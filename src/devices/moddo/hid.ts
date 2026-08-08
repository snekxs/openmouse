import type { MouseStatus } from "../mouse-types.ts";
import {
  decodeModdoBattery,
  decodeModdoConfig,
  decodeModdoFirmware,
  decodeModdoLift,
  encodeModdoConfig,
  encodeModdoLift,
  isValidModdoDpi,
  moddoDpiOptions,
  MODDO_DPI_MAX,
  MODDO_DPI_MIN,
  MODDO_DPI_STEP,
  MODDO_REPORT,
  MODDO_SUPPORTED_POLLING_RATES,
  MODDO_USAGE_PAGE_VENDOR,
  MODDO_USAGE_VENDOR_CONFIG,
  MODDO_USAGE_VENDOR_CONFIG_LEGACY,
  MODDO_VENDOR_ID,
  type ModdoBattery,
  type ModdoConfig,
  type ModdoFirmware,
} from "./protocol.ts";

// The firmware applies config writes fire-and-forget, so a read-back can briefly
// still show the old value (especially over the 2.4 GHz dongle). Settle and retry
// before deciding a write failed.
const WRITE_SETTLE_MS = 60;
const WRITE_CONFIRM_ATTEMPTS = 5;

/**
 * moddoMOUSE (moddo.io) vendor HID control.
 *
 * Transport: vendor usage page 0xFF, usage 0x01 (or legacy 0x02) under VID 0x2FE3.
 * All packing/parsing lives in ./protocol; this class is the WebHID I/O around it.
 */
export class ModdoHidClient {
  readonly device: HIDDevice;

  constructor(device: HIDDevice) {
    this.device = device;
  }

  static isSupported(device: HIDDevice): boolean {
    if (device.vendorId !== MODDO_VENDOR_ID) return false;
    const hasVendorConfig = (collections: readonly HIDCollectionInfo[]): boolean =>
      collections.some((collection) =>
        (collection.usagePage === MODDO_USAGE_PAGE_VENDOR
          && (collection.usage === MODDO_USAGE_VENDOR_CONFIG || collection.usage === MODDO_USAGE_VENDOR_CONFIG_LEGACY))
        || hasVendorConfig(collection.children));
    return hasVendorConfig(device.collections);
  }

  get supportedPollingRates(): number[] {
    return [...MODDO_SUPPORTED_POLLING_RATES];
  }

  getDpiOptions(): number[] {
    return moddoDpiOptions();
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }

  async readStatus(): Promise<MouseStatus> {
    await this.open();
    // readConfig rejects a zeroed/asleep report, so a null here means "not ready"
    // and the grid stays hidden instead of showing 0 DPI / 0 Hz.
    const config = await this.readConfig().catch(() => null);
    const battery = await this.readBattery().catch(
      (): ModdoBattery => ({ percent: null, state: "Unknown" }),
    );
    const firmware = await this.readFirmware().catch(() => null);
    const wireless = firmware?.dongleConnected ?? false;

    return {
      brand: "moddoMOUSE",
      name: "moddoMOUSE",
      ui: {
        family: "moddo",
        settingsReady: config !== null,
        hideLodLow: true,
        hideUnsupportedPollingRates: true,
        hideProcessingCard: true,
        defaultDisplayName: "moddoMOUSE",
      },
      batteryPercent: battery.percent,
      batteryState: battery.state,
      dpi: config?.dpiX ?? 1600,
      dpiY: config?.dpiY ?? config?.dpiX ?? 1600,
      pollingRateHz: config?.polling ?? 1000,
      supportedPollingRates: this.supportedPollingRates,
      activeProfile: null,
      connectionType: wireless ? "Wireless" : "Wired",
      connectionDetail: wireless ? "2.4 GHz receiver" : "USB",
      liftOffDistance: config ? decodeModdoLift(config.lift) : null,
      firmware: this.firmwareLines(firmware),
    };
  }

