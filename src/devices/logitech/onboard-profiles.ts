/**
 * HID++ 0x8100 onboard profile decoding.
 *
 * Layouts recovered from Logitech's own registration code and verified against
 * a Pro X Superlight 2 (profile format 7) — see
 * docs/logitech-onboard-profiles.md. Pure functions only: the transport lives
 * in hidpp.ts, so everything here is testable against captured bytes.
 */

/** 0x8100 function ids. Write functions are deliberately absent. */
export const PROFILE_FN = {
  getInfo: 0x00,
  setMode: 0x10,
  getMode: 0x20,
  setCurrentProfile: 0x30,
  getCurrentProfile: 0x40,
  memoryRead: 0x50,
  memoryAddrWrite: 0x60,
  memoryWrite: 0x70,
  memoryWriteEnd: 0x80,
} as const;

export const ONBOARD_MODE = { onboard: 0x01, host: 0x02 } as const;

/**
 * Names from the library's PROFILE_FORMAT enum, which stops at 6 — the
 * dispatcher handles 8. Ids 7 and 8 are newer formats the managed wrapper was
 * never updated for, so they are described by what they carry instead.
 */
const PROFILE_FORMAT_NAMES: Record<number, string> = {
  1: "PROTOSS_HYJAL",
  2: "LOGAN",
  3: "HEAT",
  4: "HARPY",
  5: "HOST_LAYER",
  6: "BAYMAX",
  7: "FORMAT 7", // (v6 + bunny hopping)
  8: "FORMAT 8", // (v6 + bunny hopping + analog buttons)
};

/**
 * Formats whose layout has been confirmed by decoding a real profile whose
 * checksum validates. Everything else is read out of vendor code only — the v6
 * base was wrong in two ways (DPI offset and endianness) until hardware
 * corrected it, so treat unverified layouts as display-only.
 *
 * Add a format here only after a dump from that device decodes sensibly with a
 * matching CRC.
 *
 * Format 2 (LOGAN) is trusted only for its report-rate field: the v1 base was
 * recovered from vendor code, the write sequence is the same one format 7
 * proved on hardware, and the rate byte decodes back as a polling interval. A
 * hardware sanity check on a G502/G403-family device is still required before
 * release — see docs/logitech-onboard-profiles.md.
 */
const VERIFIED_FORMATS = new Set([7, 2]);

export interface ProfileFormat {
  id: number;
  name: string;
  /** Which base layout applies; decides how a profile sector is decoded. */
  base: "v1" | "v6";
  /** A layout exists for this format. */
  supported: boolean;
  /** The layout has been confirmed against real hardware. */
  verified: boolean;
}

export function describeProfileFormat(profileFormatId: number): ProfileFormat {
  return {
    id: profileFormatId,
    name: PROFILE_FORMAT_NAMES[profileFormatId] ?? "unknown",
    base: profileFormatId >= 6 ? "v6" : "v1",
    supported: profileFormatId >= 1 && profileFormatId <= 8,
    verified: VERIFIED_FORMATS.has(profileFormatId),
  };
}

export type LiftOffLevel = "Low" | "Medium" | "High";

/**
 * Setting limits that vary by profile format rather than by model, keyed on the
 * format the mouse reports through 0x8100 getInfo. A new mouse on a known
 * format inherits them without a model check.
 */
/**
 * DPI slot limits for one format. Slot count and DPI range are properties of
 * the mouse, not of the app: an older format can hold fewer slots and a much
 * narrower range. Null means we have not established them for that format, in
 * which case slots are not offered at all rather than guessed at.
 */
export interface DpiStageCapabilities {
  maxStages: number;
  minDpi: number;
  maxDpi: number;
  stepDpi: number;
}

/**
 * Report-rate ceilings, which differ per connection: the radio and the USB
 * interface are not equally fast. Null when never established for a format.
 */
export interface ReportRateCapabilities {
  wirelessMaxHz: number;
  wiredMaxHz: number;
}

export interface ProfileFormatCapabilities {
  supportedLods: LiftOffLevel[];
  /**
   * Byte feature 0x2202 uses for each level. The same on every device — it is
   * the feature's enum, not the format's — but kept here so a format that ever
   * turns out to differ has somewhere to say so.
   */
  lodEncoding: Record<LiftOffLevel, number>;
  dpiStages: DpiStageCapabilities | null;
  reportRates: ReportRateCapabilities | null;
  /** Characters the name region holds, or null when the format has no name. */
  maxNameLength: number | null;
  /**
   * Whether the format has a bunny-hop byte at all. Kept separate from the
   * stored value: an unwritten byte reads 0xff and decodes to null, which
   * means "never set", not "not supported".
   */
  bunnyHop: boolean;
}

/** The name region is 0x30 bytes of UTF-16LE: 24 units, one kept for the
 * terminator so a full-length name still reads back with a clear end. */
