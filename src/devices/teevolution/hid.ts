import type { MouseStatus } from "../mouse-types.ts";
import { VENDOR_ID } from "../vendors.ts";
import {
  TEEVOLUTION_COMMAND,
  TEEVOLUTION_FLASH,
  TEEVOLUTION_PRODUCT_IDS,
  TEEVOLUTION_REPORT_ID,
  TEEVOLUTION_TYPE_MAX_POLL,
  teevolutionBuildOnlinePayload,
  teevolutionBuildReadPayload,
  teevolutionBuildSimplePayload,
  teevolutionBuildWritePayload,
  teevolutionDecodeDpiLightBrightness,
  teevolutionDecodeDpiLightMode,
  teevolutionDecodeDpi,
  teevolutionDecodeFirmwareVersion,
  teevolutionDecodeLiftOff,
  teevolutionDecodePollingRate,
  teevolutionDecodeSensorModeStored,
  teevolutionDpiOptions,
  teevolutionEncodeDpiLightBrightness,
  teevolutionEncodeDpi,
  teevolutionEncodeLiftOff,
  teevolutionEncodePollingRate,
  teevolutionEncodeSensorMode,
  teevolutionPacketChecksum,
  teevolutionParseBattery,
  teevolutionParseReadResponse,
  teevolutionProfileForCid,
  teevolutionSensorModeUi,
  type TeevolutionDeviceProfile,
} from "./protocol.ts";

export interface TeevolutionDeviceInfo {
  cid: number;
  mid: number;
  type: number;
  dongleType: number;
  connection: "Wired" | "Wireless";
  maximumPollingRateHz: number;
  profile: TeevolutionDeviceProfile;
}

