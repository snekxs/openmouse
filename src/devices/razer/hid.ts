import type { MouseStatus } from "../mouse-types.ts";
import { VENDOR_ID } from "../vendors.ts";
import { RATES_1K, RAZER_PRODUCTS, type RazerProduct } from "./devices.ts";
import {
  RAZER_LANDING_MAX,
  RAZER_LANDING_MIN,
  RAZER_LIFT_OFF_MAX,
  RAZER_LIFT_OFF_MIN,
  RAZER_READ,
  RAZER_REPORT_ID,
  RAZER_STATUS,
  RAZER_TRACKING_DISTANCES,
  RAZER_TRANSACTION_ID,
  RazerProtocolError,
  decodeBatteryPercent,
  decodeCharging,
  decodeDpi,
  decodeExtendedPollingRate,
  decodeFirmwareVersion,
  decodeLegacyPollingRate,
  decodeLiftOff,
  decodeLowPowerThreshold,
  decodeRazerResponse,
  decodeSerial,
  decodeSleepTimeout,
  encodeRazerRequest,
  razerSetDpiCommand,
  razerSetExtendedPollingCommand,
  razerSetLegacyPollingCommand,
  razerMaxLanding,
  razerSetLiftOffCommand,
  razerSetTrackingDistanceCommand,
  razerEnableAsymmetricLiftOffCommand,
  razerSetLowPowerThresholdCommand,
  razerSetSleepTimeoutCommand,
  type RazerCommand,
  type RazerLiftOff,
  type RazerTrackingDistance,
} from "./protocol.ts";

// The sensor takes any whole DPI from here up to the model's ceiling, per axis.
const DPI_MIN = 100;
const RESPONSE_DELAY_MS = 100;
const RESPONSE_ATTEMPTS = 6;

// The vendor software slides from 1 to 15 minutes, so those are the bounds this
// model is meant to hold. The firmware itself accepts less — 30 s round-tripped
// exactly, below even the 60 s floor OpenRazer documents — but nothing offers
// that, so it is not offered here either.
const SLEEP_MIN_SECONDS = 60;
const SLEEP_MAX_SECONDS = 900;
const SLEEP_STEP_SECONDS = 60;
// One entry per minute, matching the vendor slider exactly rather than sampling
// it, so no offered value is an interpolation.
const SLEEP_OPTIONS: readonly number[] = Array.from(
  { length: SLEEP_MAX_SECONDS / SLEEP_STEP_SECONDS },
  (_, index) => (index + 1) * SLEEP_STEP_SECONDS,
);

// Synapse slides this from 5 to 100 percent. The value is stored on the battery
// reads' 0–255 scale, so the offered percentages are what round-trip cleanly
// through it rather than every whole percent.
const LOW_POWER_MIN_PERCENT = 5;
const LOW_POWER_MAX_PERCENT = 100;
const LOW_POWER_STEP_PERCENT = 5;
const LOW_POWER_OPTIONS: readonly number[] = Array.from(
  { length: (LOW_POWER_MAX_PERCENT - LOW_POWER_MIN_PERCENT) / LOW_POWER_STEP_PERCENT + 1 },
  (_, index) => LOW_POWER_MIN_PERCENT + index * LOW_POWER_STEP_PERCENT,
);
// Synapse states low power mode is unavailable at 2000 Hz and above, and greys
// the slider out there. The setting still reads, so this bounds the control
// rather than the command.
const LOW_POWER_MAX_POLLING_HZ = 1000;

/**
 * Razer exposes its control channel on the interface whose only collection is
 * Generic Desktop Mouse. Every other interface either belongs to a different
 * function or is a protected collection the browser will not talk to.
 */
function isMouseControlInterface(device: HIDDevice): boolean {
  const [collection, ...rest] = device.collections;
  return rest.length === 0 && collection?.usagePage === 0x01 && collection?.usage === 0x02;
}

/**
 * Older Razer mice carry the configuration channel on a vendor-defined
 * interface instead, and which one varies by hardware revision. Accepting both
 * shapes means the picker can offer either without the driver refusing it.
 */
function hasVendorCollection(device: HIDDevice): boolean {
  return device.collections.some((collection) => (collection.usagePage ?? 0) >= 0xff00);
}

export class RazerHidClient {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly staticReads = new Map<string, Promise<Uint8Array | null>>();
  // The mode probe is a write, so it runs once per connection rather than on
  // every background refresh. Both setters know which mode they leave behind,
  // so nothing after the first read needs to ask the mouse again.
  private asymmetric: boolean | null = null;
  private asymmetricKnown = false;

