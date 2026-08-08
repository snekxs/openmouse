import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCrc,
  decodeOnboardProfile,
  parseDirectory,
  parseProfilesInfo,
  profileCrc,
  reproduceProfile,
  setDirectoryEnabled,
  storedCrc,
  capabilitiesForFormat,
  clampBunnyHopMs,
  clampDpi,
  decodeLiftOffLevel,
  describeProfileFormat,
  encodeDpiStages,
  encodeProfileName,
  encodeReportRate,
  factoryProfileForFormat,
  reportRatesFor,
  validateBunnyHoppingMs,
  validateProfileName,
  validateReportRate,
  PROFILE_NAME_MAX_CHARS,
  validateDpiStagePlan,
} from "./onboard-profiles.ts";

function bytes(hex: string): Uint8Array {
  return new Uint8Array(hex.trim().split(/\s+/).map((byte) => parseInt(byte, 16)));
}

/** getOnboardProfilesInfo reply from a Pro X Superlight 2 (3-byte header + payload). */
const INFO_REPLY = bytes("01 0d 00  01 07 01 05 01 05 10 00 ff 0a 04 00 00");

/** Directory sector 0x0000: five profiles, only sector 3 enabled. */
const DIRECTORY = bytes(`
  00 01 00 ff 00 02 00 ff 00 03 01 ff 00 04 00 ff
  00 05 00 ff ff ff ff ff ff ff ff ff ff ff ff ff
`);

/**
 * Profile sector 3, the configured profile: named "myp", a single 1600 DPI
 * stage, G-Shift bindings populated. 255 bytes, CRC 0x20c7.
 */
const SECTOR_3 = bytes(`
  03 03 00 00 40 06 40 06 02 00 00 00 00 00 00 00
  00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
  00 ff 00 ff ff 00 ff ff ff ff ff ff 3c 00 2c 01
  80 01 00 01 80 01 00 02 80 01 00 04 80 01 00 08
  80 01 00 10 ff ff ff ff ff ff ff ff ff ff ff ff
  ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
  ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
  80 01 00 01 80 01 00 02 80 01 00 04 80 01 00 08
  80 01 00 10 ff ff ff ff ff ff ff ff ff ff ff ff
  ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
  6d 00 79 00 70 00 00 00 00 00 00 00 00 00 00 00
  00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
  00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
  03 00 00 00 00 00 1f 40 00 00 00 03 00 00 00 00
  00 1f 40 00 00 00 03 00 00 00 00 00 1f 40 32 00
  00 03 00 00 00 00 00 1f 40 32 00 00 03 20 c7
`);

/** An untouched factory profile: no name, five default DPI stages. CRC 0x84db. */
const SECTOR_2 = bytes(`
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
`);

/** G402 format-1 sector captured by OpenMouse; remaining bytes are erased. */
const G402_SECTOR = (() => {
  const sector = new Uint8Array(1024).fill(0xff);
  sector.set(bytes(`
    01 02 00 a4 01 48 03 3c 06 78 0c 00 00 ff ff ff
    ff 00 ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    80 01 00 01 80 01 00 02 80 01 00 04 80 01 00 08
    80 01 00 10 90 07 ff ff 90 04 ff ff 90 03 ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff
    01 01 01 ff ff ff 00 00 00 02 00 00 00 00 00 df
    00 08 e1 d2 00 08 15 d3 00 08 01 00 00 02 00 00
    00 00 14 df 00 08 25 d3 00 08 2d d3 00 08 03 00
    00 02 00 00 00 00 28 df 00 08 51 d3 00 08 59 d3
    00 08 05 00 00 03 00 00 00 00 3c df 00 08 67 d3
    00 08 93 d3 00 08 7d d3 00 08 c1 00 00 02 00 ff
  `), 0);
  sector.set([0x4e, 0xba], sector.length - 2);
  return sector;
})();

test("parses getOnboardProfilesInfo", () => {
  assert.deepEqual(parseProfilesInfo(INFO_REPLY), {
    memoryModelId: 1,
    profileFormatId: 7,
    profileCount: 5,
    sectorCount: 16,
    sectorSize: 255,
  });
});

