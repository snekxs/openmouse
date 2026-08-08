/**
 * Optional UI policy from a driver (used by control.ts).
 * Drivers added in a PR should set only the flags they need so the shell
 * stays free of brand-specific branching.
 */
export interface MouseUiHints {
  /** Stable driver id, e.g. "egg-we". */
  family?: string;
  /** When false, core settings grid stays hidden. Default true. */
  settingsReady?: boolean;
  /**
   * DPI and polling in this status were read from the mouse rather than filled
   * in, so they are worth reporting even while `settingsReady` hides the grid.
   */
  valuesVerified?: boolean;
  /** Hide the Low LOD option. */
  hideLodLow?: boolean;
  /** Disable LOD controls while gamingSurfaceMode is "Off". */
  lodRequiresSurface?: boolean;
  /** Hide poll rates not listed in supportedPollingRates. */
  hideUnsupportedPollingRates?: boolean;
  /** Show the polling rate the mouse reports, but refuse to stage a change. */
  pollingReadOnly?: boolean;
  /** Hide Motion Sync / angle snap / ripple card. */
  hideProcessingCard?: boolean;
  /** Hide the receiver signal-strength card when no command reports link quality. */
  hideSignalCard?: boolean;
  /**
   * Render the advanced settings section for a driver outside the brands that
   * open it by default. The section is the only place the signal, debounce,
   * sleep and processing cards live, so a driver that fills one of them stays
   * invisible without this. Set it only when a card in there will show.
   */
  showAdvancedSection?: boolean;
  /** Always show battery column (even wired with null %). */
  forceShowBattery?: boolean;
  /** Override the polling-rate footnote. */
  pollingNote?: string;
  /** Sidebar name before first status read. */
  defaultDisplayName?: string;
}

export interface MouseStatus {
  brand: "Logitech" | "Pulsar" | "Endgame Gear" | "WLMouse" | "Lamzu" | "Orbital" | "Razer" | "Teevolution" | "ATK" | "VGN" | "Finalmouse" | "Keychron";
  name: string;
  /** Driver-supplied UI policy (optional; keeps control.ts brand-agnostic). */
  ui?: MouseUiHints;
  batteryPercent: number | null;
  batteryVoltageMv?: number | null;
  batteryState: "Charging" | "Charging slowly" | "Almost full" | "Full" | "Discharging" | "Unknown";
  dpi: number;
  dpiY?: number;
  supportsSeparateDpiAxes?: boolean;
  /** Hall-effect primary-button tuning exposed by Logitech's 0x1B0C HID++ feature. */
  analogButtonTuning?: {
    maxActuation: number;
    maxRapidTrigger: number;
    maxHaptics: number;
    buttons: Array<{ actuation: number; rapidTrigger: number; haptics: number }>;
  };
  pollingRateHz: number;
  supportedPollingRates?: number[];
  activeProfile: number | null;
  deviceMode?: "Onboard" | "Host" | "Unknown";
  unitId?: string | null;
  modelId?: string | null;
  transportIds?: Record<string, string>;
  connectionType?: "Wired" | "Wireless";
  connectionDetail?: string;
  dongleLedEnabled?: boolean | null;
  finalmouseDongleLedMode?: number | null;
  finalmouseTournamentScrollMode?: number | null;
  finalmouseTournamentScrollTimeoutMs?: number | null;
  signalStrength?: number | null;
  motionSync?: boolean | null;
  debounceMs?: number | null;
  sleepTimeout?: number | null;
  angleSnapping?: boolean | null;
  rippleControl?: boolean | null;
  slamclickFilter?: boolean | null;
  motionJitterFilter?: boolean | null;
  leftSpdtMode?: "Off" | "GX Safe" | "GX Speed" | null;
  rightSpdtMode?: "Off" | "GX Safe" | "GX Speed" | null;
  eggCpiLevels?: number;
  eggCpiStages?: Array<{ x: number; y: number }>;
  eggPollingDivider?: number;
  eggMulticlickFilters?: number[];
  eggButtonMappings?: string[];
  performanceMode?: boolean | null;
  angleTuning?: number | null;
  wheelAcceleration?: boolean | null;
  lowBatteryWarning?: number | null;
  remoteLedMode1?: number | null;
  remoteLedMode2?: number | null;
  dpiLedMode?: number | null;
  dpiLedBrightness?: number | null;
  dpiLedSpeed?: number | null;
  liftOffDistance: "Low" | "Medium" | "High" | null;
  /** Explicit LOD choices when a mouse does not support all three common levels. */
  supportedLiftOffDistances?: Array<NonNullable<MouseStatus["liftOffDistance"]>>;
  /**
   * Separate cut-off and re-engage heights, where a mouse offers them instead
   * of the single three-stop `liftOffDistance`. Only drivers that have verified
   * it on hardware populate this; everywhere else it stays undefined and the
   * control does not appear.
   *
   * `enabled` is which of the two the mouse is actually using, and may be null
   * when a driver cannot establish it.
   */
  asymmetricLiftOff?: {
    enabled: boolean | null;
    liftOff: number;
    landing: number;
    liftOffRange: { min: number; max: number };
    landingRange: { min: number; max: number };
  } | null;
  /** Logitech onboard profile format (HID++ 0x8100), which selects the layout. */
  onboardProfileFormat?: {
    id: number;
    name: string;
    base: string;
    supported: boolean;
    /** False when the layout comes from vendor code but was never confirmed on hardware. */
    verified: boolean;
  } | null;
  gamingSurfaceMode?: "On" | "Off" | "Auto" | null;
  lightforceSwitchMode?: "Hybrid" | "Optical" | null;
  firmware: string[];
}
