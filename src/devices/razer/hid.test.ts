import assert from "node:assert/strict";
import test from "node:test";

// `hid.ts` schedules its inter-exchange delay through `window`, which node does
// not provide. The global carries the same `setTimeout`.
Object.assign(globalThis, { window: globalThis });

const { RazerHidClient } = await import("./hid.ts");
const {
  RAZER_PACKET_LENGTH,
  RAZER_STATUS,
  RAZER_TRANSACTION_ID,
  razerChecksum,
} = await import("./protocol.ts");

interface FakeLiftOff {
  tracking: number;
  liftOff: number;
  landing: number;
  /** The mouse refuses the pair write unless this is on. */
  asymmetric: boolean;
}

interface FakeOptions {
  /** Answer class 0x0b as unsupported, the way the cable may. */
  liftOffUnsupported?: boolean;
  /** Accept the write and keep the old values, as a rejected write does. */
  ignoreWrites?: boolean;
}

function replyPacket(commandClass: number, commandId: number, dataSize: number, args: number[], status: number): Uint8Array {
  const packet = new Uint8Array(RAZER_PACKET_LENGTH);
  packet[0] = status;
  packet[1] = RAZER_TRANSACTION_ID;
  packet[5] = dataSize;
  packet[6] = commandClass;
  packet[7] = commandId;
  packet.set(args, 8);
  packet[88] = razerChecksum(packet);
  return packet;
}

/**
 * A mouse that answers only the lift-off commands, storing the pair the way the
 * real one does: the write carries `00 04` before the levels, and each level is
 * held one below the number the vendor software shows.
 */
function fakeMouse(state: FakeLiftOff, options: FakeOptions = {}) {
  const sent: Uint8Array[] = [];
  let pending = new Uint8Array(RAZER_PACKET_LENGTH);
  const device = {
    vendorId: 0x1532,
    productId: 0x00c1,
    productName: "Razer Viper V3 Pro",
    opened: true,
    collections: [{ usagePage: 0x01, usage: 0x02, children: [], featureReports: [], inputReports: [], outputReports: [] }],
    open: async () => {},
    close: async () => {},
    sendFeatureReport: async (_reportId: number, data: Uint8Array) => {
      sent.push(data);
      const [commandClass, commandId] = [data[6], data[7]];
      if (options.liftOffUnsupported) {
        pending = replyPacket(commandClass, commandId, data[5], [], RAZER_STATUS.unsupported);
        return;
      }
      // Matched on class as well as id: polling shares both ids on class 0x00,
      // so an id-only match would let a later test mutate the pair by accident.
      const liftOffWrite = commandClass === 0x0b && commandId === 0x05;
      const liftOffRead = commandClass === 0x0b && commandId === 0x85;
      const settingWrite = commandClass === 0x0b && commandId === 0x0b;
      // The real mouse refuses the pair write unless asymmetric mode is on, and
      // leaves it again whenever a tracking level is written.
      if (settingWrite && data[10] === 0x04) state.asymmetric = data[11] === 0x01;
      if (settingWrite && data[10] === 0x01 && !options.ignoreWrites) {
        state.tracking = data[11];
        state.asymmetric = false;
      }
      if (liftOffWrite && !state.asymmetric) {
        pending = replyPacket(commandClass, commandId, data[5], [], RAZER_STATUS.failure);
        return;
      }
      if (liftOffWrite && !options.ignoreWrites) {
        state.liftOff = data[10] + 1;
        state.landing = data[11] + 1;
      }
      pending = liftOffRead
        ? replyPacket(commandClass, commandId, 0x05, [0, 0, state.tracking, state.liftOff - 1, state.landing - 1], RAZER_STATUS.ok)
        : replyPacket(commandClass, commandId, data[5], [...data.slice(8, 8 + data[5])], RAZER_STATUS.ok);
    },
    receiveFeatureReport: async () => new DataView(pending.buffer.slice(0)),
  } as unknown as HIDDevice;
  return { client: new RazerHidClient(device), sent };
}

/**
 * A mouse that answers firmware, DPI and legacy polling, and reports every
 * power-management command (class 0x07) as unsupported — the shape an untested
 * model takes when its `hasBattery` prediction is wrong.
 */
