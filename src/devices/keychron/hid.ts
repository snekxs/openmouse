import type { MouseStatus } from "../mouse-types.ts";
import { KEYCHRON_PRODUCT_IDS, VENDOR_ID } from "../vendors.ts";

const RAW_USAGE_PAGE = 0xff60;
const RAW_USAGE = 0x61;
const REPORT_ID = 0;
const PACKET_LENGTH = 32;
const QUERY_TIMEOUT_MS = 1200;

const PRODUCTS = new Map<number, { name: string; receiver?: boolean }>([
  [0x0440, { name: "Nape Pro" }],
  [0xd026, { name: "Keychron Link-KM", receiver: true }],
  [0xd029, { name: "Keychron Link-KM Type C", receiver: true }],
]);

const CMD = {
  firmwareVersion: 161,
  miscGroup: 167,
} as const;

const NAPE = {
  getDpiStage: 33,
  setDpiStage: 34,
  setDpiValue: 35,
  getDpiValue: 36,
  getBattery: 49,
  getOrientation: 32,
  getCustomDpi: 54,
  setCustomDpi: 55,
} as const;

const MISC = {
  getPolling: 13,
  setPolling: 14,
} as const;

const DPI_STAGE_COUNT = 5;
const DPI_MIN = 50;
const DPI_MAX = 3200;
const DPI_STEP = 50;
const ORIENTATION_STEPS = 8;
const POLLING_TABLE = [8000, 4000, 2000, 1000, 500, 250, 125] as const;
const NAPE_DISPLAY_NAME = "Nape Pro";
const PRODUCT_IDS = new Set<number>(KEYCHRON_PRODUCT_IDS);

export class KeychronHidClient {
  private responseWaiter: {
    match: (bytes: Uint8Array) => boolean;
    resolve: (bytes: Uint8Array) => void;
    reject: (reason: Error) => void;
  } | null = null;