export class TeevolutionHidClient {
  private deviceInfo: TeevolutionDeviceInfo | null = null;
  private responseWaiter: {
    command: number;
    resolve: (bytes: Uint8Array) => void;
    reject: (reason: Error) => void;
  } | null = null;

  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    const bytes = new Uint8Array(
      event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength),
    );
    if (event.reportId === TEEVOLUTION_REPORT_ID && bytes[0] === this.responseWaiter?.command) {
      const waiter = this.responseWaiter;
      this.responseWaiter = null;
      waiter.resolve(bytes);
    }
  };

  readonly device: HIDDevice;

  constructor(device: HIDDevice) {
    this.device = device;
  }

  static isSupported(device: HIDDevice): boolean {
    return device.vendorId === VENDOR_ID.teevolution
      && TEEVOLUTION_PRODUCT_IDS.has(device.productId)
      && device.collections.some((collection) =>
        collection.inputReports.length === 1
        && collection.outputReports.length === 1
        && collection.inputReports[0]?.reportId === TEEVOLUTION_REPORT_ID
        && collection.outputReports[0]?.reportId === TEEVOLUTION_REPORT_ID);
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    this.device.addEventListener("inputreport", this.onInputReport);
  }

  describeCollections(): string {
    return this.device.collections.map((collection) => {
      const inputIds = collection.inputReports.map((report) => report.reportId);
      const outputIds = collection.outputReports.map((report) => report.reportId);
      const featureIds = collection.featureReports.map((report) => report.reportId);
      return [
        `usage 0x${collection.usagePage.toString(16)}:${collection.usage.toString(16)}`,
        `in [${inputIds.join(", ") || "none"}]`,
        `out [${outputIds.join(", ") || "none"}]`,
        `feature [${featureIds.join(", ") || "none"}]`,
      ].join(" · ");
    }).join(" | ") || "No HID collections reported";
  }

  async readDeviceInfo(): Promise<TeevolutionDeviceInfo> {
    await this.open();
    const challenge = new Uint8Array(8);
    crypto.getRandomValues(challenge);
    challenge.fill(0, 4);
    const response = await this.query(TEEVOLUTION_COMMAND.encryptionData, challenge);
    this.assertAccepted(response, "identification");
    const cid = response[9] ?? 0;
    const profile = teevolutionProfileForCid(cid);
    if (!profile) {
      throw new Error(`Unsupported Teevolution model (CID 0x${cid.toString(16).padStart(2, "0")}). No flash settings were read or written.`);
    }
    const type = response[11] ?? 0xff;
    this.deviceInfo = {
      cid,
      mid: response[10] ?? 0,
      type,
      dongleType: response[12] ?? 0,
      connection: type === 2 || type === 3 ? "Wired" : "Wireless",
      maximumPollingRateHz: TEEVOLUTION_TYPE_MAX_POLL[type] ?? 1000,
      profile,
    };
    return this.deviceInfo;
  }

  async readStatus(): Promise<MouseStatus> {
    const info = this.deviceInfo ?? await this.readDeviceInfo();
    return await this.withDeviceControl(async () => {
      const flash = await this.readFlash(TEEVOLUTION_FLASH.reportRate, TEEVOLUTION_FLASH.sensorMode + 2);
      const batteryResponse = await this.query(TEEVOLUTION_COMMAND.batteryLevel);
      const deviceVersion = await this.query(TEEVOLUTION_COMMAND.readVersionId);
      const dongleVersion = await this.query(TEEVOLUTION_COMMAND.getDongleVersion).catch(() => null);
      const profile = await this.query(TEEVOLUTION_COMMAND.getCurrentConfig).catch(() => null);
      const rssi = await this.query(TEEVOLUTION_COMMAND.getRssi).catch(() => null);
      const currentDpi = Math.min(
        flash[TEEVOLUTION_FLASH.currentDpi] ?? 0,
        info.profile.dpiStageCount - 1,
      );
      const dpi = teevolutionDecodeDpi(
        flash.slice(TEEVOLUTION_FLASH.dpiValues + currentDpi * 4, TEEVOLUTION_FLASH.dpiValues + currentDpi * 4 + 4),
      );
      const battery = teevolutionParseBattery(batteryResponse);
      const pollingRateHz = teevolutionDecodePollingRate(flash[TEEVOLUTION_FLASH.reportRate] ?? 1);
      const sensorModeUi = teevolutionSensorModeUi({
        storedMode: flash[TEEVOLUTION_FLASH.sensorMode] ?? 0,
        pollingRateHz,
        connection: info.connection,
      });
      return {
        brand: "Teevolution",
        name: this.displayName(info),
        ui: {
          defaultDisplayName: info.profile.name,
          hideUnsupportedPollingRates: true,
          hideSignalCard: true,
        },
        batteryPercent: battery?.percent ?? null,
        batteryState: battery?.charging ? "Charging" : "Discharging",
        dpi,
        pollingRateHz,
        supportedPollingRates: info.profile.pollingRates.filter((rate) => rate <= info.maximumPollingRateHz),
        activeProfile: profile && profile[1] === 0 ? (profile[5] ?? 0) + 1 : null,
        connectionType: info.connection,
        connectionDetail: `CID ${info.cid} · MID ${info.mid} · Type ${info.type}`,
        signalStrength: rssi && rssi[1] === 0 ? Math.min(rssi[5] ?? 0, 4) : null,
        dpiLedMode: teevolutionDecodeDpiLightMode(
          flash[TEEVOLUTION_FLASH.dpiLightMode] ?? 1,
          flash[TEEVOLUTION_FLASH.dpiLightState] ?? 0,
        ),
        dpiLedBrightness: teevolutionDecodeDpiLightBrightness(
          flash[TEEVOLUTION_FLASH.dpiLightBrightness] ?? 0x80,
        ),
        dpiLedSpeed: Math.min(Math.max(flash[TEEVOLUTION_FLASH.dpiLightSpeed] ?? 3, 1), 5),
        debounceMs: flash[TEEVOLUTION_FLASH.debounceTime] ?? null,
        motionSync: flash[TEEVOLUTION_FLASH.motionSync] === 1,
        sleepTimeout: flash[TEEVOLUTION_FLASH.sleepTime] ?? null,
        angleSnapping: flash[TEEVOLUTION_FLASH.angleSnapping] === 1,
        rippleControl: flash[TEEVOLUTION_FLASH.rippleControl] === 1,
        performanceMode: flash[TEEVOLUTION_FLASH.performanceState] === 1,
        performanceDuration: flash[TEEVOLUTION_FLASH.performanceTime] ?? null,
        sensorMode: sensorModeUi.mode,
        sensorModeStored: sensorModeUi.storedValue,
        sensorModeEditable: sensorModeUi.editable,
        liftOffDistance: teevolutionDecodeLiftOff(flash[TEEVOLUTION_FLASH.liftOffDistance] ?? -1),
        supportedLiftOffDistances: [...info.profile.liftOffDistances],
        firmware: [
          this.decodeVersionOptional("Mouse", deviceVersion) ?? "Mouse firmware unavailable",
          this.decodeVersionOptional("Dongle", dongleVersion) ?? "Dongle firmware unavailable",
        ],
      };
    });
  }

  getDpiOptions(): number[] {
    return teevolutionDpiOptions(this.profile());
  }

  getModelProfile(): TeevolutionDeviceProfile {
    return this.profile();
  }

  async setPollingRate(pollingRateHz: number): Promise<number> {
    const info = this.deviceInfo ?? await this.readDeviceInfo();
    if (!info.profile.pollingRates.includes(pollingRateHz)) {
      throw new Error(`${pollingRateHz} Hz is not supported by the ${info.profile.name}.`);
    }
    const encoded = teevolutionEncodePollingRate(pollingRateHz);
    if (pollingRateHz > info.maximumPollingRateHz) {
      throw new Error(`This connection supports at most ${info.maximumPollingRateHz} Hz.`);
    }
    return await this.withDeviceControl(async () => {
      await this.writeCheckedByte(TEEVOLUTION_FLASH.reportRate, encoded);
      const confirmed = teevolutionDecodePollingRate((await this.readFlash(TEEVOLUTION_FLASH.reportRate, 2))[0] ?? 1);
      if (confirmed !== pollingRateHz) throw new Error(`The mouse kept ${confirmed} Hz instead of ${pollingRateHz} Hz.`);
      return confirmed;
    });
  }

  async setDpi(dpi: number): Promise<number> {
    const info = this.deviceInfo ?? await this.readDeviceInfo();
    if (!teevolutionDpiOptions(info.profile).includes(dpi)) {
      throw new Error(`${dpi} DPI is not supported by the ${info.profile.name}.`);
    }
    return await this.withDeviceControl(async () => {
      const currentDpi = (await this.readFlash(TEEVOLUTION_FLASH.currentDpi, 2))[0] ?? 0;
      const address = TEEVOLUTION_FLASH.dpiValues
        + Math.min(currentDpi, info.profile.dpiStageCount - 1) * 4;
      await this.writeFlash(address, teevolutionEncodeDpi(dpi));
      const confirmed = teevolutionDecodeDpi(await this.readFlash(address, 4));
      if (confirmed !== dpi) throw new Error(`The mouse kept ${confirmed} DPI instead of ${dpi} DPI.`);
      return confirmed;
    });
  }

  async setLiftOffDistance(liftOffDistance: NonNullable<MouseStatus["liftOffDistance"]>): Promise<NonNullable<MouseStatus["liftOffDistance"]>> {
    const profile = this.profile();
    if (!profile.liftOffDistances.includes(liftOffDistance)) {
      throw new Error(`${liftOffDistance} lift-off distance is not supported by the ${profile.name}.`);
    }
    const encoded = teevolutionEncodeLiftOff(liftOffDistance);
    return await this.withDeviceControl(async () => {
      await this.writeCheckedByte(TEEVOLUTION_FLASH.liftOffDistance, encoded);
      const confirmed = teevolutionDecodeLiftOff((await this.readFlash(TEEVOLUTION_FLASH.liftOffDistance, 2))[0] ?? -1);
      if (confirmed !== liftOffDistance) throw new Error(`The mouse kept ${confirmed ?? "an unknown LOD"} instead of ${liftOffDistance}.`);
      return confirmed;
    });
  }

  async setMotionSync(enabled: boolean): Promise<boolean> {
    return await this.setVerifiedBoolean(TEEVOLUTION_FLASH.motionSync, enabled, "Motion Sync");
  }

  async setAngleSnapping(enabled: boolean): Promise<boolean> {
    return await this.setVerifiedBoolean(TEEVOLUTION_FLASH.angleSnapping, enabled, "angle snapping");
  }

  async setRippleControl(enabled: boolean): Promise<boolean> {
    return await this.setVerifiedBoolean(TEEVOLUTION_FLASH.rippleControl, enabled, "ripple control");
  }

  getPerformanceDurationOptions(): number[] {
    return [...this.profile().performanceTimeOptions];
  }

  async setSensorMode(mode: NonNullable<MouseStatus["sensorMode"]>): Promise<NonNullable<MouseStatus["sensorMode"]>> {
    const info = this.deviceInfo ?? await this.readDeviceInfo();
    if (mode === "Ultra" || !info.profile.sensorModes.includes(mode)) {
      throw new Error(`${mode} sensor mode cannot be written on the ${info.profile.name}.`);
    }
    const pollingRateHz = teevolutionDecodePollingRate(
      (await this.readFlash(TEEVOLUTION_FLASH.reportRate, 2))[0] ?? 1,
    );
    const ui = teevolutionSensorModeUi({
      storedMode: teevolutionEncodeSensorMode(mode),
      pollingRateHz,
      connection: info.connection,
    });
    if (!ui.editable) {
      throw new Error(`Sensor mode cannot be changed at ${pollingRateHz.toLocaleString()} Hz over ${info.connection.toLowerCase()}.`);
    }
    return await this.withDeviceControl(async () => {
      const encoded = teevolutionEncodeSensorMode(mode);
      await this.writeCheckedByte(TEEVOLUTION_FLASH.sensorMode, encoded);
      const confirmed = teevolutionDecodeSensorModeStored((await this.readFlash(TEEVOLUTION_FLASH.sensorMode, 2))[0] ?? -1);
      if (confirmed !== mode) throw new Error(`The mouse kept ${confirmed} sensor mode instead of ${mode}.`);
      return confirmed;
    });
  }

  async setPerformanceDuration(duration: number): Promise<number> {
    if (!this.profile().performanceTimeOptions.includes(duration)) {
      throw new Error("Unsupported Teevolution highest-performance duration.");
    }
    return await this.setVerifiedByte(TEEVOLUTION_FLASH.performanceTime, duration, "highest-performance duration");
  }

  async setPerformanceMode(enabled: boolean): Promise<boolean> {
    return await this.setVerifiedBoolean(TEEVOLUTION_FLASH.performanceState, enabled, "performance mode");
  }

  async setDpiLighting(mode: number, brightness: number, speed: number): Promise<void> {
    const lighting = this.profile().dpiLighting;
    if (!lighting.modes.includes(mode as 0 | 1 | 2)) {
      throw new Error("Unsupported Teevolution DPI light effect.");
    }
    if (brightness < lighting.brightness.min || brightness > lighting.brightness.max) {
      throw new Error(`Teevolution DPI light brightness must be from ${lighting.brightness.min} to ${lighting.brightness.max}.`);
    }
    const encodedBrightness = teevolutionEncodeDpiLightBrightness(brightness);
    if (!Number.isInteger(speed) || speed < lighting.speed.min || speed > lighting.speed.max) {
      throw new Error(`Teevolution DPI light speed must be from ${lighting.speed.min} to ${lighting.speed.max}.`);
    }
    await this.withDeviceControl(async () => {
      const current = await this.readFlash(TEEVOLUTION_FLASH.dpiLightMode, 8);
      if (mode !== 0 && current[0] !== mode) {
        await this.writeCheckedByte(TEEVOLUTION_FLASH.dpiLightMode, mode);
      }
      if (current[2] !== encodedBrightness) {
        await this.writeCheckedByte(TEEVOLUTION_FLASH.dpiLightBrightness, encodedBrightness);
      }
      if (current[4] !== speed) {
        await this.writeCheckedByte(TEEVOLUTION_FLASH.dpiLightSpeed, speed);
      }
      const state = mode === 0 ? 0 : 1;
      if (current[6] !== state) {
        await this.writeCheckedByte(TEEVOLUTION_FLASH.dpiLightState, state);
      }

      const confirmed = await this.readFlash(TEEVOLUTION_FLASH.dpiLightMode, 8);
      const confirmedMode = teevolutionDecodeDpiLightMode(confirmed[0] ?? 1, confirmed[6] ?? 0);
      const confirmedBrightness = teevolutionDecodeDpiLightBrightness(confirmed[2] ?? 0x80);
      if (confirmedMode !== mode || confirmedBrightness !== brightness || confirmed[4] !== speed) {
        throw new Error("The mouse did not confirm the requested DPI lighting settings.");
      }
    });
  }

  async setDebounceTime(debounceMs: number): Promise<number> {
    const { min, max } = this.profile().debounce;
    if (!Number.isInteger(debounceMs) || debounceMs < min || debounceMs > max) {
      throw new Error(`This Teevolution model supports a debounce time from ${min} to ${max} ms.`);
    }
    return await this.setVerifiedByte(TEEVOLUTION_FLASH.debounceTime, debounceMs, "debounce time");
  }

  async setSleepTimeout(timeout: number): Promise<number> {
    if (!this.profile().sleepOptions.includes(timeout)) {
      throw new Error("Unsupported Teevolution sleep timeout.");
    }
    return await this.withDeviceControl(async () => {
      await this.writeCheckedByte(TEEVOLUTION_FLASH.sleepTime, timeout);
      const sleepConfirmed = (await this.readFlash(TEEVOLUTION_FLASH.sleepTime, 2))[0];
      if (sleepConfirmed !== timeout) {
        throw new Error("The mouse did not confirm the requested sleep timeout.");
      }
      return sleepConfirmed!;
    });
  }

  async close(): Promise<void> {
    this.device.removeEventListener("inputreport", this.onInputReport);
    this.responseWaiter?.reject(new Error("The Teevolution device was closed."));
    this.responseWaiter = null;
    if (this.device.opened) await this.device.close();
  }

  private displayName(info: TeevolutionDeviceInfo): string {
    return info.profile.name;
  }

  private profile(): TeevolutionDeviceProfile {
    if (!this.deviceInfo) {
      throw new Error("Read the Teevolution device identity before requesting model capabilities.");
    }
    return this.deviceInfo.profile;
  }

  private async withDeviceControl<T>(operation: () => Promise<T>): Promise<T> {
    await this.setDeviceOnline(true);
    try {
      return await operation();
    } finally {
      await this.setDeviceOnline(false).catch(() => undefined);
    }
  }

  private async setDeviceOnline(enabled: boolean): Promise<void> {
    let response: Uint8Array | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      response = await this.exchange(teevolutionBuildOnlinePayload(enabled));
      this.assertAccepted(response, enabled ? "host-control entry" : "host-control exit");
      if (response[9] !== 1) break;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
    }
    if (!response || response[9] === 1) throw new Error("The Teevolution receiver stayed busy.");
    if (enabled && response[5] !== 1) throw new Error("The Teevolution mouse is offline. Move it or click a button, then retry.");
  }

  private async readFlash(address: number, length: number): Promise<Uint8Array> {
    const result = new Uint8Array(length);
    for (let offset = 0; offset < length; offset += 10) {
      const count = Math.min(10, length - offset);
      const response = await this.exchange(teevolutionBuildReadPayload(address + offset, count));
      const chunk = teevolutionParseReadResponse(response, address + offset, count);
      if (!chunk) {
        this.assertAccepted(response, "configuration read");
        throw new Error("The Teevolution configuration read response was corrupt.");
      }
      result.set(chunk, offset);
    }
    return result;
  }

  private async writeCheckedByte(address: number, value: number): Promise<void> {
    await this.writeFlash(address, new Uint8Array([value, (0x55 - value) & 0xff]));
  }

  private async setVerifiedByte(address: number, value: number, label: string): Promise<number> {
    return await this.withDeviceControl(async () => {
      await this.writeCheckedByte(address, value);
      const confirmed = (await this.readFlash(address, 2))[0];
      if (confirmed !== value) throw new Error(`The mouse did not confirm the requested ${label}.`);
      return confirmed!;
    });
  }

  private async setVerifiedBoolean(address: number, enabled: boolean, label: string): Promise<boolean> {
    return (await this.setVerifiedByte(address, enabled ? 1 : 0, label)) === 1;
  }

  private async writeFlash(address: number, data: Uint8Array): Promise<void> {
    for (let offset = 0; offset < data.length; offset += 10) {
      const chunk = [...data.slice(offset, offset + 10)];
      this.assertAccepted(
        await this.exchange(teevolutionBuildWritePayload(address + offset, chunk)),
        "configuration write",
      );
    }
  }

  private async query(command: number, parameters = new Uint8Array()): Promise<Uint8Array> {
    if (parameters.length > 10) throw new Error("Teevolution queries support at most 10 parameter bytes.");
    const packet = teevolutionBuildSimplePayload(command);
    packet[4] = parameters.length;
    packet.set(parameters, 5);
    packet[15] = teevolutionPacketChecksum(packet);
    return await this.exchange(packet);
  }

  private async exchange(packet: Uint8Array): Promise<Uint8Array> {
    if (this.responseWaiter) throw new Error("Another Teevolution request is already in progress.");
    const command = packet[0]!;
    let timeout = 0;
    let rejectResponse: ((reason: Error) => void) | null = null;
    const response = new Promise<Uint8Array>((resolve, reject) => {
      rejectResponse = reject;
      timeout = window.setTimeout(() => {
        this.responseWaiter = null;
        reject(new Error(`The Teevolution mouse did not answer command 0x${command.toString(16).padStart(2, "0")}.`));
      }, 1200);
      this.responseWaiter = {
        command,
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
      await this.device.sendReport(TEEVOLUTION_REPORT_ID, new Uint8Array(packet));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      (rejectResponse as ((reason: Error) => void) | null)?.(new Error(`Chrome could not write Teevolution report 8. ${detail}`));
      this.responseWaiter = null;
    }
    return await response;
  }

  private decodeVersionOptional(label: string, response: Uint8Array | null): string | null {
    if (!response || response[1] !== 0) return null;
    this.assertAccepted(response, `${label.toLowerCase()} firmware read`);
    return teevolutionDecodeFirmwareVersion(label, response);
  }

  private assertAccepted(response: Uint8Array, operation: string): void {
    if (response[1] !== 0) throw new Error(`The Teevolution receiver rejected the ${operation} (status ${response[1]}).`);
  }
}
