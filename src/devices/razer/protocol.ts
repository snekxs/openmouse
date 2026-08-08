/**
 * Razer control protocol: 90-byte feature reports exchanged on report ID 0.
 *
 * Razer does not declare this report in its HID descriptor, so the collection
 * carries no feature report of its own; the exchange still succeeds because
 * WebHID does not validate report IDs against the descriptor. The control
 * interface is the one whose only collection is Generic Desktop Mouse.
 */

export const RAZER_REPORT_ID = 0;
export const RAZER_PACKET_LENGTH = 90;

/** Verified against Viper V3 Pro firmware 1.12 on both transports. */
export const RAZER_TRANSACTION_ID = 0x1f;

/**
 * Razer's older configuration interfaces answer on a different transaction id,
 * and a mismatch is silent: the mouse simply never replies. OpenRazer uses this
 * one for the DeathAdder Essential family.
 */
export const RAZER_TRANSACTION_ID_LEGACY = 0x3f;

const ARGS_OFFSET = 8;
const CHECKSUM_INDEX = 88;
const CHECKSUM_FIRST = 2;
const CHECKSUM_LAST = 88;
const STAGE_OFFSET = 3;
const STAGE_LENGTH = 7;
const BATTERY_SCALE = 255;

export const RAZER_STATUS = {
  busy: 0x01,
  ok: 0x02,
  failure: 0x03,
  timeout: 0x04,
  unsupported: 0x05,
} as const;

export interface RazerCommand {
  commandClass: number;
  commandId: number;
  dataSize: number;
  args?: readonly number[];
}

/**
 * Razer selects a value store per command. Firmware 1.12 reports the same DPI
 * from either store, and writes were confirmed against this one, so reads and
 * writes both use it rather than risking a stale read from the other.
 */
const RAZER_STORAGE = 0x01;

/** The underglow's led id in openrazer's extended-matrix family. */
const RAZER_LED_LOGO = 0x04;

/** Read-only commands confirmed against Viper V3 Pro firmware 1.12. */
export const RAZER_READ = {
  firmware: { commandClass: 0x00, commandId: 0x81, dataSize: 0x02 },
  serial: { commandClass: 0x00, commandId: 0x82, dataSize: 0x16 },
  battery: { commandClass: 0x07, commandId: 0x80, dataSize: 0x02 },
  charging: { commandClass: 0x07, commandId: 0x84, dataSize: 0x02 },
  sleepTimeout: { commandClass: 0x07, commandId: 0x83, dataSize: 0x02 },
  lowPowerThreshold: { commandClass: 0x07, commandId: 0x81, dataSize: 0x02 },
  dpi: { commandClass: 0x04, commandId: 0x85, dataSize: 0x07, args: [RAZER_STORAGE] },
  dpiStages: { commandClass: 0x04, commandId: 0x86, dataSize: 0x26, args: [0x00] },
  pollingRate: { commandClass: 0x00, commandId: 0x85, dataSize: 0x01 },
  pollingRateExtended: { commandClass: 0x00, commandId: 0xc0, dataSize: 0x02, args: [0x00] },
  liftOff: { commandClass: 0x0b, commandId: 0x85, dataSize: 0x05 },
} as const satisfies Record<string, RazerCommand>;

/**
 * Write commands confirmed against Viper V3 Pro firmware 1.12.
 *
 * Razer pairs each read with a write that clears the high bit of the command
 * id. Only commands verified on hardware belong here — in particular the DPI
 * stage table (`0x04`/`0x06`) is absent on purpose, because a wrong length
 * there is the one realistic way to corrupt stored settings.
 */
export const RAZER_WRITE = {
  dpi: { commandClass: 0x04, commandId: 0x05, dataSize: 0x07 },
  pollingRate: { commandClass: 0x00, commandId: 0x05, dataSize: 0x01 },
  pollingRateExtended: { commandClass: 0x00, commandId: 0x40, dataSize: 0x02 },
  liftOff: { commandClass: 0x0b, commandId: 0x05, dataSize: 0x0a },
  sensorSetting: { commandClass: 0x0b, commandId: 0x0b, dataSize: 0x04 },
  sleepTimeout: { commandClass: 0x07, commandId: 0x03, dataSize: 0x02 },
  lowPowerThreshold: { commandClass: 0x07, commandId: 0x01, dataSize: 0x02 },
} as const satisfies Record<string, Omit<RazerCommand, "args">>;

