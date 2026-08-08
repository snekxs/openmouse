import assert from "node:assert/strict";
import test from "node:test";

import {
  boltSupportScore,
  classifyHidpp20Probe,
  collapseBoltPeers,
  hasHidppLongCollection,
  hasHidppShortCollection,
  hidppIndexCandidates,
  resolveBoltReportDevice,
} from "./bolt.ts";
import {
  BOLT_PAIRING_SLOTS,
  DEVICE_INDEX_DIRECT,
  DEVICE_INDEX_RECEIVER,
  isBoltReceiverProduct,
  isDirectConnectProduct,
} from "./protocol.ts";

const LIGHTSPEED_RECEIVER = 0xc54d;
const BOLT_RECEIVER = 0xc548;
const KNOWN_RECEIVERS = new Set([LIGHTSPEED_RECEIVER, BOLT_RECEIVER, 0xc539, 0xc547, 0xc0a8]);

function fakeHidDevice(productId: number, collections: HIDCollectionInfo[]): HIDDevice {
  return {
    vendorId: 0x046d,
    productId,
    productName: "test",
    collections,
  } as unknown as HIDDevice;
}

function hidppCollection(usage: number): HIDCollectionInfo {
  return {
    usagePage: 0xff00,
    usage,
    type: 1,
    children: [],
    featureReports: [],
    inputReports: [],
    outputReports: [],
  } as unknown as HIDCollectionInfo;
}

test("Logi Bolt receivers are distinct from Lightspeed and direct-connect mice", () => {
  assert.equal(isBoltReceiverProduct(BOLT_RECEIVER), true);
  assert.equal(isBoltReceiverProduct(LIGHTSPEED_RECEIVER), false);
  assert.equal(isDirectConnectProduct(BOLT_RECEIVER), false);
  assert.deepEqual([...BOLT_PAIRING_SLOTS], [0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
});

test("Bolt index candidates cover all pairing slots; Lightspeed stays 0x01 then 0xFF", () => {
  assert.deepEqual(hidppIndexCandidates(BOLT_RECEIVER, KNOWN_RECEIVERS), [...BOLT_PAIRING_SLOTS]);
  assert.deepEqual(
    hidppIndexCandidates(LIGHTSPEED_RECEIVER, KNOWN_RECEIVERS),
    [DEVICE_INDEX_RECEIVER, DEVICE_INDEX_DIRECT],
  );
  assert.deepEqual(
    hidppIndexCandidates(0xc084, KNOWN_RECEIVERS),
    [DEVICE_INDEX_DIRECT, DEVICE_INDEX_RECEIVER],
  );
});

test("Bolt HID++ support accepts short and long collections and prefers long", () => {
  const shortOnly = fakeHidDevice(BOLT_RECEIVER, [hidppCollection(0x0001)]);
  const longOnly = fakeHidDevice(BOLT_RECEIVER, [hidppCollection(0x0002)]);
  const lightspeed = fakeHidDevice(LIGHTSPEED_RECEIVER, [hidppCollection(0x0001)]);

  assert.equal(hasHidppShortCollection(shortOnly), true);
  assert.equal(hasHidppLongCollection(shortOnly), false);
  assert.equal(hasHidppLongCollection(longOnly), true);
  assert.equal(boltSupportScore(longOnly, true), 8);
  assert.equal(boltSupportScore(shortOnly, true), 6);
  assert.equal(boltSupportScore(lightspeed, true), 6);
  assert.equal(boltSupportScore(longOnly, false), 0);
});

test("Bolt short and long peers collapse to one logical device", () => {
  const shortOnly = fakeHidDevice(BOLT_RECEIVER, [hidppCollection(0x0001)]);
  const longOnly = fakeHidDevice(BOLT_RECEIVER, [hidppCollection(0x0002)]);
  const lightspeed = fakeHidDevice(LIGHTSPEED_RECEIVER, [hidppCollection(0x0001)]);

  assert.deepEqual(
    collapseBoltPeers([shortOnly, longOnly, lightspeed]),
    [longOnly, lightspeed],
  );
  assert.deepEqual(
    collapseBoltPeers([shortOnly, lightspeed]),
    [shortOnly, lightspeed],
    "short collection is kept when no long peer is authorized yet",
  );
});

test("Bolt report device resolves to the long-report peer when needed", () => {
  const shortOnly = fakeHidDevice(BOLT_RECEIVER, [hidppCollection(0x0001)]);
  const longOnly = fakeHidDevice(BOLT_RECEIVER, [hidppCollection(0x0002)]);
  assert.equal(resolveBoltReportDevice(longOnly, []), longOnly);
  assert.equal(resolveBoltReportDevice(shortOnly, [longOnly]), longOnly);
  assert.throws(() => resolveBoltReportDevice(shortOnly, []), /usage 2/);
});

test("HID++ 1.0 probe errors are treated as absent indices", () => {
  assert.equal(classifyHidpp20Probe(new Error("timeout"), true), "absent");
  assert.equal(
    classifyHidpp20Probe(new Error("The mouse rejected that setting (HID++ 1.0: invalid command)."), false),
    "absent",
  );
  assert.equal(
    classifyHidpp20Probe(new Error("The mouse rejected that setting (unsupported)."), false),
    "hidpp20",
  );
});