function fakeMouseWithoutBattery(productId: number) {
  let pending = new Uint8Array(RAZER_PACKET_LENGTH);
  const device = {
    vendorId: 0x1532,
    productId,
    productName: "Razer test device",
    opened: true,
    collections: [{ usagePage: 0x01, usage: 0x02, children: [], featureReports: [], inputReports: [], outputReports: [] }],
    open: async () => {},
    close: async () => {},
    sendFeatureReport: async (_reportId: number, data: Uint8Array) => {
      const [commandClass, commandId] = [data[6], data[7]];
      const answer = (dataSize: number, args: number[]) =>
        replyPacket(commandClass, commandId, dataSize, args, RAZER_STATUS.ok);
      if (commandClass === 0x00 && commandId === 0x81) pending = answer(0x02, [1, 12]);
      else if (commandClass === 0x04 && commandId === 0x85) pending = answer(0x07, [0x01, 0x03, 0x20, 0x03, 0x20]);
      else if (commandClass === 0x00 && commandId === 0x85) pending = answer(0x01, [1]);
      else pending = replyPacket(commandClass, commandId, data[5], [], RAZER_STATUS.unsupported);
    },
    receiveFeatureReport: async () => new DataView(pending.buffer.slice(0)),
  } as unknown as HIDDevice;
  return new RazerHidClient(device);
}

test("an untested model that refuses the battery read still reports the rest", async () => {
  // `hasBattery` is a prediction on a model nobody has connected. Unlike sleep
  // and low power, this read is not optional, so an unsupported reply would
  // abort the whole status read and take DPI and polling down with it.
  // Arrange: 0x0083 is Basilisk X HyperSpeed — wireless, unverified.
  const client = fakeMouseWithoutBattery(0x0083);

  // Act
  const status = await client.readStatus();

  // Assert
  assert.equal(status.name, "Razer Basilisk X HyperSpeed");
  assert.equal(status.batteryPercent, null);
  assert.equal(status.dpi, 800);
  assert.equal(status.pollingRateHz, 1000);
  // The panel should not present a transcribed model as a tested one.
  assert.match(status.connectionDetail ?? "", /untested model/);
});

test("a verified model still fails loudly when its battery read stops answering", async () => {
  // There the command is known to exist, so a refusal is news rather than an
  // absent capability, and hiding it would hide a real fault.
  // Arrange: 0x00c1 is the Viper V3 Pro receiver.
  const client = fakeMouseWithoutBattery(0x00c1);

  // Act / Assert
  await assert.rejects(() => client.readStatus(), /not supported by this mouse/);
});

test("lift-off reads the tracking level and the asymmetric pair together", async () => {
  // Arrange
  const { client } = fakeMouse({ tracking: 1, liftOff: 16, landing: 11, asymmetric: true });

  // Act
  const liftOff = await client.readLiftOff();

  // Assert
  assert.deepEqual(liftOff, { tracking: "Medium", liftOff: 16, landing: 11 });
});

test("a transport that rejects class 0x0b degrades to null instead of throwing", async () => {
  // A status read that throws takes the whole panel down, and the cable has
  // never been checked against this command.
  // Arrange
  const { client } = fakeMouse({ tracking: 1, liftOff: 16, landing: 11, asymmetric: true }, { liftOffUnsupported: true });

  // Act
  const liftOff = await client.readLiftOff();

  // Assert
  assert.equal(liftOff, null);
});

