import type { MouseStatus } from "./devices/mouse-types";
import { PREVIEW_KEYS, type FixturePreviewMode } from "./preview-modes";

export { PREVIEW_KEYS };

/**
 * Dev-only stand-in statuses, one per supported driver.
 *
 * The control shell decides which cards and panels to show entirely from
 * `MouseStatus`, so a fixture that matches what a driver really reports
 * exercises the same rendering path the device would. That makes it possible to
 * check a shell change against every brand without owning every mouse.
 *
 * Each fixture is modelled on the corresponding driver's readStatus return, so
 * when a driver changes what it reports its fixture should change with it.
 */
export interface PreviewFixture {
  /** Shown in the picker and the live-status line. */
  label: string;
  status: MouseStatus;
}

const PULSAR: MouseStatus = {
  brand: "Pulsar",
  name: "X2H Mini",
  ui: { family: "pulsar", hideUnsupportedPollingRates: true },
  batteryPercent: 64,
  batteryState: "Discharging",
  dpi: 1600,
  pollingRateHz: 1000,
  supportedPollingRates: [125, 250, 500, 1000],
  activeProfile: 1,
  liftOffDistance: "Medium",
  connectionType: "Wireless",
  connectionDetail: "2.4 GHz receiver",
  dongleLedEnabled: true,
  signalStrength: 82,
  motionSync: true,
  debounceMs: 4,
  sleepTimeout: 30,
  angleSnapping: false,
  rippleControl: false,
  firmware: ["1.04.11"],
};

const PULSAR_PRO: MouseStatus = {
  ...PULSAR,
  name: "X2H Mini Pro",
  performanceMode: true,
  angleTuning: 0,
  wheelAcceleration: false,
  pollingRateHz: 4000,
  supportedPollingRates: [125, 250, 500, 1000, 2000, 4000, 8000],
  firmware: ["2.01.03"],
};

const EGG_OP1: MouseStatus = {
  brand: "Endgame Gear",
  name: "OP1 8K",
  ui: { family: "egg-op1", hideLodLow: true, hideUnsupportedPollingRates: true },
  batteryPercent: null,
  batteryState: "Unknown",
  dpi: 3200,
  pollingRateHz: 8000,
  supportedPollingRates: [1000, 2000, 4000, 8000],
  activeProfile: 2,
  liftOffDistance: "Medium",
  connectionType: "Wired",
  motionSync: false,
  angleSnapping: false,
  rippleControl: false,
  leftSpdtMode: "GX Speed",
  rightSpdtMode: "GX Safe",
  eggCpiLevels: 4,
  eggCpiStages: [{ x: 800, y: 800 }, { x: 1600, y: 1600 }, { x: 3200, y: 3200 }, { x: 6400, y: 6400 }],
  eggPollingDivider: 1,
  eggMulticlickFilters: [0, 0],
  eggButtonMappings: ["Left", "Right", "Middle", "Back", "Forward"],
  firmware: ["1.02.00"],
};

const EGG_WE: MouseStatus = {
  brand: "Endgame Gear",
  name: "OP1we",
  ui: {
    family: "egg-we",
    settingsReady: true,
    hideLodLow: true,
    hideUnsupportedPollingRates: true,
    hideProcessingCard: true,
    forceShowBattery: true,
    pollingNote: "OP1we supports up to 1,000 Hz (125 / 250 / 500 / 1000).",
    defaultDisplayName: "Endgame Gear OP1we",
  },
  batteryPercent: 58,
  batteryState: "Discharging",
  dpi: 1600,
  pollingRateHz: 1000,
  supportedPollingRates: [125, 250, 500, 1000],
  activeProfile: 1,
  liftOffDistance: "Medium",
  connectionType: "Wireless",
  slamclickFilter: true,
  motionJitterFilter: false,
  firmware: ["1.00.07"],
};

const WLMOUSE: MouseStatus = {
  brand: "WLMouse",
  name: "BEAST X",
  ui: { family: "wlmouse", hideUnsupportedPollingRates: true, forceShowBattery: true },
  batteryPercent: 91,
  batteryState: "Charging",
  dpi: 800,
  dpiY: 800,
  supportsSeparateDpiAxes: true,
  pollingRateHz: 8000,
  supportedPollingRates: [125, 250, 500, 1000, 2000, 4000, 8000],
  activeProfile: 1,
  liftOffDistance: "Low",
  connectionType: "Wireless",
  motionSync: true,
  debounceMs: 2,
  sleepTimeout: 60,
  firmware: ["0.9.2"],
};

