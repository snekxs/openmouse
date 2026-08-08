import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeModdoBattery,
  decodeModdoConfig,
  decodeModdoFirmware,
  decodeModdoLift,
  encodeModdoConfig,
  encodeModdoLift,
  isValidModdoDpi,
  moddoDpiOptions,
  MODDO_CONFIG_REPORT_SIZE,
  type ModdoConfig,
} from "./protocol.ts";

test("config round-trips through the packed 11-byte report", () => {
  // Arrange
  const config: ModdoConfig = {
    polling: 1000,
    lift: 1,
    dpiX: 1600,
    dpiY: 800,
    invertSwap: 0,
    angle: -5,
    deepSleep: 30,
  };

  // Act
  const encoded = encodeModdoConfig(config);

  // Assert
  assert.equal(encoded.length, MODDO_CONFIG_REPORT_SIZE);
  assert.deepEqual([...encoded], [0xe8, 0x03, 0x01, 0x40, 0x06, 0x20, 0x03, 0x00, 0xfb, 0xff, 0x1e]);
  assert.deepEqual(decodeModdoConfig(encoded), config);
});

test("decode preserves the invert/swap, angle, and deep-sleep bytes for read-modify-write", () => {
  // Arrange — a config whose reserved fields are all non-zero.
  const config: ModdoConfig = {
    polling: 500,
    lift: 2,
    dpiX: 26000,
    dpiY: 26000,
    invertSwap: 0x03,
    angle: 180,
    deepSleep: 60,
  };

  // Act / Assert
  assert.deepEqual(decodeModdoConfig(encodeModdoConfig(config)), config);
});

test("decodeModdoConfig rejects truncated or not-ready reports", () => {
  // Arrange
  const zeroed = new Uint8Array(MODDO_CONFIG_REPORT_SIZE);
  const truncated = new Uint8Array([0xe8, 0x03, 0x01, 0x40, 0x06]);
  const badDpi = encodeModdoConfig({
    polling: 1000, lift: 1, dpiX: 0, dpiY: 0, invertSwap: 0, angle: 0, deepSleep: 0,
  });

  // Act / Assert — a sleeping mouse answers all-zero; the driver must not show 0 DPI / 0 Hz.
  assert.equal(decodeModdoConfig(zeroed), null);
  assert.equal(decodeModdoConfig(truncated), null);
  assert.equal(decodeModdoConfig(badDpi), null);
});

test("battery decodes charge state and hides the column when no cell is present", () => {
  // Arrange — [remaining, _, status, chargerFlags]
  const charging = new Uint8Array([90, 0, 0x44, 0x01]);
  const discharging = new Uint8Array([75, 0, 0x45, 0x01]);
  const full = new Uint8Array([100, 0, 0x46, 0x01]);
  const noCell = new Uint8Array([90, 0, 0x44, 0x00]);
  const overRange = new Uint8Array([200, 0, 0x44, 0x01]);

  // Act / Assert
  assert.deepEqual(decodeModdoBattery(charging), { percent: 90, state: "Charging" });
  assert.deepEqual(decodeModdoBattery(discharging), { percent: 75, state: "Discharging" });
  assert.deepEqual(decodeModdoBattery(full), { percent: 100, state: "Full" });
  assert.deepEqual(decodeModdoBattery(noCell), { percent: null, state: "Unknown" });
  assert.deepEqual(decodeModdoBattery(overRange), { percent: null, state: "Charging" });
  assert.deepEqual(decodeModdoBattery(new Uint8Array([90, 0, 0x44])), { percent: null, state: "Unknown" });
});

test("firmware distinguishes the wireless dongle path from a wired mouse", () => {
  // Arrange — [dongle major.minor.patch.build, mouse major.minor.patch.build]
  const wireless = new Uint8Array([1, 2, 3, 4, 2, 0, 1, 0]);
  const wired = new Uint8Array([0, 0, 0, 0, 1, 4, 2, 0]);

  // Act / Assert
  assert.deepEqual(decodeModdoFirmware(wireless), { mouse: "2.0.1", dongle: "1.2.3", dongleConnected: true });
  assert.deepEqual(decodeModdoFirmware(wired), { mouse: "1.4.2", dongle: null, dongleConnected: false });
  assert.deepEqual(decodeModdoFirmware(new Uint8Array(7)), { mouse: null, dongle: null, dongleConnected: false });
});

test("lift-off codec round-trips the two supported heights", () => {
  // Act / Assert
  assert.equal(decodeModdoLift(1), "Medium");
  assert.equal(decodeModdoLift(2), "High");
  assert.equal(decodeModdoLift(0), null);
  assert.equal(decodeModdoLift(3), null);
  for (const value of ["Medium", "High"] as const) {
    assert.equal(decodeModdoLift(encodeModdoLift(value)), value);
  }
});

test("DPI validation follows the 50-step range and options span it", () => {
  // Act / Assert
  for (const dpi of [50, 1600, 26000]) assert.equal(isValidModdoDpi(dpi), true);
  for (const dpi of [49, 75, 0, 26050, 1600.5]) assert.equal(isValidModdoDpi(dpi), false);

  const options = moddoDpiOptions();
  assert.equal(options[0], 50);
  assert.equal(options[1], 100);
  assert.equal(options.at(-1), 26000);
  assert.equal(options.length, 520);
});
