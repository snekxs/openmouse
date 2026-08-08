export const TEEVOLUTION_REPORT_ID = 0x08;
export const TEEVOLUTION_PACKET_LENGTH = 16;
export const TEEVOLUTION_MAX_CHUNK = 10;
export const TEEVOLUTION_DPI_MAX = 42000;
export const TEEVOLUTION_PRODUCT_IDS = new Set([0xf520, 0xf523, 0xf5bb, 0xf522]);
export const TEEVOLUTION_POLLING_RATES = [125, 250, 500, 1000, 2000, 4000, 8000] as const;
export const TEEVOLUTION_SLEEP_OPTIONS = [1, 3, 6, 12, 30, 60, 180] as const;
/** Teevolink "Highest performance" duration codes (flash 0xB7). */
export const TEEVOLUTION_PERFORMANCE_TIME_OPTIONS = [1, 3, 6, 12, 30, 60, 90] as const;
export const TEEVOLUTION_PERFORMANCE_TIME_LABELS: ReadonlyArray<readonly [number, string]> = [
  [1, "10 seconds"], [3, "30 seconds"], [6, "1 minute"], [12, "2 minutes"],
  [30, "5 minutes"], [60, "10 minutes"], [90, "15 minutes"],
];
export const TEEVOLUTION_DPI_LIGHT_MODES = [0, 1, 2] as const;
export type TeevolutionDpiLightMode = typeof TEEVOLUTION_DPI_LIGHT_MODES[number];
export type TeevolutionSensorMode = "Eco" | "High" | "Ultra";
export type TeevolutionLiftOffDistance = "Low" | "Medium" | "High";

export interface TeevolutionDeviceProfile {
  cid: number;
  name: string;
  protocol: "compX-terra-v1";
  dpiStageCount: number;
  dpi: {
    min: number;
    standardMax: number;
    max: number;
    standardStep: number;
    highStep: number;
  };
  pollingRates: readonly number[];
  liftOffDistances: readonly TeevolutionLiftOffDistance[];
  debounce: { min: number; max: number };
  sleepOptions: readonly number[];
  performanceTimeOptions: readonly number[];
  sensorModes: readonly Exclude<TeevolutionSensorMode, "Ultra">[];
  dpiLighting: {
    modes: readonly TeevolutionDpiLightMode[];
    brightness: { min: number; max: number };
    speed: { min: number; max: number };
  };
}

export const TEEVOLUTION_DEVICE_PROFILES: ReadonlyMap<number, TeevolutionDeviceProfile> = new Map([
  [14, {
    cid: 14,
    name: "Terra Pro",
    protocol: "compX-terra-v1",
    dpiStageCount: 4,
    dpi: {
      min: 50,
      standardMax: 30_000,
      max: TEEVOLUTION_DPI_MAX,
      standardStep: 50,
      highStep: 100,
    },
    pollingRates: TEEVOLUTION_POLLING_RATES,
    liftOffDistances: ["Low", "Medium", "High"],
    debounce: { min: 0, max: 20 },
    sleepOptions: TEEVOLUTION_SLEEP_OPTIONS,
    performanceTimeOptions: TEEVOLUTION_PERFORMANCE_TIME_OPTIONS,
    sensorModes: ["Eco", "High"],
    dpiLighting: {
      modes: TEEVOLUTION_DPI_LIGHT_MODES,
      brightness: { min: 1, max: 10 },
      speed: { min: 1, max: 5 },
    },
  }],
]);

export function teevolutionProfileForCid(cid: number): TeevolutionDeviceProfile | null {
  return TEEVOLUTION_DEVICE_PROFILES.get(cid) ?? null;
}

export const TEEVOLUTION_COMMAND = {
  encryptionData: 0x01,
  deviceOnline: 0x03,
  batteryLevel: 0x04,
  writeFlashData: 0x07,
  readFlashData: 0x08,
  getCurrentConfig: 0x0e,
  readVersionId: 0x12,
  getDongleVersion: 0x1d,
  getRssi: 0x2b,
} as const;

/** Flash offsets used by Teevolink / Compx HUB for Terra Pro. */
export const TEEVOLUTION_FLASH = {
  reportRate: 0,
  currentDpi: 4,
  liftOffDistance: 10,
  dpiValues: 12,
  dpiLightMode: 76,
  dpiLightBrightness: 78,
  dpiLightSpeed: 80,
  dpiLightState: 82,
  debounceTime: 169,
  motionSync: 171,
  sleepTime: 173,
  angleSnapping: 175,
  rippleControl: 177,
  performanceState: 181,
  performanceTime: 183,
  sensorMode: 185,
} as const;

export const TEEVOLUTION_TYPE_MAX_POLL: Record<number, number> = {
  0: 1000,
  1: 4000,
  2: 1000,
  3: 8000,
  4: 2000,
  5: 8000,
};

export interface TeevolutionBattery {
  percent: number | null;
  charging: boolean;
}

function assertByte(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`${label} must be one byte.`);
  }
}

