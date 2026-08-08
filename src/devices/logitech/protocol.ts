// HID++ reserves software ID 0 for device-originated notifications. Using a
// nonzero ID keeps command replies distinct from asynchronous mouse events.
const SOFTWARE_ID = 0x05;

/** Add this client's HID++ software ID while preserving the function nibble. */
export function withSoftwareId(functionId: number): number {
  return (functionId & 0xf0) | SOFTWARE_ID;
}

/** Receiver-attached mice answer on the receiver's first pairing slot. */
export const DEVICE_INDEX_RECEIVER = 0x01;
/** A mouse addressed over its own USB interface answers on 0xFF. */
export const DEVICE_INDEX_DIRECT = 0xff;
/** Bolt receivers expose up to six pairing slots (HID++ device indices 1..6). */
export const BOLT_PAIRING_SLOTS = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06] as const;

/**
 * Logitech mice whose vendor interface is the mouse itself rather than a
 * receiver. They answer HID++ on device index 0xFF and keep their writable
 * settings in an onboard profile.
 *
 * - 0xc07e — G402 / G402 Hyperion Fury (wired)
 * - 0xc08f — G403 HERO (wired)
 *
 * This module deliberately imports nothing, so both the driver and the WebHID
 * filters in ../vendors can read it without a cycle.
 */
export const LOGITECH_DIRECT_PRODUCT_IDS = [0xc07e, 0xc08f] as const;

/**
 * Logi Bolt receivers. Unlike Lightspeed, device HID++ 2.0 rides long reports
 * (report id 0x11) on usage `ff00:2`, and the mouse may sit on any pairing
 * slot — not only 0x01.
 *
 * - 0xc548 — Logi Bolt USB receiver (MX Master 3S and other Bolt mice)
 */
export const LOGITECH_BOLT_PRODUCT_IDS = [0xc548] as const;

const DIRECT_PRODUCT_ID_SET: ReadonlySet<number> = new Set(LOGITECH_DIRECT_PRODUCT_IDS);
const BOLT_PRODUCT_ID_SET: ReadonlySet<number> = new Set(LOGITECH_BOLT_PRODUCT_IDS);

export function isDirectConnectProduct(productId: number): boolean {
  return DIRECT_PRODUCT_ID_SET.has(productId);
}

export function isBoltReceiverProduct(productId: number): boolean {
  return BOLT_PRODUCT_ID_SET.has(productId);
}

/**
 * Whether this HID++ endpoint is the mouse itself rather than a receiver.
 * Runtime probing is authoritative for unknown Logitech product IDs; the PID
 * list is only the pre-probe fast path.
 */
export function isDirectConnection(productId: number, resolvedDeviceIndex: number | null): boolean {
  return resolvedDeviceIndex === DEVICE_INDEX_DIRECT
    || (resolvedDeviceIndex === null && isDirectConnectProduct(productId));
}

export function hidppDeviceIndex(productId: number): number {
  return isDirectConnectProduct(productId) ? DEVICE_INDEX_DIRECT : DEVICE_INDEX_RECEIVER;
}

/** HID++ 2.0 error codes, reported in byte 4 of a 0xFF error response. */
const HIDPP20_ERRORS: Readonly<Record<number, string>> = {
  0x01: "unknown request",
  0x02: "invalid argument",
  0x03: "value out of range",
  0x04: "hardware error",
  0x05: "Logitech internal error",
  0x06: "invalid feature index",
  0x07: "invalid function",
  0x08: "device busy",
  0x09: "unsupported",
};

/** HID++ 1.0 error codes, reported in byte 4 of a 0x8F error response. */
const HIDPP10_ERRORS: Readonly<Record<number, string>> = {
  0x01: "invalid command",
  0x02: "invalid address",
  0x03: "invalid value",
  0x04: "connection request failed",
  0x05: "too many devices",
  0x06: "already exists",
  0x07: "device busy",
  0x08: "unknown device",
  0x09: "resource error",
  0x0a: "request unavailable",
  0x0b: "unsupported parameter value",
  0x0c: "wrong PIN code",
};

export function hidppErrorMessage(code: number): string {
  const reason = HIDPP20_ERRORS[code];
  return reason
    ? `The mouse rejected that setting (${reason}).`
    : `The mouse rejected that setting (HID++ 2.0 error 0x${code.toString(16).padStart(2, "0")}).`;
}

export function hidpp10ErrorMessage(code: number): string {
  const reason = HIDPP10_ERRORS[code];
  return reason
    ? `The mouse rejected that setting (HID++ 1.0: ${reason}).`
    : `The mouse rejected that setting (HID++ 1.0 error 0x${code.toString(16).padStart(2, "0")}).`;
}

