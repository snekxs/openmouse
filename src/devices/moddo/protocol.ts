/**
 * moddoMOUSE (moddo.io) vendor HID protocol — pure encode/decode helpers.
 *
 * Settings live in one packed feature report (id 0x02) — no CBOR:
 *   [ pollingHz u16le | lift u8 | dpiX u16le | dpiY u16le | invert/swap u8 | angle i16le | deepSleep u8 ]
 * Battery is feature report 0x04; firmware version + connection path (wireless
 * dongle vs. wired) come from feature report 0x03.
 *
 * These functions operate on the report *payload*, i.e. the bytes after the
 * WebHID report-id byte; hid.ts strips that byte before calling in. Only
 * documented settings are touched — no firmware flashing, wireless pairing, or
 * button remapping. Report layout mirrors moddoHUB-Web (js/main.js,
 * js/battery.js, js/firmware.js).
 */

export const MODDO_VENDOR_ID = 0x2fe3;
export const MODDO_USAGE_PAGE_VENDOR = 0xff;
export const MODDO_USAGE_VENDOR_CONFIG = 0x01;
export const MODDO_USAGE_VENDOR_CONFIG_LEGACY = 0x02;

export const MODDO_REPORT = {
  config: 0x02,
  firmware: 0x03,
  battery: 0x04,
} as const;

/** Packed config-report field offsets (into the payload, after the report-id byte). */
const CONFIG = {
  polling: 0, // u16 LE — report rate in Hz
  lift: 2, // u8 — 1 = 1 mm, 2 = 2 mm
  dpiX: 3, // u16 LE
  dpiY: 5, // u16 LE
  invertSwap: 7, // u8 — preserved across writes
  angle: 8, // i16 LE — preserved across writes
  deepSleep: 10, // u8 — preserved across writes
} as const;

export const MODDO_CONFIG_REPORT_SIZE = 11;

export const MODDO_SUPPORTED_POLLING_RATES = [125, 250, 500, 1000] as const;
export const MODDO_DPI_MIN = 50;
export const MODDO_DPI_MAX = 26000;
export const MODDO_DPI_STEP = 50;

// Battery status codes and charger flags (js/battery.js).
export const MODDO_BATTERY_STATUS = {
  charging: 0x44,
  discharging: 0x45,
  fullyCharged: 0x46,
  fullyDischarged: 0x47,
} as const;
export const MODDO_CHARGER_BATTERY_PRESENT_BIT = 1 << 0;

/** The moddoMOUSE reports lift-off at 1 mm ("Medium") or 2 mm ("High") only. */
export type ModdoLiftOffDistance = "Medium" | "High";
export type ModdoBatteryState = "Charging" | "Full" | "Discharging" | "Unknown";

export interface ModdoConfig {
  polling: number;
  lift: number;
  dpiX: number;
  dpiY: number;
  invertSwap: number;
  angle: number;
  deepSleep: number;
}

export interface ModdoBattery {
  percent: number | null;
  state: ModdoBatteryState;
}

export interface ModdoFirmware {
  mouse: string | null;
  dongle: string | null;
  dongleConnected: boolean;
}

export function isValidModdoDpi(dpi: number): boolean {
  return Number.isInteger(dpi) && dpi >= MODDO_DPI_MIN && dpi <= MODDO_DPI_MAX && dpi % MODDO_DPI_STEP === 0;
}

export function moddoDpiOptions(): number[] {
  const values: number[] = [];
  for (let dpi = MODDO_DPI_MIN; dpi <= MODDO_DPI_MAX; dpi += MODDO_DPI_STEP) values.push(dpi);
  return values;
}

export function decodeModdoLift(raw: number): ModdoLiftOffDistance | null {
  if (raw === 1) return "Medium";
  if (raw === 2) return "High";
  return null;
}

export function encodeModdoLift(value: ModdoLiftOffDistance): number {
  return value === "Medium" ? 1 : 2;
}