const PROFILE_NAME_BYTES = 0x30;
export const PROFILE_NAME_MAX_CHARS = PROFILE_NAME_BYTES / 2 - 1;

/**
 * Feature 0x2202's lift-off enum: 0 means the sensor has no lift-off control,
 * and the levels count from one. This belongs to the feature, not to a profile
 * format — every device that exposes 0x2202 uses the same numbering.
 *
 * Confirmed twice over: captured from G HUB writing a Pro X Superlight 2
 * profile (02 -> 01 for medium to low, 01 -> 03 for low to high), and matching
 * OpenLogi's Lod enum { NotSupported = 0, Low = 1, Medium = 2, High = 3 }.
 *
 * The driver previously counted from zero, which made "Low" write 0 — a value
 * meaning "unsupported" that the mouse rejects — and reported every level one
 * step too high.
 */
const LOD_ENCODING: Record<LiftOffLevel, number> = { Low: 1, Medium: 2, High: 3 };

/**
 * Applied when the mouse does not report a format, or reports one whose limits
 * were never established.
 *
 * Only two levels are offered because no third was ever confirmed on such a
 * device — not because Low is unreachable. That was the old off-by-one talking:
 * Low used to write 0, which means "no lift-off control", so it always failed.
 */
const DEFAULT_FORMAT_CAPABILITIES: ProfileFormatCapabilities = {
  supportedLods: ["Medium", "High"],
  lodEncoding: LOD_ENCODING,
  // Base v1 has a scalar DPI table, but its sensor-specific conversion and
  // writable range are not verified. Unknown formats therefore offer no edits.
  dpiStages: null,
  // Ceilings are a property of the radio and the USB interface, so they cannot
  // be carried over from another mouse.
  reportRates: null,
  maxNameLength: null,
  bunnyHop: false,
};

const FORMAT_CAPABILITIES: Record<number, ProfileFormatCapabilities> = {
  // Wired HERO-era mice (G403 HERO, G502 HERO family). Base v1 stores a single
  // report-rate byte as the USB polling interval in milliseconds, so only the
  // wired link is writable; there is no radio link, no DPI stage table, no name
  // region text and no bunny hop on this format. The 1000 Hz ceiling is the
  // shared USB cap of that generation.
  2: {
    supportedLods: ["Medium", "High"],
    lodEncoding: LOD_ENCODING,
    dpiStages: null,
    reportRates: { wirelessMaxHz: 0, wiredMaxHz: 1000 },
    maxNameLength: null,
    bunnyHop: false,
  },
  // Pro X Superlight 2. Three levels, counted from one. Five slots, from the
  // 5x5 stage table in the registration and confirmed against a real profile.
  7: {
    supportedLods: ["Low", "Medium", "High"],
    lodEncoding: LOD_ENCODING,
    dpiStages: { maxStages: 5, minDpi: 100, maxDpi: 32000, stepDpi: 50 },
    // Reported on hardware: the Lightspeed link runs to 8 kHz, the USB cable
    // is a 1 kHz charging connection rather than a full-rate wired mode.
    reportRates: { wirelessMaxHz: 8000, wiredMaxHz: 1000 },
    maxNameLength: PROFILE_NAME_MAX_CHARS,
    bunnyHop: true,
  },
  // Format 8 carries the analog-button block, so it is the PRO X 2 Superstrike
  // format. Its two levels are what the driver has always offered and were
  // never checked against a real device; its sensor range was never captured
  // either, so slots stay unavailable rather than being assumed to match
  // format 7.
  8: {
    supportedLods: ["Low", "High"],
    lodEncoding: LOD_ENCODING,
    dpiStages: null,
    reportRates: null,
    // The name region is part of base v6, which format 8 shares.
    maxNameLength: PROFILE_NAME_MAX_CHARS,
    bunnyHop: true,
  },
};

export function capabilitiesForFormat(profileFormatId: number | null | undefined): ProfileFormatCapabilities {
  if (profileFormatId === null || profileFormatId === undefined) return DEFAULT_FORMAT_CAPABILITIES;
  return FORMAT_CAPABILITIES[profileFormatId] ?? DEFAULT_FORMAT_CAPABILITIES;
}

/** Turns a raw 0x2202 lift-off byte back into a level for the given format. */
export function decodeLiftOffLevel(
  raw: number | null | undefined,
  capabilities: ProfileFormatCapabilities,
): LiftOffLevel | null {
  if (raw === null || raw === undefined) return null;
  const level = (Object.keys(capabilities.lodEncoding) as LiftOffLevel[])
    .find((name) => capabilities.lodEncoding[name] === raw);
  // 0 is the feature's "not supported" value, and anything else unmapped is
  // simply unknown. Either way it is reported as no level rather than guessed
  // at — reading 0 as "Low" is how the off-by-one used to hide itself.
  return level ?? null;
}

export interface OnboardProfilesInfo {
  memoryModelId: number;
  profileFormatId: number;
  profileCount: number;
  sectorCount: number;
  sectorSize: number;
}