/**
 * Decodes an error only when it echoes the request being awaited.
 *
 * HID++ 1.0: [device, 0x8f, sub-id, address, error]
 * HID++ 2.0: [device, 0xff, feature-index, function+software-id, error]
 */
export function hidppErrorForRequest(
  report: Uint8Array,
  requestFirstByte: number,
  requestSecondByte: number,
): string | null {
  if (report[2] !== requestFirstByte || report[3] !== withSoftwareId(requestSecondByte)) return null;
  if (report[1] === 0x8f) return hidpp10ErrorMessage(report[4] ?? 0);
  if (report[1] === 0xff) return hidppErrorMessage(report[4] ?? 0);
  return null;
}

/**
 * Decode the legacy Report Rate (0x8060) supported-rate bitmap, where bit i
 * marks an interval of (i + 1) ms. The G402 generation reports 0x8b, meaning
 * 1, 2, 4 and 8 ms — 1000, 500, 250 and 125 Hz.
 */
export function decodeReportRateBitmap(bitflags: number): number[] {
  const rates: number[] = [];
  for (let bit = 0; bit < 8; bit += 1) {
    if ((bitflags & (1 << bit)) !== 0) rates.push(Math.round(1000 / (bit + 1)));
  }
  return rates.sort((left, right) => left - right);
}

/**
 * Sensor grids for direct-connect mice, used only when one answers the legacy
 * DPI-list request with nothing usable. Every value is still confirmed by the
 * read-back after a write, so a wrong entry surfaces as a rejected change
 * rather than a silently wrong setting.
 */
const LEGACY_DPI_GRIDS: ReadonlyMap<number, { min: number; step: number; max: number }> = new Map([
  // G402: hardware advertises 252 to 4032 in steps of 84 — not the 240/80
  // quoted by vendor software, which rounds these to marketing numbers (2436
  // is displayed as "2400"). Captured from a getSensorDpiList reply of
  // 00 FC | E0 54 | 0F C0.
  [0xc07e, { min: 252, step: 84, max: 4032 }],
  // G403 HERO: the HERO sensor's documented 100-25,600 range in steps of 50.
  [0xc08f, { min: 100, step: 50, max: 25600 }],
]);

export function legacyDpiFallback(productId: number): number[] {
  const grid = LEGACY_DPI_GRIDS.get(productId);
  if (!grid) return [];
  const options: number[] = [];
  for (let dpi = grid.min; dpi <= grid.max; dpi += grid.step) options.push(dpi);
  return options;
}

export type BatteryChargeState =
  | "Charging" | "Charging slowly" | "Almost full" | "Full" | "Discharging" | "Unknown";

/**
 * 0x1004 UNIFIED_BATTERY chargingStatus.
 *
 * Deliberately separate from the 0x1000 mapping below: the two features number
 * their states differently, and decoding one with the other's table reports a
 * slow charge as "almost full".
 */
export function decodeUnifiedBatteryState(chargingStatus: number): BatteryChargeState {
  switch (chargingStatus) {
    case 0x00: return "Discharging";
    case 0x01: return "Charging";
    case 0x02: return "Charging slowly";
    case 0x03: return "Full";
    // 4 is a charging fault. There is no state for it, and calling it charging
    // would be worse than admitting we do not know.
    default: return "Unknown";
  }
}

/** 0x1000 BATTERY_LEVEL_STATUS batteryStatus. */
export function decodeBatteryLevelState(batteryStatus: number): BatteryChargeState {
  switch (batteryStatus) {
    case 0x00: return "Discharging";
    case 0x01: return "Charging";
    case 0x02: return "Almost full";
    case 0x03: return "Full";
    case 0x04: return "Charging slowly";
    // 5 invalid battery, 6 thermal error, 7 other charging error.
    default: return "Unknown";
  }
}

/**
 * The mouse keeps its settings in onboard memory and will not hand control to
 * software, so the only way to change anything is to write its profile — which
 * needs a decoded layout for that profile format.
 *
 * Its own type because it is not a fault: it is a mouse that cannot be
 * supported yet, and the way forward is a capture from whoever owns one.
 */
export class OnboardOnlyError extends Error {
  readonly profileFormatId: number | null;

  constructor(profileFormatId: number | null) {
    super(
      "This mouse keeps its settings in onboard memory and will not hand control to software. "
      + `Writing ${profileFormatId === null ? "its profile format" : `profile format ${profileFormatId}`} `
      + 'is not supported yet. Open Diagnostics, then HID++ capture, and use "Copy verification data" — '
      + "sending that is what lets the layout be added.",
    );
    this.name = "OnboardOnlyError";
    this.profileFormatId = profileFormatId;
  }
}