  readonly device: HIDDevice;

  constructor(device: HIDDevice) {
    this.device = device;
  }

  static isSupported(device: HIDDevice): boolean {
    const product = RAZER_PRODUCTS.get(device.productId);
    if (device.vendorId !== VENDOR_ID.razer || !product) return false;
    return isMouseControlInterface(device)
      || (product.vendorControlInterface === true && hasVendorCollection(device));
  }

  private profile(): RazerProduct | undefined {
    return RAZER_PRODUCTS.get(this.device.productId);
  }

  /**
   * Whether polling uses the extended command (a divisor of 8000) rather than
   * the legacy one (a divisor of 1000).
   *
   * Asked of the product rather than of the connection: the Viper 8KHz is wired
   * and needs the extended command, while the pre-HyperPolling receivers are
   * wireless and answer only the legacy one. For every model verified so far
   * this is exactly `isWireless()`, which is what it used to read.
   */
  private usesHighRatePolling(): boolean {
    return this.profile()?.highRatePolling ?? this.isWireless();
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
  }

  async close(): Promise<void> {
    this.staticReads.clear();
    this.asymmetricKnown = false;
    if (this.device.opened) await this.device.close();
  }

  displayName(): string {
    const known = this.profile();
    return known ? `Razer ${known.model}` : this.device.productName || "Razer";
  }

  isWireless(): boolean {
    return this.profile()?.wireless ?? false;
  }

  /**
   * Says so when the model has never been connected by this project.
   *
   * The commands are the ones already confirmed elsewhere, but which of them a
   * given model answers is transcribed rather than measured, so the panel
   * should not present it as the same thing as a tested mouse.
   */
  private connectionDetail(wireless: boolean): string {
    const link = wireless ? "HyperSpeed receiver" : "Wired USB";
    return this.profile()?.verified === false ? `${link} · untested model` : link;
  }

  maxDpi(): number {
    return this.profile()?.maxDpi ?? 35000;
  }

  getSupportedPollingRates(): number[] {
    return [...(this.profile()?.pollingRates ?? RATES_1K)];
  }

  /** Seconds, matching what the panel labels and what `setSleepTimeout` takes. */
  getSleepOptions(): number[] {
    return [...SLEEP_OPTIONS];
  }

  /** Whole percentages, matching the vendor slider. */
  getLowPowerOptions(): number[] {
    return [...LOW_POWER_OPTIONS];
  }

  /** The rate above which the vendor software refuses to arm low power mode. */
  getLowPowerPollingCeiling(): number {
    return LOW_POWER_MAX_POLLING_HZ;
  }

  /** Every whole value, because the control validates entries against this list. */
  getDpiOptions(): number[] {
    const options: number[] = [];
    for (let dpi = DPI_MIN; dpi <= this.maxDpi(); dpi += 1) options.push(dpi);
    return options;
  }