test("parses the profile directory and its enabled flags", () => {
  const entries = parseDirectory(DIRECTORY);
  assert.deepEqual(entries, [
    { sector: 1, enabled: false },
    { sector: 2, enabled: false },
    { sector: 3, enabled: true },
    { sector: 4, enabled: false },
    { sector: 5, enabled: false },
  ]);
});

test("CRC-16/CCITT-FALSE matches the checksum stored on hardware", () => {
  assert.equal(SECTOR_3.length, 255);
  assert.equal(storedCrc(SECTOR_3), 0x20c7);
  assert.equal(profileCrc(SECTOR_3), 0x20c7);
  assert.equal(storedCrc(SECTOR_2), 0x84db);
  assert.equal(profileCrc(SECTOR_2), 0x84db);
});

test("decodes a configured profile", () => {
  const profile = decodeOnboardProfile(SECTOR_3, 7, { sector: 3, enabled: true }, true);
  assert.equal(profile.name, "myp");
  assert.equal(profile.crcValid, true);
  assert.equal(profile.enabled, true);
  assert.equal(profile.isCurrent, true);
  assert.deepEqual(profile.dpiStages, [{ x: 1600, y: 1600, lod: 2 }]);
  assert.equal(profile.reportRateWireless, 1000);
  assert.equal(profile.reportRateWired, 1000);
  assert.equal(profile.powerSaveTimeoutSeconds, 60);
  assert.equal(profile.powerOffTimeoutSeconds, 300);
  assert.equal(profile.angleSnapping, false);
});

test("decodes an untouched factory profile", () => {
  const profile = decodeOnboardProfile(SECTOR_2, 7, { sector: 2, enabled: false }, false);
  assert.equal(profile.name, null, "an all-0xff name must not decode as text");
  assert.equal(profile.crcValid, true);
  assert.equal(profile.enabled, false);
  // Little-endian DPI: 20 03 -> 800, not 8195.
  assert.deepEqual(profile.dpiStages, [
    { x: 800, y: 800, lod: 2 },
    { x: 1200, y: 1200, lod: 2 },
    { x: 1600, y: 1600, lod: 2 },
    { x: 2400, y: 2400, lod: 2 },
    { x: 3200, y: 3200, lod: 2 },
  ]);
  assert.equal(profile.defaultDpiIndex, 0);
});

test("toggling a directory entry rewrites only that flag, plus the CRC", () => {
  // A full 255-byte directory sector with a valid checksum.
  const directory = new Uint8Array(255).fill(0xff);
  directory.set(DIRECTORY.slice(0, 20), 0);
  applyCrc(directory);

  const updated = setDirectoryEnabled(directory, 1, true);
  assert.equal(parseDirectory(updated)[0].enabled, true);
  assert.equal(profileCrc(updated), storedCrc(updated), "checksum must be recomputed");

  // Only the flag byte and the two CRC bytes may differ.
  const changed = [...updated].flatMap((byte, index) => (byte === directory[index] ? [] : [index]));
  assert.deepEqual(changed, [2, 253, 254]);
});

test("toggling refuses a sector the directory does not list", () => {
  const directory = applyCrc(new Uint8Array(255).fill(0xff));
  assert.throws(() => setDirectoryEnabled(directory, 9, true), /not listed/);
});

/**
 * A real capture: wireless polling was 8000 Hz (byte 0x00 = 0x06, CRC 0x6e7c)
 * and G HUB changed it to 1000 Hz (0x03, CRC 0x20c7). Rebuilding the "before"
 * state reproduces the checksum G HUB wrote for a sector we never dumped.
 */
test("the CRC reproduces a vendor-written checksum we never read", () => {
  const before = SECTOR_3.slice();
  before[0x00] = 0x06;
  applyCrc(before);
  assert.equal(storedCrc(before), 0x6e7c);
});

test("our encoders reproduce a vendor write byte for byte", () => {
  const before = SECTOR_3.slice();
  before[0x00] = 0x06;
  applyCrc(before);

  // Apply the change with our own encoding rather than copying bytes.
  const reproduced = reproduceProfile(before, SECTOR_3, 7);
  assert.deepEqual([...reproduced], [...SECTOR_3], "write path must match what G HUB produced");
});

/**
 * States of sector 3 observed while G HUB changed one setting at a time. Only
 * the first was ever dumped in full; the rest are reconstructed, so matching
 * their checksums confirms the CRC independently each time.
 */