export interface DirectoryEntry {
  sector: number;
  enabled: boolean;
}

export interface DpiStage {
  x: number;
  y: number;
  /** 0 marks an unused stage; real levels are 1-3 (low/medium/high). */
  lod: number;
}

export interface OnboardProfile {
  sector: number;
  enabled: boolean;
  isCurrent: boolean;
  name: string | null;
  dpiStages: DpiStage[];
  defaultDpiIndex: number | null;
  reportRateWireless: number | null;
  reportRateWired: number | null;
  angleSnapping: boolean | null;
  powerSaveTimeoutSeconds: number | null;
  powerOffTimeoutSeconds: number | null;
  /**
   * Bunny-hop timeout in milliseconds, or 0 when the feature is off. Stored as
   * ms / 10, so G HUB's 100-1000 ms range is 0x0a-0x64 and "off" is 0x00. All
   * three confirmed on hardware; 0xff is unwritten flash and decodes as null.
   */
  bunnyHoppingMs: number | null;
  crcValid: boolean;
  /** Raw sector, kept so captures can diff before/after a vendor-app change. */
  raw: Uint8Array;
}

/** Report-rate bytes index this table, matching 0x8061's ordering. */
const REPORT_RATE_HZ = [125, 250, 500, 1000, 2000, 4000, 8000] as const;

/**
 * Field offsets per profile format. Formats 1-5 use the v1 base, 6-8 the v6
 * base; only the fields the UI reads are listed here.
 */
interface ProfileLayout {
  reportRateWireless: number | null;
  reportRateWired: number | null;
  /** Start of the DPI block: two index bytes, then five 5-byte stages. */
  dpi: number | null;
  angleSnapping: number;
  powerSaveTimeout: number | null;
  powerOffTimeout: number | null;
  profileName: number;
  /** Only formats 7+ register this component. */
  bunnyHopping: number | null;
}

const LAYOUT_V1: ProfileLayout = {
  reportRateWireless: null,
  reportRateWired: 0x00,
  dpi: 0x01,
  angleSnapping: 0x11,
  powerSaveTimeout: 0x1c,
  powerOffTimeout: 0x1e,
  profileName: 0xa0,
  bunnyHopping: null,
};

const LAYOUT_V6: ProfileLayout = {
  reportRateWireless: 0x00,
  reportRateWired: 0x01,
  dpi: 0x02,
  angleSnapping: 0x22,
  powerSaveTimeout: 0x2c,
  powerOffTimeout: 0x2e,
  profileName: 0xa0,
  bunnyHopping: null,
};

export function layoutForFormat(profileFormatId: number): ProfileLayout {
  const base = profileFormatId >= 6 ? LAYOUT_V6 : LAYOUT_V1;
  return { ...base, bunnyHopping: profileFormatId >= 7 ? 0x25 : null };
}

export interface ComponentSpec {
  offset: number;
  size: number;
  name: string;
}

const COMPONENTS_V1: ComponentSpec[] = [
  { offset: 0x00, size: 1, name: "report_rate" },
  { offset: 0x01, size: 0x0c, name: "dpi_v1" },
  { offset: 0x0d, size: 3, name: "color" },
  { offset: 0x10, size: 1, name: "power_mode" },
  { offset: 0x11, size: 1, name: "angle_snapping" },
  { offset: 0x1c, size: 2, name: "power_save_timeout" },
  { offset: 0x1e, size: 2, name: "power_off_timeout" },
  { offset: 0x20, size: 0x40, name: "button_functions" },
  { offset: 0x60, size: 0x40, name: "g_shift_function" },
  { offset: 0xa0, size: 0x30, name: "profile_name" },
];

const COMPONENTS_V6: ComponentSpec[] = [
  { offset: 0x00, size: 1, name: "report_rate_wireless" },
  { offset: 0x01, size: 1, name: "report_rate_wired" },
  { offset: 0x02, size: 0x1b, name: "dpi_v6" },
  { offset: 0x1d, size: 4, name: "dpi_delta" },
  { offset: 0x21, size: 1, name: "power_mode" },
  { offset: 0x22, size: 1, name: "angle_snapping" },
  { offset: 0x23, size: 2, name: "write_counter" },
  { offset: 0x2c, size: 2, name: "power_save_timeout" },
  { offset: 0x2e, size: 2, name: "power_off_timeout" },
  { offset: 0x30, size: 0x30, name: "button_functions" },
  { offset: 0x70, size: 0x30, name: "g_shift_function" },
  { offset: 0xa0, size: 0x30, name: "profile_name" },
  { offset: 0xd0, size: 0x0b, name: "lighting cluster_0_active" },
  { offset: 0xdb, size: 0x0b, name: "lighting cluster_1_active" },
  { offset: 0xe6, size: 0x0b, name: "lighting cluster_0_passive" },
  { offset: 0xf1, size: 0x0b, name: "lighting cluster_1_passive" },
  { offset: 0xfc, size: 1, name: "lighting_flag" },
];