  async readStatus(): Promise<MouseStatus> {
    await this.open();
    const wireless = this.isWireless();
    const firmware = await this.once("firmware", () => this.request(RAZER_READ.firmware));
    if (!firmware) throw new Error("The mouse did not report a firmware version.");
    const serial = await this.once("serial", () => this.request(RAZER_READ.serial).catch(() => null));
    // A wired mouse with no cell answers battery and power-management commands
    // as unsupported, which would otherwise abort the whole status read.
    const hasBattery = this.profile()?.hasBattery !== false;
    // On a model nobody has connected, `hasBattery` is a prediction. An
    // unsupported reply throws, and this read is not optional the way sleep and
    // low power are, so it would abort the whole status read and take DPI and
    // polling down with it rather than dropping one card. Verified models still
    // fail loudly: there, a battery command that stopped answering is news.
    const battery = hasBattery
      ? await this.readBattery().catch((error: unknown) => {
        if (this.profile()?.verified === true) throw error;
        return null;
      })
      : null;
    // Both transports answer this, unlike polling. A transport that ever stops
    // reports no timeout and hides the control rather than failing the whole
    // read, which would take DPI and battery down with it.
    const sleep = hasBattery ? await this.request(RAZER_READ.sleepTimeout).catch(() => null) : null;
    const lowPower = hasBattery ? await this.request(RAZER_READ.lowPowerThreshold).catch(() => null) : null;
    const dpi = decodeDpi(await this.request(RAZER_READ.dpi));
    const pollingRateHz = await this.readPollingRateHz();
    const liftOff = await this.readLiftOff();
    return {
      brand: "Razer",
      name: this.displayName(),
      ui: {
        family: "razer",
        settingsReady: true,
        valuesVerified: true,
        hideUnsupportedPollingRates: true,
        // No sensor-processing command is confirmed, so that card is hidden
        // rather than offered and left inert. Lift-off is confirmed and
        // readable through `readLiftOff`, but `MouseStatus` cannot carry the
        // asymmetric pair yet — see the note on `liftOffDistance` below.
        hideProcessingCard: true,
        // Nothing reports link quality on this model, and the section this card
        // shares with sleep is opened below, so it would otherwise appear as a
        // permanent "signal is unavailable" placeholder.
        hideSignalCard: true,
        // Auto sleep is the only card this driver puts in that section, so the
        // section opens only when the mouse actually answered the sleep read.
        showAdvancedSection: sleep !== null,
        forceShowBattery: battery ? true : undefined,
        defaultDisplayName: this.profile()?.model,
      },
      batteryPercent: battery?.percent ?? null,
      batteryState: battery?.state ?? "Unknown",
      dpi: dpi.x,
      dpiY: dpi.y,
      supportsSeparateDpiAxes: true,
      pollingRateHz,
      supportedPollingRates: this.getSupportedPollingRates(),
      activeProfile: null,
      connectionType: wireless ? "Wireless" : "Wired",
      connectionDetail: this.connectionDetail(wireless),
      sleepTimeout: sleep ? decodeSleepTimeout(sleep) : null,
      lowBatteryWarning: lowPower ? decodeLowPowerThreshold(lowPower) : null,
      unitId: serial ? decodeSerial(serial) : null,
      liftOffDistance: liftOff?.tracking ?? null,
      // An empty list hides the control, which is what should happen on a
      // transport that does not answer class 0x0b at all.
      supportedLiftOffDistances: liftOff ? [...RAZER_TRACKING_DISTANCES] : [],
      asymmetricLiftOff: liftOff && this.hasAsymmetricLiftOff()
        ? {
          enabled: await this.asymmetricMode(liftOff),
          liftOff: liftOff.liftOff,
          landing: liftOff.landing,
          liftOffRange: { min: RAZER_LIFT_OFF_MIN, max: RAZER_LIFT_OFF_MAX },
          landingRange: { min: RAZER_LANDING_MIN, max: RAZER_LANDING_MAX },
        }
        : null,
      firmware: [`Mouse ${decodeFirmwareVersion(firmware)}`],
    };
  }

  async setDpi(dpi: number, dpiY: number = dpi): Promise<number> {
    const ceiling = this.maxDpi();
    for (const value of [dpi, dpiY]) {
      if (!Number.isInteger(value) || value < DPI_MIN || value > ceiling) {
        throw new Error(`DPI must be a whole number between ${DPI_MIN} and ${ceiling.toLocaleString()}.`);
      }
    }
    await this.request(razerSetDpiCommand(dpi, dpiY));
    const confirmed = decodeDpi(await this.request(RAZER_READ.dpi));
    if (confirmed.x !== dpi || confirmed.y !== dpiY) {
      throw new Error(`The mouse kept ${confirmed.x.toLocaleString()} DPI instead of ${dpi.toLocaleString()}.`);
    }
    return confirmed.x;
  }

  async setSleepTimeout(seconds: number): Promise<number> {
    if (!Number.isInteger(seconds) || seconds < SLEEP_MIN_SECONDS || seconds > SLEEP_MAX_SECONDS) {
      const minutes = SLEEP_MAX_SECONDS / SLEEP_STEP_SECONDS;
      throw new Error(`Auto sleep must be between 1 and ${minutes} minutes.`);
    }
    await this.request(razerSetSleepTimeoutCommand(seconds));
    const confirmed = decodeSleepTimeout(await this.request(RAZER_READ.sleepTimeout));
    if (confirmed !== seconds) {
      throw new Error(`The mouse kept ${confirmed} seconds instead of ${seconds}.`);
    }
    return confirmed;
  }

  async setLowPowerThreshold(percent: number): Promise<number> {
    // A range rather than the offered list: the panel adds the mouse's own value
    // when it sits off the five-point step, and that value must stay writable.
    if (!Number.isInteger(percent) || percent < LOW_POWER_MIN_PERCENT || percent > LOW_POWER_MAX_PERCENT) {
      throw new Error(`Low power mode must be between ${LOW_POWER_MIN_PERCENT}% and ${LOW_POWER_MAX_PERCENT}%.`);
    }
    // Asked of the mouse, not the panel. Staging a polling change repaints the
    // control as disabled without withdrawing a threshold already queued behind
    // it, so the disabled select cannot be what enforces this.
    const pollingRateHz = await this.readPollingRateHz();
    if (pollingRateHz > LOW_POWER_MAX_POLLING_HZ) {
      throw new Error(
        `Low power mode is unavailable at ${pollingRateHz.toLocaleString()} Hz.`
        + ` Set the polling rate to ${LOW_POWER_MAX_POLLING_HZ.toLocaleString()} Hz or lower first.`,
      );
    }
    await this.request(razerSetLowPowerThresholdCommand(percent));
    const confirmed = decodeLowPowerThreshold(await this.request(RAZER_READ.lowPowerThreshold));
    if (confirmed !== percent) {
      throw new Error(`The mouse kept ${confirmed}% instead of ${percent}%.`);
    }
    return confirmed;
  }