const OBSERVED_STATES: ReadonlyArray<{ rate: number; bunnyHopping: number; crc: number }> = [
  { rate: 0x03, bunnyHopping: 0x00, crc: 0x20c7 },
  { rate: 0x06, bunnyHopping: 0x00, crc: 0x6e7c },
  { rate: 0x06, bunnyHopping: 0x0a, crc: 0xd92c },
  { rate: 0x06, bunnyHopping: 0x14, crc: 0x10fd },
];

const ENTRY = { sector: 3, enabled: true };

function sectorState(state: { rate: number; bunnyHopping: number }): Uint8Array {
  const bytes = SECTOR_3.slice();
  bytes[0x00] = state.rate;
  bytes[0x25] = state.bunnyHopping;
  return applyCrc(bytes);
}

test("the CRC matches every checksum G HUB wrote", () => {
  for (const state of OBSERVED_STATES) {
    assert.equal(
      storedCrc(sectorState(state)),
      state.crc,
      `rate 0x${state.rate.toString(16)} bunny 0x${state.bunnyHopping.toString(16)}`,
    );
  }
});

test("our encoders reproduce each observed transition byte for byte", () => {
  for (let index = 1; index < OBSERVED_STATES.length; index += 1) {
    const before = sectorState(OBSERVED_STATES[index - 1]);
    const after = sectorState(OBSERVED_STATES[index]);
    assert.deepEqual([...reproduceProfile(before, after, 7)], [...after], `transition ${index}`);
  }
});

test("decodes the captured G402 format-1 profile without v6 mojibake", () => {
  const profile = decodeOnboardProfile(G402_SECTOR, 1, { sector: 1, enabled: true }, false);
  assert.equal(G402_SECTOR.length, 1024);
  assert.equal(profile.crcValid, true);
  assert.equal(profile.name, null);
  assert.equal(profile.defaultDpiIndex, 2);
  assert.deepEqual(profile.dpiStages, [420, 840, 1596, 3192].map((dpi) => ({ x: dpi, y: dpi, lod: 0 })));
  assert.equal(profile.reportRateWireless, null);
  assert.equal(profile.reportRateWired, 1000);
  assert.equal(profile.angleSnapping, false);
  assert.equal(profile.powerSaveTimeoutSeconds, null);
  assert.equal(profile.powerOffTimeoutSeconds, null);
});

test("factory reset image is exact, CRC-valid and limited to captured geometry", () => {
  const factory = factoryProfileForFormat(7, 255);
  assert.ok(factory);
  assert.deepEqual([...factory], [...SECTOR_2]);
  assert.equal(profileCrc(factory), storedCrc(factory));
  assert.equal(factoryProfileForFormat(7, 256), null);
  assert.equal(factoryProfileForFormat(8, 255), null);
});

test("factory reset reproduces erased name, bunny-hop and G-Shift regions", () => {
  // Captured from G HUB/Onboard Memory Manager resetting every profile. The
  // configured sector becomes byte-identical to an untouched factory sector.
  const reproduced = reproduceProfile(SECTOR_3, SECTOR_2, 7);
  assert.deepEqual([...reproduced], [...SECTOR_2]);
});

test("bunny-hop timeout decodes as milliseconds", () => {
  // Captured from G HUB: 100 ms stored as 0x0a, 200 ms as 0x14.
  const at100 = decodeOnboardProfile(sectorState({ rate: 0x06, bunnyHopping: 0x0a }), 7, ENTRY, true);
  const at200 = decodeOnboardProfile(sectorState({ rate: 0x06, bunnyHopping: 0x14 }), 7, ENTRY, true);
  assert.equal(at100.bunnyHoppingMs, 100);
  assert.equal(at200.bunnyHoppingMs, 200);

  // G HUB's range is 100-1000 ms, so the byte tops out at 0x64.
  const atMax = decodeOnboardProfile(sectorState({ rate: 0x06, bunnyHopping: 0x64 }), 7, ENTRY, true);
  assert.equal(atMax.bunnyHoppingMs, 1000);

  // Turning the feature off in G HUB stores 0x00, distinct from unwritten.
  const off = decodeOnboardProfile(sectorState({ rate: 0x06, bunnyHopping: 0x00 }), 7, ENTRY, true);
  assert.equal(off.bunnyHoppingMs, 0);

  // Unwritten flash must not decode as a 2550 ms timeout.
  const unwritten = decodeOnboardProfile(sectorState({ rate: 0x06, bunnyHopping: 0xff }), 7, ENTRY, true);
  assert.equal(unwritten.bunnyHoppingMs, null);
});