export function teevolutionPacketChecksum(packet: Uint8Array | readonly number[]): number {
  let sum = 0;
  const limit = Math.min(packet.length, TEEVOLUTION_PACKET_LENGTH - 1);
  for (let index = 0; index < limit; index += 1) sum += packet[index]! & 0xff;
  return (0x55 - (sum & 0xff) - TEEVOLUTION_REPORT_ID) & 0xff;
}

export function teevolutionPacketChecksumIsValid(payload: Uint8Array | readonly number[]): boolean {
  if (payload.length !== TEEVOLUTION_PACKET_LENGTH) return false;
  return teevolutionPacketChecksum(payload) === (payload[15]! & 0xff);
}

export function teevolutionDataChecksum(data: Uint8Array | readonly number[]): number {
  let sum = 0;
  for (const value of data) sum += value & 0xff;
  return (0x55 - (sum & 0xff)) & 0xff;
}

function finalize(payload: Uint8Array): Uint8Array {
  payload[15] = teevolutionPacketChecksum(payload);
  return payload;
}

export function teevolutionBuildSimplePayload(command: number): Uint8Array {
  assertByte(command, "Teevolution command");
  const payload = new Uint8Array(TEEVOLUTION_PACKET_LENGTH);
  payload[0] = command;
  return finalize(payload);
}

export function teevolutionBuildReadPayload(address: number, length: number): Uint8Array {
  if (!Number.isInteger(address) || address < 0 || address > 0xffff) {
    throw new Error("Teevolution address is out of range.");
  }
  if (!Number.isInteger(length) || length < 1 || length > TEEVOLUTION_MAX_CHUNK) {
    throw new Error("Teevolution read length must be 1–10 bytes.");
  }
  const payload = teevolutionBuildSimplePayload(TEEVOLUTION_COMMAND.readFlashData);
  payload[2] = address >> 8;
  payload[3] = address & 0xff;
  payload[4] = length;
  return finalize(payload);
}

export function teevolutionBuildWritePayload(address: number, data: readonly number[]): Uint8Array {
  if (!Number.isInteger(address) || address < 0 || address > 0xffff) {
    throw new Error("Teevolution address is out of range.");
  }
  if (data.length < 1 || data.length > TEEVOLUTION_MAX_CHUNK) {
    throw new Error("Teevolution write length must be 1–10 bytes.");
  }
  const payload = teevolutionBuildSimplePayload(TEEVOLUTION_COMMAND.writeFlashData);
  payload[2] = address >> 8;
  payload[3] = address & 0xff;
  payload[4] = data.length;
  payload.set(data.map((byte) => byte & 0xff), 5);
  return finalize(payload);
}

export function teevolutionBuildWriteScalarPayload(address: number, value: number): Uint8Array {
  assertByte(value, "Teevolution scalar");
  return teevolutionBuildWritePayload(address, [value, (0x55 - value) & 0xff]);
}

export function teevolutionBuildOnlinePayload(enabled: boolean): Uint8Array {
  const payload = teevolutionBuildSimplePayload(TEEVOLUTION_COMMAND.deviceOnline);
  payload[5] = enabled ? 1 : 0;
  return finalize(payload);
}

export function teevolutionParseReadResponse(
  response: Uint8Array,
  address: number,
  length: number,
): Uint8Array | null {
  if (!teevolutionPacketChecksumIsValid(response)) return null;
  if (response[0] !== TEEVOLUTION_COMMAND.readFlashData || response[1] !== 0) return null;
  if (response[2] !== ((address >> 8) & 0xff) || response[3] !== (address & 0xff)) return null;
  if (response[4] !== length || response.length < 5 + length) return null;
  return response.slice(5, 5 + length);
}

export function teevolutionParseBattery(response: Uint8Array): TeevolutionBattery | null {
  if (!teevolutionPacketChecksumIsValid(response)) return null;
  if (response[0] !== TEEVOLUTION_COMMAND.batteryLevel || response[1] !== 0) return null;
  const raw = response[5] ?? 0xff;
  return {
    percent: raw <= 100 ? raw : null,
    charging: response[6] === 1,
  };
}

export function teevolutionEncodePollingRate(rate: number): number {
  if (!(TEEVOLUTION_POLLING_RATES as readonly number[]).includes(rate)) {
    throw new Error("Unsupported Teevolution polling rate.");
  }
  const encoded = rate <= 1000 ? 1000 / rate : rate / 2000 * 16;
  if (!Number.isInteger(encoded)) throw new Error("Unsupported Teevolution polling rate.");
  return encoded;
}

export function teevolutionDecodePollingRate(encoded: number): number {
  return encoded >= 16 ? encoded / 16 * 2000 : 1000 / encoded;
}

/**
 * PAW3950 Compx packing used by Teevolink: 50 DPI steps below 30,100, then
 * 100 DPI steps to 42,000 via dpiEx 0x11 (halve before packing).
 */