export function razerSetDpiCommand(x: number, y: number): RazerCommand {
  return {
    ...RAZER_WRITE.dpi,
    args: [RAZER_STORAGE, (x >> 8) & 0xff, x & 0xff, (y >> 8) & 0xff, y & 0xff, 0x00, 0x00],
  };
}

/** Seconds, big-endian, in the same encoding the matching read returns. */
export function razerSetSleepTimeoutCommand(seconds: number): RazerCommand {
  return { ...RAZER_WRITE.sleepTimeout, args: [(seconds >> 8) & 0xff, seconds & 0xff] };
}

/**
 * The payload mirrors the matching read byte for byte: the level on the 0–255
 * scale first, then a trailing zero. Confirmed on hardware by writing 85% and
 * finding `d9 00` still held after a reload.
 */
export function razerSetLowPowerThresholdCommand(percent: number): RazerCommand {
  return { ...RAZER_WRITE.lowPowerThreshold, args: [encodeBatteryLevel(percent), 0x00] };
}

function pollingDivisor(ceiling: number, pollingRateHz: number): number {
  const divisor = ceiling / pollingRateHz;
  if (!Number.isInteger(divisor) || divisor < 1 || divisor > 0xff) {
    throw new RazerProtocolError(`${pollingRateHz} Hz is not a rate this mouse can encode.`);
  }
  return divisor;
}

export function razerSetLegacyPollingCommand(pollingRateHz: number): RazerCommand {
  return { ...RAZER_WRITE.pollingRate, args: [pollingDivisor(1000, pollingRateHz)] };
}

/** The receiver takes the same leading argument its read echoes back. */
export function razerSetExtendedPollingCommand(pollingRateHz: number): RazerCommand {
  return { ...RAZER_WRITE.pollingRateExtended, args: [0x00, pollingDivisor(8000, pollingRateHz)] };
}

export type RazerExtendedEffect =
  | "off"
  | "static"
  | "spectrum"
  | "reactive"
  | "breathing-random"
  | "breathing-single"
  | "breathing-dual";

/** Effect ids from openrazer's `razer_chroma_extended_matrix_effect_*` family. */
export const RAZER_EFFECT = {
  off: 0x00,
  static: 0x01,
  spectrum: 0x03,
  reactive: 0x05,
  "breathing-random": 0x02,
  "breathing-single": 0x02,
  "breathing-dual": 0x02,
} as const satisfies Record<RazerExtendedEffect, number>;

export type RazerReactiveSpeed = 1 | 2 | 3 | 4;

/** Synapse's reactive speed scale: 1 is fast, 4 is slow. */
export const RAZER_EFFECT_SPEED = { 1: 1, 2: 2, 3: 3, 4: 4 } as const satisfies Record<RazerReactiveSpeed, number>;

export function parseRazerColor(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new RazerProtocolError(`${hex} is not a "#rrggbb" colour.`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * Extended effect command for the Viper Mini's extended-matrix family (`0x0f` /
 * `0x02`), matching openrazer's `razer_chroma_extended_matrix_effect_*`
 * functions, which this mouse dispatches through with `VARSTORE` and the logo
 * led. The mouse's one 1x1 matrix means a single underglow zone.
 *
 * All effects share the `[VARSTORE, logo, effect]` header. Breathing variants
 * differ only in the colour count byte and payload length, and reactive adds a
 * speed level between the header and its single colour.
 */
export function razerSetExtendedEffectCommand(
  effect: RazerExtendedEffect,
  options: {
    color?: string;
    color2?: string;
    speed?: RazerReactiveSpeed;
  } = {},
): RazerCommand {
  const args: number[] = [RAZER_STORAGE, RAZER_LED_LOGO, RAZER_EFFECT[effect]];
  switch (effect) {
    case "off":
    case "spectrum":
    case "breathing-random":
      args.push(0x00, 0x00, 0x00);
      break;
    case "static":
      if (!options.color) throw new RazerProtocolError(`${effect} needs a colour.`);
      args.push(0x00, 0x00, 0x01, ...parseRazerColor(options.color));
      break;
    case "reactive":
      if (!options.color) throw new RazerProtocolError(`${effect} needs a colour.`);
      if (!options.speed) throw new RazerProtocolError("Reactive needs a speed.");
      args.push(0x00, RAZER_EFFECT_SPEED[options.speed], 0x01, ...parseRazerColor(options.color));
      break;
    case "breathing-single":
      if (!options.color) throw new RazerProtocolError("Breathing single needs a colour.");
      args.push(0x01, 0x00, 0x01, ...parseRazerColor(options.color));
      break;
    case "breathing-dual":
      if (!options.color || !options.color2) throw new RazerProtocolError("Breathing dual needs two colours.");
      args.push(0x02, 0x00, 0x02, ...parseRazerColor(options.color), ...parseRazerColor(options.color2));
      break;
  }
  return {
    commandClass: 0x0f,
    commandId: 0x02,
    dataSize: args.length,
    args,
  };
}

export class RazerProtocolError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "RazerProtocolError";
    this.status = status;
  }
}