/**
 * Decode the packed config payload, or null when the mouse is not ready: a
 * truncated report, or the zeroed report a sleeping/off wireless mouse answers
 * with. Returning null (rather than 0 DPI / 0 Hz) keeps the UI grid hidden and
 * stops a read-modify-write from persisting zeros.
 */
export function decodeModdoConfig(payload: Uint8Array): ModdoConfig | null {
  // Need polling + lift + both DPI axes present (through offset 6).
  if (payload.length < 7) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const u8 = (offset: number): number => (offset < payload.length ? view.getUint8(offset) : 0);
  const i16 = (offset: number): number => (offset + 2 <= payload.length ? view.getInt16(offset, true) : 0);
  const config: ModdoConfig = {
    polling: view.getUint16(CONFIG.polling, true),
    lift: view.getUint8(CONFIG.lift),
    dpiX: view.getUint16(CONFIG.dpiX, true),
    dpiY: view.getUint16(CONFIG.dpiY, true),
    invertSwap: u8(CONFIG.invertSwap),
    angle: i16(CONFIG.angle),
    deepSleep: u8(CONFIG.deepSleep),
  };
  if (config.polling <= 0 || config.dpiX < MODDO_DPI_MIN || config.dpiX > MODDO_DPI_MAX) return null;
  return config;
}

/** Serialize the full 11-byte config report; callers validate before calling. */
export function encodeModdoConfig(config: ModdoConfig): Uint8Array<ArrayBuffer> {
  const buffer = new Uint8Array(MODDO_CONFIG_REPORT_SIZE);
  const view = new DataView(buffer.buffer);
  view.setUint16(CONFIG.polling, config.polling, true);
  view.setUint8(CONFIG.lift, config.lift);
  view.setUint16(CONFIG.dpiX, config.dpiX, true);
  view.setUint16(CONFIG.dpiY, config.dpiY, true);
  view.setUint8(CONFIG.invertSwap, config.invertSwap);
  view.setInt16(CONFIG.angle, config.angle, true);
  view.setUint8(CONFIG.deepSleep, config.deepSleep);
  return buffer;
}

export function decodeModdoBattery(payload: Uint8Array): ModdoBattery {
  if (payload.length < 4) return { percent: null, state: "Unknown" };
  const remaining = payload[0]!;
  const status = payload[2]!;
  const chargerStatus = payload[3]!;
  if ((chargerStatus & MODDO_CHARGER_BATTERY_PRESENT_BIT) === 0) {
    // No cell present (e.g. a wired mouse) — surface an empty battery column.
    return { percent: null, state: "Unknown" };
  }
  const percent = remaining > 100 ? null : remaining;
  const state: ModdoBatteryState = status === MODDO_BATTERY_STATUS.charging
    ? "Charging"
    : status === MODDO_BATTERY_STATUS.fullyCharged
      ? "Full"
      : status === MODDO_BATTERY_STATUS.discharging || status === MODDO_BATTERY_STATUS.fullyDischarged
        ? "Discharging"
        : "Unknown";
  return { percent, state };
}

export function decodeModdoFirmware(payload: Uint8Array): ModdoFirmware {
  // First 8 bytes: dongle (rx) then mouse (tx) major.minor.patch.build.
  if (payload.length < 8) return { mouse: null, dongle: null, dongleConnected: false };
  const version = (offset: number): { text: string; present: boolean } => {
    const major = payload[offset]!;
    const minor = payload[offset + 1]!;
    const patch = payload[offset + 2]!;
    const build = payload[offset + 3]!;
    const present = !(major === 0 && minor === 0 && patch === 0 && build === 0);
    return { text: `${major}.${minor}.${patch}`, present };
  };
  const dongle = version(0);
  const mouse = version(4);
  return {
    mouse: mouse.present ? mouse.text : null,
    dongle: dongle.present ? dongle.text : null,
    // A non-zero dongle version means the mouse answered over the 2.4 GHz
    // receiver; a wired mouse leaves those bytes zero.
    dongleConnected: dongle.present,
  };
}