const LAMZU: MouseStatus = {
  brand: "Lamzu",
  name: "Atlantis OG V2",
  ui: { family: "lamzu", hideUnsupportedPollingRates: true, forceShowBattery: true },
  batteryPercent: 47,
  batteryState: "Discharging",
  dpi: 1600,
  dpiY: 1600,
  supportsSeparateDpiAxes: true,
  pollingRateHz: 4000,
  supportedPollingRates: [125, 250, 500, 1000, 2000, 4000],
  activeProfile: 3,
  liftOffDistance: "Medium",
  connectionType: "Wireless",
  motionSync: false,
  debounceMs: 3,
  sleepTimeout: 30,
  firmware: ["1.1.4"],
};

const ATK: MouseStatus = {
  brand: "ATK",
  name: "A9 Ultra",
  ui: { family: "atk", hideUnsupportedPollingRates: true, forceShowBattery: true },
  batteryPercent: 73,
  batteryState: "Unknown",
  dpi: 1600,
  dpiY: 1600,
  supportsSeparateDpiAxes: false,
  pollingRateHz: 8000,
  supportedPollingRates: [125, 250, 500, 1000, 2000, 4000, 8000],
  activeProfile: null,
  liftOffDistance: "Medium",
  connectionType: "Wireless",
  firmware: ["1.0.0"],
};

const ORBITAL: MouseStatus = {
  brand: "Orbital",
  name: "Orbital One",
  ui: { defaultDisplayName: "Orbital One", hideLodLow: false, hideUnsupportedPollingRates: true },
  batteryPercent: 88,
  batteryState: "Discharging",
  dpi: 1600,
  dpiY: 1600,
  supportsSeparateDpiAxes: true,
  pollingRateHz: 2000,
  supportedPollingRates: [125, 250, 500, 1000, 2000, 4000],
  activeProfile: 1,
  liftOffDistance: "Low",
  connectionType: "Wireless",
  motionSync: true,
  debounceMs: 5,
  sleepTimeout: 180,
  firmware: ["1.3.0"],
};

const RAZER: MouseStatus = {
  brand: "Razer",
  name: "Viper V3 Pro",
  ui: {
    family: "razer",
    settingsReady: true,
    valuesVerified: true,
    hideUnsupportedPollingRates: true,
    hideProcessingCard: true,
    forceShowBattery: true,
    defaultDisplayName: "Viper V3 Pro",
  },
  batteryPercent: 66,
  batteryState: "Discharging",
  dpi: 1600,
  dpiY: 1600,
  supportsSeparateDpiAxes: true,
  pollingRateHz: 1000,
  supportedPollingRates: [125, 250, 500, 1000, 2000, 4000, 8000],
  activeProfile: 1,
  liftOffDistance: null,
  supportedLiftOffDistances: [],
  connectionType: "Wireless",
  connectionDetail: "HyperSpeed receiver",
  firmware: ["1.01.00"],
};

const RAZER_VIPER_V4: MouseStatus = {
  ...RAZER,
  name: "Viper V4 Pro",
  ui: { family: "razer-viper-v4-pro", hideUnsupportedPollingRates: true, hideProcessingCard: true, forceShowBattery: true },
  pollingRateHz: 8000,
  sleepTimeout: 300,
  lowBatteryWarning: 15,
  firmware: ["1.00.04"],
};

const TEEVOLUTION: MouseStatus = {
  brand: "Teevolution",
  name: "Terra Pro",
  ui: { defaultDisplayName: "Terra Pro", hideUnsupportedPollingRates: true, hideSignalCard: true },
  batteryPercent: 52,
  batteryState: "Discharging",
  dpi: 1600,
  pollingRateHz: 1000,
  supportedPollingRates: [125, 250, 500, 1000],
  activeProfile: 1,
  liftOffDistance: "Medium",
  connectionType: "Wireless",
  connectionDetail: "CID 1 · MID 2 · Type 3",
  sensorMode: "Eco",
  sensorModeStored: 0,
  sensorModeEditable: true,
  performanceMode: false,
  performanceDuration: 6,
  dpiLedMode: 1,
  dpiLedBrightness: 5,
  dpiLedSpeed: 3,
  motionSync: false,
  debounceMs: 4,
  sleepTimeout: 60,
  firmware: ["1.0.2"],
};