  async setPollingRate(pollingRateHz: number): Promise<number> {
    if (!this.getSupportedPollingRates().includes(pollingRateHz)) {
      throw new Error(`This mouse does not support ${pollingRateHz.toLocaleString()} Hz on this connection.`);
    }
    await this.request(this.usesHighRatePolling()
      ? razerSetExtendedPollingCommand(pollingRateHz)
      : razerSetLegacyPollingCommand(pollingRateHz));
    const confirmed = await this.readPollingRateHz();
    if (confirmed !== pollingRateHz) {
      throw new Error(`The mouse kept ${confirmed.toLocaleString()} Hz instead of ${pollingRateHz.toLocaleString()} Hz.`);
    }
    return confirmed;
  }

  private async readBattery(): Promise<{ percent: number; state: MouseStatus["batteryState"] }> {
    const level = await this.request(RAZER_READ.battery);
    const charging = decodeCharging(await this.request(RAZER_READ.charging));
    return { percent: decodeBatteryPercent(level), state: charging ? "Charging" : "Discharging" };
  }

  /**
   * Reads the tracking level and the asymmetric lift-off/landing pair.
   *
   * Returns null when the mouse does not answer. Class `0x0b` has only ever
   * been exercised on the receiver, so the cable may reject it, and a status
   * read that throws takes the whole panel down rather than one control. The
   * caller degrades instead.
   */
  async readLiftOff(): Promise<RazerLiftOff | null> {
    const reply = await this.request(RAZER_READ.liftOff).catch(() => null);
    return reply ? decodeLiftOff(reply) : null;
  }

  /**
   * Reports whether the mouse is currently in asymmetric mode, or null when it
   * cannot be established.
   *
   * Nothing readable carries the mode — two 47-command captures differing only
   * by it were byte-identical, and a full sweep found nothing. What does report
   * it is the pair write's own status: refused `0x03` in symmetric mode,
   * accepted `0x02` in asymmetric.
   *
   * That makes this a probe rather than a read, so it is written to disturb
   * nothing. Re-sending the values the mirror already holds is value-preserving
   * either way, and mode-preserving too: a refusal cannot switch the mode, and
   * an acceptance re-selects the mode the mouse was already in.
   *
   * Call it once per connection, not on every refresh — it is still a write.
   */
  async probeAsymmetric(current: RazerLiftOff): Promise<boolean | null> {
    // The firmware stores an inverted pair without complaint, and one session
    // left it holding lift-off 2 with landing 26. Probing with that would throw
    // in the command builder, so report "unknown" rather than guessing.
    if (current.landing >= current.liftOff) return null;
    try {
      await this.request(razerSetLiftOffCommand(current.liftOff, current.landing));
      return true;
    } catch (error) {
      if (error instanceof RazerProtocolError && error.status === RAZER_STATUS.failure) return false;
      return null;
    }
  }

  /**
   * Whether this model stores a separate lift-off/landing pair at all.
   *
   * Establishing the mode costs a *write*, so it is only attempted where the
   * pair commands have been confirmed on hardware. A model that has not been
   * connected keeps the plain three-stop tracking control instead, which costs
   * reads only.
   */
  private hasAsymmetricLiftOff(): boolean {
    return this.profile()?.asymmetricLiftOff === true;
  }

  /** Probes once, then trusts what the setters leave behind. */
  private async asymmetricMode(current: RazerLiftOff): Promise<boolean | null> {
    if (!this.asymmetricKnown) {
      this.asymmetric = await this.probeAsymmetric(current);
      this.asymmetricKnown = true;
    }
    return this.asymmetric;
  }

