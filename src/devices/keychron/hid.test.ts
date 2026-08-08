import assert from "node:assert/strict";
import test from "node:test";

import { KeychronHidClient } from "./hid.ts";
import { VENDOR_ID } from "../vendors.ts";

function device(productId: number, usagePage = 0xff60, usage = 0x61): HIDDevice {
  return {
    vendorId: VENDOR_ID.keychron,
    productId,
    productName: "Keychron Nape Pro",
    collections: [{
      usagePage,
      usage,
      children: [],
      featureReports: [],
      inputReports: [{ reportId: 0, items: [{ reportCount: 32, reportSize: 8 }] }],
      outputReports: [{ reportId: 0, items: [{ reportCount: 32, reportSize: 8 }] }],
    }],
  } as unknown as HIDDevice;
}

test("support is limited to Nape Pro and Link-KM VIA raw HID collections", () => {
  assert.equal(KeychronHidClient.isSupported(device(0x0440)), true);
  assert.equal(KeychronHidClient.isSupported(device(0xd026)), true);
  assert.equal(KeychronHidClient.isSupported(device(0xd029)), true);
  assert.equal(KeychronHidClient.isSupported(device(0x0441)), false);
  assert.equal(KeychronHidClient.isSupported(device(0x0440, 0xff00, 0x61)), false);
  assert.equal(KeychronHidClient.isSupported(device(0x0440, 0xff60, 1)), false);
});

test("DPI options follow the Nape Pro 50–3200 step-50 ladder", () => {
  const options = new KeychronHidClient(device(0x0440)).getDpiOptions();
  assert.equal(options[0], 50);
  assert.equal(options.at(-1), 3200);
  assert.equal(options.length, (3200 - 50) / 50 + 1);
  assert.ok(options.every((dpi, index) => index === 0 || dpi - options[index - 1]! === 50));
});