const VGN: MouseStatus = {
  brand: "VGN",
  name: "F2 Master Plus",
  ui: { family: "vgn", hideUnsupportedPollingRates: true, forceShowBattery: true },
  batteryPercent: 79,
  batteryState: "Discharging",
  dpi: 1600,
  pollingRateHz: 4000,
  supportedPollingRates: [125, 250, 500, 1000, 2000, 4000],
  activeProfile: 1,
  liftOffDistance: "Medium",
  connectionType: "Wireless",
  motionSync: true,
  debounceMs: 4,
  sleepTimeout: 60,
  firmware: ["1.2.0"],
};

const FINALMOUSE: MouseStatus = {
  brand: "Finalmouse",
  name: "Finalmouse UltralightX",
  ui: {
    family: "finalmouse-ulx",
    defaultDisplayName: "Finalmouse UltralightX",
    hideUnsupportedPollingRates: true,
    forceShowBattery: true,
  },
  batteryPercent: 76,
  batteryVoltageMv: 3890,
  batteryState: "Discharging",
  dpi: 1600,
  pollingRateHz: 8000,
  supportedPollingRates: [500, 1000, 2000, 4000, 8000],
  activeProfile: null,
  connectionType: "Wireless",
  connectionDetail: "2.4 GHz receiver · -48 dBm",
  motionSync: true,
  liftOffDistance: "Medium",
  supportedLiftOffDistances: ["Medium", "High"],
  finalmouseDongleLedMode: 1,
  finalmouseTournamentScrollMode: 3,
  finalmouseTournamentScrollTimeoutMs: 500,
  firmware: ["Mouse 1.0.7", "Dongle RF 1.0.4", "Dongle USB 1.0.3"],
};

const LOGITECH_LEGACY: MouseStatus = {
  brand: "Logitech",
  name: "G402 Hyperion Fury",
  ui: { family: "logitech-hidpp", lodRequiresSurface: true },
  batteryPercent: null,
  batteryState: "Unknown",
  dpi: 1200,
  pollingRateHz: 1000,
  supportedPollingRates: [125, 250, 500, 1000],
  activeProfile: 1,
  // Legacy 0x2201 exposes no lift-off, which must hide the sensor card.
  liftOffDistance: null,
  supportedLiftOffDistances: [],
  connectionType: "Wired",
  connectionDetail: "Wired USB",
  firmware: ["MPM 12.01"],
};

/**
 * Keyed by the `?preview=` value. `superstrike` and `slots` are handled
 * separately because they drive panels beyond a plain status.
 */
export const PREVIEW_FIXTURES: Record<FixturePreviewMode, PreviewFixture> = {
  pulsar: { label: "Pulsar X2H Mini", status: PULSAR },
  "pulsar-pro": { label: "Pulsar X2H Mini Pro", status: PULSAR_PRO },
  "egg-op1": { label: "Endgame Gear OP1 8K", status: EGG_OP1 },
  "egg-we": { label: "Endgame Gear OP1we", status: EGG_WE },
  wlmouse: { label: "WLMouse BEAST X", status: WLMOUSE },
  lamzu: { label: "Lamzu Atlantis OG V2", status: LAMZU },
  atk: { label: "ATK A9 Ultra", status: ATK },
  orbital: { label: "Orbital One", status: ORBITAL },
  razer: { label: "Razer Viper V3 Pro", status: RAZER },
  "razer-viper-v4": { label: "Razer Viper V4 Pro", status: RAZER_VIPER_V4 },
  teevolution: { label: "Teevolution Terra Pro", status: TEEVOLUTION },
  vgn: { label: "VGN F2 Master Plus", status: VGN },
  finalmouse: { label: "Finalmouse UltralightX", status: FINALMOUSE },
  "logitech-legacy": { label: "Logitech G402 (legacy DPI)", status: LOGITECH_LEGACY },
};