export function razerChecksum(packet: Uint8Array): number {
  let checksum = 0;
  for (let index = CHECKSUM_FIRST; index < CHECKSUM_LAST; index += 1) checksum ^= packet[index];
  return checksum;
}

export function encodeRazerRequest(
  command: RazerCommand,
  transactionId: number = RAZER_TRANSACTION_ID,
): Uint8Array<ArrayBuffer> {
  const packet = new Uint8Array(RAZER_PACKET_LENGTH);
  packet[1] = transactionId;
  packet[5] = command.dataSize;
  packet[6] = command.commandClass;
  packet[7] = command.commandId;
  packet.set(command.args ?? [], ARGS_OFFSET);
  packet[CHECKSUM_INDEX] = razerChecksum(packet);
  return packet;
}

function describe(command: RazerCommand, problem: string): string {
  const hex = (value: number) => `0x${value.toString(16).padStart(2, "0")}`;
  return `Class ${hex(command.commandClass)} command ${hex(command.commandId)} ${problem}.`;
}

/** Returns the reply arguments, or throws with the reported status. */
export function decodeRazerResponse(packet: Uint8Array, command: RazerCommand): Uint8Array {
  if (packet.length !== RAZER_PACKET_LENGTH) {
    throw new RazerProtocolError(describe(command, `returned ${packet.length} bytes instead of ${RAZER_PACKET_LENGTH}`));
  }
  if (packet[CHECKSUM_INDEX] !== razerChecksum(packet)) {
    throw new RazerProtocolError(describe(command, "returned a reply with a bad checksum"));
  }
  const status = packet[0];
  if (status === RAZER_STATUS.unsupported) {
    throw new RazerProtocolError(describe(command, "is not supported by this mouse"), status);
  }
  if (status !== RAZER_STATUS.ok) {
    throw new RazerProtocolError(describe(command, `returned status ${`0x${status.toString(16).padStart(2, "0")}`}`), status);
  }
  if (packet[6] !== command.commandClass || packet[7] !== command.commandId) {
    throw new RazerProtocolError(describe(command, "was answered by a different command"), status);
  }
  const length = Math.min(packet[5], RAZER_PACKET_LENGTH - ARGS_OFFSET);
  return packet.slice(ARGS_OFFSET, ARGS_OFFSET + length);
}

export function decodeFirmwareVersion(args: Uint8Array): string {
  return `${args[0]}.${args[1]}`;
}

export function decodeSerial(args: Uint8Array): string {
  let text = "";
  for (const byte of args) {
    if (byte === 0) break;
    text += String.fromCharCode(byte);
  }
  return text.trim();
}

export function decodeBatteryPercent(args: Uint8Array): number {
  return Math.round((args[1] * 100) / BATTERY_SCALE);
}

/**
 * The low-power threshold shares the battery level's 0–255 scale rather than
 * being a percentage, so 0x4d is 30% and reading it as a percent is wrong by a
 * factor of two and a half.
 *
 * It also sits in the *first* argument byte, where battery, charging and sleep
 * all pad with a leading zero and answer in the second. The mouse replied
 * `4d 00` where Synapse showed 30%, so the class is not consistent about this
 * and the shared decoder cannot be reused.
 */
export function decodeLowPowerThreshold(args: Uint8Array): number {
  return Math.round((args[0] * 100) / BATTERY_SCALE);
}

