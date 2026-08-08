import assert from "node:assert/strict";
import test from "node:test";

import {
  TEEVOLUTION_FLASH,
  TEEVOLUTION_REPORT_ID,
  teevolutionProfileForCid,
  teevolutionBuildOnlinePayload,
  teevolutionBuildReadPayload,
  teevolutionBuildSimplePayload,
  teevolutionBuildWriteScalarPayload,
  teevolutionDecodeDpiLightBrightness,
  teevolutionDecodeDpiLightMode,
  teevolutionDecodeDpi,
  teevolutionDecodeFirmwareVersion,
  teevolutionDecodeLiftOff,
  teevolutionDecodePollingRate,
  teevolutionDpiOptions,
  teevolutionEncodeDpiLightBrightness,
  teevolutionEncodeDpi,
  teevolutionEncodeLiftOff,
  teevolutionEncodePollingRate,
  teevolutionEncodeSensorMode,
  teevolutionPacketChecksumIsValid,
  teevolutionParseBattery,
  teevolutionParseReadResponse,
  teevolutionSensorModeUi,
} from "./protocol.ts";

test("host-control and battery commands match Compx report-8 checksums", () => {
  // Arrange — same framing Teevolink uses on report ID 0x08
  const requests = [
    teevolutionBuildOnlinePayload(true),
    teevolutionBuildSimplePayload(0x04),
    teevolutionBuildReadPayload(0x00a0, 10),
  ];

  // Act / Assert
  assert.deepEqual([...requests[0]!], [0x03, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x49]);
  assert.deepEqual([...requests[1]!], [0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x49]);
  assert.deepEqual([...requests[2]!], [0x08, 0, 0, 0xa0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x9b]);
  assert.equal(TEEVOLUTION_REPORT_ID, 0x08);
});