test("turning bunny hopping off round-trips back to the earlier checksum", () => {
  const on = sectorState({ rate: 0x06, bunnyHopping: 0x14 });
  const off = sectorState({ rate: 0x06, bunnyHopping: 0x00 });
  assert.equal(storedCrc(on), 0x10fd);
  assert.equal(storedCrc(off), 0x6e7c, "off must return the sector to its earlier state");
  assert.deepEqual([...reproduceProfile(on, off, 7)], [...off]);
});

test("bunny-hop times off the 10 ms step are rejected", () => {
  assert.equal(validateBunnyHoppingMs(100), null);
  assert.equal(validateBunnyHoppingMs(1000), null);
  assert.equal(validateBunnyHoppingMs(0), null, "0 is off");

  assert.match(validateBunnyHoppingMs(105) ?? "", /multiple of 10/);
  assert.match(validateBunnyHoppingMs(100.5) ?? "", /whole number/);
  assert.match(validateBunnyHoppingMs(Number.NaN) ?? "", /whole number/);
  // In range but the byte cannot hold it, and out of range entirely.
  assert.match(validateBunnyHoppingMs(50) ?? "", /between 100 and 1000/);
  assert.match(validateBunnyHoppingMs(1010) ?? "", /between 100 and 1000/);
});

test("rewriting the DPI stages byte-for-byte leaves the sector unchanged", () => {
  // The captured sector is the ground truth: decoding it and encoding the same
  // values back must reproduce it exactly, checksum included.
  const decoded = decodeOnboardProfile(SECTOR_3, 7, ENTRY, true);
  assert.equal(decoded.defaultDpiIndex !== null, true);
  const rewritten = encodeDpiStages(SECTOR_3, 7, {
    stages: decoded.dpiStages,
    defaultIndex: decoded.defaultDpiIndex ?? 0,
  });
  assert.deepEqual([...rewritten], [...SECTOR_3]);
});

/** The captured sector uses a single slot, so extra slots are built here. */
const FIVE_STAGES = [
  { x: 800, y: 800, lod: 1 },
  { x: 1200, y: 1200, lod: 2 },
  { x: 1600, y: 1600, lod: 2 },
  { x: 2400, y: 2400, lod: 2 },
  { x: 3200, y: 3200, lod: 3 },
];

test("every DPI slot round-trips through encode and decode", () => {
  const filled = encodeDpiStages(SECTOR_3, 7, { stages: FIVE_STAGES, defaultIndex: 2 });
  const decoded = decodeOnboardProfile(filled, 7, ENTRY, true);
  assert.deepEqual(decoded.dpiStages, FIVE_STAGES);
  assert.equal(decoded.defaultDpiIndex, 2);
  assert.equal(storedCrc(filled), profileCrc(filled), "checksum reapplied");
});

test("dropping DPI slots zeroes the stages that fall out of use", () => {
  const filled = encodeDpiStages(SECTOR_3, 7, { stages: FIVE_STAGES, defaultIndex: 0 });
  const twoSlots = encodeDpiStages(filled, 7, { stages: FIVE_STAGES.slice(0, 2), defaultIndex: 0 });

  // A stage is marked unused by zeroing x, y and lod together.
  for (let stage = 2; stage < 5; stage += 1) {
    const base = 0x02 + 2 + stage * 5;
    assert.deepEqual([...twoSlots.slice(base, base + 5)], [0, 0, 0, 0, 0], `stage ${stage + 1}`);
  }

  // Reading it back reports exactly the slots that remain.
  const reread = decodeOnboardProfile(twoSlots, 7, ENTRY, true);
  assert.deepEqual(reread.dpiStages, FIVE_STAGES.slice(0, 2));
  assert.equal(storedCrc(twoSlots), profileCrc(twoSlots), "checksum reapplied");
});