export function encodeBatteryLevel(percent: number): number {
  return Math.round((percent * BATTERY_SCALE) / 100);
}

export function decodeCharging(args: Uint8Array): boolean {
  return args[1] === 1;
}

/**
 * Idle sleep is a whole number of seconds, unlike battery and charging in the
 * same class, which pad their one meaningful byte with a leading zero.
 */
export function decodeSleepTimeout(args: Uint8Array): number {
  return (args[0] << 8) | args[1];
}

export interface RazerDpi {
  x: number;
  y: number;
}

export function decodeDpi(args: Uint8Array): RazerDpi {
  return { x: (args[1] << 8) | args[2], y: (args[3] << 8) | args[4] };
}

export interface RazerDpiStages {
  /** One-based index into `stages`, as reported by the mouse. */
  active: number;
  stages: RazerDpi[];
}

export function decodeDpiStages(args: Uint8Array): RazerDpiStages {
  const count = args[2];
  const stages: RazerDpi[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = STAGE_OFFSET + index * STAGE_LENGTH;
    if (offset + 4 >= args.length) break;
    stages.push({
      x: (args[offset + 1] << 8) | args[offset + 2],
      y: (args[offset + 3] << 8) | args[offset + 4],
    });
  }
  return { active: args[1], stages };
}

/**
 * Lift-off distance. The vendor software presents this as two different
 * controls behind one checkbox, and the mouse stores both independently:
 *
 * - Asymmetric off: a single three-stop slider, "Tracking Distance".
 * - Asymmetric on: two 26-step sliders, lift-off and landing.
 *
 * Switching modes leaves the other mode's stored value untouched, so neither
 * reading destroys the other.
 */
export type RazerTrackingDistance = "Low" | "Medium" | "High";

/** Indexed by the byte the mouse reports, so the order is the encoding. */
export const RAZER_TRACKING_DISTANCES: readonly RazerTrackingDistance[] = ["Low", "Medium", "High"];

/** Synapse's own numbering. Landing must stay strictly below lift-off. */
export const RAZER_LIFT_OFF_MIN = 2;
export const RAZER_LIFT_OFF_MAX = 26;
export const RAZER_LANDING_MIN = 1;
export const RAZER_LANDING_MAX = 25;

/**
 * Second argument of every class 0x0b write the vendor software was observed
 * making. It reads as a feature selector — smart tracking — and the mouse
 * rejects the packet without it.
 */
const RAZER_SENSOR_SELECTOR = 0x04;

/**
 * Third argument of `0x0b`/`0x0b`, choosing which setting the fourth carries.
 * Both were read off the vendor software's own traffic and confirmed on
 * hardware.
 */
const RAZER_SENSOR_SETTING = {
  trackingDistance: 0x01,
  asymmetric: 0x04,
} as const;

export interface RazerLiftOff {
  /** Null when the mouse reports a level outside the three the slider offers. */
  tracking: RazerTrackingDistance | null;
  liftOff: number;
  landing: number;
}

/**
 * Both asymmetric levels are stored one below the number Synapse displays, so
 * lift-off 26 is 0x19 and landing 25 is 0x18. Confirmed at 5/4, 16/11 and 26/25,
 * with the middle reading predicted before it was measured.
 *
 * Byte[0] echoes whatever argument the request carried and byte[1] was zero in
 * every capture, so neither is read here — arguments 0x00 through 0x07 all
 * returned the same levels, which rules out a per-profile store.
 */
export function decodeLiftOff(args: Uint8Array): RazerLiftOff {
  return {
    tracking: RAZER_TRACKING_DISTANCES[args[2]] ?? null,
    liftOff: args[3] + 1,
    landing: args[4] + 1,
  };
}

/**
 * The highest landing a given lift-off permits: lift-off 10 allows 9, and so on
 * down to the floor of 1.
 *
 * Landing is bounded by lift-off rather than locked to it — the vendor software
 * caps its own slider the same way, and 16/11 is a perfectly ordinary pair. The
 * firmware stores an inverted pair without complaint, and one session left the
 * mouse holding lift-off 2 with landing 26, which the vendor software cannot
 * even express. Nothing downstream catches that, so the rule is enforced here.
 */