test("receiver responses pass checksum validation", () => {
  // Arrange — battery response shape from Compx HUB (percent + charging flag)
  const response = new Uint8Array([0x04, 0, 0, 0, 2, 0x64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  response[15] = (0x55 - TEEVOLUTION_REPORT_ID - response.slice(0, 15).reduce((sum, byte) => sum + byte, 0)) & 0xff;

  // Act / Assert
  assert.equal(teevolutionPacketChecksumIsValid(response), true);
  response[5] ^= 1;
  assert.equal(teevolutionPacketChecksumIsValid(response), false);
});

test("battery responses decode percent and charging", () => {
  // Arrange
  const response = new Uint8Array([0x04, 0, 0, 0, 2, 0x5f, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  response[15] = (0x55 - TEEVOLUTION_REPORT_ID - response.slice(0, 15).reduce((sum, byte) => sum + byte, 0)) & 0xff;

  // Act
  const battery = teevolutionParseBattery(response);

  // Assert
  assert.deepEqual(battery, { percent: 95, charging: true });
});

test("flash reads reject corrupt or mismatched responses", () => {
  // Arrange
  const response = new Uint8Array([0x08, 0, 0, 0x0a, 4, 1, 0x54, 0x1f, 0x1f, 0, 0, 0, 0, 0, 0, 0]);
  response[15] = (0x55 - TEEVOLUTION_REPORT_ID - response.slice(0, 15).reduce((sum, byte) => sum + byte, 0)) & 0xff;

  // Act / Assert
  assert.deepEqual([...teevolutionParseReadResponse(response, 0x000a, 4)!], [1, 0x54, 0x1f, 0x1f]);
  assert.equal(teevolutionParseReadResponse(response, 0x000b, 4), null);
  response[15] ^= 1;
  assert.equal(teevolutionParseReadResponse(response, 0x000a, 4), null);
});

test("DPI and polling rate codecs round-trip Terra Pro UI values", () => {
  // Arrange — includes the Teevolink high-DPI range above 30,100
  const dpis = [50, 1600, 30000, 30100, 42000];
  const rates = [125, 250, 500, 1000, 2000, 4000, 8000];

  // Act / Assert
  for (const dpi of dpis) assert.equal(teevolutionDecodeDpi(teevolutionEncodeDpi(dpi)), dpi);
  for (const rate of rates) {
    assert.equal(teevolutionDecodePollingRate(teevolutionEncodePollingRate(rate)), rate);
  }
});

test("high-DPI packing uses dpiEx 0x11 like Teevolink", () => {
  // Arrange / Act
  const stage = teevolutionEncodeDpi(30100);

  // Assert — low nibble of flags carries the extend bits used on decode
  assert.equal(stage[2]! & 0x03, 0x01);
  assert.equal(stage[3], (0x55 - stage[0]! - stage[1]! - stage[2]!) & 0xff);
  assert.equal(teevolutionDecodeDpi(stage), 30100);
});

test("scalar writes include the value parity byte", () => {
  // Arrange / Act
  const payload = teevolutionBuildWriteScalarPayload(TEEVOLUTION_FLASH.motionSync, 1);

  // Assert
  assert.deepEqual([...payload.slice(0, 7)], [0x07, 0, 0, 0xab, 2, 1, 0x54]);
  assert.equal(teevolutionPacketChecksumIsValid(payload), true);
});

test("lift-off codes match Teevolink Low/Medium/High mapping", () => {
  assert.equal(teevolutionEncodeLiftOff("Low"), 3);
  assert.equal(teevolutionEncodeLiftOff("Medium"), 1);
  assert.equal(teevolutionEncodeLiftOff("High"), 2);
  assert.equal(teevolutionDecodeLiftOff(3), "Low");
  assert.equal(teevolutionDecodeLiftOff(1), "Medium");
  assert.equal(teevolutionDecodeLiftOff(2), "High");
  assert.equal(teevolutionDecodeLiftOff(0), null);
});

test("firmware version strings match Teevolink formatting", () => {
  const response = new Uint8Array([0x12, 0, 0, 0, 2, 1, 0x2a, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(teevolutionDecodeFirmwareVersion("Mouse", response), "Mouse v1.2a");
});

test("DPI option list covers 50–30k then 100-step high range", () => {
  const profile = teevolutionProfileForCid(14);
  if (!profile) throw new Error("Terra Pro capability profile is missing.");
  const options = teevolutionDpiOptions(profile);
  assert.equal(options[0], 50);
  assert.ok(options.includes(30000));
  assert.ok(options.includes(30100));
  assert.equal(options.at(-1), 42000);
  assert.equal(options.filter((dpi) => dpi > 30000 && dpi % 100 !== 0).length, 0);
});

test("Terra Pro capabilities are selected by reported CID", () => {
  const profile = teevolutionProfileForCid(14);
  if (!profile) throw new Error("Terra Pro capability profile is missing.");
  assert.equal(profile.name, "Terra Pro");
  assert.equal(profile.protocol, "compX-terra-v1");
  assert.equal(profile.dpiStageCount, 4);
  assert.deepEqual(profile.pollingRates, [125, 250, 500, 1000, 2000, 4000, 8000]);
  assert.deepEqual(profile.liftOffDistances, ["Low", "Medium", "High"]);
  assert.deepEqual(profile.sensorModes, ["Eco", "High"]);
  assert.equal(teevolutionProfileForCid(0xff), null);
});

test("DPI light brightness matches Teevolink's nonlinear 1–10 table", () => {
  const stored = [0x10, 0x1e, 0x3c, 0x5a, 0x80, 0x96, 0xb4, 0xd2, 0xe6, 0xff];
  for (let level = 1; level <= 10; level += 1) {
    assert.equal(teevolutionEncodeDpiLightBrightness(level), stored[level - 1]);
    assert.equal(teevolutionDecodeDpiLightBrightness(stored[level - 1]!), level);
  }
  assert.equal(teevolutionDecodeDpiLightBrightness(0), 5);
  assert.throws(() => teevolutionEncodeDpiLightBrightness(0), /1 to 10/);
});

test("DPI light state exposes Off, Steady, and Breathing", () => {
  assert.equal(teevolutionDecodeDpiLightMode(1, 0), 0);
  assert.equal(teevolutionDecodeDpiLightMode(1, 1), 1);
  assert.equal(teevolutionDecodeDpiLightMode(2, 1), 2);
  assert.equal(teevolutionDecodeDpiLightMode(99, 1), 1);
});

test("sensor mode UI matches Teevolink Eco/High/Ultra rules", () => {
  assert.deepEqual(teevolutionSensorModeUi({
    storedMode: 0,
    pollingRateHz: 1000,
    connection: "Wireless",
  }), { mode: "Eco", editable: true, storedValue: 0 });
  assert.deepEqual(teevolutionSensorModeUi({
    storedMode: 1,
    pollingRateHz: 500,
    connection: "Wireless",
  }), { mode: "High", editable: true, storedValue: 1 });
  assert.deepEqual(teevolutionSensorModeUi({
    storedMode: 0,
    pollingRateHz: 4000,
    connection: "Wireless",
  }), { mode: "Ultra", editable: false, storedValue: 0 });
  assert.deepEqual(teevolutionSensorModeUi({
    storedMode: 1,
    pollingRateHz: 1000,
    connection: "Wired",
  }), { mode: "Ultra", editable: false, storedValue: 1 });
});

test("sensor mode encoding accepts Eco and High only", () => {
  assert.equal(teevolutionEncodeSensorMode("Eco"), 0);
  assert.equal(teevolutionEncodeSensorMode("High"), 1);
  assert.throws(() => teevolutionEncodeSensorMode("Ultra"), /cannot be written/);
});