test("shrinking the slot count pulls the g-shift index back into range", () => {
  const filled = encodeDpiStages(SECTOR_3, 7, { stages: FIVE_STAGES, defaultIndex: 0 });
  const withGShift = filled.slice();
  withGShift[0x03] = 4; // points at the last slot

  // Left pointing at slot 5 it would select a stage this write just zeroed.
  const oneSlot = encodeDpiStages(withGShift, 7, { stages: FIVE_STAGES.slice(0, 1), defaultIndex: 0 });
  assert.equal(oneSlot[0x03], 0);

  // A g-shift index still inside the slots in use is left alone.
  const kept = encodeDpiStages(withGShift, 7, { stages: FIVE_STAGES, defaultIndex: 0 });
  assert.equal(kept[0x03], 4);
});

test("bunny hop and DPI slots survive being written into one sector", () => {
  // They share the profile sector, so a flash writes them together. Applying
  // one must not discard the other, and the checksum must cover both.
  const withBunnyHop = SECTOR_3.slice();
  withBunnyHop[0x25] = 20; // 200 ms
  const combined = encodeDpiStages(withBunnyHop, 7, { stages: FIVE_STAGES, defaultIndex: 1 });

  const decoded = decodeOnboardProfile(combined, 7, ENTRY, true);
  assert.equal(decoded.bunnyHoppingMs, 200, "the bunny-hop byte was not clobbered");
  assert.deepEqual(decoded.dpiStages, FIVE_STAGES);
  assert.equal(decoded.defaultDpiIndex, 1);
  assert.equal(storedCrc(combined), profileCrc(combined));
});

test("bunny-hop support is a format trait, not a stored value", () => {
  // A profile that never had bunny hop written reads 0xff there, which decodes
  // to null. That must not be read as "the format has no bunny hop" — doing so
  // hid the control on every profile the setting had not been used on.
  const unwritten = SECTOR_3.slice();
  unwritten[0x25] = 0xff;
  applyCrc(unwritten);
  assert.equal(decodeOnboardProfile(unwritten, 7, ENTRY, true).bunnyHoppingMs, null);
  assert.equal(capabilitiesForFormat(7).bunnyHop, true, "format 7 still supports it");

  assert.equal(capabilitiesForFormat(8).bunnyHop, true);
  // Below 7 the byte does not exist at all.
  assert.equal(capabilitiesForFormat(6).bunnyHop, false);
  assert.equal(capabilitiesForFormat(null).bunnyHop, false);
});

test("report-rate ceilings differ per link and per format", () => {
  const rates = capabilitiesForFormat(7).reportRates;
  assert.deepEqual(rates, { wirelessMaxHz: 8000, wiredMaxHz: 1000 });

  // The cable is the slower link, so it offers fewer options than the radio.
  assert.deepEqual(reportRatesFor(rates, "wireless"), [125, 250, 500, 1000, 2000, 4000, 8000]);
  assert.deepEqual(reportRatesFor(rates, "wired"), [125, 250, 500, 1000]);

  assert.equal(validateReportRate(8000, rates, "wireless"), null);
  assert.match(validateReportRate(8000, rates, "wired") ?? "", /Wired report rate/);
  assert.equal(validateReportRate(1000, rates, "wired"), null);

  // Formats whose ceilings were never captured offer nothing.
  assert.equal(capabilitiesForFormat(8).reportRates, null);
  assert.deepEqual(reportRatesFor(null, "wireless"), []);
  assert.match(validateReportRate(1000, null, "wireless") ?? "", /not known/);
});

test("the two report-rate bytes match what the vendor tool writes", () => {
  // Captured from the vendor tool on a Pro X Superlight 2 (format 7), sector 1,
  // setting wireless to 8000 Hz and wired to 250 Hz:
  //   0x00  03 -> 06   report_rate_wireless
  //   0x01  03 -> 01   report_rate_wired
  const before = SECTOR_3.slice();
  before[0x00] = 0x03;
  before[0x01] = 0x03;
  applyCrc(before);

  const after = encodeReportRate(encodeReportRate(before, 7, "wireless", 8000), 7, "wired", 250);
  assert.equal(after[0x00], 0x06, "wireless index");
  assert.equal(after[0x01], 0x01, "wired index");
  // Every other byte of the profile is left exactly as it was.
  for (let index = 2; index < after.length - 2; index += 1) {
    assert.equal(after[index], before[index], `byte 0x${index.toString(16)}`);
  }
});

