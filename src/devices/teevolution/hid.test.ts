import assert from "node:assert/strict";
import test from "node:test";

import { TeevolutionHidClient } from "./hid.ts";
import { TEEVOLUTION_REPORT_ID } from "./protocol.ts";

function device(productId: number, reportId = TEEVOLUTION_REPORT_ID): HIDDevice {
  return {
    vendorId: 0x3554,
    productId,
    productName: "RapidSync",
    collections: [{
      usagePage: 0xff00,
      usage: 1,
      children: [],
      featureReports: [],
      inputReports: [{ reportId, items: [{ reportCount: 16, reportSize: 8 }] }],
      outputReports: [{ reportId, items: [{ reportCount: 16, reportSize: 8 }] }],
    }],
  } as unknown as HIDDevice;
}

test("support is limited to Terra Pro Compx transports with report 8", () => {
  // Arrange
  const receiver = device(0xf523);
  const wired = device(0xf520);
  const alt = device(0xf5bb);
  const wrongPid = device(0xfb56);
  const wrongReport = device(0xf523, 0x09);

  // Act / Assert
  assert.equal(TeevolutionHidClient.isSupported(receiver), true);
  assert.equal(TeevolutionHidClient.isSupported(wired), true);
  assert.equal(TeevolutionHidClient.isSupported(alt), true);
  assert.equal(TeevolutionHidClient.isSupported(device(0xf522)), true);
  assert.equal(TeevolutionHidClient.isSupported(wrongPid), false);
  assert.equal(TeevolutionHidClient.isSupported(wrongReport), false);
});