test("the lift-off write unlocks asymmetric mode first, then uses the captured format", async () => {
  // Without the unlock the mouse answers 0x03 and still moves what the read
  // reports, so the omission would look like success from every angle but the
  // sensor.
  // Arrange
  const { client, sent } = fakeMouse({ tracking: 2, liftOff: 26, landing: 25, asymmetric: false });

  // Act
  const confirmed = await client.setLiftOff(16, 11);

  // Assert
  const [unlock, write] = sent;
  assert.deepEqual([unlock[5], unlock[6], unlock[7]], [0x04, 0x0b, 0x0b]);
  assert.deepEqual([...unlock.slice(8, 12)], [0x00, 0x04, 0x04, 0x01]);
  assert.deepEqual([write[5], write[6], write[7]], [0x0a, 0x0b, 0x05]);
  assert.deepEqual([...write.slice(8, 18)], [0x00, 0x04, 0x0f, 0x0a, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(confirmed, { tracking: "High", liftOff: 16, landing: 11 });
});

test("landing is capped below lift-off rather than rejected", async () => {
  // Lowering lift-off past an already-set landing is ordinary use of a pair of
  // controls; the protocol layer would throw on the inverted pair.
  // Arrange
  const { client, sent } = fakeMouse({ tracking: 0, liftOff: 16, landing: 11, asymmetric: true });

  // Act
  const confirmed = await client.setLiftOff(5, 11);

  // Assert
  assert.deepEqual([...sent[1].slice(8, 12)], [0x00, 0x04, 0x04, 0x03]);
  assert.deepEqual(confirmed, { tracking: "Low", liftOff: 5, landing: 4 });
});

test("setting a tracking distance returns the mouse to symmetric mode", async () => {
  // There is no mode flag to clear — the mouse honours whichever store was
  // written last, so a later pair write must be refused until it re-unlocks.
  // Arrange
  const state = { tracking: 0, liftOff: 16, landing: 11, asymmetric: true };
  const { client, sent } = fakeMouse(state);

  // Act
  const confirmed = await client.setLiftOffDistance("High");

  // Assert
  assert.deepEqual([...sent[0].slice(8, 12)], [0x00, 0x04, 0x01, 0x02]);
  assert.equal(confirmed, "High");
  assert.equal(state.asymmetric, false);
});

test("a tracking distance the mouse does not take is reported", async () => {
  // Arrange
  const { client } = fakeMouse({ tracking: 0, liftOff: 16, landing: 11, asymmetric: false }, { ignoreWrites: true });

  // Act / Assert
  await assert.rejects(() => client.setLiftOffDistance("High"), /kept Low tracking distance instead of High/);
});

test("the mode probe reports asymmetric from the pair write's status", async () => {
  // Nothing readable carries the mode; the pair write is refused in symmetric
  // mode and accepted in asymmetric, which is the only signal available.
  // Arrange
  const asymmetric = fakeMouse({ tracking: 1, liftOff: 16, landing: 11, asymmetric: true });
  const symmetric = fakeMouse({ tracking: 1, liftOff: 16, landing: 11, asymmetric: false });

  // Act / Assert
  assert.equal(await asymmetric.client.probeAsymmetric({ tracking: "Medium", liftOff: 16, landing: 11 }), true);
  assert.equal(await symmetric.client.probeAsymmetric({ tracking: "Medium", liftOff: 16, landing: 11 }), false);
});

test("the mode probe leaves the stored pair exactly as it found it", async () => {
  // It is a write, so it has to be one the mouse cannot act on. Re-sending the
  // mirror's own values is inert whichever way the status goes.
  // Arrange
  const state = { tracking: 1, liftOff: 16, landing: 11, asymmetric: true };
  const { client } = fakeMouse(state);

  // Act
  await client.probeAsymmetric({ tracking: "Medium", liftOff: 16, landing: 11 });

  // Assert
  assert.deepEqual(state, { tracking: 1, liftOff: 16, landing: 11, asymmetric: true });
});

test("the mode probe reports unknown rather than throwing on an inverted pair", async () => {
  // The firmware stores lift-off 2 with landing 26 without complaint, and one
  // session left it there. Probing with that would throw in the command builder.
  // Arrange
  const { client, sent } = fakeMouse({ tracking: 1, liftOff: 2, landing: 26, asymmetric: true });

  // Act
  const mode = await client.probeAsymmetric({ tracking: "Medium", liftOff: 2, landing: 26 });

  // Assert
  assert.equal(mode, null);
  assert.equal(sent.length, 0);
});

test("a level outside the three the slider offers still produces a readable error", async () => {
  // `decodeLiftOff` reports an unrecognised byte[2] as null rather than guessing,
  // so the mismatch message has to survive that without printing "null".
  // Arrange
  const { client } = fakeMouse({ tracking: 7, liftOff: 16, landing: 11, asymmetric: false }, { ignoreWrites: true });

  // Act / Assert
  await assert.rejects(
    () => client.setLiftOffDistance("Medium"),
    /kept an unknown tracking distance instead of Medium/,
  );
});

test("a write the mouse does not honour is reported instead of assumed", async () => {
  // Arrange
  const { client } = fakeMouse({ tracking: 0, liftOff: 26, landing: 25, asymmetric: true }, { ignoreWrites: true });

  // Act / Assert
  await assert.rejects(() => client.setLiftOff(16, 11), /kept lift-off 26 and landing 25/);
});

test("an out-of-range lift-off reports itself rather than the landing it drags down", async () => {
  // Arrange
  const { client, sent } = fakeMouse({ tracking: 0, liftOff: 16, landing: 11, asymmetric: false });

  // Act / Assert
  await assert.rejects(() => client.setLiftOff(1, 1), /Lift-off must be/);
  // Nothing reached the device, so a rejected value cannot leave the mouse
  // switched into asymmetric mode over a write that never happened.
  assert.equal(sent.length, 0);
  await assert.rejects(() => client.setLiftOff(27, 25), /Lift-off must be/);
});