test("each link's report rate is written without disturbing the other", () => {
  const wireless = encodeReportRate(SECTOR_3, 7, "wireless", 4000);
  const wired = encodeReportRate(wireless, 7, "wired", 500);

  const decoded = decodeOnboardProfile(wired, 7, ENTRY, true);
  assert.equal(decoded.reportRateWireless, 4000);
  assert.equal(decoded.reportRateWired, 500);
  assert.equal(storedCrc(wired), profileCrc(wired));

  assert.throws(() => encodeReportRate(SECTOR_3, 7, "wired", 8000), /Wired report rate/);
});

test("base v1 report rates are encoded as milliseconds, not a table index", () => {
  // LOGAN stores the USB polling interval in milliseconds, exactly like legacy
  // 0x8060: 1 ms is 1000 Hz, 2 ms is 500 Hz. The index encoding (0 = 125 Hz,
  // 3 = 1000 Hz) would write 3 for 1000 Hz and read back as 333 Hz.
  const sector = new Uint8Array(255).fill(0xff);
  sector[0x00] = 0x02; // 500 Hz
  applyCrc(sector);

  const encoded = encodeReportRate(sector, 2, "wired", 1000);
  assert.equal(encoded[0x00], 0x01, "1 ms must encode 1000 Hz on base v1");
  assert.equal(decodeOnboardProfile(encoded, 2, { sector: 1, enabled: true }, false).reportRateWired, 1000);
  assert.equal(storedCrc(encoded), profileCrc(encoded));

  // And back to 500 Hz touches only the rate byte, plus the checksum.
  const back = encodeReportRate(encoded, 2, "wired", 500);
  assert.equal(back[0x00], 0x02);
  for (let index = 1; index < back.length - 2; index += 1) {
    assert.equal(back[index], encoded[index], `byte 0x${index.toString(16)}`);
  }
});

test("format 2 (LOGAN) advertises a writable wired ceiling and no wireless link", () => {
  const rates = capabilitiesForFormat(2).reportRates;
  assert.deepEqual(rates, { wirelessMaxHz: 0, wiredMaxHz: 1000 });
  assert.deepEqual(reportRatesFor(rates, "wired"), [125, 250, 500, 1000]);
  assert.deepEqual(reportRatesFor(rates, "wireless"), []);
  assert.equal(validateReportRate(1000, rates, "wired"), null);
  assert.match(validateReportRate(2000, rates, "wired") ?? "", /Wired report rate/);

  // The report-rate write is the one thing this format is trusted for; the rest
  // stays locked so a v1 mouse cannot be pushed into unknown fields.
  assert.equal(describeProfileFormat(2).verified, true);
  assert.equal(capabilitiesForFormat(2).dpiStages, null);
  assert.equal(capabilitiesForFormat(2).maxNameLength, null);
  assert.equal(capabilitiesForFormat(2).bunnyHop, false);
});

test("profile names round-trip and are held to the region's size", () => {
  const named = encodeProfileName(SECTOR_3, 7, "FPS");
  assert.equal(decodeOnboardProfile(named, 7, ENTRY, true).name, "FPS");
  assert.equal(storedCrc(named), profileCrc(named));

  // A shorter name must not leave the tail of the previous one behind.
  const shorter = encodeProfileName(encodeProfileName(SECTOR_3, 7, "LONG NAME HERE"), 7, "AB");
  assert.equal(decodeOnboardProfile(shorter, 7, ENTRY, true).name, "AB");

  assert.equal(PROFILE_NAME_MAX_CHARS, 23);
  assert.equal(validateProfileName("x".repeat(23), 23), null);
  assert.match(validateProfileName("x".repeat(24), 23) ?? "", /at most 23/);
  assert.match(validateProfileName("   ", 23) ?? "", /Enter a profile name/);
  // Astral characters take two UTF-16 units and would be split by the limit.
  assert.match(validateProfileName("game 🎮", 23) ?? "", /emoji/);
  assert.match(validateProfileName("x", null) ?? "", /no name field/);

  const full = encodeProfileName(SECTOR_3, 7, "x".repeat(23));
  assert.equal(decodeOnboardProfile(full, 7, ENTRY, true).name, "x".repeat(23));
});