export function razerMaxLanding(liftOff: number): number {
  return Math.min(RAZER_LANDING_MAX, Math.max(RAZER_LANDING_MIN, liftOff - 1));
}

/**
 * Selects the mouse's symmetric tracking distance, and by doing so switches it
 * out of asymmetric mode.
 *
 * The mouse has no readable mode bit and no mode flag to set. It honours
 * whichever of the two stores was written most recently, so writing a tracking
 * level *is* the way to return to symmetric — confirmed by the asymmetric pair
 * write being rejected immediately afterwards.
 */
export function razerSetTrackingDistanceCommand(distance: RazerTrackingDistance): RazerCommand {
  const level = RAZER_TRACKING_DISTANCES.indexOf(distance);
  if (level < 0) throw new RazerProtocolError(`${distance} is not a tracking distance this mouse offers.`);
  return {
    ...RAZER_WRITE.sensorSetting,
    args: [0x00, RAZER_SENSOR_SELECTOR, RAZER_SENSOR_SETTING.trackingDistance, level],
  };
}

/**
 * Unlocks the asymmetric pair write, which the mouse rejects with status `0x03`
 * in symmetric mode — and rejects while still moving what the read reports, so
 * skipping this produces a driver that appears to work and never touches the
 * sensor.
 *
 * There is no matching disable. Sending value `0x00` was accepted and changed
 * nothing; the vendor software leaves asymmetric mode by writing a tracking
 * level instead, which is what `razerSetTrackingDistanceCommand` does.
 */
export function razerEnableAsymmetricLiftOffCommand(): RazerCommand {
  return {
    ...RAZER_WRITE.sensorSetting,
    args: [0x00, RAZER_SENSOR_SELECTOR, RAZER_SENSOR_SETTING.asymmetric, 0x01],
  };
}

/**
 * Lift-off write, transcribed from the vendor software's own packet rather than
 * inferred: `dataSize 0x0a`, then `00 04` before the pair. It does NOT mirror
 * the read's layout, which is what three earlier guesses assumed — each was
 * answered `0x03` while still disturbing the stored values.
 *
 * Must be preceded by `razerEnableAsymmetricLiftOffCommand`.
 *
 * Confirmed on hardware: status `0x02`, read-back exact, and the change is
 * felt at the sensor, which a read-back alone cannot establish.
 */
export function razerSetLiftOffCommand(liftOff: number, landing: number): RazerCommand {
  if (!Number.isInteger(liftOff) || liftOff < RAZER_LIFT_OFF_MIN || liftOff > RAZER_LIFT_OFF_MAX) {
    throw new RazerProtocolError(`Lift-off must be a whole number between ${RAZER_LIFT_OFF_MIN} and ${RAZER_LIFT_OFF_MAX}.`);
  }
  if (!Number.isInteger(landing) || landing < RAZER_LANDING_MIN || landing > RAZER_LANDING_MAX) {
    throw new RazerProtocolError(`Landing must be a whole number between ${RAZER_LANDING_MIN} and ${RAZER_LANDING_MAX}.`);
  }
  // The firmware stores an inverted pair without complaint — a write of
  // landing 26 against lift-off 2 round-tripped and left the mouse in a state
  // the vendor software cannot express. Nothing downstream will catch this.
  if (landing >= liftOff) {
    throw new RazerProtocolError(`Landing (${landing}) must be below lift-off (${liftOff}).`);
  }
  return {
    ...RAZER_WRITE.liftOff,
    args: [0x00, RAZER_SENSOR_SELECTOR, liftOff - 1, landing - 1, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  };
}

/**
 * Legacy polling encodes the rate as a divisor of 1000, so it cannot express
 * the HyperPolling rates. Wireless answers this command as unsupported.
 */
export function decodeLegacyPollingRate(args: Uint8Array): number {
  if (!args[0]) throw new RazerProtocolError("The mouse reported an unknown polling rate.");
  return Math.round(1000 / args[0]);
}

/**
 * HyperPolling rates encode as a divisor of 8000. The first reply byte echoes
 * the request argument, so the rate lives in the second. Wired answers this
 * command as unsupported.
 */
export function decodeExtendedPollingRate(args: Uint8Array): number {
  if (!args[1]) throw new RazerProtocolError("The mouse reported an unknown polling rate.");
  return Math.round(8000 / args[1]);
}