  private napeVerified: boolean | null = null;
  readonly device: HIDDevice;

  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    const bytes = new Uint8Array(
      event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength),
    );
    if (!this.responseWaiter?.match(bytes)) return;
    const waiter = this.responseWaiter;
    this.responseWaiter = null;
    waiter.resolve(bytes);
  };

  constructor(device: HIDDevice) {
    this.device = device;
  }
  static isSupported(device: HIDDevice): boolean {
    return device.vendorId === VENDOR_ID.keychron
      && PRODUCT_IDS.has(device.productId)
      && device.collections.some((collection) =>
        collection.usagePage === RAW_USAGE_PAGE && collection.usage === RAW_USAGE);
  }

  private openedListener = false;

  async open(): Promise<void> {
    await this.openDevice();
    await this.ensureNapeCompatible();
  }

  private async openDevice(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    if (!this.openedListener) {
      this.device.addEventListener("inputreport", this.onInputReport);
      this.openedListener = true;
    }
  }

  async close(): Promise<void> {
    if (this.openedListener) {
      this.device.removeEventListener("inputreport", this.onInputReport);
      this.openedListener = false;
    }
    this.responseWaiter?.reject(new Error("The Keychron device was closed."));
    this.responseWaiter = null;
    this.napeVerified = null;
    if (this.device.opened) await this.device.close();
  }

  private isReceiver(): boolean {
    return PRODUCTS.get(this.device.productId)?.receiver === true;
  }

  private async ensureNapeCompatible(): Promise<void> {
    if (!this.isReceiver()) {
      this.napeVerified = true;
      return;
    }
    if (this.napeVerified === true) return;
    if (this.napeVerified === false) {
      throw new Error(this.incompatibleReceiverMessage());
    }

    try {
      const orientationIndex = await this.getOrientationIndex();
      if (orientationIndex < 0 || orientationIndex >= ORIENTATION_STEPS) {
        throw new Error("orientation out of range");
      }
      const stage = await this.getDpiStage();
      const dpi = await this.getDpiValue(stage);
      if (dpi < DPI_MIN || dpi > DPI_MAX || dpi % DPI_STEP !== 0) {
        throw new Error(`dpi ${dpi} outside Nape Pro range`);
      }
      this.napeVerified = true;
    } catch (error) {
      this.napeVerified = false;
      await this.close().catch(() => undefined);
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${this.incompatibleReceiverMessage()} (${detail})`);
    }
  }

  private incompatibleReceiverMessage(): string {
    const receiver = PRODUCTS.get(this.device.productId)?.name ?? "Keychron receiver";
    return `This ${receiver} is not paired to a Nape Pro that OpenMouse can control. `
      + "Use the wired cable, or pair a supported Keychron mouse to the receiver.";
  }

  getDpiOptions(): number[] {
    const options: number[] = [];
    for (let dpi = DPI_MIN; dpi <= DPI_MAX; dpi += DPI_STEP) options.push(dpi);
    return options;
  }

  async readStatus(): Promise<MouseStatus> {
    await this.open();
    const firmware = await this.getFirmwareVersion().catch(() => null);
    const stage = await this.getDpiStage();
    const stages = await this.getAllDpiValues();
    const battery = await this.getBattery().catch(() => null);
    const polling = await this.getPolling().catch(() => null);
    const orientation = await this.getOrientation().catch(() => null);
    const active = stages.find((entry) => entry.index === stage) ?? stages[0];
    const dpi = active?.value ?? 800;
    const product = PRODUCTS.get(this.device.productId);
    const viaReceiver = product?.receiver === true;
    const displayName = viaReceiver
      ? NAPE_DISPLAY_NAME
      : (product?.name || this.device.productName || NAPE_DISPLAY_NAME);
    const connectionDetail = [
      viaReceiver ? `2.4 GHz (${product?.name ?? "receiver"})` : "Wired USB",
      orientation !== null ? `${orientation}\u00b0 orientation` : null,
      `DPI stage ${stage + 1}/${DPI_STAGE_COUNT}`,
    ].filter(Boolean).join(" · ");

    return {
      brand: "Keychron",
      name: displayName,
      ui: {
        family: "keychron-nape",
        defaultDisplayName: NAPE_DISPLAY_NAME,
        hideUnsupportedPollingRates: true,
        hideProcessingCard: true,
        forceShowBattery: true,
        pollingNote: "Nape Pro exposes polling through Keychron's misc HID commands when the firmware allows it.",
      },
      batteryPercent: battery && battery.percent <= 100 ? battery.percent : null,
      batteryState: battery ? battery.state : "Unknown",
      dpi,
      pollingRateHz: polling?.rateHz ?? 1000,
      supportedPollingRates: polling?.supported ?? [1000],
      activeProfile: null,
      connectionDetail: connectionDetail || "Keychron Launcher protocol",
      liftOffDistance: null,
      supportedLiftOffDistances: [],
      firmware: [firmware ?? "Firmware unavailable"],
    };
  }

  async setDpi(dpi: number): Promise<number> {
    if (dpi < DPI_MIN || dpi > DPI_MAX) {
      throw new Error(`Nape Pro DPI must be between ${DPI_MIN} and ${DPI_MAX}.`);
    }
    await this.open();
    const stage = await this.getDpiStage();
    // Launcher writes are fire-and-forget (no matching input report).
    await this.write([CMD.miscGroup, NAPE.setDpiValue, stage & 0xff, dpi & 0xff, (dpi >> 8) & 0xff]);
    await this.write([CMD.miscGroup, NAPE.setDpiStage, stage & 0xff]);
    const confirmed = await this.getDpiValue(stage);
    if (confirmed !== dpi) {
      await this.write([CMD.miscGroup, NAPE.setCustomDpi, dpi & 0xff, (dpi >> 8) & 0xff]);
      return await this.getCustomDpi().catch(async () => this.getDpiValue(await this.getDpiStage()));
    }
    return confirmed;
  }

  async setPollingRate(pollingRateHz: number): Promise<number> {
    await this.open();
    const current = await this.getPolling();
    if (!current.supported.includes(pollingRateHz)) {
      throw new Error(`This Nape Pro connection does not support ${pollingRateHz} Hz.`);
    }
    const shift = POLLING_TABLE.indexOf(pollingRateHz as (typeof POLLING_TABLE)[number]);
    if (shift < 0) throw new Error(`Unsupported polling rate ${pollingRateHz} Hz.`);
    await this.write([CMD.miscGroup, MISC.setPolling, shift & 0xff, shift & 0xff]);
    return (await this.getPolling()).rateHz;
  }

  async setLiftOffDistance(_lod: NonNullable<MouseStatus["liftOffDistance"]>): Promise<never> {
    throw new Error("Lift-off distance is not exposed by the Nape Pro Launcher protocol.");
  }

  async setMotionSync(_enabled: boolean): Promise<never> {
    throw new Error("Motion Sync is not exposed by the Nape Pro Launcher protocol.");
  }

  async setAngleSnapping(_enabled: boolean): Promise<never> {
    throw new Error("Angle snapping is not exposed by the Nape Pro Launcher protocol.");
  }

  async setRippleControl(_enabled: boolean): Promise<never> {
    throw new Error("Ripple control is not exposed by the Nape Pro Launcher protocol.");
  }

  async setDebounceTime(_debounceMs: number): Promise<never> {
    throw new Error("Debounce is not exposed by the Nape Pro Launcher protocol.");
  }

  async setSleepTimeout(_timeout: number): Promise<never> {
    throw new Error("Sleep timeout is not exposed by the Nape Pro Launcher protocol.");
  }

  async setPerformanceMode(_enabled: boolean): Promise<never> {
    throw new Error("Performance mode is not exposed by the Nape Pro Launcher protocol.");
  }

  private async getDpiStage(): Promise<number> {
    const response = await this.query(
      (bytes) => bytes[0] === CMD.miscGroup && bytes[1] === NAPE.getDpiStage,
      [CMD.miscGroup, NAPE.getDpiStage],
    );
    return Math.min(response[2] ?? 0, DPI_STAGE_COUNT - 1);
  }

  private async getDpiValue(stage: number): Promise<number> {
    const response = await this.query(
      (bytes) => bytes[0] === CMD.miscGroup && bytes[1] === NAPE.getDpiValue,
      [CMD.miscGroup, NAPE.getDpiValue, stage & 0xff],
    );
    return (response[2] ?? 0) | ((response[3] ?? 0) << 8);
  }

  private async getAllDpiValues(): Promise<Array<{ index: number; value: number }>> {
    const values: Array<{ index: number; value: number }> = [];
    for (let index = 0; index < DPI_STAGE_COUNT; index += 1) {
      try {
        values.push({ index, value: await this.getDpiValue(index) });
      } catch {
        break;
      }
    }
    return values;
  }

  private async getBattery(): Promise<{ percent: number; state: MouseStatus["batteryState"] }> {
    const response = await this.query(
      (bytes) => bytes[0] === CMD.miscGroup && bytes[1] === NAPE.getBattery,
      [CMD.miscGroup, NAPE.getBattery],
    );
    const percent = response[2] ?? 0xff;
    const status = response[3] ?? 0;
    const state: MouseStatus["batteryState"] = status === 1
      ? "Charging"
      : status === 2
        ? "Full"
        : "Discharging";
    return { percent, state };
  }

  private async getOrientationIndex(): Promise<number> {
    const response = await this.query(
      (bytes) => bytes[0] === CMD.miscGroup && bytes[1] === NAPE.getOrientation,
      [CMD.miscGroup, NAPE.getOrientation],
    );
    return response[2] ?? 0xff;
  }

  private async getOrientation(): Promise<number | null> {
    const index = await this.getOrientationIndex();
    if (index < 0 || index >= ORIENTATION_STEPS) return null;
    return 45 * index;
  }

  private async getCustomDpi(): Promise<number> {
    const response = await this.query(
      (bytes) => bytes[0] === CMD.miscGroup && bytes[1] === NAPE.getCustomDpi,
      [CMD.miscGroup, NAPE.getCustomDpi],
    );
    return (response[2] ?? 0) | ((response[3] ?? 0) << 8);
  }

  private async getPolling(): Promise<{ rateHz: number; supported: number[] }> {
    const response = await this.query(
      (bytes) => bytes[0] === CMD.miscGroup && bytes[1] === MISC.getPolling,
      [CMD.miscGroup, MISC.getPolling],
    );
    // Keychron Launcher treats an empty/zero payload as a 1 kHz-only device.
    if (response.slice(2).every((byte) => byte === 0)) {
      return { rateHz: 1000, supported: [125, 500, 1000] };
    }
    const supportMask = response[5] ?? 0;
    const supported = POLLING_TABLE.filter((_, index) => ((supportMask >> index) & 1) === 1)
      .slice()
      .sort((a, b) => a - b);
    const shift = response[6] ?? 3;
    const rateHz = POLLING_TABLE[Math.min(shift, POLLING_TABLE.length - 1)] ?? 1000;
    return {
      rateHz,
      supported: supported.length > 0 ? supported : [rateHz],
    };
  }

  private async getFirmwareVersion(): Promise<string | null> {
    const response = await this.query(
      (bytes) => bytes[0] === CMD.firmwareVersion,
      [CMD.firmwareVersion],
    );
    const chars: string[] = [];
    for (let index = 1; index < response.length; index += 1) {
      const code = response[index] ?? 0;
      if (code === 0) break;
      chars.push(String.fromCharCode(code));
    }
    if (chars.length === 0) return null;
    const text = chars.join("");
    return text.startsWith("v") ? text : `v${text}`;
  }

  private async write(command: number[]): Promise<void> {
    const packet = new Uint8Array(PACKET_LENGTH);
    packet.set(command.slice(0, PACKET_LENGTH));
    await this.device.sendReport(REPORT_ID, packet);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
  }

  private async query(match: (bytes: Uint8Array) => boolean, command: number[]): Promise<Uint8Array> {
    if (this.responseWaiter) throw new Error("Another Keychron request is already in progress.");
    const packet = new Uint8Array(PACKET_LENGTH);
    packet.set(command.slice(0, PACKET_LENGTH));
    let timeout = 0;
    let rejectResponse: ((reason: Error) => void) | null = null;
    const response = new Promise<Uint8Array>((resolve, reject) => {
      rejectResponse = reject;
      timeout = window.setTimeout(() => {
        this.responseWaiter = null;
        reject(new Error(`The Keychron device did not answer command 0x${command[0]?.toString(16)}.`));
      }, QUERY_TIMEOUT_MS);
      this.responseWaiter = {
        match,
        resolve: (bytes) => {
          window.clearTimeout(timeout);
          resolve(bytes);
        },
        reject: (reason) => {
          window.clearTimeout(timeout);
          reject(reason);
        },
      };
    });
    void response.catch(() => undefined);
    try {
      await this.device.sendReport(REPORT_ID, packet);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      (rejectResponse as ((reason: Error) => void) | null)?.(new Error(`Chrome could not write Keychron HID report. ${detail}`));
      this.responseWaiter = null;
    }
    return await response;
  }
}