test("DPI slot limits are per format, not global", () => {
  const format7 = capabilitiesForFormat(7).dpiStages;
  assert.deepEqual(format7, { maxStages: 5, minDpi: 100, maxDpi: 32000, stepDpi: 50 });

  // Base v1 has no stage table, and no other format's range was ever captured,
  // so slots must not be offered rather than borrowing format 7's numbers.
  assert.equal(capabilitiesForFormat(8).dpiStages, null);
  assert.equal(capabilitiesForFormat(1).dpiStages, null);
  assert.equal(capabilitiesForFormat(6).dpiStages, null);
  assert.equal(capabilitiesForFormat(null).dpiStages, null);

  const stage = { x: 800, y: 800, lod: 1 };
  assert.match(validateDpiStagePlan({ stages: [stage], defaultIndex: 0 }, null) ?? "", /not known/);
  assert.throws(() => encodeDpiStages(SECTOR_3, 8, { stages: [stage], defaultIndex: 0 }), /not known/);

  // A hypothetical older format with tighter limits is held to its own.
  const narrow = { maxStages: 2, minDpi: 200, maxDpi: 4000, stepDpi: 100 };
  assert.match(validateDpiStagePlan({ stages: Array(3).fill(stage), defaultIndex: 0 }, narrow) ?? "", /1 to 2/);
  assert.match(validateDpiStagePlan({ stages: [{ ...stage, x: 8000 }], defaultIndex: 0 }, narrow) ?? "", /between 200 and 4000/);
  assert.match(validateDpiStagePlan({ stages: [{ ...stage, x: 850 }], defaultIndex: 0 }, narrow) ?? "", /multiple of 100/);
  assert.equal(validateDpiStagePlan({ stages: [{ x: 800, y: 800, lod: 1 }], defaultIndex: 0 }, narrow), null);

  assert.equal(clampDpi(60, narrow), 200);
  assert.equal(clampDpi(9000, narrow), 4000);
  assert.equal(clampDpi(849, narrow), 800);
  assert.equal(clampDpi(Number.NaN, narrow), 200);
});

test("unwritable DPI stage plans are rejected before they reach flash", () => {
  const limits = capabilitiesForFormat(7).dpiStages;
  const stage = { x: 800, y: 800, lod: 1 };
  assert.equal(validateDpiStagePlan({ stages: [stage], defaultIndex: 0 }, limits), null);

  assert.match(validateDpiStagePlan({ stages: [], defaultIndex: 0 }, limits) ?? "", /1 to 5/);
  assert.match(validateDpiStagePlan({ stages: Array(6).fill(stage), defaultIndex: 0 }, limits) ?? "", /1 to 5/);
  assert.match(validateDpiStagePlan({ stages: [stage], defaultIndex: 1 }, limits) ?? "", /default slot/);

  assert.match(validateDpiStagePlan({ stages: [{ ...stage, x: 60 }], defaultIndex: 0 }, limits) ?? "", /between 100 and 32000/);
  assert.match(validateDpiStagePlan({ stages: [{ ...stage, y: 825 }], defaultIndex: 0 }, limits) ?? "", /multiple of 50/);
  // 0 means "unused", so it cannot be the level of a slot in use.
  assert.match(validateDpiStagePlan({ stages: [{ ...stage, lod: 0 }], defaultIndex: 0 }, limits) ?? "", /lift-off/);
  assert.match(validateDpiStagePlan({ stages: [{ ...stage, lod: 4 }], defaultIndex: 0 }, limits) ?? "", /lift-off/);

  assert.throws(() => encodeDpiStages(SECTOR_3, 7, { stages: [], defaultIndex: 0 }), /1 to 5/);
});

test("lift-off limits come from the profile format, not the model", () => {
  // Format 7 (Pro X Superlight 2) offers all three levels.
  assert.deepEqual(capabilitiesForFormat(7).supportedLods, ["Low", "Medium", "High"]);

  // Format 8 carries the analog-button block, so it is the Superstrike format.
  assert.deepEqual(capabilitiesForFormat(8).supportedLods, ["Low", "High"]);

  // Anything else keeps what the driver assumed before limits were per format.
  assert.deepEqual(capabilitiesForFormat(1).supportedLods, ["Medium", "High"]);

  // getInfo is allowed to fail, so an absent format must not throw.
  assert.deepEqual(capabilitiesForFormat(null).supportedLods, ["Medium", "High"]);
  assert.deepEqual(capabilitiesForFormat(undefined).supportedLods, ["Medium", "High"]);
  assert.deepEqual(capabilitiesForFormat(99).supportedLods, ["Medium", "High"]);
});

