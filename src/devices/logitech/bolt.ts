/**
 * Logi Bolt transport helpers.
 *
 * Kept out of hidpp.ts so Bolt/MX work can land without rewriting the shared
 * Lightspeed / direct-connect driver paths that other PRs touch often.
 */
import {
  BOLT_PAIRING_SLOTS,
  DEVICE_INDEX_DIRECT,
  DEVICE_INDEX_RECEIVER,
  isBoltReceiverProduct,
} from "./protocol.ts";

/** Index probe on empty Bolt slots should fail fast; feature I/O keeps longer. */
export const BOLT_INDEX_PROBE_TIMEOUT_MS = 800;

/** True when a collection (or nested child) is an HID++ short- or long-report endpoint. */
function collectionHasHidppUsage(
  collections: readonly HIDCollectionInfo[],
  usage: number,
): boolean {
  return collections.some((collection) =>
    (collection.usagePage === 0xff00 && collection.usage === usage)
    || collectionHasHidppUsage(collection.children, usage));
}

/** Short-report HID++ collection (Lightspeed, Bolt receiver registers). */
export function hasHidppShortCollection(device: HIDDevice): boolean {
  return collectionHasHidppUsage(device.collections, 0x0001);
}

/** Long-report HID++ collection (required for Bolt device feature traffic). */
export function hasHidppLongCollection(device: HIDDevice): boolean {
  return collectionHasHidppUsage(device.collections, 0x0002);
}

/**
 * Prefer Bolt's long-report collection when both HID++ endpoints are present
 * so feature traffic lands on the interface that can carry it.
 */
export function boltSupportScore(device: HIDDevice, supported: boolean): number {
  if (!supported) return 0;
  if (isBoltReceiverProduct(device.productId) && hasHidppLongCollection(device)) return 8;
  return 6;
}

/**
 * Collapse Bolt short+long peers to one sidebar entry (the long collection
 * when both are authorized).
 */
export function collapseBoltPeers(devices: readonly HIDDevice[]): HIDDevice[] {
  const boltLongPresent = new Set<number>();
  for (const device of devices) {
    if (isBoltReceiverProduct(device.productId) && hasHidppLongCollection(device)) {
      boltLongPresent.add(device.productId);
    }
  }
  return devices.filter((device) => {
    if (!isBoltReceiverProduct(device.productId) || !hasHidppShortCollection(device)) return true;
    if (hasHidppLongCollection(device)) return true;
    return !boltLongPresent.has(device.productId);
  });
}

/**
 * HID++ device-index probe order. Bolt may place the mouse on any of six
 * pairing slots; Lightspeed stays 0x01 then 0xFF; unknown endpoints try self
 * first so wired mice are not addressed as receivers.
 */
export function hidppIndexCandidates(
  productId: number,
  knownReceiverIds: ReadonlySet<number>,
): number[] {
  if (isBoltReceiverProduct(productId)) return [...BOLT_PAIRING_SLOTS];
  if (knownReceiverIds.has(productId)) return [DEVICE_INDEX_RECEIVER, DEVICE_INDEX_DIRECT];
  return [DEVICE_INDEX_DIRECT, DEVICE_INDEX_RECEIVER];
}

/**
 * Classify a root getFeature probe: only HID++ 2.0 replies mean a mouse is on
 * that index. Bolt receivers answer HID++ 1.0 errors on empty slots / 0xFF.
 */
export function classifyHidpp20Probe(error: unknown, isTimeout: boolean): "hidpp20" | "absent" {
  if (isTimeout) return "absent";
  if (error instanceof Error && /HID\+\+ 1\.0/.test(error.message)) return "absent";
  return "hidpp20";
}

/**
 * Bolt device features answer on the long-report collection (usage 2). The
 * picker may hand us the short collection; use an already-authorized peer.
 */
export function resolveBoltReportDevice(
  device: HIDDevice,
  peers: readonly HIDDevice[],
): HIDDevice {
  if (!isBoltReceiverProduct(device.productId)) return device;
  if (hasHidppLongCollection(device)) return device;
  const longPeer = peers.find((candidate) =>
    candidate !== device
    && candidate.vendorId === device.vendorId
    && candidate.productId === device.productId
    && hasHidppLongCollection(candidate));
  if (!longPeer) {
    throw new Error(
      "Logi Bolt needs the HID++ long-report interface (usage 2). "
      + "Reconnect and authorize both Bolt HID++ collections, or pick the usage-2 interface. "
      + "Close Logi Options+ if the browser cannot open the device.",
    );
  }
  return longPeer;
}