  /**
   * Selects the symmetric tracking distance, which also takes the mouse out of
   * asymmetric mode — it honours whichever store was written last, and there is
   * no mode flag to clear.
   *
   * Named for the shell's driver contract rather than the vendor's wording; the
   * vendor calls this the tracking distance.
   */
  async setLiftOffDistance(distance: RazerTrackingDistance): Promise<RazerTrackingDistance> {
    await this.request(razerSetTrackingDistanceCommand(distance));
    const confirmed = decodeLiftOff(await this.request(RAZER_READ.liftOff));
    if (confirmed.tracking !== distance) {
      throw new Error(`The mouse kept ${confirmed.tracking ?? "an unknown"} tracking distance instead of ${distance}.`);
    }
    this.asymmetric = false;
    this.asymmetricKnown = true;
    return distance;
  }

  /**
   * Writes the asymmetric pair, and switches the mouse into asymmetric mode to
   * do it. The tracking level shares the same reply but not the same write, so
   * it is left as the mouse holds it.
   *
   * Landing is capped just below lift-off rather than rejected, because
   * lowering lift-off past an already-set landing is ordinary use of a pair of
   * controls and the vendor software caps its own slider the same way. The
   * returned values are what the mouse ended up holding, not what was asked
   * for, so a caller can render the cap rather than guess at it.
   */
  async setLiftOff(liftOff: number, landing: number): Promise<RazerLiftOff> {
    const capped = Math.min(landing, razerMaxLanding(liftOff));
    // Built before anything is sent, so a rejected value costs no device
    // traffic and cannot leave the mouse switched into asymmetric mode over a
    // write that never happened. `razerSetLiftOffCommand` validates lift-off
    // before landing, so an out-of-range lift-off still reports itself rather
    // than being masked by the landing it drags out of range here.
    const command = razerSetLiftOffCommand(liftOff, capped);
    // The pair write is refused in symmetric mode — and refused while still
    // moving what the read reports, so skipping this yields a driver that looks
    // like it works and never reaches the sensor.
    await this.request(razerEnableAsymmetricLiftOffCommand());
    await this.request(command);
    // Rejected writes on this command still disturb the stored pair, so the
    // read-back is a genuine check, not a formality. Tracking is excluded — it
    // was never part of the write.
    const confirmed = decodeLiftOff(await this.request(RAZER_READ.liftOff));
    if (confirmed.liftOff !== liftOff || confirmed.landing !== capped) {
      throw new Error(`The mouse kept lift-off ${confirmed.liftOff} and landing ${confirmed.landing} instead of ${liftOff} and ${capped}.`);
    }
    this.asymmetric = true;
    this.asymmetricKnown = true;
    return confirmed;
  }

  /**
   * Wired answers only the legacy command and the receiver only the extended
   * one, so ask for the expected one first and keep the other as a fallback.
   * Asking in the wrong order costs a failed exchange on every refresh.
   */
  private async readPollingRateHz(): Promise<number> {
    const extended = [RAZER_READ.pollingRateExtended, decodeExtendedPollingRate] as const;
    const legacy = [RAZER_READ.pollingRate, decodeLegacyPollingRate] as const;
    for (const [command, decode] of this.usesHighRatePolling() ? [extended, legacy] : [legacy, extended]) {
      const reply = await this.request(command).catch(() => null);
      if (reply) return decode(reply);
    }
    throw new Error("The mouse did not report a polling rate.");
  }

  private once(key: string, read: () => Promise<Uint8Array | null>): Promise<Uint8Array | null> {
    const pending = this.staticReads.get(key);
    if (pending) return pending;
    const started = read();
    this.staticReads.set(key, started);
    started.catch(() => this.staticReads.delete(key));
    return started;
  }

  private async request(command: RazerCommand): Promise<Uint8Array> {
    const run = this.queue.then(() => this.exchange(command), () => this.exchange(command));
    this.queue = run.catch(() => undefined);
    return await run;
  }

  private async exchange(command: RazerCommand): Promise<Uint8Array> {
    await this.open();
    const transactionId = this.profile()?.transactionId ?? RAZER_TRANSACTION_ID;
    await this.device.sendFeatureReport(RAZER_REPORT_ID, encodeRazerRequest(command, transactionId));
    for (let attempt = 0; attempt < RESPONSE_ATTEMPTS; attempt += 1) {
      await this.delay(RESPONSE_DELAY_MS);
      const reply = this.copyDataView(await this.device.receiveFeatureReport(RAZER_REPORT_ID));
      try {
        return decodeRazerResponse(reply, command);
      } catch (error) {
        if (error instanceof RazerProtocolError && error.status === RAZER_STATUS.busy) continue;
        throw error;
      }
    }
    throw new Error("The mouse stayed busy — it may be asleep or out of range.");
  }

  private copyDataView(view: DataView): Uint8Array {
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
}