const BUNNY_HOPPING: ComponentSpec = { offset: 0x25, size: 1, name: "bunny_hopping" };
const ANALOG_BUTTON: ComponentSpec = { offset: 0x26, size: 6, name: "analog_button" };

export function componentsForFormat(profileFormatId: number): ComponentSpec[] {
  const components = profileFormatId >= 6 ? [...COMPONENTS_V6] : [...COMPONENTS_V1];
  if (profileFormatId >= 7) components.push(BUNNY_HOPPING);
  if (profileFormatId >= 8) components.push(ANALOG_BUTTON);
  return components.sort((left, right) => left.offset - right.offset);
}

/**
 * Names the field a byte belongs to, so a diff reads as "dpi_v6 +2" rather
 * than a bare offset. Returns null for bytes no component claims.
 */
export function describeOffset(profileFormatId: number, offset: number, sectorSize = 255): string | null {
  if (offset >= sectorSize - 2) return "checksum";
  const owner = componentsForFormat(profileFormatId)
    .find((component) => offset >= component.offset && offset < component.offset + component.size);
  return owner ? `${owner.name} +${offset - owner.offset}` : null;
}

export function parseProfilesInfo(reply: Uint8Array): OnboardProfilesInfo {
  return {
    memoryModelId: reply[3] ?? 0,
    profileFormatId: reply[4] ?? 0,
    profileCount: reply[6] ?? 0,
    sectorCount: reply[9] ?? 0,
    sectorSize: ((reply[10] ?? 0) << 8) | (reply[11] ?? 0),
  };
}

/** Directory entries are 4 bytes: sector (big-endian), enabled, reserved. */
export function parseDirectory(bytes: Uint8Array): DirectoryEntry[] {
  const entries: DirectoryEntry[] = [];
  for (let offset = 0; offset + 4 <= bytes.length; offset += 4) {
    const sector = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (sector === 0xffff || sector === 0x0000) break;
    entries.push({ sector, enabled: bytes[offset + 2] === 0x01 });
  }
  return entries;
}