export function teevolutionEncodeDpi(dpi: number): Uint8Array {
  let dpiEx = 0;
  let scaled = dpi;
  if (dpi >= 30100) {
    dpiEx = 0x11;
    scaled = dpi / 2;
  }
  const raw = scaled / 50 - 1;
  if (!Number.isInteger(raw) || raw < 0) {
    throw new Error(`${dpi} DPI cannot be encoded for the Terra Pro.`);
  }
  const high = raw >> 8;
  const flags = (high << 2) | (high << 6) | dpiEx | (dpiEx << 4);
  const low = raw & 0xff;
  return new Uint8Array([low, low, flags & 0xff, teevolutionDataChecksum([low, low, flags & 0xff])]);
}

export function teevolutionDecodeDpi(data: Uint8Array | readonly number[]): number {
  const flags = data[2] ?? 0;
  const raw = (data[0] ?? 0) + (((flags & 0x0c) >> 2) << 8);
  const dpiEx = flags & 0x03;
  let dpi = (raw + 1) * 50;
  if ((dpiEx & 0x01) !== 0) dpi *= 2;
  if ((dpiEx & 0x02) !== 0) dpi *= 2;
  return dpi;
}

export function teevolutionDecodeLiftOff(value: number): "Low" | "Medium" | "High" | null {
  return value === 3 ? "Low" : value === 1 ? "Medium" : value === 2 ? "High" : null;
}

export function teevolutionEncodeLiftOff(liftOffDistance: "Low" | "Medium" | "High"): number {
  return ({ Low: 3, Medium: 1, High: 2 } as const)[liftOffDistance];
}

export function teevolutionDecodeFirmwareVersion(label: string, response: Uint8Array): string {
  return `${label} v${response[5] ?? 0}.${(response[6] ?? 0).toString(16).padStart(2, "0")}`;
}

export function teevolutionDpiOptions(profile: TeevolutionDeviceProfile): number[] {
  const options: number[] = [];
  for (let dpi = profile.dpi.min; dpi <= profile.dpi.standardMax; dpi += profile.dpi.standardStep) {
    options.push(dpi);
  }
  for (
    let dpi = profile.dpi.standardMax + profile.dpi.highStep;
    dpi <= profile.dpi.max;
    dpi += profile.dpi.highStep
  ) {
    options.push(dpi);
  }
  return options;
}

/** Converts Teevolink's 1–10 brightness slider to the byte stored in flash 0x4E. */
export function teevolutionEncodeDpiLightBrightness(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 10) {
    throw new Error("Teevolution DPI light brightness must be from 1 to 10.");
  }
  if (level === 1) return 0x10;
  if ([2, 3, 4, 6, 7, 8].includes(level)) return 0x1e * (level - 1);
  if (level === 5) return 0x80;
  if (level === 9) return 0xe6;
  return 0xff;
}

/** Mirrors Teevolink's fallback to level 5 for an unrecognised stored byte. */
export function teevolutionDecodeDpiLightBrightness(value: number): number {
  if (value !== 0 && value % 0x1e === 0) {
    const level = value / 0x1e + 1;
    if (Number.isInteger(level) && level >= 2 && level <= 8) return level;
  }
  if (value === 0x10) return 1;
  if (value === 0x80) return 5;
  if (value === 0xe6) return 9;
  if (value === 0xff) return 10;
  return 5;
}

export function teevolutionDecodeDpiLightMode(mode: number, state: number): TeevolutionDpiLightMode {
  if (state !== 1) return 0;
  return mode === 2 ? 2 : 1;
}

export function teevolutionEncodeSensorMode(mode: TeevolutionSensorMode): number {
  if (mode === "High") return 1;
  if (mode === "Eco") return 0;
  throw new Error("Ultra sensor mode is enforced by the link and cannot be written.");
}

export function teevolutionDecodeSensorModeStored(value: number): TeevolutionSensorMode {
  return value === 1 ? "High" : "Eco";
}

/**
 * Mirrors Teevolink Update_MS_SensorModeDisplay for PAW3950 Terra Pro links.
 * Ultra (256) is display-only when high poll rates force corded tracking.
 */
export function teevolutionSensorModeUi(options: {
  storedMode: number;
  pollingRateHz: number;
  connection: "Wired" | "Wireless";
  fps20k?: boolean;
}): { mode: TeevolutionSensorMode; editable: boolean; storedValue: 0 | 1 } {
  const storedValue = options.storedMode === 1 ? 1 : 0;
  if (options.connection === "Wired" || options.fps20k) {
    return { mode: "Ultra", editable: false, storedValue };
  }
  if (options.pollingRateHz < 2000) {
    return { mode: storedValue === 1 ? "High" : "Eco", editable: true, storedValue };
  }
  if (options.pollingRateHz === 8000) {
    return { mode: "Ultra", editable: false, storedValue };
  }
  // 2000/4000 Hz wireless on PAW3950 uses corded/Ultra tracking.
  return { mode: "Ultra", editable: false, storedValue };
}