  async setDpi(dpi: number, dpiY: number = dpi): Promise<number> {
    for (const value of [dpi, dpiY]) {
      if (!isValidModdoDpi(value)) {
        throw new Error(
          `moddoMOUSE DPI must be ${MODDO_DPI_MIN}–${MODDO_DPI_MAX.toLocaleString()} in ${MODDO_DPI_STEP} DPI steps.`,
        );
      }
    }
    await this.open();
    const config = await this.readConfig();
    await this.writeConfig({ ...config, dpiX: dpi, dpiY });
    const confirmed = await this.confirmConfig((c) => c.dpiX === dpi && c.dpiY === dpiY);
    if (confirmed.dpiX !== dpi || confirmed.dpiY !== dpiY) {
      throw new Error(`The mouse kept ${confirmed.dpiX.toLocaleString()} DPI instead of ${dpi.toLocaleString()}.`);
    }
    return confirmed.dpiX;
  }

  async setPollingRate(rate: number): Promise<number> {
    if (!(MODDO_SUPPORTED_POLLING_RATES as readonly number[]).includes(rate)) {
      throw new Error("moddoMOUSE supports 125, 250, 500, or 1000 Hz report rate.");
    }
    await this.open();
    const config = await this.readConfig();
    await this.writeConfig({ ...config, polling: rate });
    const confirmed = await this.confirmConfig((c) => c.polling === rate);
    if (confirmed.polling !== rate) {
      throw new Error(
        `The mouse kept ${confirmed.polling.toLocaleString()} Hz instead of ${rate.toLocaleString()} Hz.`,
      );
    }
    return confirmed.polling;
  }

  async setLiftOffDistance(value: NonNullable<MouseStatus["liftOffDistance"]>): Promise<void> {
    if (value === "Low") {
      throw new Error("The moddoMOUSE supports 1 mm (Medium) or 2 mm (High) lift-off distance.");
    }
    const encoded = encodeModdoLift(value);
    await this.open();
    const config = await this.readConfig();
    await this.writeConfig({ ...config, lift: encoded });
    const confirmed = await this.confirmConfig((c) => c.lift === encoded);
    if (confirmed.lift !== encoded) {
      throw new Error(
        `The mouse kept ${decodeModdoLift(confirmed.lift) ?? "an unknown"} lift-off distance instead of ${value}.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Report I/O
  // ---------------------------------------------------------------------------

  private async readConfig(): Promise<ModdoConfig> {
    const config = decodeModdoConfig(this.payload(await this.device.receiveFeatureReport(MODDO_REPORT.config)));
    if (!config) throw new Error("moddoMOUSE settings are not ready yet — wake the mouse and try again.");
    return config;
  }

  private async writeConfig(config: ModdoConfig): Promise<void> {
    await this.device.sendFeatureReport(MODDO_REPORT.config, encodeModdoConfig(config));
  }

  /** Re-read the config until it matches, tolerating fire-and-forget write latency. */
  private async confirmConfig(matches: (config: ModdoConfig) => boolean): Promise<ModdoConfig> {
    let config = await this.readConfig();
    for (let attempt = 1; attempt < WRITE_CONFIRM_ATTEMPTS && !matches(config); attempt += 1) {
      await this.delay(WRITE_SETTLE_MS);
      config = await this.readConfig();
    }
    return config;
  }

  private async readBattery(): Promise<ModdoBattery> {
    return decodeModdoBattery(this.payload(await this.device.receiveFeatureReport(MODDO_REPORT.battery)));
  }

  private async readFirmware(): Promise<ModdoFirmware> {
    return decodeModdoFirmware(this.payload(await this.device.receiveFeatureReport(MODDO_REPORT.firmware)));
  }

  private firmwareLines(firmware: ModdoFirmware | null): string[] {
    const lines = [firmware?.mouse ? `Mouse v${firmware.mouse}` : "Mouse firmware unavailable"];
    if (firmware?.dongle) lines.push(`Dongle v${firmware.dongle}`);
    return lines;
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  /** WebHID feature reports carry the report id as byte 0; return the bytes past it. */
  private payload(view: DataView): Uint8Array {
    return new Uint8Array(view.buffer, view.byteOffset + 1, Math.max(0, view.byteLength - 1));
  }
}