/** CRC-16/CCITT-FALSE over everything but the trailing two checksum bytes. */
export function profileCrc(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (let index = 0; index < bytes.length - 2; index += 1) {
    crc ^= (bytes[index] ?? 0) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function storedCrc(bytes: Uint8Array): number {
  return ((bytes[bytes.length - 2] ?? 0) << 8) | (bytes[bytes.length - 1] ?? 0);
}

/** Writes the checksum into the last two bytes, big-endian. */
export function applyCrc(bytes: Uint8Array): Uint8Array {
  const crc = profileCrc(bytes);
  bytes[bytes.length - 2] = (crc >> 8) & 0xff;
  bytes[bytes.length - 1] = crc & 0xff;
  return bytes;
}

/**
 * Complete factory profile captured after G HUB/Onboard Memory Manager's
 * "reset all profiles" action on profile format 7. This is intentionally an
 * exact sector image rather than a list of guessed defaults: it resets button
 * assignments, G-Shift, lighting and currently-undecoded fields as well as the
 * settings OpenMouse exposes in the UI.
 */
const FACTORY_PROFILE_FORMAT_7 = `
  03 03 00 00 20 03 20 03 02 b0 04 b0 04 02 40 06
  40 06 02 60 09 60 09 02 80 0c 80 0c 02 00 00 00
  00 ff 00 ff ff ff ff ff ff ff ff ff 3c 00 2c 01
  80 01 00 01 80 01 00 02 80 01 00 04 80 01 00 08
  80 01 00 10 ff ff ff ff ff ff ff ff ff ff ff ff
  ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
  ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
  ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
  ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
  ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
  ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
  ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
  ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
  03 00 00 00 00 00 1f 40 00 00 00 03 00 00 00 00
  00 1f 40 00 00 00 03 00 00 00 00 00 1f 40 32 00
  00 03 00 00 00 00 00 1f 40 32 00 00 03 84 db
`;

/** Returns a fresh, CRC-valid factory sector only for a captured geometry. */
export function factoryProfileForFormat(profileFormatId: number, sectorSize: number): Uint8Array | null {
  if (profileFormatId !== 7 || sectorSize !== 255) return null;
  return Uint8Array.from(
    FACTORY_PROFILE_FORMAT_7.trim().split(/\s+/),
    (byte) => Number.parseInt(byte, 16),
  );
}

/**
 * Returns a copy of the directory sector with one profile's enabled flag
 * changed and the checksum recomputed. Every other byte is carried through
 * untouched, so unknown directory fields survive.
 */
export function setDirectoryEnabled(sector: Uint8Array, profileSector: number, enabled: boolean): Uint8Array {
  const updated = sector.slice();
  for (let offset = 0; offset + 4 <= updated.length; offset += 4) {
    const entry = ((updated[offset] ?? 0) << 8) | (updated[offset + 1] ?? 0);
    if (entry === 0xffff || entry === 0x0000) break;
    if (entry === profileSector) {
      updated[offset + 2] = enabled ? 0x01 : 0x00;
      return applyCrc(updated);
    }
  }
  throw new Error(`Profile sector ${profileSector} is not listed in the directory.`);
}

function readUint16LE(bytes: Uint8Array, offset: number): number | null {
  const low = bytes[offset];
  const high = bytes[offset + 1];
  if (low === undefined || high === undefined) return null;
  const value = low | (high << 8);
  // Unwritten flash reads as 0xffff.
  return value === 0xffff ? null : value;
}

/** Profile names are UTF-16LE, despite the library calling them "utf8". */
function decodeName(bytes: Uint8Array, offset: number): string | null {
  const slice = bytes.slice(offset, offset + 0x30);
  if (slice.length === 0 || slice.every((byte) => byte === 0xff)) return null;
  const text = new TextDecoder("utf-16le").decode(slice).split("\0")[0].trim();
  return text.length > 0 ? text : null;
}

function decodeDpi(bytes: Uint8Array, offset: number): { stages: DpiStage[]; defaultIndex: number | null } {
  const defaultIndex = bytes[offset] ?? null;
  const stages: DpiStage[] = [];
  for (let stage = 0; stage < 5; stage += 1) {
    const base = offset + 2 + stage * 5;
    const x = readUint16LE(bytes, base);
    const y = readUint16LE(bytes, base + 2);
    const lod = bytes[base + 4];
    if (x === null || y === null || lod === undefined || x === 0) continue;
    stages.push({ x, y, lod });
  }
  return { stages, defaultIndex: defaultIndex === 0xff ? null : defaultIndex };
}

/** Formats 1-5 store one little-endian DPI value per slot, without X/Y or LOD. */
function decodeDpiV1(bytes: Uint8Array, offset: number): { stages: DpiStage[]; defaultIndex: number | null } {
  const rawDefaultIndex = bytes[offset];
  const stages: DpiStage[] = [];
  for (let stage = 0; stage < DPI_STAGE_SLOTS; stage += 1) {
    const dpi = readUint16LE(bytes, offset + 2 + stage * 2);
    if (dpi === null || dpi === 0) continue;
    stages.push({ x: dpi, y: dpi, lod: 0 });
  }
  return {
    stages,
    defaultIndex: rawDefaultIndex === undefined || rawDefaultIndex === 0xff ? null : rawDefaultIndex,
  };
}

function decodeReportRate(bytes: Uint8Array, offset: number | null): number | null {
  if (offset === null) return null;
  const raw = bytes[offset];
  return raw === undefined || raw === 0xff ? null : REPORT_RATE_HZ[raw] ?? null;
}

/** Formats 1-5 store the USB polling interval in milliseconds. */
function decodeReportRateV1(bytes: Uint8Array, offset: number | null): number | null {
  if (offset === null) return null;
  const intervalMs = bytes[offset];
  if (intervalMs === undefined || intervalMs === 0xff || intervalMs === 0) return null;
  const hz = 1000 / intervalMs;
  return Number.isInteger(hz) ? hz : null;
}

/** Rates the byte can index, filtered to the ceiling for that connection. */
export function reportRatesFor(
  capabilities: ReportRateCapabilities | null,
  link: "wireless" | "wired",
): number[] {
  if (!capabilities) return [];
  const ceiling = link === "wired" ? capabilities.wiredMaxHz : capabilities.wirelessMaxHz;
  return REPORT_RATE_HZ.filter((rate) => rate <= ceiling);
}

export function validateReportRate(
  hz: number,
  capabilities: ReportRateCapabilities | null,
  link: "wireless" | "wired",
): string | null {
  const allowed = reportRatesFor(capabilities, link);
  if (allowed.length === 0) return "Report rates are not known for this profile format.";
  if (!allowed.includes(hz)) {
    return `${link === "wired" ? "Wired" : "Wireless"} report rate must be one of ${allowed.join(", ")} Hz.`;
  }
  return null;
}

/**
 * Returns a copy of the sector with one connection's report rate replaced and
 * the checksum reapplied. The two links are stored separately, so setting one
 * leaves the other alone.
 */
export function encodeReportRate(
  sector: Uint8Array,
  profileFormatId: number,
  link: "wireless" | "wired",
  hz: number,
): Uint8Array {
  const capabilities = capabilitiesForFormat(profileFormatId).reportRates;
  const invalid = validateReportRate(hz, capabilities, link);
  if (invalid) throw new Error(invalid);
  const layout = layoutForFormat(profileFormatId);
  const offset = link === "wired" ? layout.reportRateWired : layout.reportRateWireless;
  if (offset === null) throw new Error("This profile format has no report-rate setting.");

  const result = sector.slice();
  // Base v1 (formats 1-5) stores the USB polling interval in milliseconds, the
  // same encoding legacy 0x8060 uses; base v6 and later index the rate table
  // 0x8061 shares. Writing the wrong one would read back as another rate.
  result[offset] = profileFormatId < 6
    ? Math.round(1000 / hz)
    : REPORT_RATE_HZ.indexOf(hz as (typeof REPORT_RATE_HZ)[number]);
  return applyCrc(result);
}

/** Returns why a profile name cannot be stored, or null when it fits. */
export function validateProfileName(name: string, maxLength: number | null): string | null {
  if (maxLength === null) return "This profile format has no name field.";
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Enter a profile name.";
  if (trimmed.length > maxLength) return `Profile names are at most ${maxLength} characters.`;
  // The region is UTF-16 code units, so anything outside the BMP takes two of
  // them and would be cut in half by the length check above.
  if ([...trimmed].some((character) => (character.codePointAt(0) ?? 0) > 0xffff)) {
    return "Profile names cannot contain emoji or other characters outside the basic range.";
  }
  return null;
}

/**
 * Returns a copy of the sector with the profile name replaced and the checksum
 * reapplied. The region is zero-filled first so a shorter name cannot leave the
 * tail of the previous one behind it.
 */
export function encodeProfileName(
  sector: Uint8Array,
  profileFormatId: number,
  name: string,
): Uint8Array {
  const invalid = validateProfileName(name, capabilitiesForFormat(profileFormatId).maxNameLength);
  if (invalid) throw new Error(invalid);
  const offset = layoutForFormat(profileFormatId).profileName;

  const result = sector.slice();
  result.fill(0, offset, offset + PROFILE_NAME_BYTES);
  const trimmed = name.trim();
  for (let index = 0; index < trimmed.length; index += 1) {
    const code = trimmed.charCodeAt(index);
    result[offset + index * 2] = code & 0xff;
    result[offset + index * 2 + 1] = (code >> 8) & 0xff;
  }
  return applyCrc(result);
}

export const BUNNY_HOP_LIMITS = { minMs: 100, maxMs: 1000, stepMs: 10 } as const;

/**
 * Returns why a bunny-hop time is invalid, or null when it is acceptable.
 * The byte stores ms / 10, so anything off-step cannot be represented.
 */
export function validateBunnyHoppingMs(milliseconds: number): string | null {
  if (!Number.isFinite(milliseconds) || !Number.isInteger(milliseconds)) {
    return "Enter a whole number of milliseconds.";
  }
  if (milliseconds % BUNNY_HOP_LIMITS.stepMs !== 0) {
    return `Bunny hop time must be a multiple of ${BUNNY_HOP_LIMITS.stepMs} ms.`;
  }
  if (milliseconds === 0) return null; // off
  if (milliseconds < BUNNY_HOP_LIMITS.minMs || milliseconds > BUNNY_HOP_LIMITS.maxMs) {
    return `Bunny hop time must be between ${BUNNY_HOP_LIMITS.minMs} and ${BUNNY_HOP_LIMITS.maxMs} ms, or off.`;
  }
  return null;
}

/** The stage table always has room for five records; how many a format allows
 * is a per-format limit, so this is only the size of the region to clear. */
const DPI_STAGE_SLOTS = 5;

export interface DpiStagePlan {
  /** One entry per slot the user wants, within the format's limit. */
  stages: DpiStage[];
  /** Which slot the mouse starts on, as an index into `stages`. */
  defaultIndex: number;
}

/**
 * Returns why a stage plan cannot be written to this format, or null when it
 * is writable. Every limit comes from the format, so an older mouse holding
 * fewer slots or a narrower DPI range is checked against its own numbers.
 */
export function validateDpiStagePlan(
  plan: DpiStagePlan,
  capabilities: DpiStageCapabilities | null,
): string | null {
  if (capabilities === null) {
    return "DPI slots are not known for this profile format.";
  }
  const { maxStages, minDpi, maxDpi, stepDpi } = capabilities;
  if (plan.stages.length < 1 || plan.stages.length > maxStages) {
    return `This profile holds 1 to ${maxStages} DPI slots.`;
  }
  if (!Number.isInteger(plan.defaultIndex) || plan.defaultIndex < 0 || plan.defaultIndex >= plan.stages.length) {
    return "The default slot must be one of the slots in use.";
  }
  for (const [index, stage] of plan.stages.entries()) {
    for (const [axis, value] of [["X", stage.x], ["Y", stage.y]] as const) {
      if (!Number.isInteger(value) || value < minDpi || value > maxDpi) {
        return `Slot ${index + 1} ${axis} DPI must be between ${minDpi} and ${maxDpi}.`;
      }
      if (value % stepDpi !== 0) {
        return `Slot ${index + 1} ${axis} DPI must be a multiple of ${stepDpi}.`;
      }
    }
    // 0 is the "unused stage" marker, so an in-use slot cannot carry it.
    if (!Number.isInteger(stage.lod) || stage.lod < 1 || stage.lod > 3) {
      return `Slot ${index + 1} has an invalid lift-off level.`;
    }
  }
  return null;
}

/**
 * Levels as stored inside a stage record, where 0 means the stage is unused.
 * This is a property of the record itself, so it does not vary with whatever
 * encoding feature 0x2202 happens to use on a given format.
 */
export const PROFILE_STAGE_LOD: Record<LiftOffLevel, number> = { Low: 1, Medium: 2, High: 3 };

export function stageLodLevel(lod: number): LiftOffLevel | null {
  return (Object.keys(PROFILE_STAGE_LOD) as LiftOffLevel[])
    .find((level) => PROFILE_STAGE_LOD[level] === lod) ?? null;
}

/** Snaps a typed DPI onto the step and into the range the format allows. */
export function clampDpi(value: number, capabilities: DpiStageCapabilities): number {
  const { minDpi, maxDpi, stepDpi } = capabilities;
  if (!Number.isFinite(value)) return minDpi;
  const stepped = Math.round(value / stepDpi) * stepDpi;
  return Math.min(maxDpi, Math.max(minDpi, stepped));
}

/**
 * Returns a copy of the sector with the DPI stage table replaced and the
 * checksum reapplied. Slots past the plan are zeroed, which is how the vendor
 * marks a stage unused, so the slot count is simply how many stages are set.
 */
export function encodeDpiStages(
  sector: Uint8Array,
  profileFormatId: number,
  plan: DpiStagePlan,
): Uint8Array {
  const invalid = validateDpiStagePlan(plan, capabilitiesForFormat(profileFormatId).dpiStages);
  if (invalid) throw new Error(invalid);
  const layout = layoutForFormat(profileFormatId);
  if (layout.dpi === null) throw new Error("This profile format has no DPI stages.");

  const result = sector.slice();
  result[layout.dpi] = plan.defaultIndex;
  // 0x03 is the g-shift index. It is left alone unless it now points past the
  // slots in use, in which case it would select a zeroed stage.
  const gShift = result[layout.dpi + 1] ?? 0;
  if (gShift >= plan.stages.length) result[layout.dpi + 1] = plan.defaultIndex;

  for (let stage = 0; stage < DPI_STAGE_SLOTS; stage += 1) {
    const base = layout.dpi + 2 + stage * 5;
    const entry = plan.stages[stage];
    if (!entry) {
      result[base] = 0; result[base + 1] = 0;
      result[base + 2] = 0; result[base + 3] = 0;
      result[base + 4] = 0;
      continue;
    }
    writeUint16LE(result, base, entry.x);
    writeUint16LE(result, base + 2, entry.y);
    result[base + 4] = entry.lod;
  }
  return applyCrc(result);
}

/**
 * Snaps a typed bunny-hop time into the range and step the byte can hold.
 * A number field only enforces min/max/step for its spinner, so a typed value
 * has to be corrected here instead of being rejected.
 */
export function clampBunnyHopMs(milliseconds: number): number {
  const { minMs, maxMs, stepMs } = BUNNY_HOP_LIMITS;
  if (!Number.isFinite(milliseconds)) return minMs;
  const stepped = Math.round(milliseconds / stepMs) * stepMs;
  return Math.min(maxMs, Math.max(minMs, stepped));
}

/** Stored as ms / 10: G HUB's 100-1000 ms range is 0x0a-0x64. */
function decodeBunnyHoppingMs(bytes: Uint8Array, offset: number | null): number | null {
  if (offset === null) return null;
  const raw = bytes[offset];
  return raw === undefined || raw === 0xff ? null : raw * 10;
}

function writeUint16LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

/**
 * Rebuilds `before` with every field we can encode set to the value found in
 * `after`, then fixes the checksum.
 *
 * This is how a write path is proven without writing: if the result is
 * byte-identical to what the vendor software actually produced, our encoding,
 * offsets and CRC are all correct. Any byte that differs is something we either
 * model wrongly or cannot write yet.
 */
export function reproduceProfile(before: Uint8Array, after: Uint8Array, profileFormatId: number): Uint8Array {
  const layout = layoutForFormat(profileFormatId);
  const result = before.slice();
  const legacyLayout = profileFormatId < 6;
  const isErased = (offset: number, size: number): boolean =>
    after.slice(offset, offset + size).every((byte) => byte === 0xff);

  const copyRate = (offset: number | null): void => {
    if (offset === null) return;
    const hz = legacyLayout ? decodeReportRateV1(after, offset) : decodeReportRate(after, offset);
    if (hz === null) return;
    if (legacyLayout) result[offset] = 1000 / hz;
    else {
      const index = REPORT_RATE_HZ.indexOf(hz as (typeof REPORT_RATE_HZ)[number]);
      if (index >= 0) result[offset] = index;
    }
  };
  copyRate(layout.reportRateWireless);
  copyRate(layout.reportRateWired);

  if (layout.dpi !== null) {
    const dpi = legacyLayout ? decodeDpiV1(after, layout.dpi) : decodeDpi(after, layout.dpi);
    if (dpi.defaultIndex !== null) result[layout.dpi] = dpi.defaultIndex;
    result[layout.dpi + 1] = after[layout.dpi + 1];
    // Stages are re-encoded from decoded values, not copied, so their
    // little-endian representation is what is actually under test.
    let stage = 0;
    for (const { x, y, lod } of dpi.stages) {
      const base = layout.dpi + 2 + stage * (legacyLayout ? 2 : 5);
      writeUint16LE(result, base, x);
      if (!legacyLayout) {
        writeUint16LE(result, base + 2, y);
        result[base + 4] = lod;
      }
      stage += 1;
    }
  }

  const angleSnapping = after[layout.angleSnapping];
  if (angleSnapping !== undefined) result[layout.angleSnapping] = angleSnapping;

  if (layout.bunnyHopping !== null) {
    const milliseconds = decodeBunnyHoppingMs(after, layout.bunnyHopping);
    if (milliseconds !== null) result[layout.bunnyHopping] = Math.round(milliseconds / 10);
    // Factory reset returns the optional component to erased flash rather than
    // encoding "off" as zero. That distinction is visible in a vendor diff.
    else if (after[layout.bunnyHopping] === 0xff) result[layout.bunnyHopping] = 0xff;
  }

  for (const offset of [layout.powerSaveTimeout, layout.powerOffTimeout]) {
    if (offset === null) continue;
    const seconds = readUint16LE(after, offset);
    if (seconds !== null) writeUint16LE(result, offset, seconds);
  }

  const name = legacyLayout ? null : decodeName(after, layout.profileName);
  if (name !== null) {
    const encoded = new Uint8Array(0x30);
    encoded.set(after.slice(layout.profileName, layout.profileName + 0x30).map(() => 0));
    for (let index = 0; index < name.length && index * 2 + 1 < 0x30; index += 1) {
      const code = name.charCodeAt(index);
      encoded[index * 2] = code & 0xff;
      encoded[index * 2 + 1] = (code >> 8) & 0xff;
    }
    result.set(encoded, layout.profileName);
  } else if (isErased(layout.profileName, PROFILE_NAME_BYTES)) {
    // An unnamed factory profile uses erased bytes, not a zero-filled empty
    // UTF-16 string. Reproduce that representation exactly so its CRC matches.
    result.fill(0xff, layout.profileName, layout.profileName + PROFILE_NAME_BYTES);
  }

  // Reset-to-factory erases the complete G-Shift assignment component. We do
  // not claim to encode individual assignments yet, but an all-0xff target is
  // unambiguous and safe to reproduce for capture verification.
  const gShift = componentsForFormat(profileFormatId).find((component) => component.name === "g_shift_function");
  if (gShift && isErased(gShift.offset, gShift.size)) {
    result.fill(0xff, gShift.offset, gShift.offset + gShift.size);
  }

  return applyCrc(result);
}

export function decodeOnboardProfile(
  bytes: Uint8Array,
  profileFormatId: number,
  entry: DirectoryEntry,
  isCurrent: boolean,
): OnboardProfile {
  const layout = layoutForFormat(profileFormatId);
  const legacyLayout = profileFormatId < 6;
  const dpi = layout.dpi === null
    ? { stages: [], defaultIndex: null }
    : legacyLayout ? decodeDpiV1(bytes, layout.dpi) : decodeDpi(bytes, layout.dpi);
  const angleSnappingByte = bytes[layout.angleSnapping];

  return {
    sector: entry.sector,
    enabled: entry.enabled,
    isCurrent,
    // The v1 region is byte text, not UTF-16. This G402 capture contains
    // non-text device data there, so do not manufacture a mojibake name.
    name: legacyLayout ? null : decodeName(bytes, layout.profileName),
    dpiStages: dpi.stages,
    defaultDpiIndex: dpi.defaultIndex,
    reportRateWireless: legacyLayout
      ? decodeReportRateV1(bytes, layout.reportRateWireless)
      : decodeReportRate(bytes, layout.reportRateWireless),
    reportRateWired: legacyLayout
      ? decodeReportRateV1(bytes, layout.reportRateWired)
      : decodeReportRate(bytes, layout.reportRateWired),
    angleSnapping: angleSnappingByte === undefined || angleSnappingByte === 0xff
      ? null
      : angleSnappingByte !== 0,
    powerSaveTimeoutSeconds: layout.powerSaveTimeout === null
      ? null
      : readUint16LE(bytes, layout.powerSaveTimeout),
    powerOffTimeoutSeconds: layout.powerOffTimeout === null
      ? null
      : readUint16LE(bytes, layout.powerOffTimeout),
    bunnyHoppingMs: decodeBunnyHoppingMs(bytes, layout.bunnyHopping),
    crcValid: bytes.length > 2 && profileCrc(bytes) === storedCrc(bytes),
    raw: bytes,
  };
}
