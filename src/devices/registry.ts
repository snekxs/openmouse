import { AtkHidClient } from "./atk/hid.ts";
import { EggOp1HidClient } from "./endgame/egg-op1-hid.ts";
import { eggWeCreate, eggWeIsSupported, eggWeSupportScore, isEggWeClient, type EggWeHidClient } from "./endgame/egg-we-control.ts";
import { FinalmouseHidClient } from "./finalmouse/hid.ts";
import { LamzuHidClient } from "./lamzu/hid.ts";
import { LogitechHidppClient } from "./logitech/hidpp.ts";
import { ModdoHidClient } from "./moddo/hid.ts";
import { OrbitalHidClient } from "./orbital/hid.ts";
import { PulsarHidClient } from "./pulsar/pulsar-hid.ts";
import { PulsarProHidClient } from "./pulsar/pulsar-pro-hid.ts";
import { RazerHidClient } from "./razer/hid.ts";
import { RazerViperMiniHidClient } from "./razer/viper-mini-hid.ts";
import { RazerViperV4ProHidClient } from "./razer/viper-v4-pro-hid.ts";
import { TeevolutionHidClient } from "./teevolution/hid.ts";
import { VgnF2HidClient } from "./vgn/hid.ts";
import { WLMouseHidClient } from "./wlmouse/hid.ts";

export type PulsarClient = PulsarHidClient | PulsarProHidClient;
export type SupportedClient = LogitechHidppClient | PulsarClient | EggOp1HidClient | EggWeHidClient | FinalmouseHidClient | WLMouseHidClient | LamzuHidClient | OrbitalHidClient | RazerHidClient | RazerViperMiniHidClient | RazerViperV4ProHidClient | TeevolutionHidClient | AtkHidClient | VgnF2HidClient | ModdoHidClient;

export interface DeviceDriver {
  brand: string;
  supports(device: HIDDevice): boolean;
  create(device: HIDDevice): SupportedClient | null;
  score(device: HIDDevice): number;
}

export const DEVICE_DRIVERS: readonly DeviceDriver[] = [
  { brand: "Finalmouse", supports: (device) => FinalmouseHidClient.isSupported(device), create: (device) => new FinalmouseHidClient(device), score: () => 10 },
  { brand: "Endgame Gear", supports: (device) => EggOp1HidClient.isSupported(device), create: (device) => new EggOp1HidClient(device), score: () => 10 },
  { brand: "Endgame Gear", supports: eggWeIsSupported, create: eggWeCreate, score: eggWeSupportScore },
  { brand: "Pulsar", supports: (device) => PulsarProHidClient.isSupported(device), create: (device) => new PulsarProHidClient(device), score: () => 8 },
  { brand: "Pulsar", supports: (device) => PulsarHidClient.isSupported(device), create: (device) => new PulsarHidClient(device), score: () => 7 },
  { brand: "Teevolution", supports: (device) => TeevolutionHidClient.isSupported(device), create: (device) => new TeevolutionHidClient(device), score: () => 7 },
  { brand: "VGN", supports: (device) => VgnF2HidClient.isSupported(device), create: (device) => new VgnF2HidClient(device), score: () => 7 },
  { brand: "Logitech", supports: (device) => LogitechHidppClient.isSupported(device), create: (device) => new LogitechHidppClient(device), score: () => 6 },
  { brand: "WLMouse", supports: (device) => WLMouseHidClient.isSupported(device), create: (device) => new WLMouseHidClient(device), score: () => 5 },
  { brand: "Lamzu", supports: (device) => LamzuHidClient.isSupported(device), create: (device) => new LamzuHidClient(device), score: () => 5 },
  { brand: "moddoMOUSE", supports: (device) => ModdoHidClient.isSupported(device), create: (device) => new ModdoHidClient(device), score: () => 5 },
  { brand: "Orbital", supports: (device) => OrbitalHidClient.isSupported(device), create: (device) => new OrbitalHidClient(device), score: () => 6 },
  { brand: "Razer", supports: (device) => RazerHidClient.isSupported(device), create: (device) => new RazerHidClient(device), score: () => 6 },
  { brand: "Razer", supports: (device) => RazerViperMiniHidClient.isSupported(device), create: (device) => new RazerViperMiniHidClient(device), score: () => 6 },
  { brand: "ATK", supports: (device) => AtkHidClient.isSupported(device), create: (device) => new AtkHidClient(device), score: () => 5 },
  { brand: "Razer", supports: (device) => RazerViperV4ProHidClient.isSupported(device), create: (device) => new RazerViperV4ProHidClient(device), score: () => 7 },
];

function driverFor(device: HIDDevice): DeviceDriver | undefined {
  return DEVICE_DRIVERS.find((driver) => driver.supports(device));
}

export function createSupportedClient(device: HIDDevice): SupportedClient | null {
  return driverFor(device)?.create(device) ?? null;
}

export function clientSupportScore(device: HIDDevice): number {
  return driverFor(device)?.score(device) ?? 0;
}

export function deviceBrand(client: SupportedClient): string {
  if (client instanceof EggOp1HidClient || isEggWeClient(client)) return "Endgame Gear";
  return driverFor(client.device)?.brand ?? "Unknown";
}