test("format 7 counts lift-off levels from one", () => {
  // Captured from G HUB writing the profile on a Pro X Superlight 2: medium to
  // low wrote 0x02 -> 0x01, and low to high wrote 0x01 -> 0x03.
  const format7 = capabilitiesForFormat(7);
  assert.deepEqual(format7.lodEncoding, { Low: 1, Medium: 2, High: 3 });

  for (const [level, raw] of [["Low", 1], ["Medium", 2], ["High", 3]] as const) {
    assert.equal(decodeLiftOffLevel(raw, format7), level);
  }

  // 0 marks an unused DPI stage on this format, so it is not a level.
  assert.equal(decodeLiftOffLevel(0, format7), null);
  assert.equal(decodeLiftOffLevel(null, format7), null);
  assert.equal(decodeLiftOffLevel(undefined, format7), null);
});

test("every format counts lift-off levels from one", () => {
  // 0x2202's enum belongs to the feature, not to a profile format, so the
  // fallback and format 8 use the same numbering format 7 was confirmed on.
  // Counting from zero made "Low" write 0 — the feature's "not supported"
  // value — and reported every level one step too high.
  for (const format of [null, 8, 1, 99]) {
    const capabilities = capabilitiesForFormat(format);
    assert.deepEqual(capabilities.lodEncoding, { Low: 1, Medium: 2, High: 3 }, `format ${format}`);
    assert.equal(decodeLiftOffLevel(1, capabilities), "Low");
    assert.equal(decodeLiftOffLevel(2, capabilities), "Medium");
    assert.equal(decodeLiftOffLevel(3, capabilities), "High");
    // 0 means the sensor has no lift-off control, so it is not a level.
    assert.equal(decodeLiftOffLevel(0, capabilities), null);
  }
});

test("typed bunny-hop times are snapped into range and onto the step", () => {
  assert.equal(clampBunnyHopMs(200), 200, "an already valid value is untouched");
  assert.equal(clampBunnyHopMs(105), 110, "off-step values round to the nearest step");
  assert.equal(clampBunnyHopMs(104), 100);

  // Out of range in either direction snaps to the nearest limit rather than
  // being rejected, so the field can never hold a value the byte cannot store.
  assert.equal(clampBunnyHopMs(50), 100);
  assert.equal(clampBunnyHopMs(0), 100);
  assert.equal(clampBunnyHopMs(-40), 100);
  assert.equal(clampBunnyHopMs(5000), 1000);

  // An empty field reads back as NaN.
  assert.equal(clampBunnyHopMs(Number.NaN), 100);

  // Whatever comes out must satisfy the validator.
  for (const input of [50, 104, 105, 333, 999, 5000, Number.NaN]) {
    assert.equal(validateBunnyHoppingMs(clampBunnyHopMs(input)), null, `clamped ${input}`);
  }
});

test("bunny hopping is not modelled on formats below 7", () => {
  const before = SECTOR_3.slice();
  const after = SECTOR_3.slice();
  after[0x25] = 0x0a;
  applyCrc(after);

  const reproduced = reproduceProfile(before, after, 6);
  assert.notDeepEqual([...reproduced], [...after], "format 6 has no bunny_hopping component");
});

test("reproducing reports the bytes we cannot yet write", () => {
  const before = SECTOR_3.slice();
  const after = SECTOR_3.slice();
  // Lighting is not modelled by any encoder, so it must show up as a difference.
  after[0xd2] ^= 0xff;
  applyCrc(after);

  const reproduced = reproduceProfile(before, after, 7);
  const changed = [...reproduced].flatMap((byte, index) => (byte === after[index] ? [] : [index]));
  assert.ok(changed.includes(0xd2), "an unmodelled field must not silently pass");
});

test("a corrupted byte invalidates the CRC", () => {
  const tampered = SECTOR_3.slice();
  tampered[0x04] ^= 0xff;
  assert.equal(decodeOnboardProfile(tampered, 7, { sector: 3, enabled: true }, true).crcValid, false);
});
