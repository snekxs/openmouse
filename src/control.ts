import "./control.css";
import { estimateBatteryTime, saveBatterySample, type BatteryMode } from "./battery-history";
import { unsupportedNotice, unsupportedTemplate } from "./browser-support";
import { controlTemplate } from "./control-template";
import { bindControlEvents } from "./control-events";
import {
  clientSupportScore,
  createSupportedClient,
  describeHidDevice,
  listLogicalDevices,
  type PulsarClient,
  type SupportedClient,
} from "./device-clients";
import { renderDeviceSidebar as renderDeviceSidebarView } from "./device-sidebar";
import { closestDpiOption, dpiPresetValues } from "./dpi-presets";
import { renderEggControls } from "./devices/endgame/egg-controls-view";
import { hidTraffic, isMark, markHidActivity, startHidCapture, type HidTrafficEntry } from "./hid-diagnostics";
import {
  clearPendingChanges,
  dropPendingChange,
  hasPendingChanges,
  isPendingChange,
  onPendingChanges,
  pendingChangeBatches,
  pendingChanges,
  stagePendingChange,
  withPendingChanges,
  type PendingChange,
} from "./pending-changes";
import { deviceImage } from "./ui/device-images";
import { formatHex, setControlValue, setSelected, setText, setToggleValue } from "./ui/dom";
import { renderPendingBar, setPendingBarBusy, setPendingBarStatus } from "./ui/pending-bar";
import {
  DEFAULT_INTERFACE_PREFERENCES,
  loadInterfacePreferences,
  saveInterfacePreferences as persistInterfacePreferences,
  type InterfaceDensity,
  type InterfaceTheme,
} from "./interface-preferences";
import {
  EGG_BUTTON_NAMES,
  EggOp1HidClient,
  type EggButtonIndex,
  type EggButtonMapping,
  type EggSpdtMode,
} from "./devices/endgame/egg-op1-hid";
import {
  EGG_WE_DISPLAY_NAME,
  eggWeAuthorizedPool,
  eggWeFromAuthorized,
  eggWeIsSupported,
  eggWeOwnsDevice,
  eggWePrepare,
  eggWeResolveConnect,
  isEggWeClient,
  type EggWeHidClient,
} from "./devices/endgame/egg-we-control";
import { AtkHidClient } from "./devices/atk/hid";
import { LamzuHidClient } from "./devices/lamzu/hid";
import {
  LogitechHidppClient,
  NotAMouseError,
  PROFILE_DPI_WRITES_ENABLED,
  type OnboardProfile,
} from "./devices/logitech/hidpp";
import {
  BUNNY_HOP_LIMITS,
  PROFILE_STAGE_LOD,
  capabilitiesForFormat,
  clampDpi,
  describeOffset,
  reportRatesFor,
  validateProfileName,
  validateReportRate,
  reproduceProfile,
  stageLodLevel,
  validateBunnyHoppingMs,
  type DpiStageCapabilities,
  type DpiStagePlan,
} from "./devices/logitech/onboard-profiles";
import { escapeHtml } from "./ui/dom";
import { bindCapturePanel, setCaptureContext } from "./capture-panel";
import type { MouseStatus } from "./devices/mouse-types";
import { PulsarProHidClient } from "./devices/pulsar/pulsar-pro-hid";
import { OrbitalHidClient } from "./devices/orbital/hid";
import { RazerHidClient } from "./devices/razer/hid";
import { RazerViperMiniHidClient } from "./devices/razer/viper-mini-hid";
import { RazerViperV4ProHidClient } from "./devices/razer/viper-v4-pro-hid";
import { FinalmouseHidClient } from "./devices/finalmouse/hid";
import { TeevolutionHidClient } from "./devices/teevolution/hid";
import { teevolutionProfileForCid, teevolutionSensorModeUi } from "./devices/teevolution/protocol.ts";
import { VgnF2HidClient } from "./devices/vgn/hid";
import { SUPPORTED_HID_FILTERS } from "./devices/vendors";
import { WLMouseHidClient } from "./devices/wlmouse/hid";
import { parsePreviewMode, type PreviewMode } from "./preview-modes";

const controlApp = document.querySelector<HTMLDivElement>("#control-app");

if (!controlApp) {
  throw new Error("OpenMouse could not find the control application root.");
}

const appRoot = controlApp;

const BUILD_LABEL = `${__BUILD_CHANNEL__.toUpperCase()} · v${__APP_VERSION__}`;
const previewMode = import.meta.env.DEV
  ? parsePreviewMode(new URLSearchParams(window.location.search).get("preview"))
  : null;
const isSuperstrikePreview = previewMode === "superstrike";
/** Any `?preview=` value, so the HID listeners stay off in every preview. */
const isAnyPreview = previewMode !== null;
/** Dev-only: renders the profile list and slot editor without hardware. */
const isSlotsPreview = previewMode === "slots";
let activeClient: LogitechHidppClient | null = null;
let activePulsarClient: PulsarClient | null = null;
let activeEggClient: EggOp1HidClient | null = null;
let activeEggWeClient: EggWeHidClient | null = null;
let activeDmClient: WLMouseHidClient | LamzuHidClient | AtkHidClient | null = null;
let activeOrbitalClient: OrbitalHidClient | null = null;
let activeRazerClient: RazerHidClient | RazerViperMiniHidClient | null = null;
let activeTeevolutionClient: TeevolutionHidClient | null = null;
let activeVgnClient: VgnF2HidClient | null = null;
let activeViperClient: RazerViperV4ProHidClient | null = null;
/** Cached onboard profiles; a full read is far too slow for the refresh loop. */
let onboardProfiles: OnboardProfile[] | null = null;
let onboardProfilesLoading = false;
let lastDeviceMode: MouseStatus["deviceMode"] = "Unknown";
let lastProfileFormat: MouseStatus["onboardProfileFormat"] = null;

const ICON_ENABLED = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#9fe0b6" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z"/><circle cx="8" cy="8" r="1.8"/></svg>`;
/** Closed link: this slot's X and Y move together. */
const ICON_LINKED = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M6.5 9.5a2.6 2.6 0 0 0 3.7 0l2.3-2.3a2.6 2.6 0 0 0-3.7-3.7l-.7.7"/><path d="M9.5 6.5a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.7-.7"/></svg>`;
/** Broken link: this slot's X and Y are set separately. */
const ICON_UNLINKED = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M7 4.4l1.1-1.1a2.6 2.6 0 0 1 3.7 3.7L10.7 8.1"/><path d="M9 11.6l-1.1 1.1a2.6 2.6 0 0 1-3.7-3.7L5.3 7.9"/><path d="M2.6 2.6l10.8 10.8"/></svg>`;
/** Pencil: rename this profile. */
const ICON_RENAME = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#8b8b90" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.2 2.6a1.7 1.7 0 0 1 2.4 2.4L5.4 13.2 2 14l.8-3.4Z"/></svg>`;
/** Filled dot: the mouse is running this profile. */
const ICON_RUNNING = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#9fe0b6" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.4" fill="#9fe0b6" stroke="none"/></svg>`;
/** Hollow dot: switching the mouse to this profile. */
const ICON_ACTIVATE = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#77777c" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/></svg>`;
const ICON_DISABLED = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#77777c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8s2.2-4 6-4 6 4 6 4a10 10 0 0 1-1.7 1.9"/><path d="M6.3 11.7A7.6 7.6 0 0 0 8 12"/><path d="m2 2 12 12"/></svg>`;
let activeFinalmouseClient: FinalmouseHidClient | null = null;
let refreshTimer: number | null = null;
let refreshInProgress = false;
let dpiOptions: number[] = [];
let settingInProgress = false;

/**
 * Clears the in-progress flag and repaints the controls that read it.
 *
 * Every control rendered during a write comes out disabled, so simply clearing
 * the flag in a `finally` leaves them that way until something else happens to
 * re-render. Anything that sets the flag must end through here.
 */
function endDeviceWrite(): void {
  settingInProgress = false;
  if (latestDeviceStatus) showStatus(latestDeviceStatus);
  renderOnboardProfiles();
}
let lastRenderedStatusKey: string | null = null;
let activeDevice: HIDDevice | null = null;
/** Art whose file did not load, so repaints stop re-requesting it. */
const unreachableImages = new Set<string>();
const deviceStatuses = new Map<HIDDevice, MouseStatus>();
let latestDiagnosticsSnapshot: Record<string, unknown> | null = null;
let latestDiagnosticStatus: MouseStatus | null = null;
// Last status read from the device, before staged changes are previewed over it
let latestDeviceStatus: MouseStatus | null = null;
let lastDiagnosticCommand: string | null = null;
let lastDiagnosticError: string | null = null;
/** Prevents overlapping reconnect loops from leaving the UI stuck on "Reconnecting…". */
let reconnectInFlight = false;
let sidebarHidden = false;

async function statusAfterWrite(client: SupportedClient): Promise<MouseStatus> {
  return activeDmClient && client === activeDmClient
    ? await activeDmClient.readStatus(true)
    : await client.readStatus();
}

function activeSettingsClient(): SupportedClient | null {
  return activeClient ?? activePulsarClient ?? activeEggClient ?? activeEggWeClient ?? activeFinalmouseClient ?? activeDmClient ?? activeOrbitalClient ?? activeRazerClient ?? activeViperClient ?? activeTeevolutionClient ?? activeVgnClient;
}

function hasActiveClient(): boolean {
  return activeSettingsClient() !== null;
}

function requireSettingsClient(): SupportedClient {
  const client = activeSettingsClient();
  if (!client) throw new Error("The mouse is no longer connected.");
  return client;
}

/**
 * Drivers may confirm one write before another, so each setting is checked on
 * its own. A driver that hides the settings grid never reaches these, which
 * makes this a guard rather than a path the interface offers.
 */
function requireClientMethod<K extends string>(
  method: K,
  setting: string,
): Extract<SupportedClient, Record<K, unknown>> {
  const client = requireSettingsClient();
  if (!(method in client)) throw new Error(`This mouse does not support changing ${setting} yet.`);
  // `in` does not narrow through a generic key, so the union is filtered here.
  return client as Extract<SupportedClient, Record<K, unknown>>;
}

/**
 * Records a settings change without touching the device. The control repaints
 * from the previewed status so it shows the staged value, and the unsaved-changes
 * bar offers to flash or discard it.
 */
function stageChange(change: PendingChange): void {
  if (settingInProgress) {
    setText("#read-status", "Wait for the current flash to finish.");
    return;
  }
  if (matchesDeviceStatus(change)) {
    // The control was moved back to the value the mouse already holds, so there
    // is nothing left to flash for this setting.
    dropPendingChange(change.key);
    if (latestDeviceStatus) showStatus(latestDeviceStatus);
    setText("#read-status", `${change.label} already matches the mouse.`);
    return;
  }
  stagePendingChange(change);
  if (latestDeviceStatus) showStatus(latestDeviceStatus);
  setText("#read-status", `${change.label} staged. Flash to write it to the mouse.`);
}

// True when previewing the change over the device status would leave it unchanged
function matchesDeviceStatus(change: PendingChange): boolean {
  if (!latestDeviceStatus) return false;
  // Without a preview the setting is not in MouseStatus, so there is nothing to
  // compare and the caller has to decide for itself whether the value changed.
  if (!change.preview) return false;
  const preview = structuredClone(latestDeviceStatus);
  change.preview(preview);
  return JSON.stringify(preview) === JSON.stringify(latestDeviceStatus);
}

function revertPendingChanges(): void {
  if (settingInProgress || !hasPendingChanges()) return;
  clearPendingChanges();
  if (latestDeviceStatus) showStatus(latestDeviceStatus);
  setText("#read-status", "Discarded the staged changes.");
}

// Held before each write so the flashing state is legible rather than a flicker.
const FLASH_STEP_DELAY_MS = 420;
// Held after the last write, so the bar does not vanish the instant it lands.
const FLASH_SETTLE_MS = 320;

async function flashPause(milliseconds = FLASH_STEP_DELAY_MS): Promise<void> {
  // The pause only exists to show the animation, so skip it when motion is reduced.
  if (interfacePreferences.reducedMotion) return;
  await wait(milliseconds);
}

async function flashPendingChanges(): Promise<void> {
  const batches = pendingChangeBatches();
  if (batches.length === 0 || settingInProgress || refreshInProgress) return;
  settingInProgress = true;
  setPendingBarBusy(true);
  let written = 0;
  let failure: string | null = null;
  try {
    for (const batch of batches) {
      // Grouped settings share a byte or sector, so the last change staged into
      // the group carries the combined write and the rest ride along with it.
      const writer = batch[batch.length - 1];
      if (!writer) continue;
      setPendingBarStatus(`${writer.progress} (${written + 1} of ${batches.length})`);
      setText("#read-status", writer.progress);
      // Let the step render before the write blocks on HID traffic.
      await flashPause();
      for (const change of batch) recordDiagnosticCommand(change.command);
      await writer.apply();
      // Drop each change as it lands, so a later failure leaves only the
      // unwritten ones staged and the user can retry just those.
      for (const change of batch) dropPendingChange(change.key);
      written += batch.length;
    }
  } catch (error) {
    recordDiagnosticError(error, "Unable to flash the staged changes.");
    failure = error instanceof Error ? error.message : "Unable to flash the staged changes.";
  }
  await flashPause(FLASH_SETTLE_MS);
  const client = activeSettingsClient();
  const status = client ? await statusAfterWrite(client).catch(() => null) : null;
  // statusAfterWrite may have failed, so re-render either way rather than
  // leaving the controls disabled from the write.
  if (status) latestDeviceStatus = status;
  endDeviceWrite();
  setPendingBarBusy(false);
  if (failure) {
    setText("#read-status", failure);
    setPendingBarStatus(failure);
    return;
  }
  setText("#read-status", written === 1
    ? "Flashed 1 change to the mouse."
    : `Flashed ${written} changes to the mouse.`);
}

let interfacePreferences = loadInterfacePreferences(localStorage);

function saveInterfacePreferences(): void {
  persistInterfacePreferences(localStorage, interfacePreferences);
  applyInterfacePreferences();
}

function applyInterfacePreferences(): void {
  const shell = document.querySelector<HTMLElement>(".control-shell");
  if (!shell) return;
  shell.classList.toggle("density-comfortable", interfacePreferences.density === "Comfortable");
  shell.classList.toggle("reduce-interface-motion", interfacePreferences.reducedMotion);
  shell.classList.toggle("sidebar-hidden", sidebarHidden);
  const menuToggle = document.querySelector<HTMLButtonElement>("#sidebar-menu-toggle");
  if (menuToggle) menuToggle.setAttribute("aria-pressed", String(!sidebarHidden));
  shell.dataset.interfaceTheme = interfacePreferences.theme.toLowerCase();
  document.querySelectorAll<HTMLDetailsElement>(".egg-collapsible, .egg-experimental").forEach((details) => {
    details.open = interfacePreferences.expandSections;
  });
  const experimental = document.querySelector<HTMLElement>("#egg-polling-settings");
  if (experimental && activeEggClient && !activeEggWeClient) {
    experimental.style.display = interfacePreferences.showExperimental ? "block" : "none";
  }
}

function renderStagedMarkers(): void {
  document.querySelectorAll<HTMLElement>("[data-pending-key]").forEach((element) => {
    const staged = element.dataset.pendingKey!.split(" ").some(isPendingChange);
    element.classList.toggle("is-staged", staged);
  });
}

function renderControl(): void {
  startHidCapture();
  appRoot.innerHTML = controlTemplate(BUILD_LABEL);
  document.querySelector<HTMLDetailsElement>("#device-debug-details details")?.addEventListener("toggle", () => {
    renderDeviceDiagnostics(latestDiagnosticStatus);
  });

  bindCapturePanel();
  bindControlEvents({
    connect,
    selectAuthorizedDevice,
    openInterfaceSettings,
    closeInterfaceSettings,
    setInterfaceDensity: (value) => {
      interfacePreferences.density = value as InterfaceDensity;
      saveInterfacePreferences();
    },
    setInterfaceTheme: (value) => {
      interfacePreferences.theme = value as InterfaceTheme;
      saveInterfacePreferences();
    },
    setReducedMotion: (enabled) => {
      interfacePreferences.reducedMotion = enabled;
      saveInterfacePreferences();
    },
    setExpandSections: (enabled) => {
      interfacePreferences.expandSections = enabled;
      saveInterfacePreferences();
    },
    setShowExperimental: (enabled) => {
      interfacePreferences.showExperimental = enabled;
      saveInterfacePreferences();
    },
    toggleSidebar: () => {
      sidebarHidden = !sidebarHidden;
      applyInterfacePreferences();
    },
    resetInterfacePreferences: () => {
      interfacePreferences = { ...DEFAULT_INTERFACE_PREFERENCES };
      saveInterfacePreferences();
      populateInterfaceSettings();
    },
    downloadDiagnostics,
    resetLogitechProfiles,
    chooseCustomDpi,
    sanitizeCustomDpi,
    finishCustomDpiEditing,
    applyLogitechAxisDpi,
    applyLogitechAnalogButton,
    applyLogitechAnalogButtons,
    setSuperstrikeTuningMode,
    toggleDongleLed,
    applyPulsarValue,
    toggleSleep: (enabled) => applyPulsarValue("sleep", enabled ? lastSleepSeconds : WLMOUSE_SLEEP_NEVER),
    applyLowPowerThreshold,
    applyPulsarToggle,
    applyTeevolutionSensorMode,
    applyTeevolutionPerformanceDuration,
    applyTeevolutionDpiLighting,
    applyEggFilter,
    applyEggSpdtMode,
    applyEggCpiLevels,
    updateCustomPollingPreview,
    applyEggPollingDivider,
    applyProSetting,
    applyFinalmouseSetting,
    applyPollingRate,
    applyLiftOffDistance,
    applyLiftOffMode,
    applyAsymmetricLiftOff,
    capLandingToLiftOff,
    applyGamingSurfaceMode,
    applyLightforceSwitchMode,
    flashPendingChanges,
    revertPendingChanges,
    applyOnboardMode,
    applyBunnyHopMs,
    setDpiSlotCount,
    setDpiSlotAxis,
    setDpiSlotLod,
    setDpiSlotDefault,
    setDpiAxisLock,
    selectOnboardProfile,
    openOnboardProfile: selectEditedProfile,
    renameOnboardProfile,
    toggleProfilesExpanded,
    setProfileReportRate,
    rateFromSlider,
    previewRateSlider,
    toggleOnboardProfileEnabled,
    reloadOnboardProfiles,
  });
  onPendingChanges(renderPendingBar);
  onPendingChanges(() => {
    // Flashed or reverted: stop previewing and fall back to the device value.
    if (!isPendingChange(BUNNY_HOP_KEY)) stagedBunnyHopMs = null;
    if (!isPendingChange(PROFILE_RATE_KEY)) stagedProfileRates = { wireless: null, wired: null };
    if (!isPendingChange(PROFILE_NAME_KEY)) stagedProfileName = null;
    if (!isPendingChange(DPI_SLOTS_KEY)) {
      // Flashed or reverted: reseed the editor from whatever the mouse holds.
      syncDpiSlotPlan();
      renderDpiSlots();
    }
    if (!isPendingChange("gaming-surface")) stagedGamingSurface = null;
    if (!isPendingChange("lightforce-switch-mode")) stagedLightforce = null;
    renderBunnyHop();
  });
  onPendingChanges(renderStagedMarkers);
  renderPendingBar();
  renderStagedMarkers();
  populateInterfaceSettings();
  applyInterfacePreferences();
  if (!isAnyPreview) {
    navigator.hid?.addEventListener("connect", handleHidConnect);
    navigator.hid?.addEventListener("disconnect", handleHidDisconnect);
    void reconnectAuthorizedDevice();
  }
}

/**
 * Dev-only preview of a Pro X Superlight 2 with its onboard profiles loaded,
 * so the profile list and the slot editor can be looked at without hardware.
 */
function showSlotsPreview(): void {
  dpiOptions = [100, 200, 400, 800, 1600, 3200, 6400, 8000, 16000, 32000];
  const stages = [
    { x: 800, y: 800, lod: 1 },
    { x: 1200, y: 1200, lod: 2 },
    { x: 1600, y: 1600, lod: 2 },
    { x: 2400, y: 2400, lod: 2 },
    { x: 3200, y: 3200, lod: 3 },
  ];
  onboardProfiles = [1, 2, 3].map((index) => ({
    sector: index,
    enabled: index !== 3,
    isCurrent: index === 1,
    name: `Profile ${index}`,
    dpiStages: stages.slice(0, index === 1 ? 5 : 2),
    defaultDpiIndex: 0,
    reportRateWireless: 8000,
    reportRateWired: 1000,
    angleSnapping: false,
    powerSaveTimeoutSeconds: 60,
    powerOffTimeoutSeconds: 300,
    bunnyHoppingMs: 100,
    crcValid: true,
  } as OnboardProfile));
  const status: MouseStatus = {
    brand: "Logitech",
    name: "PRO X SUPERLIGHT 2",
    ui: { family: "logitech-hidpp", lodRequiresSurface: true },
    batteryPercent: 72,
    batteryState: "Discharging",
    dpi: 800,
    dpiY: 800,
    supportsSeparateDpiAxes: true,
    pollingRateHz: 8000,
    supportedPollingRates: [125, 250, 500, 1000, 2000, 4000, 8000],
    liftOffDistance: "Low",
    supportedLiftOffDistances: ["Low", "Medium", "High"],
    onboardProfileFormat: { id: 7, name: "unnamed (v6 + bunny hopping)", base: "v6", supported: true, verified: true },
    gamingSurfaceMode: "Auto",
    lightforceSwitchMode: "Hybrid",
    activeProfile: 1,
    deviceMode: "Onboard",
    connectionType: "Wireless",
    firmware: ["MPM 39.00.B0004"],
  };
  // Stand-in client so the staging paths run without hardware. Every write
  // refuses: the preview is for looking at the UI, not pretending to flash.
  const refuse = async (): Promise<never> => {
    throw new Error("Preview mode: no mouse is connected, so nothing was written.");
  };
  activeClient = {
    writeActiveProfile: refuse,
    setBunnyHoppingMs: refuse,
    setProfileDpiStages: refuse,
    setModeStatus: refuse,
    readOnboardProfiles: async () => onboardProfiles ?? [],
  } as unknown as LogitechHidppClient;

  configureDpiControl(status.dpi);
  showStatus(status);
  renderOnboardProfiles();
  setConnectionButtons(true, "Preview mode");
  setText("#read-status", "Preview: profile format 7 with five DPI slots.");
}

/**
 * Renders one driver's fixture, or lists the available ones when the name is
 * unknown. The shell decides what to show from MouseStatus alone, so this walks
 * the same rendering path the real driver would.
 */
async function showFixturePreview(name: PreviewMode): Promise<void> {
  // Loaded on demand so the fixtures never reach a production bundle, where
  // `previewMode` is always null and none of this is reachable.
  const { PREVIEW_FIXTURES, PREVIEW_KEYS } = await import("./preview-fixtures");
  const fixture = name === "list" || name === "slots" || name === "superstrike"
    ? undefined
    : PREVIEW_FIXTURES[name];
  if (!fixture) {
    // `?preview=list` lands here on purpose: an index is more useful than an
    // error when you cannot remember the driver's key.
    const heading = document.querySelector<HTMLElement>("#empty-state-title");
    if (heading) heading.textContent = "Driver previews";
    const links = PREVIEW_KEYS
      .filter((key) => key !== "list")
      .map((key) => `<a href="?preview=${key}" style="color:var(--ui-accent)">${key}</a>`)
      .join(" · ");
    const blurb = heading?.nextElementSibling;
    if (blurb) blurb.innerHTML = `Render any supported driver without its hardware: ${links}`;
    setText("#read-status", name === "list" ? "Pick a driver preview." : `Unknown preview "${name}".`);
    return;
  }
  dpiOptions = [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 32000];
  configureDpiControl(fixture.status.dpi);
  showStatus(fixture.status);
  setConnectionButtons(true, "Preview mode");
  setText("#read-status", `Preview: ${fixture.label}. Nothing is written.`);
}

function showSuperstrikePreview(): void {
  dpiOptions = [100, 200, 400, 800, 1600, 3200, 6400, 8000, 16000, 32000];
  const status: MouseStatus = {
    brand: "Logitech",
    name: "PRO X 2 Superstrike",
    batteryPercent: 87,
    batteryVoltageMv: 3989,
    batteryState: "Discharging",
    dpi: 800,
    dpiY: 800,
    supportsSeparateDpiAxes: true,
    analogButtonTuning: {
      maxActuation: 10,
      maxRapidTrigger: 5,
      maxHaptics: 5,
      buttons: [
        { actuation: 3, rapidTrigger: 2, haptics: 3 },
        { actuation: 3, rapidTrigger: 2, haptics: 3 },
      ],
    },
    pollingRateHz: 4000,
    supportedPollingRates: [125, 250, 500, 1000, 2000, 4000, 8000],
    liftOffDistance: "High",
    supportedLiftOffDistances: ["Low", "High"],
    activeProfile: 1,
    deviceMode: "Onboard",
    modelId: "40BDC0A80000",
    transportIds: { USB: "C0A8", Wireless: "40BD" },
    connectionType: "Wireless",
    connectionDetail: "Lightspeed receiver",
    firmware: ["MPM 42.00.B0011", "BL2 73.00.B0011"],
  };
  configureDpiControl(status.dpi);
  showStatus(status);
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
    ".settings-grid input, .settings-grid button, #logitech-analog-button-settings input, #logitech-analog-button-settings .superstrike-apply-button",
  ).forEach((control) => { control.disabled = true; });
  setConnectionButtons(true, "Preview mode");
  setText("#read-status", "Current: 800 DPI · 4,000 Hz");
}

function showInterfaceSettings(open: boolean): void {
  if (open) populateInterfaceSettings();
  document.querySelector<HTMLElement>("#interface-settings-page")?.classList.toggle("is-open", open);
  document.querySelector<HTMLElement>(".control-panel")?.classList.toggle("showing-settings", open);
  document.querySelector<HTMLElement>("#interface-settings-button")?.setAttribute("aria-current", String(open));
  document.querySelector<HTMLElement>(".control-panel")?.scrollTo({ top: 0 });
}

function openInterfaceSettings(): void {
  showInterfaceSettings(true);
}

function closeInterfaceSettings(): void {
  showInterfaceSettings(false);
}

/**
 * Fills the driver-preview list in interface settings. Development only: the
 * fixtures are a dynamic import so they never reach a production bundle, and
 * the section stays hidden there.
 */
async function populatePreviewLauncher(): Promise<void> {
  const section = document.querySelector<HTMLElement>("#preview-launcher");
  const list = document.querySelector<HTMLElement>("#preview-launcher-list");
  if (!section || !list || !import.meta.env.DEV || list.childElementCount > 0) return;

  const { PREVIEW_FIXTURES } = await import("./preview-fixtures");
  const entries: Array<[string, string]> = [
    ["slots", "Logitech PRO X Superlight 2"],
    ["superstrike", "Logitech PRO X 2 Superstrike"],
    ...Object.entries(PREVIEW_FIXTURES).map(([key, fixture]) => [key, fixture.label] as [string, string]),
  ];
  list.innerHTML = entries
    .map(([key, label]) => `<a class="preview-launcher-link${previewMode === key ? " is-active" : ""}" href="?preview=${key}">${escapeHtml(label)}<small>${key}</small></a>`)
    .join("");
  section.hidden = false;
}

function populateInterfaceSettings(): void {
  void populatePreviewLauncher();
  setControlValue("#interface-density", interfacePreferences.density);
  setControlValue("#interface-theme", interfacePreferences.theme);
  const reducedMotion = document.querySelector<HTMLInputElement>("#interface-reduced-motion");
  const expandSections = document.querySelector<HTMLInputElement>("#interface-expand-sections");
  const showExperimental = document.querySelector<HTMLInputElement>("#interface-show-experimental");
  if (reducedMotion) reducedMotion.checked = interfacePreferences.reducedMotion;
  if (expandSections) expandSections.checked = interfacePreferences.expandSections;
  if (showExperimental) showExperimental.checked = interfacePreferences.showExperimental;
}

function batteryMode(state: MouseStatus["batteryState"]): BatteryMode | null {
  if (state === "Charging" || state === "Charging slowly" || state === "Almost full") return "charging";
  if (state === "Discharging") return "discharging";
  return null;
}

function batteryDetail(status: MouseStatus): string {
  const voltage = status.batteryVoltageMv ? `${(status.batteryVoltageMv / 1000).toFixed(3)} V` : null;
  const withVoltage = (detail: string): string => voltage ? `${detail} · ${voltage}` : detail;
  if (status.batteryPercent === null) return withVoltage(status.batteryState);
  if (status.batteryState === "Full") return withVoltage("Fully charged");
  const mode = batteryMode(status.batteryState);
  if (!mode) return withVoltage(status.batteryState);
  const now = Date.now();
  const samples = saveBatterySample(localStorage, status.name, status.batteryPercent, mode, now);
  const estimate = estimateBatteryTime(samples, status.batteryPercent, mode, now);
  const label = mode === "charging" ? "until full" : "remaining";
  return withVoltage(estimate ? `${status.batteryState} · ${estimate} ${label}` : status.batteryState);
}

const WLMOUSE_SLEEP_NEVER = 0xffff;
const PULSAR_SLEEP_OPTIONS: ReadonlyArray<readonly [number, string]> = [
  [1, "10 seconds"], [3, "30 seconds"], [6, "1 minute"], [12, "2 minutes"],
  [30, "5 minutes"], [60, "10 minutes"], [180, "30 minutes"],
];
let lastSleepSeconds = 60;

function sleepLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = seconds / 60;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function fillSleepOptions(options: ReadonlyArray<readonly [number, string]>): void {
  fillSelectOptions("#sleep-select", options);
}

function fillSelectOptions(selector: string, options: ReadonlyArray<readonly [number, string]>): void {
  const select = document.querySelector<HTMLSelectElement>(selector);
  const signature = options.map(([value]) => value).join(",");
  if (!select || select.dataset.options === signature) return;
  select.replaceChildren(...options.map(([value, label]) => new Option(label, String(value))));
  select.dataset.options = signature;
}

/**
 * Stepped options for a setting the mouse stores continuously. The device's own
 * value joins the list when it falls between the offered ones, because a value
 * matching no option renders the select blank; a value outside them altogether
 * returns null, since the panel can neither show it nor write it back.
 */
function selectableValues(offered: number[], current: number | null | undefined): number[] | null {
  if (current === null || current === undefined) return null;
  if (current < offered[0] || current > offered[offered.length - 1]) return null;
  return offered.includes(current) ? offered : [...offered, current].sort((left, right) => left - right);
}

function fillPercentOptions(selector: string, values: readonly number[]): void {
  const select = document.querySelector<HTMLSelectElement>(selector);
  const signature = values.join(",");
  if (!select || select.dataset.options === signature) return;
  select.replaceChildren(...values.map((value) => new Option(`${value}%`, String(value))));
  select.dataset.options = signature;
}

function fillDebounceOptions(maxMs: number): void {
  const select = document.querySelector<HTMLSelectElement>("#debounce-select");
  if (!select || select.dataset.max === String(maxMs)) return;
  select.replaceChildren(...Array.from({ length: maxMs + 1 }, (_, ms) => new Option(`${ms} ms`, String(ms))));
  select.dataset.max = String(maxMs);
}

function resetDeviceSpecificPanels(): void {
  for (const selector of [
    "#egg-filter-settings",
    "#egg-spdt-settings",
    "#egg-polling-settings",
    "#egg-cpi-settings",
    "#egg-button-settings",
    "#pulsar-pro-settings",
    "#logitech-analog-button-settings",
    "#finalmouse-settings",
  ]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.style.display = "none";
  }
  // Shown through the hidden attribute rather than display, and only ever set
  // by the driver that owns them, so nothing else would clear them on a switch.
  for (const selector of ["#low-power-settings", "#device-thumbnail"]) {
    document.querySelector<HTMLElement>(selector)?.setAttribute("hidden", "");
  }
  document.querySelector<HTMLElement>("#pulsar-advanced")?.classList.remove("egg-advanced-layout");
  for (const selector of ["#angle-snapping-toggle", "#ripple-control-toggle"] as const) {
    const row = document.querySelector<HTMLElement>(selector)?.closest<HTMLElement>(".switch-row");
    if (row) {
      row.hidden = false;
      row.style.display = "";
    }
  }
}

function diagnosticErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function recordDiagnosticCommand(command: string): void {
  lastDiagnosticCommand = command;
  markHidActivity(command);
  lastDiagnosticError = null;
  renderDeviceDiagnostics(latestDiagnosticStatus);
}

function recordDiagnosticError(error: unknown, fallback: string): void {
  lastDiagnosticError = diagnosticErrorMessage(error, fallback);
  markHidActivity(lastDiagnosticError, { failed: true });
  renderReads();
  renderDeviceDiagnostics(latestDiagnosticStatus);
}

function configureProfileCapture(status: MouseStatus | null): void {
  // Capture must be reachable from the profile section even when the separate
  // Diagnostics disclosure is closed.
  const logitechClient = status?.brand === "Logitech" ? activeClient as LogitechHidppClient | null : null;
  const formatId = status?.onboardProfileFormat?.id ?? null;
  const captureOpen = document.querySelector<HTMLButtonElement>("#capture-open");
  if (captureOpen) captureOpen.hidden = logitechClient === null || formatId === null;
  const resetButton = document.querySelector<HTMLButtonElement>("#reset-logitech-profiles");
  if (resetButton) {
    resetButton.hidden = logitechClient === null || formatId === null;
    const supported = formatId === 7;
    resetButton.disabled = settingInProgress || !supported;
    resetButton.title = supported
      ? "Permanently restore every onboard profile to Logitech defaults"
      : `Factory defaults have not been captured for profile format ${formatId ?? "unknown"}`;
  }
  setCaptureContext({
    device: activeDevice ? describeHidDevice(activeDevice) : status?.name ?? null,
    profileFormat: status?.onboardProfileFormat ? `${status.onboardProfileFormat.id} · ${status.onboardProfileFormat.name}` : null,
    profiles: logitechClient && formatId !== null
      ? {
        read: async () => (await logitechClient.readOnboardProfiles())
          .map((profile) => ({ sector: profile.sector, bytes: profile.raw })),
        readVerification: async () => {
          const verification = await logitechClient.readOnboardProfileVerification();
          return {
            ...verification,
            profiles: verification.profiles.map((profile) => ({
              sector: profile.sector,
              enabled: profile.enabled,
              isCurrent: profile.isCurrent,
              crcValid: profile.crcValid,
              decoded: {
                name: profile.name,
                dpiStages: profile.dpiStages,
                defaultDpiIndex: profile.defaultDpiIndex,
                reportRateWireless: profile.reportRateWireless,
                reportRateWired: profile.reportRateWired,
                angleSnapping: profile.angleSnapping,
                powerSaveTimeoutSeconds: profile.powerSaveTimeoutSeconds,
                powerOffTimeoutSeconds: profile.powerOffTimeoutSeconds,
                bunnyHoppingMs: profile.bunnyHoppingMs,
              },
              bytes: profile.raw,
            })),
          };
        },
        describeOffset: (offset) => describeOffset(formatId, offset),
        reproduce: (before, after) => reproduceProfile(before, after, formatId),
      }
      : null,
  });
}

function renderDeviceDiagnostics(status: MouseStatus | null): void {
  configureProfileCapture(status);
  const output = document.querySelector<HTMLPreElement>("#device-debug-snapshot");
  if (!output || !diagnosticsOpen()) return;

  const serializeCollection = (collection: HIDCollectionInfo): object => ({
    usagePage: `0x${formatHex(collection.usagePage, 4)}`,
    usage: `0x${formatHex(collection.usage, 4)}`,
    inputReports: collection.inputReports.map((report) => `0x${formatHex(report.reportId)}`),
    outputReports: collection.outputReports.map((report) => `0x${formatHex(report.reportId)}`),
    featureReports: collection.featureReports.map((report) => `0x${formatHex(report.reportId)}`),
    children: collection.children.map(serializeCollection),
  });

  const device = activeDevice;
  if (!device && !status && !lastDiagnosticError) {
    output.textContent = "Connect a mouse to collect diagnostics.";
    return;
  }
  const driver = status
    ? (status.ui?.family ? `${status.brand} · ${status.ui.family}` : status.brand)
    : "No driver read this device";
  const overview = document.querySelector<HTMLElement>("#device-debug-overview");
  if (overview) {
    const items: string[][] = [
      ["Driver", driver],
      ["VID / PID", device ? `0x${formatHex(device.vendorId, 4)} / 0x${formatHex(device.productId, 4)}` : "Not reported"],
      ["Build", BUILD_LABEL],
      ["Last command", lastDiagnosticCommand ?? "None"],
    ];
    if (lastDiagnosticError) items.push(["Last error", lastDiagnosticError]);
    overview.replaceChildren(...items.map(([label, value]) => {
      const item = document.createElement("div");
      const heading = document.createElement("small");
      const content = document.createElement("span");
      heading.textContent = label.toUpperCase();
      content.textContent = value;
      item.append(heading, content);
      return item;
    }));
  }
  const snapshot = {
    app: {
      build: BUILD_LABEL,
      userAgent: navigator.userAgent,
    },
    driver: {
      brand: status?.brand ?? null,
      family: status?.ui?.family ?? null,
      readOk: status !== null,
      description: device ? describeHidDevice(device) : null,
    },
    webhid: device ? {
      productName: device.productName || null,
      vendorId: `0x${formatHex(device.vendorId, 4)}`,
      productId: `0x${formatHex(device.productId, 4)}`,
      opened: device.opened,
      collections: device.collections.map(serializeCollection),
    } : null,
    status: status ? { ...status, unitId: status.unitId ? "(masked)" : status.unitId } : null,
    diagnostics: {
      lastCommand: lastDiagnosticCommand,
      lastError: lastDiagnosticError,
    },
  };
  latestDiagnosticsSnapshot = snapshot;
  output.textContent = JSON.stringify(snapshot, null, 2);
  const downloadButton = document.querySelector<HTMLButtonElement>("#download-diagnostics");
  if (downloadButton) downloadButton.disabled = false;
  renderReads();
}

function maskBytes(bytes: Uint8Array): string {
  const hide = new Set<number>();
  let run = -1;
  for (let i = 0; i <= bytes.length; i += 1) {
    const printable = i < bytes.length && bytes[i] >= 0x20 && bytes[i] <= 0x7e;
    if (printable && run < 0) run = i;
    if (!printable && run >= 0) {
      if (i - run >= 6) for (let j = run; j < i; j += 1) hide.add(j);
      run = -1;
    }
  }
  let end = bytes.length;
  while (end > 8 && bytes[end - 1] === 0) end -= 1;
  const shown = Array.from(bytes.slice(0, end), (byte, i) => hide.has(i) ? "**" : formatHex(byte)).join(" ");
  return end < bytes.length ? `${shown}  (${bytes.length}B)` : shown;
}

function diagnosticsOpen(): boolean {
  return document.querySelector<HTMLDetailsElement>("#device-debug-details details")?.open === true;
}

function renderReads(): void {
  const target = document.querySelector<HTMLPreElement>("#device-debug-reads");
  if (target && diagnosticsOpen()) target.textContent = renderReadTable();
}

const BACKGROUND = "Background refresh";

function renderReadTable(): string {
  const rows = hidTraffic(activeDevice);
  if (!rows.length) return "Nothing yet. Change a setting to see what gets sent.";

  const base = rows[0].at;
  const stamp = (at: number): string => `t+${((at - base) / 1000).toFixed(1)}s`.padStart(9);

  const groups: { label: string; detail: string | null; failed: boolean; at: number; items: HidTrafficEntry[] }[] = [];
  for (const row of rows) {
    if (isMark(row)) groups.push({ label: row.label, detail: row.detail, failed: row.failed, at: row.at, items: [] });
    else {
      if (!groups.length) groups.push({ label: BACKGROUND, detail: null, failed: false, at: row.at, items: [] });
      groups[groups.length - 1].items.push(row);
    }
  }

  const interesting = groups.filter((group) => group.label !== BACKGROUND || group.items.some((item) => item.error));
  const shown = interesting.slice(-15);
  const lines: string[] = [];
  const hidden = groups.length - shown.length;
  if (hidden > 0) lines.push(`… ${hidden} earlier or background entries hidden`);

  for (const group of shown) {
    lines.push(`${stamp(group.at)} ${group.failed ? "!" : ">"} ${group.label}`);
    if (group.detail) lines.push(`${stamp(group.at)}     ${group.detail}`);
    for (const row of group.items) {
      const outcome = row.error ? `FAILED ${row.error}` : maskBytes(row.bytes);
      lines.push(`${stamp(row.at)}     ${row.dir.padEnd(4)} id ${row.reportId} ${String(row.ms).padStart(4)}ms  ${outcome}`);
    }
  }
  return lines.join("\n");
}

function diagnosticsLog(): object[] {
  const rows = hidTraffic(activeDevice);
  if (rows.length === 0) return [];
  const base = rows[0].at;
  const seconds = (at: number): number => Number(((at - base) / 1000).toFixed(3));
  return rows.map((row) => isMark(row)
    ? { at: seconds(row.at), kind: "event", label: row.label, detail: row.detail, failed: row.failed }
    : {
      at: seconds(row.at),
      kind: "report",
      dir: row.dir,
      reportId: row.reportId,
      ms: row.ms,
      bytes: maskBytes(row.bytes),
      error: row.error,
    });
}

function diagnosticsFileName(): string {
  const device = activeDevice;
  const ids = device ? `${formatHex(device.vendorId, 4)}-${formatHex(device.productId, 4)}` : "no-device";
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  return `openmouse-${ids}-${stamp}.json`.toLowerCase();
}

function downloadDiagnostics(): void {
  const status = document.querySelector<HTMLElement>("#diagnostic-download-status");
  if (!latestDiagnosticsSnapshot) return;
  const name = diagnosticsFileName();
  const rows = hidTraffic(activeDevice);
  const report = JSON.stringify({
    ...latestDiagnosticsSnapshot,
    logStart: rows.length > 0 ? new Date(performance.timeOrigin + rows[0].at).toISOString() : null,
    log: diagnosticsLog(),
  }, null, 2);
  const url = URL.createObjectURL(new Blob([report], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  if (status) status.textContent = `Saved ${name}`;
}

function showStatus(deviceStatus: MouseStatus): void {
  latestDeviceStatus = deviceStatus;
  latestDiagnosticStatus = deviceStatus;
  lastRenderedStatusKey = JSON.stringify(deviceStatus);
  // Controls render from the previewed status so staged changes survive a
  // background refresh; diagnostics and the sidebar keep the device's own values.
  const status = withPendingChanges(deviceStatus);
  // Driver UI hints (e.g. status.ui.family === "egg-we") avoid brand-specific imports.
  const ui = status.ui;
  const isEgg8k = activeEggClient !== null
    || (status.brand === "Endgame Gear" && Array.isArray(status.eggCpiStages));
  const isEggWe = ui?.family === "egg-we" || activeEggWeClient !== null;
  const isEgg = isEgg8k || isEggWe;
  const isDmFamily = ui?.family === "wlmouse" || ui?.family === "lamzu" || ui?.family === "atk" || activeDmClient !== null;
  const isViper = ui?.family === "razer-viper-v4-pro" || activeViperClient !== null;
  const isRazer = ui?.family === "razer" || activeRazerClient !== null;
  const isFinalmouse = ui?.family === "finalmouse-ulx" || activeFinalmouseClient !== null;
  const settingsPending = ui?.settingsReady === false;
  const isWired = status.connectionType === "Wired";
  // Always clear device-specific panels first. A status read from the previous
  // mouse may have left these visible when WebHID switches devices.
  resetDeviceSpecificPanels();
  const batterySummary = document.querySelector<HTMLElement>("#battery-summary");
  if (batterySummary) {
    // 8K is wired-only (no battery). Drivers may force the column via ui.forceShowBattery.
    const hideBattery = isEgg8k
      || (isWired && !ui?.forceShowBattery && status.batteryPercent === null);
    batterySummary.hidden = hideBattery;
    batterySummary.style.display = hideBattery ? "none" : "flex";
  }
  const overview = document.querySelector<HTMLElement>(".device-overview");
  if (overview) {
    const showBatteryColumn = !isEgg8k
      && (ui?.forceShowBattery || !isWired || status.batteryPercent !== null);
    const stats = showBatteryColumn ? 3 : 2;
    const artwork = deviceImage(activeDevice);
    const thumbnail = document.querySelector<HTMLElement>("#device-thumbnail");
    const thumbnailImage = document.querySelector<HTMLImageElement>("#device-thumbnail-image");
    // Art is optional for every device, so the stat columns stay the layout and
    // the thumbnail only ever prepends a column to it.
    const showArtwork = artwork !== null && !unreachableImages.has(artwork);
    const statColumns = `repeat(${stats}, 1fr)`;
    if (thumbnail) thumbnail.hidden = !showArtwork;
    overview.style.gridTemplateColumns = showArtwork ? `112px ${statColumns}` : statColumns;
    if (thumbnailImage && artwork && showArtwork && thumbnailImage.dataset.source !== artwork) {
      thumbnailImage.dataset.source = artwork;
      // A file that never shipped alongside its mapping would otherwise leave an
      // empty column. Recorded so later repaints stop asking for it.
      thumbnailImage.onerror = () => {
        unreachableImages.add(artwork);
        thumbnail?.setAttribute("hidden", "");
        overview.style.gridTemplateColumns = statColumns;
      };
      thumbnailImage.src = artwork;
    }
    if (thumbnailImage) thumbnailImage.alt = status.name;
  }
  setText("#polling-note", ui?.pollingNote
    ?? (isEgg8k
      ? "Higher rates update cursor movement more often and increase CPU/USB processing load."
      : "Higher rates update cursor movement more often, but use more battery."));
  const pollingCard = document.querySelector<HTMLElement>("#polling-card");
  if (pollingCard) {
    pollingCard.hidden = false;
    pollingCard.style.display = "";
  }
  for (const selector of ["#signal-settings", "#sleep-settings"]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.hidden = isEgg || isFinalmouse;
  }
  const debounceSettings = document.querySelector<HTMLElement>("#debounce-settings");
  if (debounceSettings) {
    const showDebounce = status.debounceMs !== null && status.debounceMs !== undefined
      && (status.brand === "Pulsar" || status.brand === "Teevolution" || status.brand === "VGN" || isDmFamily);
    debounceSettings.hidden = !showDebounce;
  }
  const signalSettings = document.querySelector<HTMLElement>("#signal-settings");
  if (signalSettings) signalSettings.hidden = isEgg || isDmFamily || isFinalmouse || ui?.hideSignalCard === true;
  const performanceModeSetting = document.querySelector<HTMLElement>("#performance-mode-setting");
  if (performanceModeSetting) {
    const hidePerformanceMode = isEgg || isDmFamily || isFinalmouse;
    performanceModeSetting.hidden = hidePerformanceMode;
    performanceModeSetting.style.display = hidePerformanceMode ? "none" : "flex";
  }
  const processingCard = document.querySelector<HTMLElement>("#motion-sync-toggle")?.closest<HTMLElement>(".setting-card");
  if (processingCard && processingCard.id !== "egg-filter-settings") {
    processingCard.style.display = ui?.hideProcessingCard ? "none" : "";
  }
  const battery = status.batteryPercent === null ? "—" : `${status.batteryPercent}%`;
  const dpiOutputField = document.querySelector<HTMLInputElement>("#dpi-output");
  if (dpiOutputField?.readOnly) dpiOutputField.value = `${status.dpi.toLocaleString()} DPI`;
  setText("#battery-value", battery);
  setText("#battery-detail", batteryDetail(status));
  setText("#firmware-value", status.firmware[0] ?? "—");
  setText("#firmware-detail", status.firmware.length > 1
    ? status.firmware.slice(1).join(" · ")
    : status.firmware.length === 1
      ? "Firmware reported by mouse"
      : "Not reported");
  setText("#connection-value", status.connectionType ?? "Wireless");
  setText("#connection-detail", status.connectionDetail
    ?? (status.activeProfile ? `2.4 GHz · Profile ${status.activeProfile}` : "2.4 GHz receiver"));
  const dongleLedButton = document.querySelector<HTMLButtonElement>("#dongle-led-toggle");
  if (dongleLedButton) {
    const supported = status.brand === "Pulsar" && status.dongleLedEnabled !== null && status.dongleLedEnabled !== undefined;
    dongleLedButton.hidden = !supported;
    dongleLedButton.disabled = !supported;
    dongleLedButton.dataset.enabled = status.dongleLedEnabled ? "true" : "false";
    dongleLedButton.textContent = status.dongleLedEnabled ? "Receiver LED: On" : "Receiver LED: Off";
  }
  const advanced = document.querySelector<HTMLElement>("#pulsar-advanced");
  if (advanced) {
    const showAdvanced = status.brand === "Pulsar" || status.brand === "Teevolution" || status.brand === "VGN" || isEgg8k || isDmFamily || isFinalmouse
      || ui?.showAdvancedSection === true;
    advanced.style.display = showAdvanced ? "grid" : "none";
    advanced.classList.toggle("egg-advanced-layout", isEgg8k);
  }
  const settingsGrid = document.querySelector<HTMLElement>(".settings-grid.device-data");
  if (settingsGrid) settingsGrid.style.display = settingsPending ? "none" : "";

  const sleepToggle = document.querySelector<HTMLElement>("#sleep-toggle");
  if (sleepToggle) sleepToggle.hidden = !isDmFamily || !activeDmClient?.canDisableSleep;
  if (isDmFamily && activeDmClient) {
    const seconds = activeDmClient.getSleepOptions();
    fillSleepOptions(seconds.map((value) => [value, sleepLabel(value)] as const));
    fillDebounceOptions(activeDmClient.getDebounceMaxMs());
    // Read from the device value so toggling sleep back on restores a real timeout.
    lastSleepSeconds = deviceStatus.sleepTimeout ?? seconds[0] ?? 60;
    setToggleValue("#sleep-toggle", status.sleepTimeout !== null && status.sleepTimeout !== undefined);
    setControlValue("#debounce-select", status.debounceMs);
    setControlValue("#sleep-select", status.sleepTimeout);
    setToggleValue("#motion-sync-toggle", status.motionSync);
    setToggleValue("#angle-snapping-toggle", status.angleSnapping);
    setToggleValue("#ripple-control-toggle", status.rippleControl);
  }
  // Sleep and low-power commands are supported by the Viper V3 protocol,
  // but not by the legacy Viper Mini driver.
  if (isRazer && activeRazerClient instanceof RazerHidClient) {
    const seconds = selectableValues(activeRazerClient.getSleepOptions(), status.sleepTimeout);
    const sleepSettings = document.querySelector<HTMLElement>("#sleep-settings");
    if (sleepSettings) sleepSettings.hidden = seconds === null;
    if (seconds) {
      // Seconds throughout: sleepLabel, the staged command text and
      // setSleepTimeout all read this as seconds, which Pulsar's options are not.
      fillSleepOptions(seconds.map((value) => [value, sleepLabel(value)] as const));
      setControlValue("#sleep-select", status.sleepTimeout);
    }
    const percentages = selectableValues(activeRazerClient.getLowPowerOptions(), status.lowBatteryWarning);
    const lowPowerSettings = document.querySelector<HTMLElement>("#low-power-settings");
    if (lowPowerSettings) lowPowerSettings.hidden = percentages === null;
    if (percentages) {
      fillPercentOptions("#low-power-select", percentages);
      setControlValue("#low-power-select", status.lowBatteryWarning);
      // The threshold still reads at any rate; the vendor software just refuses
      // to arm it above this one, so the control is disabled rather than hidden.
      const ceiling = activeRazerClient.getLowPowerPollingCeiling();
      const tooFast = status.pollingRateHz > ceiling;
      const lowPowerSelect = document.querySelector<HTMLSelectElement>("#low-power-select");
      if (lowPowerSelect) lowPowerSelect.disabled = tooFast;
      setText("#low-power-note", tooFast
        ? `Unavailable above ${ceiling.toLocaleString()} Hz. Lower the polling rate to change it.`
        : "Slows the mouse down to save battery below this level.");
    }
  }
  if (status.brand === "Pulsar" || status.brand === "Teevolution" || status.brand === "VGN" || status.brand === "Endgame Gear" || isViper || isFinalmouse) {
    fillSleepOptions(PULSAR_SLEEP_OPTIONS);
    fillDebounceOptions(20);
    const strength = status.signalStrength;
    setText("#signal-output", strength === null || strength === undefined ? "—" : `${strength}/4`);
    setText("#signal-detail", strength === null || strength === undefined
      ? "Receiver signal is unavailable."
      : ["Very weak", "Weak", "Fair", "Good", "Excellent"][strength] ?? `Level ${strength}`);
    setControlValue("#debounce-select", status.debounceMs);
    setControlValue("#sleep-select", status.sleepTimeout);
    setToggleValue("#motion-sync-toggle", status.motionSync);
    setToggleValue("#angle-snapping-toggle", status.angleSnapping);
    setToggleValue("#ripple-control-toggle", status.rippleControl);
    setToggleValue("#performance-mode-toggle", status.performanceMode);
    const isTeevolution = status.brand === "Teevolution";
    const performanceModeLabel = document.querySelector<HTMLElement>("#performance-mode-label");
    if (performanceModeLabel) performanceModeLabel.textContent = isTeevolution ? "Highest performance" : "Performance mode";
    const teevolutionSensorRow = document.querySelector<HTMLElement>("#teevolution-sensor-mode-row");
    const teevolutionDurationRow = document.querySelector<HTMLElement>("#teevolution-performance-duration-row");
    const teevolutionDpiLighting = document.querySelector<HTMLElement>("#teevolution-dpi-lighting");
    if (teevolutionSensorRow) teevolutionSensorRow.hidden = !isTeevolution;
    if (teevolutionDurationRow) teevolutionDurationRow.hidden = !isTeevolution;
    if (teevolutionDpiLighting) teevolutionDpiLighting.hidden = !isTeevolution;
    const teevolutionProfile = activeTeevolutionClient?.getModelProfile() ?? teevolutionProfileForCid(14);
    if (isTeevolution && status.connectionType && teevolutionProfile) {
      const profile = teevolutionProfile;
      fillSleepOptions(profile.sleepOptions.map((value) => [value, sleepLabel(value * 10)] as const));
      fillDebounceOptions(profile.debounce.max);
      const performanceDurations = profile.performanceTimeOptions
        .map((value) => [value, sleepLabel(value * 10)] as const);
      fillSelectOptions("#teevolution-performance-duration", performanceDurations);
      const sensorUi = teevolutionSensorModeUi({
        storedMode: status.sensorModeStored ?? 0,
        pollingRateHz: status.pollingRateHz,
        connection: status.connectionType,
      });
      const sensorSelect = document.querySelector<HTMLSelectElement>("#teevolution-sensor-mode");
      if (sensorSelect) {
        for (const option of sensorSelect.options) {
          option.hidden = option.value !== "Ultra"
            && !profile.sensorModes.includes(option.value as "Eco" | "High");
        }
        sensorSelect.value = sensorUi.mode;
        sensorSelect.disabled = !sensorUi.editable;
      }
      setText("#teevolution-sensor-mode-note", sensorUi.editable
        ? "Eco saves power at 125–1000 Hz wireless. High uses the performance sensor profile."
        : `Locked to ${sensorUi.mode} at ${status.pollingRateHz.toLocaleString()} Hz ${status.connectionType.toLowerCase()}.`);
      const durationSelect = document.querySelector<HTMLSelectElement>("#teevolution-performance-duration");
      if (durationSelect) {
        durationSelect.disabled = status.performanceMode !== true;
        setControlValue("#teevolution-performance-duration", status.performanceDuration);
      }
      const lightMode = status.dpiLedMode ?? 0;
      const lightModeSelect = document.querySelector<HTMLSelectElement>("#teevolution-dpi-light-mode");
      if (lightModeSelect) {
        for (const option of lightModeSelect.options) {
          option.hidden = !profile.dpiLighting.modes.includes(Number(option.value) as 0 | 1 | 2);
        }
      }
      setControlValue("#teevolution-dpi-light-mode", lightMode);
      setControlValue("#teevolution-dpi-light-brightness", status.dpiLedBrightness);
      setControlValue("#teevolution-dpi-light-speed", status.dpiLedSpeed);
      setText("#teevolution-dpi-light-brightness-output", status.dpiLedBrightness == null ? "—" : String(status.dpiLedBrightness));
      setText("#teevolution-dpi-light-speed-output", status.dpiLedSpeed == null ? "—" : String(status.dpiLedSpeed));
      const brightness = document.querySelector<HTMLInputElement>("#teevolution-dpi-light-brightness");
      const speed = document.querySelector<HTMLInputElement>("#teevolution-dpi-light-speed");
      if (brightness) {
        brightness.min = String(profile.dpiLighting.brightness.min);
        brightness.max = String(profile.dpiLighting.brightness.max);
        brightness.disabled = lightMode !== 1 || status.dpiLedBrightness == null;
      }
      if (speed) {
        speed.min = String(profile.dpiLighting.speed.min);
        speed.max = String(profile.dpiLighting.speed.max);
        speed.disabled = lightMode !== 2 || status.dpiLedSpeed == null;
      }
    }
    for (const selector of ["#angle-snapping-toggle", "#ripple-control-toggle"] as const) {
      const row = document.querySelector<HTMLElement>(selector)?.closest<HTMLElement>(".switch-row");
      if (row) {
        row.hidden = isFinalmouse;
        row.style.display = isFinalmouse ? "none" : "";
      }
    }
    const eggFilterSettings = document.querySelector<HTMLElement>("#egg-filter-settings");
    const eggSpdtSettings = document.querySelector<HTMLElement>("#egg-spdt-settings");
    const eggPollingSettings = document.querySelector<HTMLElement>("#egg-polling-settings");
    const eggCpiSettings = document.querySelector<HTMLElement>("#egg-cpi-settings");
    const eggButtonSettings = document.querySelector<HTMLElement>("#egg-button-settings");
    if (eggFilterSettings) eggFilterSettings.style.display = isEgg8k ? "block" : "none";
    if (eggSpdtSettings) eggSpdtSettings.style.display = isEgg8k ? "block" : "none";
    if (eggPollingSettings) eggPollingSettings.style.display = isEgg8k && interfacePreferences.showExperimental ? "block" : "none";
    if (eggCpiSettings) eggCpiSettings.style.display = isEgg8k ? "block" : "none";
    if (eggButtonSettings) eggButtonSettings.style.display = isEgg8k ? "block" : "none";
    if (isEgg8k) {
      setToggleValue("#slamclick-filter-toggle", status.slamclickFilter);
      setToggleValue("#motion-jitter-filter-toggle", status.motionJitterFilter);
      setControlValue("#left-spdt-select", status.leftSpdtMode);
      setControlValue("#right-spdt-select", status.rightSpdtMode);
      setControlValue("#egg-cpi-levels", status.eggCpiLevels);
      setControlValue("#egg-polling-divider", status.eggPollingDivider);
      updateCustomPollingPreview();
      renderEggControls(status, {
        applyCpiStage: applyEggCpiStage,
        applyMulticlick: applyEggMulticlick,
        applyButtonMapping: applyEggButtonMapping,
      });
    }
    const proSettings = document.querySelector<HTMLElement>("#pulsar-pro-settings");
    const isPro = status.connectionDetail?.includes("Pulsar Pro protocol") === true;
    if (proSettings) proSettings.style.display = isPro ? "block" : "none";
    if (isPro) {
      setToggleValue("#wheel-acceleration-toggle", status.wheelAcceleration);
      setControlValue("#angle-tuning-select", status.angleTuning);
      setControlValue("#profile-select", status.activeProfile);
    }
    const finalmouseSettings = document.querySelector<HTMLElement>("#finalmouse-settings");
    if (finalmouseSettings) finalmouseSettings.style.display = isFinalmouse ? "block" : "none";
    if (isFinalmouse) {
      setControlValue("#finalmouse-dongle-led", status.finalmouseDongleLedMode);
      setControlValue("#finalmouse-tournament-scroll", status.finalmouseTournamentScrollMode);
      setControlValue("#finalmouse-tournament-timeout", status.finalmouseTournamentScrollTimeoutMs);
    }
  }
  setText("#device-title", status.name);
  if (activeDevice) {
    deviceStatuses.set(activeDevice, deviceStatus);
    void renderDeviceSidebar();
  }
  setText("#device-status", "Connected");
  if (settingsPending) {
    // A driver may read more than it can write yet. Only drivers that read
    // these values report them; the rest fall back to a placeholder here.
    const battery = deviceStatus.batteryPercent === null
      ? "Connected"
      : `Battery ${deviceStatus.batteryPercent}%`;
    setText("#read-status", ui?.valuesVerified
      ? [battery, `${deviceStatus.dpi.toLocaleString()} DPI`, `${deviceStatus.pollingRateHz.toLocaleString()} Hz`].join(" · ")
      : battery);
  } else if (!hasPendingChanges()) {
    setText("#read-status", `Current: ${deviceStatus.dpi.toLocaleString()} DPI · ${deviceStatus.pollingRateHz.toLocaleString()} Hz`);
  }
  const meter = document.querySelector<HTMLElement>("#battery-meter");
  if (meter) meter.style.width = status.batteryPercent === null ? "0%" : `${status.batteryPercent}%`;
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.remove("is-idle"));
  document.querySelector<HTMLElement>(".control-shell")?.classList.remove("is-empty");
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => setSelected(button, button.dataset.lod === status.liftOffDistance));
  // The host rate is one stop per rate the mouse actually advertises, so an
  // unsupported rate is simply not a stop rather than a hidden button.
  const advertisedRates = (status.supportedPollingRates ?? RATE_STEPS_HZ)
    .filter((rate) => !(isEgg8k && rate < 1000))
    .slice()
    .sort((a, b) => a - b);
  renderRateSlider(
    document.querySelector<HTMLElement>("#host-rate-slider"),
    advertisedRates,
    status.pollingRateHz,
    // A read-only rate still shows which one is active, it just cannot be staged.
    { disabled: settingsPending || ui?.pollingReadOnly === true },
  );
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => {
    const supportedLods = status.supportedLiftOffDistances;
    // Named levels rather than millimetres: the mouse reports a level, not a
    // height, and the millimetre figures differed per brand anyway.
    button.textContent = button.dataset.lod ?? "";
    const hideLow = button.dataset.lod === "Low"
      && (isEgg || ui?.hideLodLow === true);
    const unsupported = Array.isArray(supportedLods)
      && !supportedLods.includes(button.dataset.lod as NonNullable<MouseStatus["liftOffDistance"]>);
    const legacyLogitechLow = status.brand === "Logitech"
      && !Array.isArray(supportedLods)
      && button.dataset.lod === "Low";
    button.hidden = hideLow || unsupported;
    const lodNeedsSurface = ui?.lodRequiresSurface === true && status.gamingSurfaceMode === "Off";
    button.disabled = hideLow || unsupported || settingsPending || legacyLogitechLow || lodNeedsSurface;
  });
  renderAsymmetricLiftOff(status, settingsPending);
  // Runs after the DPI controls above so the slot editor, when it is in charge,
  // has the last word on which of them are visible.
  renderDpiSlots();
  renderProfileRates();
  const lodNote = document.querySelector<HTMLElement>("#lod-note");
  if (lodNote) {
    lodNote.textContent = ui?.lodRequiresSurface === true && status.gamingSurfaceMode === "Off"
      ? "Turn the gaming surface on or set it to auto to adjust lift-off distance."
      : "Controls how far you can lift the mouse before tracking stops. Higher values keep tracking a little longer.";
  }
  const gamingSurfaceRow = document.querySelector<HTMLElement>("#gaming-surface-row");
  if (gamingSurfaceRow) gamingSurfaceRow.hidden = !status.gamingSurfaceMode;
  document.querySelectorAll<HTMLButtonElement>("[data-gaming-surface]").forEach((button) => {
    setSelected(button, button.dataset.gamingSurface === status.gamingSurfaceMode);
    button.disabled = settingsPending || !status.gamingSurfaceMode;
  });
  // A driver that reports no gaming surface and an explicitly empty lift-off
  // list has nothing to put in the sensor card, so hide the card itself rather
  // than leaving an empty heading behind.
  const sensorCard = document.querySelector<HTMLElement>("#lod-note")?.closest<HTMLElement>(".setting-card");
  if (sensorCard) {
    sensorCard.hidden = !status.gamingSurfaceMode
      && Array.isArray(status.supportedLiftOffDistances)
      && status.supportedLiftOffDistances.length === 0;
  }
  const onboardSection = document.querySelector<HTMLElement>("#logitech-onboard");
  if (onboardSection) {
    const supportsOnboard = status.brand === "Logitech" && status.deviceMode !== undefined && status.deviceMode !== "Unknown";
    onboardSection.hidden = !supportsOnboard;
    if (supportsOnboard) {
      lastDeviceMode = status.deviceMode;
      lastProfileFormat = status.onboardProfileFormat ?? null;
      // Profiles stay in flash regardless of mode, so they are listed either
      // way; only which entry is highlighted changes. Read once per device —
      // the refresh loop must never trigger a full profile pass.
      if (onboardProfiles === null && !onboardProfilesLoading) void reloadOnboardProfiles();
      else renderOnboardProfiles();
    }
  }
  const lightforceCard = document.querySelector<HTMLElement>("#lightforce-card");
  if (lightforceCard) lightforceCard.hidden = !status.lightforceSwitchMode;
  document.querySelectorAll<HTMLButtonElement>("[data-lightforce]").forEach((button) => {
    setSelected(button, button.dataset.lightforce === status.lightforceSwitchMode);
    button.disabled = settingsPending || !status.lightforceSwitchMode;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-dpi]").forEach((button) => {
    setSelected(button, Number(button.dataset.dpi) === status.dpi);
    button.disabled = settingsPending;
  });
  const customDpi = document.querySelector<HTMLButtonElement>("#custom-dpi");
  if (customDpi) customDpi.disabled = settingsPending;
  if (dpiOutputField && settingsPending) {
    dpiOutputField.value = "—";
    dpiOutputField.readOnly = true;
  }
  const axisControls = document.querySelector<HTMLElement>("#logitech-axis-controls");
  const showSeparateDpiAxes = status.brand === "Logitech"
    && status.supportsSeparateDpiAxes === true
    && !dpiSlotsAvailable();
  if (axisControls) axisControls.style.display = showSeparateDpiAxes ? "block" : "none";
  const dpiLabel = (source: MouseStatus): string => showSeparateDpiAxes
    ? `X ${source.dpi.toLocaleString()} · Y ${(source.dpiY ?? source.dpi).toLocaleString()} DPI`
    : `${source.dpi.toLocaleString()} DPI`;
  setText("#dpi-pending", isPendingChange("dpi")
    ? `Staged ${dpiLabel(status)}`
    : `Current ${dpiLabel(deviceStatus)}`);
  settingsGrid?.classList.toggle("has-logitech-axis-controls", showSeparateDpiAxes);
  const dpiX = document.querySelector<HTMLInputElement>("#logitech-dpi-x");
  const dpiY = document.querySelector<HTMLInputElement>("#logitech-dpi-y");
  if (dpiX) dpiX.value = String(status.dpi);
  if (dpiY) dpiY.value = String(status.dpiY ?? status.dpi);
  const logitechDetails = document.querySelector<HTMLElement>("#logitech-device-details");
  if (logitechDetails) logitechDetails.style.display = status.brand === "Logitech" ? "block" : "none";
  if (status.brand === "Logitech") renderLogitechDetails(status);
  renderLogitechAnalogButtonSettings(status);
  renderDeviceDiagnostics(deviceStatus);
}

function renderLogitechAnalogButtonSettings(status: MouseStatus): void {
  const section = document.querySelector<HTMLElement>("#logitech-analog-button-settings");
  const tuning = status.brand === "Logitech" ? status.analogButtonTuning : undefined;
  if (!section) return;
  section.style.display = tuning?.buttons.length === 2 ? "block" : "none";
  if (!tuning || tuning.buttons.length !== 2) return;
  for (const side of ["left", "right"] as const) {
    const values = tuning.buttons[side === "left" ? 0 : 1];
    for (const [setting, value, max] of [
      ["actuation", values.actuation, tuning.maxActuation],
      ["rapid-trigger", values.rapidTrigger, tuning.maxRapidTrigger],
      ["haptics", values.haptics, tuning.maxHaptics],
    ] as const) {
      const input = document.querySelector<HTMLInputElement>(`#logitech-${side}-${setting}`);
      if (input) {
        input.value = String(value);
        input.max = String(max);
        document.querySelectorAll<HTMLButtonElement>(`[data-superstrike-input="${input.id}"]`).forEach((option) => {
          option.setAttribute("aria-pressed", String(Number(option.dataset.superstrikeValue) === value));
        });
      }
    }
  }
  const both = tuning.buttons[0];
  for (const [setting, value, max] of [
    ["actuation", both.actuation, tuning.maxActuation],
    ["rapid-trigger", both.rapidTrigger, tuning.maxRapidTrigger],
    ["haptics", both.haptics, tuning.maxHaptics],
  ] as const) {
    const input = document.querySelector<HTMLInputElement>(`#logitech-both-${setting}`);
    if (input) {
      input.value = String(value);
      input.max = String(max);
      document.querySelectorAll<HTMLButtonElement>(`[data-superstrike-input="${input.id}"]`).forEach((option) => {
        option.setAttribute("aria-pressed", String(Number(option.dataset.superstrikeValue) === value));
      });
    }
  }
}

function setSuperstrikeTuningMode(mode: "independent" | "both"): void {
  const panels = document.querySelector<HTMLElement>(".superstrike-tuning-panels");
  if (!panels) return;
  panels.dataset.superstrikeMode = mode;
  document.querySelectorAll<HTMLButtonElement>("[data-superstrike-tab]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.superstrikeTab === mode));
  });
}

function renderLogitechDetails(status: MouseStatus): void {
  const list = document.querySelector<HTMLElement>("#logitech-detail-list");
  if (!list) return;
  const transports = Object.entries(status.transportIds ?? {})
    .map(([name, id]) => `${name}: ${id}`)
    .join(" · ") || "Not reported";
  const rates = status.supportedPollingRates?.map((rate) => `${rate >= 1000 ? `${rate / 1000}K` : rate} Hz`).join(", ") || "Not reported";
  const items = [
    ["Mode", status.deviceMode ?? "Unknown"],
    ["Active profile", status.activeProfile === null ? "None in host mode" : `Profile ${status.activeProfile}`],
    ["Profile format", status.onboardProfileFormat
      ? `${status.onboardProfileFormat.id} · ${status.onboardProfileFormat.name} (base ${status.onboardProfileFormat.base})`
      : "Not reported"],
    ["Model ID", status.modelId ?? "Not reported"],
    ["Unit ID", status.unitId ?? "Not reported"],
    ["Transport IDs", transports],
    ["Advertised polling", rates],
    ["DPI axes", status.supportsSeparateDpiAxes ? `X ${status.dpi} · Y ${status.dpiY ?? status.dpi}` : "Linked X/Y"],
  ];
  list.innerHTML = items.map(([label, value]) =>
    `<div><small>${label.toUpperCase()}</small><span>${value}</span></div>`).join("");
}

async function showPulsarExplorer(client: PulsarClient): Promise<void> {
  await client.open();
  const device = client.device;
  setText("#connection-value", "Connected");
  setText("#connection-detail", "Reading Pulsar receiver identity");
  setText("#device-title", device.productName || "Pulsar Mouse");
  setText("#device-status", "Connected");
  setText("#read-status", client.describeCollections());
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.remove("is-idle"));
  document.querySelector<HTMLElement>(".control-shell")?.classList.remove("is-empty");
  const info = await client.readDeviceInfo();
  setText("#connection-value", info.connection);
  setText("#connection-detail", `CID 0x${formatHex(info.cid)} · MID 0x${formatHex(info.mid)} · Type ${info.type} · Dongle ${info.dongleType}`);
  const status = await client.readStatus();
  dpiOptions = client.getDpiOptions();
  configureDpiControl(status.dpi);
  showStatus(status);
  startAutomaticRefresh();
}

async function renderDeviceSidebar(devices?: HIDDevice[]): Promise<void> {
  const all = devices ?? await navigator.hid?.getDevices() ?? [];
  renderDeviceSidebarView(all, deviceStatuses, activeDevice);
}

async function selectAuthorizedDevice(index: number): Promise<void> {
  if (settingInProgress || refreshInProgress) return;
  const devices = listLogicalDevices(await navigator.hid?.getDevices() ?? []);
  const device = devices[index];
  if (!device || device === activeDevice) return;
  const client = createSupportedClient(device);
  if (!client) return;
  setText("#device-status", "Switching");
  setText("#read-status", `Reading ${statusNameForClient(client)}.`);
  try {
    await activateClient(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to switch devices.";
    setText("#device-status", "Connection failed");
    setText("#read-status", message);
  }
}

function statusNameForClient(client: SupportedClient): string {
  if (isEggWeClient(client)) return EGG_WE_DISPLAY_NAME;
  if (client instanceof FinalmouseHidClient) return client.displayName();
  return client.device.productName || "the selected mouse";
}

async function activateClient(client: SupportedClient): Promise<void> {
  resetDeviceSpecificPanels();
  // Staged changes belong to the mouse they were made on.
  clearPendingChanges();
  latestDeviceStatus = null;
  activeClient = null;
  activePulsarClient = null;
  activeEggClient = null;
  activeEggWeClient = null;
  activeDmClient = null;
  activeOrbitalClient = null;
  activeRazerClient = null;
  activeTeevolutionClient = null;
  activeVgnClient = null;
  activeViperClient = null;
  if (activeDevice !== client.device) onboardProfiles = null;
  activeFinalmouseClient = null;
  activeDevice = client.device;
  recordDiagnosticCommand("Read device status");
  lastRenderedStatusKey = null;
  if (client instanceof WLMouseHidClient || client instanceof LamzuHidClient || client instanceof AtkHidClient) {
    activeDmClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
    await client.startNotifications(() => {
      void refreshStatus();
    }).catch(() => false);
  } else if (client instanceof EggOp1HidClient) {
    activeEggClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else if (isEggWeClient(client)) {
    await eggWePrepare(client);
    activeEggWeClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else if (client instanceof LogitechHidppClient) {
    activeClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = await client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else if (client instanceof OrbitalHidClient) {
    activeOrbitalClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else if (client instanceof RazerHidClient || client instanceof RazerViperMiniHidClient) {
    activeRazerClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else if (client instanceof RazerViperV4ProHidClient) {
    activeViperClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else if (client instanceof FinalmouseHidClient) {
    activeFinalmouseClient = client;
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else if (client instanceof TeevolutionHidClient) {
    activeTeevolutionClient = client;
    await client.open();
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else if (client instanceof VgnF2HidClient) {
    activeVgnClient = client;
    await client.open();
    const status = await client.readStatus();
    deviceStatuses.set(client.device, status);
    dpiOptions = client.getDpiOptions();
    configureDpiControl(status.dpi);
    showStatus(status);
  } else {
    activePulsarClient = client;
    await showPulsarExplorer(client);
  }
  await renderDeviceSidebar();
  startAutomaticRefresh();
  // Always restore the sidebar action after a successful activate.
  setConnectionButtons(false, "Add device");
}

function showDisconnectedState(): void {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  activeClient = null;
  activePulsarClient = null;
  activeEggClient = null;
  activeEggWeClient = null;
  activeDmClient = null;
  activeOrbitalClient = null;
  activeRazerClient = null;
  activeTeevolutionClient = null;
  activeVgnClient = null;
  activeViperClient = null;
  activeFinalmouseClient = null;
  activeDevice = null;
  onboardProfiles = null;
  lastRenderedStatusKey = null;
  clearPendingChanges();
  latestDeviceStatus = null;
  resetDeviceSpecificPanels();
  const advanced = document.querySelector<HTMLElement>("#pulsar-advanced");
  if (advanced) advanced.style.display = "none";
  document.querySelector<HTMLElement>(".control-shell")?.classList.add("is-empty");
  document.querySelectorAll<HTMLElement>(".device-dot, .status-dot").forEach((dot) => dot.classList.add("is-idle"));
  setText("#device-title", "Connect a mouse");
  setText("#device-status", "No device connected");
  setText("#read-status", "Add a supported device from the sidebar to read its current status.");
  setConnectionButtons(false, "Add device");
}

function handleHidConnect(event: HIDConnectionEvent): void {
  const client = createSupportedClient(event.device);
  if (!client) {
    void renderDeviceSidebar();
    return;
  }

  if (isEggWeClient(client)) {
    void (async () => {
      const all = await navigator.hid?.getDevices() ?? [];
      await renderDeviceSidebar(all);
      const result = await eggWeResolveConnect(event.device, activeEggWeClient, activeDevice, all);
      if (result.action === "ignore") return;
      if (result.action === "refresh") {
        try {
          const status = await result.client.readStatus();
          deviceStatuses.set(result.client.device, status);
          showStatus(status);
          startAutomaticRefresh();
        } catch {
          /* keep existing UI */
        }
        return;
      }
      setText("#device-status", result.reason === "path" ? "Switching path" : "New device detected");
      setText("#read-status", result.reason === "path"
        ? "Preferring USB over receiver."
        : `Reading ${EGG_WE_DISPLAY_NAME}.`);
      await activateClient(result.client);
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unable to read the connected mouse.";
      setText("#device-status", "Connection failed");
      setText("#read-status", message);
      void renderDeviceSidebar();
    });
    return;
  }

  setText("#device-status", "New device detected");
  setText("#read-status", `Reading ${statusNameForClient(client)}.`);
  void activateClient(client).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unable to read the connected mouse.";
    setText("#device-status", "Connection failed");
    setText("#read-status", message);
    void renderDeviceSidebar();
  });
}

function handleHidDisconnect(event: HIDConnectionEvent): void {
  deviceStatuses.delete(event.device);
  // Multi-collection drivers (cmd + notify) treat either handle as the active mouse.
  if (event.device !== activeDevice && !eggWeOwnsDevice(activeEggWeClient, event.device)) {
    void renderDeviceSidebar();
    return;
  }
  showDisconnectedState();
  void (async () => {
    const devices = (await navigator.hid?.getDevices() ?? [])
      .filter((device) => device !== event.device);
    const logical = listLogicalDevices(devices);
    const replacement = logical
      .map(createSupportedClient)
      .find((client): client is SupportedClient => client !== null);
    if (replacement) {
      await activateClient(replacement);
    } else {
      await renderDeviceSidebar(devices);
    }
  })().catch((error: unknown) => {
    setText("#read-status", error instanceof Error ? error.message : "Unable to switch to another connected mouse.");
    void renderDeviceSidebar();
  });
}

async function requestSupportedClient(): Promise<SupportedClient | null> {
  if (!navigator.hid) throw new Error("WebHID is unavailable. Use Chrome or Edge on desktop.");
  const devices = await navigator.hid.requestDevice({
    filters: SUPPORTED_HID_FILTERS,
  });
  if (devices.length === 0) return null;

  // Dual-collection drivers (e.g. WE) need the full authorized set.
  if (devices.some((device) => eggWeIsSupported(device))) {
    const weClient = eggWeFromAuthorized(await eggWeAuthorizedPool(devices));
    if (weClient) return weClient;
  }

  const ranked = devices
    .map((device) => ({ device, client: createSupportedClient(device), score: clientSupportScore(device) }))
    .filter((entry) => entry.client !== null)
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (best?.client) {
    if (isEggWeClient(best.client)) await eggWePrepare(best.client);
    return best.client;
  }

  const details = devices.map((device) => describeHidDevice(device)).join(" · ");
  throw new Error(
    `Selected device is not a supported control interface (${details}). `
    + "Pick a vendor control interface (not a plain boot mouse). "
    + "If this keeps failing, note the VID/PID from this message.",
  );
}

async function connect(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>("#connect-button");
  if (!button) return;
  setConnectionButtons(true, "Connecting…");
  setText("#device-status", "Requesting permission");
  setText("#read-status", "Choose your device in the browser prompt.");

  try {
    const client = await requestSupportedClient();
    if (!client) {
      setText("#device-status", "Not connected");
      setText("#read-status", "No device was selected in the browser prompt.");
      return;
    }
    setText("#device-status", "Opening device");
    setText("#read-status", `Reading ${statusNameForClient(client)}…`);
    await activateClient(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read the mouse.";
    // Picking a keyboard or headset is a wrong choice, not a failure: say so,
    // and do not file it as a device error in diagnostics.
    const wrongDevice = error instanceof NotAMouseError;
    if (!wrongDevice) recordDiagnosticError(error, message);
    await activeEggClient?.close().catch(() => undefined);
    activeEggClient = null;
    await activeEggWeClient?.close().catch(() => undefined);
    activeEggWeClient = null;
    setText("#device-status", wrongDevice ? "Not a mouse" : "Connection failed");
    setText("#read-status", message);
  } finally {
    // Always clear the busy label — success used to leave "Connecting…" stuck.
    setConnectionButtons(false, "Add device");
  }
}

async function reconnectAuthorizedDevice(): Promise<void> {
  if (hasActiveClient() || reconnectInFlight) return;
  const button = document.querySelector<HTMLButtonElement>("#connect-button");
  if (!button) return;
  reconnectInFlight = true;
  setConnectionButtons(true, "Reconnecting…");

  let lastError: Error | null = null;
  try {
    // Browsers can restore WebHID authorization a fraction of a second after the
    // page is ready. Poll quickly at first so reloads do not feel stalled, then
    // keep a few wider retries for slower USB enumeration.
    const retryDelays = [0, 40, 60, 75, 100, 150, 225, 350, 500, 750];
    for (const delay of retryDelays) {
      // Another path (HID connect handler) may have already activated a client.
      if (hasActiveClient()) return;
      if (delay) await waitForHidChange(delay);
      if (hasActiveClient()) return;

      const devices = await navigator.hid?.getDevices() ?? [];
      const clients = listLogicalDevices(devices)
        .map((device) => ({ client: createSupportedClient(device), score: clientSupportScore(device) }))
        .filter((entry): entry is { client: SupportedClient; score: number } => entry.client !== null)
        .sort((left, right) => right.score - left.score)
        .map((entry) => entry.client);
      await renderDeviceSidebar(devices);
      if (clients.length === 0) continue;

      for (const client of clients) {
        if (hasActiveClient()) return;
        try {
          setText("#device-status", "Reconnecting");
          setText("#read-status", "Reading the previously authorized device.");
          await activateClient(client);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Unable to reconnect to the mouse.");
          await client.close().catch(() => undefined);
        }
      }
    }
    if (!hasActiveClient()) {
      setText("#device-status", "Not connected");
      setText("#read-status", lastError?.message ?? "Use Add device if the mouse does not reconnect automatically.");
    }
  } finally {
    reconnectInFlight = false;
    // Always restore the button — previously success left "Reconnecting…" forever.
    setConnectionButtons(false, "Add device");
  }
}

function setConnectionButtons(disabled: boolean, label: string): void {
  document.querySelectorAll<HTMLButtonElement>("#connect-button, #empty-connect-button").forEach((button) => {
    button.disabled = disabled;
    button.textContent = label;
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function waitForHidChange(milliseconds: number): Promise<void> {
  const hid = navigator.hid;
  if (!hid) return wait(milliseconds);
  return new Promise((resolve) => {
    const finish = (): void => {
      window.clearTimeout(timer);
      hid.removeEventListener("connect", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, milliseconds);
    hid.addEventListener("connect", finish, { once: true });
  });
}

function configureDpiControl(currentDpi: number): void {
  const presets = document.querySelector<HTMLElement>("#dpi-presets");
  const custom = document.querySelector<HTMLButtonElement>("#custom-dpi");
  if (!presets || !custom || dpiOptions.length === 0) return;
  const common = dpiPresetValues(dpiOptions);
  const values = common.includes(currentDpi) ? common : [...common, currentDpi].sort((a, b) => a - b);
  presets.innerHTML = values.map((dpi) => `<button type="button" data-dpi="${dpi}" aria-pressed="${dpi === currentDpi}" class="${dpi === currentDpi ? "selected" : ""}">${dpi.toLocaleString()}</button>`).join("");
  presets.querySelectorAll<HTMLButtonElement>("[data-dpi]").forEach((button) => {
    button.addEventListener("click", () => void applyDpiValue(Number(button.dataset.dpi)));
  });
  custom.disabled = false;
  const min = Math.min(...dpiOptions);
  const max = Math.max(...dpiOptions);
  document.querySelectorAll<HTMLInputElement>("#logitech-dpi-x, #logitech-dpi-y").forEach((axis) => {
    axis.min = String(min);
    axis.max = String(max);
  });
}

function chooseCustomDpi(): void {
  const input = document.querySelector<HTMLInputElement>("#dpi-output");
  const button = document.querySelector<HTMLButtonElement>("#custom-dpi");
  if (!input || !button) return;
  if (input.readOnly) {
    input.dataset.previousValue = input.value;
    input.readOnly = false;
    input.value = input.value.replace(/[^\d]/g, "");
    button.textContent = "Apply";
    input.focus();
    input.select();
    return;
  }
  const dpi = Number(input.value.replace(/[^\d]/g, ""));
  if (!Number.isInteger(dpi) || !dpiOptions.includes(dpi)) {
    // Naming the closest step saves guessing on mice whose grid does not land
    // on round numbers, where every obvious value looks unsupported.
    const closest = Number.isInteger(dpi) && dpi > 0 ? closestDpiOption(dpiOptions, dpi) : null;
    setText("#read-status", closest === null
      ? "That DPI value is not supported by this mouse."
      : `This mouse cannot do ${dpi.toLocaleString()} DPI. The closest step it supports is ${closest.toLocaleString()}.`);
    input.focus();
    input.select();
    return;
  }
  if (applyDpiValue(dpi)) finishCustomDpiEditing(dpi);
}

function sanitizeCustomDpi(): void {
  const input = document.querySelector<HTMLInputElement>("#dpi-output");
  if (!input || input.readOnly) return;
  const digits = input.value.replace(/\D/g, "");
  const max = dpiOptions.length > 0 ? Math.max(...dpiOptions) : null;
  const next = max !== null && digits !== "" && Number(digits) > max ? String(max) : digits;
  if (next !== input.value) input.value = next;
}

function finishCustomDpiEditing(dpi?: number): void {
  const input = document.querySelector<HTMLInputElement>("#dpi-output");
  const button = document.querySelector<HTMLButtonElement>("#custom-dpi");
  if (!input || !button) return;
  const fallback = Number((input.dataset.previousValue ?? input.value).replace(/[^\d]/g, "")) || dpiOptions[0] || 800;
  input.readOnly = true;
  input.value = `${(dpi ?? fallback).toLocaleString()} DPI`;
  delete input.dataset.previousValue;
  button.textContent = "Custom";
}

function applyDpiValue(dpi: number): boolean {
  if (!hasActiveClient() || !dpiOptions.includes(dpi)) return false;
  stageChange({
    key: "dpi",
    label: `DPI ${dpi.toLocaleString()}`,
    command: `Set DPI to ${dpi.toLocaleString()}`,
    progress: `Setting ${dpi.toLocaleString()} DPI…`,
    preview: (status) => {
      status.dpi = dpi;
      // Only mirror the Y axis when the driver actually reports one, so the
      // comparison against the device status stays exact.
      if (status.dpiY !== undefined) status.dpiY = dpi;
    },
    apply: async () => {
      await requireClientMethod("setDpi", "DPI").setDpi(dpi);
    },
  });
  return true;
}

function applyLogitechAxisDpi(): void {
  if (!activeClient) return;
  const dpiX = Number(document.querySelector<HTMLInputElement>("#logitech-dpi-x")?.value);
  const dpiY = Number(document.querySelector<HTMLInputElement>("#logitech-dpi-y")?.value);
  if (!dpiOptions.includes(dpiX) || !dpiOptions.includes(dpiY)) {
    setText("#read-status", "Both axis values must be advertised DPI values.");
    return;
  }
  stageChange({
    key: "dpi",
    label: `DPI X ${dpiX.toLocaleString()} · Y ${dpiY.toLocaleString()}`,
    command: `Set DPI axes to X ${dpiX.toLocaleString()} / Y ${dpiY.toLocaleString()}`,
    progress: `Setting X ${dpiX.toLocaleString()} · Y ${dpiY.toLocaleString()} DPI…`,
    preview: (status) => {
      status.dpi = dpiX;
      status.dpiY = dpiY;
    },
    apply: async () => {
      if (!activeClient) throw new Error("The mouse is no longer connected.");
      await activeClient.setDpi(dpiX, dpiY);
    },
  });
}

function readAnalogTuning(group: "left" | "right" | "both"): { actuation: number; rapidTrigger: number; haptics: number } {
  const read = (setting: "actuation" | "rapid-trigger" | "haptics"): number =>
    Number(document.querySelector<HTMLInputElement>(`#logitech-${group}-${setting}`)?.value);
  return { actuation: read("actuation"), rapidTrigger: read("rapid-trigger"), haptics: read("haptics") };
}

/** Stages one hall-effect button profile. Keyed per button so "both" replaces either side. */
function stageAnalogButton(button: 0 | 1, tuning: { actuation: number; rapidTrigger: number; haptics: number }): void {
  const side = button === 0 ? "left" : "right";
  stageChange({
    key: `analog-button-${button}`,
    label: `${side === "left" ? "Left" : "Right"} HITS tuning`,
    command: `Set ${side} hall-effect button tuning`,
    progress: `Setting ${side} hall-effect button tuning…`,
    preview: (status) => {
      const buttons = status.analogButtonTuning?.buttons;
      if (buttons?.[button]) buttons[button] = { ...tuning };
    },
    apply: async () => {
      if (!activeClient) throw new Error("The mouse is no longer connected.");
      await activeClient.setAnalogButtonTuning(button, tuning);
    },
  });
}

function applyLogitechAnalogButton(button: 0 | 1): void {
  if (!activeClient) return;
  stageAnalogButton(button, readAnalogTuning(button === 0 ? "left" : "right"));
}

async function applyOnboardMode(mode: "Onboard" | "Host"): Promise<void> {
  const client = activeClient;
  if (!client || refreshInProgress || settingInProgress) return;
  // Host mode opens the host layer, which discards profile edits the same way.
  if (mode === "Host" && !confirmDiscardingProfileEdits("host")) return;
  settingInProgress = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-onboard-mode]");
  buttons.forEach((button) => { button.disabled = true; });
  setText("#read-status", `Switching to ${mode.toLowerCase()} mode…`);
  recordDiagnosticCommand(`Set onboard mode to ${mode}`);
  try {
    await client.setOnboardMode(mode);
    // Host has no stored profile to edit, so switching to it also opens it.
    if (mode === "Host") selectEditedProfile("host");
    showStatus(await statusAfterWrite(client));
  } catch (error) {
    recordDiagnosticError(error, "Unable to change the onboard mode.");
    setText("#read-status", error instanceof Error ? error.message : "Unable to change the onboard mode.");
  } finally {
    endDeviceWrite();
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function selectOnboardProfile(sector: number): Promise<void> {
  const client = activeClient;
  if (!client || refreshInProgress || settingInProgress) return;
  // Asked before the mouse is touched: switching profiles also opens the new
  // one, so the edits would be gone by the time the prompt appeared.
  if (!confirmDiscardingProfileEdits(sector)) return;
  settingInProgress = true;
  setText("#read-status", `Switching to profile ${sector}…`);
  recordDiagnosticCommand(`Select onboard profile ${sector}`);
  try {
    if (lastDeviceMode !== "Onboard") await client.setOnboardMode("Onboard");
    await client.setCurrentProfile(sector);
    // Switching to a profile also opens it, which is what you would expect
    // after asking the mouse to run it.
    selectEditedProfile(sector);
    showStatus(await statusAfterWrite(client));
    await reloadOnboardProfiles();
  } catch (error) {
    recordDiagnosticError(error, "Unable to select that profile.");
    setText("#read-status", error instanceof Error ? error.message : "Unable to select that profile.");
  } finally {
    endDeviceWrite();
  }
}

/**
 * Enabling or disabling a slot rewrites the directory sector, so it costs a
 * flash erase/write cycle and uses a write sequence not yet proven on hardware.
 * Confirm explicitly rather than treating the icon as a cheap toggle.
 */
async function toggleOnboardProfileEnabled(sector: number, enabled: boolean): Promise<void> {
  const client = activeClient;
  if (!client || refreshInProgress || settingInProgress) return;

  const confirmed = window.confirm(
    `${enabled ? "Enable" : "Disable"} profile ${sector}?\n\n`
    + "This writes to the mouse's flash memory — one write cycle per change. "
    + "OpenMouse has not yet verified this write sequence on hardware; G HUB can restore the profiles if anything goes wrong.",
  );
  if (!confirmed) return;

  settingInProgress = true;
  setText("#onboard-status", `${enabled ? "Enabling" : "Disabling"} profile ${sector}…`);
  recordDiagnosticCommand(`${enabled ? "Enable" : "Disable"} onboard profile ${sector}`);
  try {
    await client.setProfileEnabled(sector, enabled);
    await reloadOnboardProfiles();
  } catch (error) {
    recordDiagnosticError(error, "Unable to change the profile state.");
    setText("#onboard-status", error instanceof Error ? error.message : "Unable to change the profile state.");
  } finally {
    endDeviceWrite();
  }
}

/**
 * Bunny hop lives in the active onboard profile, so applying it writes flash.
 * The encoding is confirmed on hardware but the write sequence is not, hence
 * the confirmation.
 */
const BUNNY_HOP_KEY = "logitech-bunny-hop";
/**
 * Settings written into the active profile's sector. Flash is erased and
 * rewritten a whole sector at a time, so two of these staged together must
 * cost one erase cycle, not two.
 */
const PROFILE_SECTOR_GROUP = "logitech-profile-sector";
const DPI_SLOTS_KEY = "logitech-dpi-slots";

/**
 * Writes every staged profile setting in one sector write. This is the apply
 * for the whole profile-sector group, so it must send everything staged in it:
 * the group runs once, and whichever change happened to be staged last is the
 * one that carries it.
 */
async function writeStagedProfileSector(): Promise<void> {
  if (!activeClient) throw new Error("The mouse is no longer connected.");
  const entry = editedProfileEntry();
  if (!entry) throw new Error("No profile is open for editing.");
  const ratesStaged = isPendingChange(PROFILE_RATE_KEY);
  await activeClient.writeActiveProfile({
    // The open profile, which is not necessarily the one the mouse is running.
    sector: entry.sector,
    bunnyHoppingMs: isPendingChange(BUNNY_HOP_KEY) ? stagedBunnyHopMs : null,
    dpiStages: isPendingChange(DPI_SLOTS_KEY) ? dpiSlotPlan : null,
    reportRateWirelessHz: ratesStaged ? stagedProfileRates.wireless : null,
    reportRateWiredHz: ratesStaged ? stagedProfileRates.wired : null,
    name: isPendingChange(PROFILE_NAME_KEY) ? stagedProfileName : null,
  });
  // The write changed profile flash, so every cached read is stale.
  onboardProfiles = null;
  await reloadOnboardProfiles();
}
/**
 * Staged bunny-hop value. It cannot ride on MouseStatus like the other staged
 * settings because it lives in the onboard profile, not the status snapshot,
 * so the pending value is mirrored here for rendering instead.
 */
let stagedBunnyHopMs: number | null = null;

function applyBunnyHopMs(milliseconds: number): void {
  if (!activeClient) return;

  const invalid = validateBunnyHoppingMs(milliseconds);
  if (invalid) {
    setText("#bunny-hop-note", invalid);
    return;
  }

  const stored = editedProfileEntry()?.bunnyHoppingMs ?? null;
  if (stored === milliseconds) {
    stagedBunnyHopMs = null;
    dropPendingChange(BUNNY_HOP_KEY);
    renderBunnyHop();
    return;
  }

  stagedBunnyHopMs = milliseconds;
  stageChange({
    key: BUNNY_HOP_KEY,
    // Everything stored in the active profile shares one sector, so a second
    // profile setting must join this group rather than cost its own erase.
    group: PROFILE_SECTOR_GROUP,
    label: milliseconds === 0 ? "Bunny hop off" : `Bunny hop ${milliseconds} ms`,
    command: `Set bunny hop to ${milliseconds} ms`,
    progress: milliseconds === 0 ? "Turning bunny hop off…" : `Setting bunny hop to ${milliseconds} ms…`,
    // No preview: the value lives in the onboard profile, not MouseStatus, so
    // renderBunnyHop mirrors the staged value from stagedBunnyHopMs instead.
    apply: writeStagedProfileSector,
  });
  renderBunnyHop();
}


function renderBunnyHop(): void {
  const row = document.querySelector<HTMLElement>("#bunny-hop-row");
  if (!row) return;
  const active = editedProfileEntry();
  // Support is a property of the format, not of the stored value: a profile
  // that never had bunny hop written reads 0xff and decodes to null, which
  // means off, not unsupported. Keying on the value hid the control entirely
  // on any profile the setting had not been used on yet.
  const supported = active !== null
    && capabilitiesForFormat(lastProfileFormat?.id).bunnyHop;
  row.hidden = !supported;
  if (!supported || !active) return;

  const locked = lastProfileFormat?.verified !== true;
  // Show the staged value, so a background refresh cannot snap the control back
  // to what is still on the device.
  // A never-written byte counts as off, so the toggle starts in the off state
  // rather than the control vanishing.
  const value = stagedBunnyHopMs ?? active.bunnyHoppingMs ?? 0;
  const enabled = value !== 0;

  setToggleValue("#bunny-hop-enabled", enabled);
  const toggle = document.querySelector<HTMLButtonElement>("#bunny-hop-enabled");
  if (toggle) toggle.disabled = locked || settingInProgress;

  const input = document.querySelector<HTMLInputElement>("#bunny-hop-input");
  if (input) {
    // Leave the field alone while it has focus, or typing gets overwritten.
    // While off there is no stored time, so the field keeps the lowest value
    // G HUB allows and turning it on applies that.
    if (document.activeElement !== input) input.value = String(enabled ? value : BUNNY_HOP_LIMITS.minMs);
    input.disabled = locked || settingInProgress || !enabled;
  }

  setText("#bunny-hop-note", locked
    ? "This profile format has not been verified on hardware, so it is read-only."
    : `Ignores repeat clicks that land within this window, so a switch that bounces during fast click spam only registers once. Longer times filter harder; shorter times let genuine fast clicks through. ${BUNNY_HOP_LIMITS.minMs}–${BUNNY_HOP_LIMITS.maxMs} ms in steps of ${BUNNY_HOP_LIMITS.stepMs}.`);
}

/**
 * DPI slots live in the active profile's stage table. The plan is edited as a
 * whole because the slot count is expressed by zeroing the stages that fall out
 * of use, so a single slot cannot be written on its own.
 */
let dpiSlotPlan: DpiStagePlan | null = null;
/**
 * Per-slot axis lock: while a slot is locked, typing X mirrors into Y. Slots
 * are independent because the choice is per slot — a sniper slot may want
 * separate axes while the rest stay square.
 */
let dpiAxisLocks: boolean[] = [];

function dpiAxisLockedAt(index: number): boolean {
  return dpiAxisLocks[index] ?? true;
}

function dpiSlotLimits(): DpiStageCapabilities | null {
  const format = lastProfileFormat;
  return format ? capabilitiesForFormat(format.id).dpiStages : null;
}

/**
 * True when the slot editor is driving DPI, which means the preset row and the
 * single X/Y pair must give way: they write the host layer, the slots write the
 * profile, and showing both would offer two DPI values that can disagree.
 * Mice with no slot support keep the preset UI unchanged.
 */
function dpiSlotsAvailable(): boolean {
  return editingStoredProfile() && dpiSlotLimits() !== null && dpiSlotPlan !== null;
}

/** True while the flash write sequence for stage tables is still unproven. */
function dpiSlotsLocked(): boolean {
  return !PROFILE_DPI_WRITES_ENABLED || lastProfileFormat?.verified !== true;
}

/**
 * Which profile the settings panels are editing. This is deliberately not the
 * same as which profile the mouse is running: you can open any stored profile,
 * change it and flash it without switching to it. "host" means the live layer
 * rather than a stored profile.
 */
let editedProfile: number | "host" | null = null;

function editedProfileEntry(): OnboardProfile | null {
  if (editedProfile === "host" || editedProfile === null) return null;
  return onboardProfiles?.find((profile) => profile.sector === editedProfile) ?? null;
}

/** True while a stored profile is open, so profile settings are in charge. */
function editingStoredProfile(): boolean {
  return editedProfileEntry() !== null;
}

function syncEditedProfile(): void {
  if (!onboardProfiles) return;
  // Follow the device on first load, and whenever the chosen profile is gone.
  const stillThere = editedProfile !== "host"
    && onboardProfiles.some((profile) => profile.sector === editedProfile);
  if (stillThere) return;
  if (editedProfile === "host") return;
  editedProfile = lastDeviceMode === "Host"
    ? "host"
    : onboardProfiles.find((profile) => profile.isCurrent)?.sector ?? "host";
}

/**
 * Changes staged against the profile currently open. They are built from that
 * sector's bytes, so they cannot follow you to another profile.
 */
function stagedProfileEdits(): PendingChange[] {
  return pendingChanges().filter((change) => change.group === PROFILE_SECTOR_GROUP);
}

/**
 * Asks before throwing away unflashed edits. Switching profiles discards them,
 * and losing a set of DPI slots to a stray click is not something to do
 * silently. Returns false when the user chooses to stay.
 */
function confirmDiscardingProfileEdits(target: number | "host"): boolean {
  const staged = stagedProfileEdits();
  if (staged.length === 0 || target === editedProfile) return true;

  const from = describeProfileEntry(editedProfileEntry()).name.replace(/ · .*$/, "");
  const to = target === "host"
    ? "Host"
    : onboardProfiles?.find((profile) => profile.sector === target)?.name ?? `Profile ${target}`;
  return window.confirm(
    `${from} has ${staged.length} change${staged.length === 1 ? "" : "s"} you have not flashed:\n\n`
    + `${staged.map((change) => `  • ${change.label}`).join("\n")}\n\n`
    + `Opening ${to} discards ${staged.length === 1 ? "it" : "them"}. Continue?`,
  );
}

function selectEditedProfile(sector: number | "host"): void {
  if (!confirmDiscardingProfileEdits(sector)) return;
  editedProfile = sector;
  // Opening a different profile abandons edits staged against the old one:
  // they were built from that sector's bytes and cannot carry over.
  dropPendingChange(DPI_SLOTS_KEY);
  dropPendingChange(BUNNY_HOP_KEY);
  dropPendingChange(PROFILE_RATE_KEY);
  dropPendingChange(PROFILE_NAME_KEY);
  stagedBunnyHopMs = null;
  stagedProfileRates = { wireless: null, wired: null };
  stagedProfileName = null;
  // The locks describe the slots of the profile that was open, not this one.
  dpiAxisLocks = [];
  syncDpiSlotPlan();
  renderOnboardProfiles();
  if (latestDeviceStatus) showStatus(latestDeviceStatus);
}

function syncDpiSlotPlan(): void {
  const limits = dpiSlotLimits();
  const entry = editedProfileEntry();
  // A reload in flight leaves onboardProfiles null for a moment. Clearing the
  // plan there made the editor blink out and back, so the last one is kept
  // until there is something to replace it with.
  if (!onboardProfiles) return;
  if (!entry || !limits || entry.dpiStages.length === 0) {
    dpiSlotPlan = null;
    return;
  }
  // A background refresh must not discard edits the user has staged but not
  // flashed yet, so the device value only reseeds the plan when none is staged.
  if (isPendingChange(DPI_SLOTS_KEY)) return;
  dpiSlotPlan = {
    stages: entry.dpiStages.slice(0, limits.maxStages).map((stage) => ({ ...stage })),
    defaultIndex: Math.min(entry.defaultDpiIndex ?? 0, entry.dpiStages.length - 1),
  };
}

function deviceDpiSlotPlan(): DpiStagePlan | null {
  const entry = editedProfileEntry();
  if (!entry || entry.dpiStages.length === 0) return null;
  return {
    stages: entry.dpiStages.map((stage) => ({ ...stage })),
    defaultIndex: Math.min(entry.defaultDpiIndex ?? 0, entry.dpiStages.length - 1),
  };
}

/**
 * Stages the edited slot table, or drops the change once it matches the mouse
 * again. The whole table is one change: the slot count is expressed by zeroing
 * the stages that fall out of use, so slots cannot be written individually.
 */
function stageDpiSlots(): void {
  // Render first: the edit already changed the plan, so bailing out below must
  // not leave the controls showing the values from before it.
  renderDpiSlots();
  if (!activeClient || !dpiSlotPlan) return;
  const stored = deviceDpiSlotPlan();
  if (stored && JSON.stringify(stored) === JSON.stringify(dpiSlotPlan)) {
    dropPendingChange(DPI_SLOTS_KEY);
    renderDpiSlots();
    return;
  }

  const count = dpiSlotPlan.stages.length;
  stageChange({
    key: DPI_SLOTS_KEY,
    group: PROFILE_SECTOR_GROUP,
    label: count === 1 ? "1 DPI slot" : `${count} DPI slots`,
    command: `Write ${count} DPI slot(s) to the active profile`,
    progress: "Writing DPI slots to the profile…",
    // No preview: the slot table is not part of MouseStatus, so renderDpiSlots
    // shows the edited plan directly.
    apply: writeStagedProfileSector,
  });
  renderDpiSlots();
}

function setDpiSlotCount(count: number): void {
  const limits = dpiSlotLimits();
  if (!dpiSlotPlan || !limits || dpiSlotsLocked()) return;
  const wanted = Math.min(limits.maxStages, Math.max(1, Math.round(count)));
  const stages = dpiSlotPlan.stages.slice(0, wanted);
  // Growing reuses the last slot's values, so a new slot starts somewhere sane
  // rather than at zero, which would read back as unused.
  while (stages.length < wanted) {
    const previous = stages[stages.length - 1] ?? { x: limits.minDpi, y: limits.minDpi, lod: 2 };
    stages.push({ ...previous });
  }
  dpiSlotPlan = { stages, defaultIndex: Math.min(dpiSlotPlan.defaultIndex, stages.length - 1) };
  stageDpiSlots();
}

function setDpiSlotAxis(index: number, axis: "x" | "y", value: number): void {
  const limits = dpiSlotLimits();
  const stage = dpiSlotPlan?.stages[index];
  if (!stage || !limits || dpiSlotsLocked()) return;
  const dpi = clampDpi(value, limits);
  stage[axis] = dpi;
  // With this slot's axes locked the pair moves together, whichever was typed.
  if (dpiAxisLockedAt(index)) stage[axis === "x" ? "y" : "x"] = dpi;
  stageDpiSlots();
}

function setDpiSlotLod(index: number, level: NonNullable<MouseStatus["liftOffDistance"]>): void {
  const stage = dpiSlotPlan?.stages[index];
  if (!stage || dpiSlotsLocked()) return;
  stage.lod = PROFILE_STAGE_LOD[level];
  stageDpiSlots();
}

function setDpiSlotDefault(index: number): void {
  if (!dpiSlotPlan || dpiSlotsLocked()) return;
  if (index < 0 || index >= dpiSlotPlan.stages.length) return;
  dpiSlotPlan.defaultIndex = index;
  stageDpiSlots();
}

function setDpiAxisLock(index: number, locked: boolean): void {
  if (dpiSlotsLocked()) return;
  dpiAxisLocks[index] = locked;
  const stage = dpiSlotPlan?.stages[index];
  // Locking pulls Y onto X straight away, so the state matches what is shown.
  if (locked && stage && stage.y !== stage.x) {
    stage.y = stage.x;
    // Mirroring changes the table, so it is staged like any other edit.
    stageDpiSlots();
    return;
  }
  renderDpiSlots();
}

/** Fallback stops for a driver that does not advertise a rate list. */
const RATE_STEPS_HZ = [125, 250, 500, 1000, 2000, 4000, 8000];

/** 125 → "125", 8000 → "8K": the scale has to fit under a narrow card. */
function shortRate(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}K` : String(hz);
}

/**
 * Renders a rate picker as a slider with one stop per supported rate.
 *
 * The slider runs over indices rather than hertz because the steps are not
 * evenly spaced — 125 to 8000 doubles each time — so an index scale puts the
 * stops at equal distances, which is what makes the dots line up.
 */
function renderRateSlider(
  root: HTMLElement | null,
  options: number[],
  valueHz: number | null,
  state: { label?: string; disabled: boolean },
): void {
  if (!root) return;
  if (options.length === 0) {
    root.innerHTML = "";
    return;
  }
  // A stored rate can sit off the scale — another tool may have written one
  // above this link's ceiling. Land on the nearest stop rather than falling
  // back to index 0, which would read as the slowest rate rather than the
  // fastest one available.
  const exact = options.indexOf(valueHz ?? -1);
  const index = exact >= 0
    ? exact
    : options.reduce(
      (best, rate, step) =>
        Math.abs(rate - (valueHz ?? options[0] ?? 0)) < Math.abs((options[best] ?? 0) - (valueHz ?? options[0] ?? 0))
          ? step
          : best,
      0,
    );
  const last = Math.max(1, options.length - 1);
  // The thumb centre travels between half a thumb in from each end, so the
  // dots are inset by the same amount to sit under it.
  const position = (step: number): string => `calc(7px + (100% - 14px) * ${step} / ${last})`;

  const scale = options.map((rate, step) => {
    const on = step <= index;
    return `<i class="${on ? "is-on" : ""}" style="left:${position(step)}"></i>`
      + `<span class="${step === index ? "is-on" : ""}" style="left:${position(step)}">${shortRate(rate)}</span>`;
  }).join("");

  root.innerHTML = `${state.label ? `<div class="rate-slider-head"><span>${escapeHtml(state.label)}</span><output>${options[index]?.toLocaleString() ?? "—"} Hz</output></div>` : ""}
    <input type="range" class="rate-slider-input" min="0" max="${last}" step="1" value="${index}"${state.disabled ? " disabled" : ""} aria-label="${escapeHtml(state.label ?? "Report rate")}" aria-valuetext="${options[index] ?? 0} Hz" />
    <div class="rate-slider-scale">${scale}</div>`;
  // The index is only meaningful next to the list it came from.
  root.dataset.rates = options.join(",");
}

/** Maps a slider index back to hertz using the list that produced it. */
function rateFromSlider(selector: string, index: number): number | null {
  const root = document.querySelector<HTMLElement>(selector);
  if (!root) return null;
  const rates = (root.dataset.rates ?? "").split(",").map(Number).filter((rate) => rate > 0);
  return rates[index] ?? null;
}

/**
 * Updates a slider's readout and lit dots as the thumb moves. Nothing is
 * staged: the value only counts once the drag ends.
 */
function previewRateSlider(selector: string, index: number): void {
  const root = document.querySelector<HTMLElement>(selector);
  if (!root) return;
  const hz = rateFromSlider(selector, index);
  const output = root.querySelector("output");
  if (output && hz !== null) output.textContent = `${hz.toLocaleString()} Hz`;
  root.querySelectorAll<HTMLElement>(".rate-slider-scale i").forEach((dot, step) => {
    dot.classList.toggle("is-on", step <= index);
  });
  root.querySelectorAll<HTMLElement>(".rate-slider-scale span").forEach((label, step) => {
    label.classList.toggle("is-on", step === index);
  });
}

const PROFILE_NAME_KEY = "logitech-profile-name";
let stagedProfileName: string | null = null;

function renameOnboardProfile(sector: number): void {
  const entry = onboardProfiles?.find((profile) => profile.sector === sector);
  if (!entry || !activeClient) return;
  const maxLength = lastProfileFormat ? capabilitiesForFormat(lastProfileFormat.id).maxNameLength : null;
  if (maxLength === null) {
    setText("#onboard-status", "This profile format has no name field.");
    return;
  }
  // Renaming a profile that is not open would stage against the wrong sector,
  // so opening it first keeps the pending write pointed at what is on screen.
  if (editedProfile !== sector) selectEditedProfile(sector);

  const current = stagedProfileName ?? entry.name ?? "";
  const input = window.prompt(`Profile name (up to ${maxLength} characters)`, current);
  if (input === null) return;

  const invalid = validateProfileName(input, maxLength);
  if (invalid) {
    setText("#onboard-status", invalid);
    return;
  }
  const name = input.trim();
  if (name === entry.name) {
    stagedProfileName = null;
    dropPendingChange(PROFILE_NAME_KEY);
    renderOnboardProfiles();
    return;
  }

  stagedProfileName = name;
  stageChange({
    key: PROFILE_NAME_KEY,
    group: PROFILE_SECTOR_GROUP,
    label: `Rename to "${name}"`,
    command: `Rename profile ${sector} to "${name}"`,
    progress: "Writing the profile name…",
    apply: writeStagedProfileSector,
  });
  renderOnboardProfiles();
}

/** Staged per-profile report rates, keyed by link. */
let stagedProfileRates: { wireless: number | null; wired: number | null } = { wireless: null, wired: null };
const PROFILE_RATE_KEY = "logitech-profile-rate";

function setProfileReportRate(link: "wireless" | "wired", hz: number): void {
  const entry = editedProfileEntry();
  if (!entry || !activeClient) return;
  const rates = lastProfileFormat ? capabilitiesForFormat(lastProfileFormat.id).reportRates : null;
  const invalid = validateReportRate(hz, rates, link);
  if (invalid) {
    setText("#polling-note", invalid);
    return;
  }
  stagedProfileRates = { ...stagedProfileRates, [link]: hz };

  const stored = { wireless: entry.reportRateWireless, wired: entry.reportRateWired };
  const wanted = {
    wireless: stagedProfileRates.wireless ?? stored.wireless,
    wired: stagedProfileRates.wired ?? stored.wired,
  };
  if (wanted.wireless === stored.wireless && wanted.wired === stored.wired) {
    stagedProfileRates = { wireless: null, wired: null };
    dropPendingChange(PROFILE_RATE_KEY);
    renderProfileRates();
    return;
  }

  stageChange({
    key: PROFILE_RATE_KEY,
    group: PROFILE_SECTOR_GROUP,
    label: `${link === "wired" ? "Wired" : "Wireless"} ${hz.toLocaleString()} Hz`,
    command: `Set profile ${link} report rate to ${hz} Hz`,
    progress: "Writing the report rate to the profile…",
    // No preview: profile rates are not part of MouseStatus.
    apply: writeStagedProfileSector,
  });
  renderProfileRates();
}

function renderProfileRates(): void {
  const rows = document.querySelector<HTMLElement>("#profile-rate-rows");
  const rateButtons = document.querySelector<HTMLElement>("#host-rate-slider");
  if (!rows) return;
  const entry = editedProfileEntry();
  const rates = lastProfileFormat ? capabilitiesForFormat(lastProfileFormat.id).reportRates : null;
  const available = entry !== null && rates !== null;

  rows.hidden = !available;
  // The host slider writes the host layer, so only one of the two is shown.
  if (rateButtons) rateButtons.hidden = available;
  const badge = document.querySelector<HTMLElement>("#rate-scope-badge");
  if (badge) {
    badge.hidden = editedProfile === null;
    badge.textContent = available ? "Per-profile" : "Host";
  }
  if (!available || !entry || !rates) return;

  const locked = lastProfileFormat?.verified !== true;
  for (const link of ["wireless", "wired"] as const) {
    const value = stagedProfileRates[link]
      ?? (link === "wired" ? entry.reportRateWired : entry.reportRateWireless);
    renderRateSlider(
      document.querySelector<HTMLElement>(`#profile-rate-${link}`),
      reportRatesFor(rates, link),
      value,
      { label: link === "wired" ? "Wired" : "Wireless", disabled: locked || settingInProgress },
    );
  }

  setText("#polling-note", `Stored in this profile, one rate per link. Up to ${
    reportRatesFor(rates, "wireless").at(-1)?.toLocaleString()} Hz wireless, ${
    reportRatesFor(rates, "wired").at(-1)?.toLocaleString()} Hz over the cable.`);
}

function renderDpiSlots(): void {
  const section = document.querySelector<HTMLElement>("#logitech-dpi-slots");
  if (!section) return;
  const limits = dpiSlotLimits();
  // No limits means the format's slot table was never established, so nothing
  // is shown rather than guessing another format's numbers.
  const available = dpiSlotsAvailable();
  section.hidden = !available;
  // One card, two sources: the badge says which one is on screen. Mice with no
  // profile list have only one source, so it carries no badge at all.
  const scopeBadge = document.querySelector<HTMLElement>("#dpi-scope-badge");
  if (scopeBadge) {
    scopeBadge.hidden = editedProfile === null;
    scopeBadge.textContent = available ? "Per-profile" : "Host";
  }
  // The compact layout pins the settings grid to a fixed row height, which the
  // slot editor overflows. Set here rather than in showStatus so the class
  // tracks the editor however the render was reached.
  document.querySelector<HTMLElement>(".settings-grid")?.classList.toggle("has-dpi-slots", available);
  // The standalone lift-off control writes the host layer and forces the mouse
  // into host mode, so it stands down while a stored profile is open — there
  // lift-off belongs to each DPI slot instead. Toggled here rather than in
  // showStatus, which runs before the open profile is known.
  const hostLodRow = document.querySelector<HTMLElement>("#host-lod-row");
  if (hostLodRow) hostLodRow.hidden = available;
  // The host layer has no stored slots, so it keeps the preset row instead.
  if (!available || limits === null || dpiSlotPlan === null) {
    // No slots on this mouse or profile format, so the preset row stays in
    // charge exactly as it did before slots existed.
    const presetRow = document.querySelector<HTMLElement>("#dpi-presets");
    if (presetRow) presetRow.hidden = false;
    const customButton = document.querySelector<HTMLButtonElement>("#custom-dpi");
    if (customButton) customButton.hidden = false;
    return;
  }

  const locked = dpiSlotsLocked();
  const levels = lastProfileFormat ? capabilitiesForFormat(lastProfileFormat.id).supportedLods : [];

  // The preset row writes host DPI, so it stands down while slots are shown.
  const presets = document.querySelector<HTMLElement>("#dpi-presets");
  if (presets) presets.hidden = true;
  const custom = document.querySelector<HTMLButtonElement>("#custom-dpi");
  if (custom) custom.hidden = true;
  const axisControls = document.querySelector<HTMLElement>("#logitech-axis-controls");
  if (axisControls) axisControls.style.display = "none";

  // A short row of stops reads faster than a dropdown and matches the other
  // pickers on the page.
  const count = document.querySelector<HTMLElement>("#dpi-slot-count");
  if (count) {
    count.innerHTML = Array.from({ length: limits.maxStages }, (_, step) => {
      const value = step + 1;
      const on = value === dpiSlotPlan?.stages.length;
      return `<button type="button" data-dpi-slot-count="${value}"${locked ? " disabled" : ""} class="${on ? "selected" : ""}" aria-pressed="${on}">${value}</button>`;
    }).join("");
  }

  const list = document.querySelector<HTMLElement>("#dpi-slot-list");
  if (list) {
    list.innerHTML = dpiSlotPlan.stages.map((stage, index) => {
      const level = stageLodLevel(stage.lod);
      // A native select cannot be styled or animated, so the menu is built by
      // hand. It keeps listbox semantics so it still reads as a select.
      const lodOptions = levels
        .map((name) => `<li role="option" data-lod-value="${name}" aria-selected="${name === level}">${name}</li>`)
        .join("");
      const isDefault = index === dpiSlotPlan?.defaultIndex;
      const axisLocked = dpiAxisLockedAt(index);
      return `<div class="dpi-slot-row${isDefault ? " is-default" : ""}">
        <button type="button" class="dpi-slot-index" data-dpi-slot-default="${index}"${locked ? " disabled" : ""} title="${isDefault ? "Starting slot" : "Make this the starting slot"}" aria-pressed="${isDefault}">${index + 1}</button>
        <input type="number" data-dpi-slot="${index}" data-dpi-axis="x" aria-label="Slot ${index + 1} X DPI" min="${limits.minDpi}" max="${limits.maxDpi}" step="${limits.stepDpi}" value="${stage.x}"${locked ? " disabled" : ""} />
        <button type="button" class="dpi-axis-lock${axisLocked ? " is-locked" : ""}" data-dpi-axis-lock="${index}"${locked ? " disabled" : ""} title="${axisLocked ? "X and Y are linked — click to set them separately" : "X and Y are separate — click to link them"}" aria-label="Link X and Y for slot ${index + 1}" aria-pressed="${axisLocked}">${axisLocked ? ICON_LINKED : ICON_UNLINKED}</button>
        <input type="number" data-dpi-slot="${index}" data-dpi-axis="y" aria-label="Slot ${index + 1} Y DPI" min="${limits.minDpi}" max="${limits.maxDpi}" step="${limits.stepDpi}" value="${stage.y}"${locked || axisLocked ? " disabled" : ""} />
        <div class="lod-select" data-lod-select="${index}">
          <button type="button" class="lod-select-value" data-lod-toggle="${index}"${locked ? " disabled" : ""} aria-haspopup="listbox" aria-expanded="false" aria-label="Slot ${index + 1} lift-off"><span>${level ?? "—"}</span><i aria-hidden="true"></i></button>
          <ul class="lod-select-menu" role="listbox" data-dpi-slot-lod="${index}" aria-label="Slot ${index + 1} lift-off">${lodOptions}</ul>
        </div>
      </div>`;
    }).join("");
    // Column headings once, rather than a label on every field: at this card
    // width the repeated labels were squeezing the inputs they described.
    list.insertAdjacentHTML("afterbegin",
      `<div class="dpi-slot-row dpi-slot-head"><span></span><span>X</span><span></span><span>Y</span><span>Lift-off</span></div>`);
  }

  setText("#dpi-slot-note", locked
    ? "Read-only: writing DPI slots to a profile is not enabled yet, because the flash write sequence has not been verified on hardware."
    : `Each slot stores its own X/Y sensitivity and lift-off level. ${limits.minDpi}–${limits.maxDpi} DPI in steps of ${limits.stepDpi}. The highlighted slot is the one the mouse starts on.`);
}

async function reloadOnboardProfiles(): Promise<void> {
  const client = activeClient;
  if (!client || onboardProfilesLoading) return;
  onboardProfilesLoading = true;
  setText("#onboard-status", "Reading onboard profiles…");
  try {
    onboardProfiles = await client.readOnboardProfiles();
    renderOnboardProfiles();
  } catch (error) {
    recordDiagnosticError(error, "Unable to read onboard profiles.");
    setText("#onboard-status", error instanceof Error ? error.message : "Unable to read onboard profiles.");
  } finally {
    onboardProfilesLoading = false;
  }
}

async function resetLogitechProfiles(): Promise<void> {
  const client = activeClient;
  if (!client || settingInProgress || lastProfileFormat?.id !== 7) return;

  const stagedWarning = hasPendingChanges()
    ? "\n\nYour staged, unflashed changes will also be discarded."
    : "";
  const confirmed = window.confirm(
    "Delete every onboard profile and restore Logitech defaults?\n\n"
    + "This permanently erases all stored DPI stages, polling rates, lift-off distances, button assignments, G-Shift mappings, lighting, names, timeouts and every other byte in onboard profile memory. Fresh default profiles will be written back, with profile 1 as the only enabled profile. This cannot be undone in OpenMouse."
    + stagedWarning,
  );
  if (!confirmed) return;

  settingInProgress = true;
  clearPendingChanges();
  setText("#read-status", "Resetting every onboard profile…");
  setText("#onboard-status", "Writing Logitech factory defaults…");
  recordDiagnosticCommand("Reset every Logitech onboard profile to factory defaults");
  configureProfileCapture(latestDeviceStatus);
  try {
    await client.resetAllOnboardProfiles();
    onboardProfiles = await client.readOnboardProfiles();
    editedProfile = onboardProfiles[0]?.sector ?? "host";
    lastDeviceMode = "Onboard";
    const status = await client.readStatus();
    latestDeviceStatus = status;
    deviceStatuses.set(client.device, status);
    showStatus(status);
    setText("#read-status", "All onboard profiles were reset to Logitech defaults.");
    setText("#onboard-status", "Reset complete. Profile 1 is active; the other profiles are disabled.");
  } catch (error) {
    recordDiagnosticError(error, "Unable to reset every onboard profile.");
    const message = error instanceof Error ? error.message : "Unable to reset every onboard profile.";
    setText("#read-status", message);
    setText("#onboard-status", message);
    // Some earlier sectors may already have been written. Re-read the device so
    // the UI never pretends an interrupted destructive operation was atomic.
    onboardProfiles = null;
    await reloadOnboardProfiles();
  } finally {
    endDeviceWrite();
    configureProfileCapture(latestDeviceStatus);
  }
}

/**
 * Whether the profile list is expanded. Deliberately sticky: opening a profile
 * to edit it does not collapse the list, so several can be compared or switched
 * between without reopening it each time.
 */
let profilesExpanded = false;

function toggleProfilesExpanded(): void {
  profilesExpanded = !profilesExpanded;
  renderProfileSummary();
  syncDisclosureHeight();
}

/**
 * Drives the open/close animation from the content's measured height.
 *
 * Called after the list is rendered, not before, so growing or shrinking the
 * list while it is open animates to the new size instead of keeping a stale one.
 */
function syncDisclosureHeight(): void {
  const body = document.querySelector<HTMLElement>("#profile-disclosure-body");
  const inner = document.querySelector<HTMLElement>(".profile-disclosure-inner");
  if (!body || !inner) return;
  body.style.maxHeight = profilesExpanded ? `${inner.scrollHeight}px` : "0px";
}

/** Describes one entry the way the collapsed summary shows it. */
function describeProfileEntry(entry: OnboardProfile | null): { name: string; detail: string } {
  if (!entry) {
    return {
      name: `Host${lastDeviceMode === "Host" ? " · active" : ""}`,
      detail: "Live settings, not stored on the mouse",
    };
  }
  const dpi = entry.dpiStages.length > 0
    ? `${entry.dpiStages.length} DPI slot${entry.dpiStages.length === 1 ? "" : "s"}`
    : "no DPI slots";
  const rate = entry.reportRateWireless ? `${entry.reportRateWireless.toLocaleString()} Hz` : "—";
  return {
    name: `${entry.name ?? `Profile ${entry.sector}`}${entry.isCurrent && lastDeviceMode !== "Host" ? " · active" : ""}`,
    detail: [dpi, rate, entry.enabled ? null : "disabled"].filter(Boolean).join(" · "),
  };
}

function renderProfileSummary(): void {
  const section = document.querySelector<HTMLElement>("#logitech-onboard");
  const toggle = document.querySelector<HTMLButtonElement>("#profile-disclosure-toggle");
  if (!section || !toggle) return;
  section.classList.toggle("is-open", profilesExpanded);
  toggle.setAttribute("aria-expanded", String(profilesExpanded));

  const { name, detail } = describeProfileEntry(editedProfileEntry());
  setText("#profile-summary-name", name);
  setText("#profile-summary-detail", detail);
}

function renderOnboardProfiles(): void {
  // Runs first so the row hides itself when no profile is loaded.
  syncEditedProfile();
  renderBunnyHop();
  syncDpiSlotPlan();
  renderDpiSlots();
  renderProfileRates();
  renderProfileSummary();
  const list = document.querySelector<HTMLElement>("#onboard-profile-list");
  if (!list) return;
  if (!onboardProfiles) {
    list.innerHTML = "";
    return;
  }
  if (onboardProfiles.length === 0) {
    list.innerHTML = "";
    setText("#onboard-status", "This mouse reported no onboard profiles.");
    return;
  }

  // Two independent states: which entry is open for editing, and what the mouse
  // is actually running. Opening host must not change what is marked active.
  const hostOpened = editedProfile === "host";
  const hostRunning = lastDeviceMode === "Host";
  const profileLayoutVerified = lastProfileFormat?.verified === true;
  const profileNameLimit = lastProfileFormat ? capabilitiesForFormat(lastProfileFormat.id).maxNameLength : null;
  // Host is a live, volatile source rather than a stored profile, so it is
  // listed apart from them rather than mixed in.
  // Host gets the same split as a profile row: open it to see its settings,
  // use the circle to actually put the mouse into host mode.
  const hostTags = [hostRunning ? "active" : null, hostOpened ? "editing" : null].filter(Boolean).join(" · ");
  const hostRow = `<div style="display:flex;gap:.55rem;align-items:center;padding:.45rem .6rem;border:1px solid ${hostOpened ? "#4a4a52" : "#26262a"};border-radius:7px;background:${hostOpened ? "#1b1b1f" : "#141416"}">
      <button type="button" data-onboard-profile="host" title="Open host settings" style="display:flex;gap:.55rem;align-items:center;flex:1;min-width:0;text-align:left;background:none;border:0;padding:0;cursor:pointer">
        <span class="device-dot${hostRunning ? "" : " is-idle"}"></span>
        <span class="profile-row-text" style="display:flex;flex-direction:column;min-width:0">
          <strong style="font-size:.72rem;color:#e6e6ea">Host — live${hostTags ? ` · ${hostTags}` : ""}</strong>
          <small style="color:#77777c;font-size:.62rem">Settings applied by software, not stored on the mouse. Lost on power-cycle.</small>
        </span>
      </button>
      <button type="button" data-onboard-mode="Host" ${hostRunning ? "disabled" : ""} title="${hostRunning ? "The mouse is already in host mode" : "Switch the mouse to host mode"}" aria-label="Switch to host mode" aria-pressed="${hostRunning}" style="display:flex;padding:.3rem;border:1px solid ${hostRunning ? "#4a4a52" : "#3a3a3f"};border-radius:5px;background:#19191c;cursor:${hostRunning ? "not-allowed" : "pointer"}">
        ${hostRunning ? ICON_RUNNING : ICON_ACTIVATE}
      </button>
    </div>
    <div style="display:flex;align-items:center;gap:.5rem;margin:.15rem 0 .05rem"><span style="height:1px;flex:1;background:#26262a"></span><small style="color:#5c5c62;font-size:.58rem;letter-spacing:.04em">STORED ON THE MOUSE</small><span style="height:1px;flex:1;background:#26262a"></span></div>
    <small style="display:block;margin:0 0 .2rem;color:#5c5c62;font-size:.58rem">Click a profile to edit it. Use the circle to switch the mouse to it.</small>`;

  list.innerHTML = hostRow + onboardProfiles.map((profile) => {
    const dpi = profile.dpiStages.length > 0
      ? profile.dpiStages.map((stage) => (stage.x === stage.y ? `${stage.x}` : `${stage.x}/${stage.y}`)).join(" · ")
      : "no DPI stages";
    const rate = profile.reportRateWireless ? `${profile.reportRateWireless.toLocaleString()} Hz` : "—";
    const detail = [
      `${dpi} DPI`,
      rate,
      profile.enabled ? "enabled" : "disabled",
      profile.crcValid ? null : "checksum mismatch",
    ].filter(Boolean).join(" · ");
    // An unverified layout may be decoding the wrong bytes entirely, so the
    // values are shown but nothing may act on them.
    const locked = !profileLayoutVerified;
    // Being open for editing and being the profile the mouse runs are separate
    // states: you can change any stored profile without switching to it.
    const opened = editedProfile === profile.sector;
    const nameable = profileNameLimit !== null;
    const running = profile.isCurrent && !hostRunning;
    const border = opened ? "#4a4a52" : "#26262a";
    const tags = [running ? "active" : null, opened ? "editing" : null].filter(Boolean).join(" · ");
    return `<div style="display:flex;gap:.55rem;align-items:center;padding:.45rem .6rem;border:1px solid ${border};border-radius:7px;background:${opened ? "#1b1b1f" : "#141416"};opacity:${profile.enabled ? "1" : ".55"}">
      <button type="button" data-onboard-profile="${profile.sector}" ${locked ? "disabled" : ""} title="${locked ? "This profile layout has not been verified on hardware" : "Open this profile to edit it"}" style="display:flex;gap:.55rem;align-items:center;flex:1;min-width:0;text-align:left;background:none;border:0;padding:0;cursor:${locked ? "not-allowed" : "pointer"}">
        <span class="device-dot${running ? "" : " is-idle"}"></span>
        <span class="profile-row-text" style="display:flex;flex-direction:column;min-width:0">
          <strong style="font-size:.72rem;color:#e6e6ea">${escapeHtml((opened && stagedProfileName) || profile.name || `Profile ${profile.sector}`)}${tags ? ` · ${tags}` : ""}</strong>
          <small style="color:#77777c;font-size:.62rem">${escapeHtml(detail)}</small>
        </span>
      </button>
      <button type="button" data-profile-rename="${profile.sector}" ${locked || !nameable ? "disabled" : ""} title="${!nameable ? "This profile format has no name field" : "Rename this profile"}" aria-label="Rename profile ${profile.sector}" style="display:flex;padding:.3rem;border:1px solid #3a3a3f;border-radius:5px;background:#19191c;cursor:${locked || !nameable ? "not-allowed" : "pointer"};opacity:${locked || !nameable ? ".4" : "1"}">
        ${ICON_RENAME}
      </button>
      <button type="button" data-profile-activate="${profile.sector}" ${locked || running || !profile.enabled ? "disabled" : ""} title="${running ? "The mouse is running this profile" : !profile.enabled ? "Enable this profile before switching to it" : "Switch the mouse to this profile"}" aria-label="Switch to profile ${profile.sector}" aria-pressed="${running}" style="display:flex;padding:.3rem;border:1px solid ${running ? "#4a4a52" : "#3a3a3f"};border-radius:5px;background:#19191c;cursor:${locked || running || !profile.enabled ? "not-allowed" : "pointer"};opacity:${locked || !profile.enabled ? ".4" : "1"}">
        ${running ? ICON_RUNNING : ICON_ACTIVATE}
      </button>
      <button type="button" data-profile-enabled="${profile.sector}" data-enabled="${profile.enabled}" ${locked ? "disabled" : ""} title="${locked ? "This profile layout has not been verified on hardware" : profile.enabled ? "Disable this profile" : "Enable this profile"}" aria-label="${profile.enabled ? "Disable" : "Enable"} profile ${profile.sector}" style="display:flex;padding:.3rem;border:1px solid #3a3a3f;border-radius:5px;background:#19191c;cursor:${locked ? "not-allowed" : "pointer"};opacity:${locked ? ".4" : "1"}">
        ${profile.enabled ? ICON_ENABLED : ICON_DISABLED}
      </button>
    </div>`;
  }).join("");

  if (!profileLayoutVerified) {
    setText("#onboard-status", `Profile format ${lastProfileFormat?.id ?? "?"} has not been verified on hardware — shown for reference only, and locked. Send a capture so it can be confirmed.`);
    syncDisclosureHeight();
    return;
  }
  const active = onboardProfiles.find((profile) => profile.isCurrent);
  setText("#onboard-status", hostOpened
    ? "Running live from software. Stored profiles are unchanged."
    : active
      ? `Running from ${active.name ?? `slot ${active.sector}`}. Profile contents are read-only for now.`
      : "Profile contents are read-only for now.");
  // Last, so the animation measures the list that was just rendered.
  syncDisclosureHeight();
}


function applyLogitechAnalogButtons(): void {
  if (!activeClient) return;
  const tuning = readAnalogTuning("both");
  stageAnalogButton(0, tuning);
  stageAnalogButton(1, tuning);
}

function applyPollingRate(rate: number): void {
  if (!hasActiveClient()) return;
  stageChange({
    key: "polling-rate",
    label: `${rate.toLocaleString()} Hz`,
    command: `Set polling rate to ${rate.toLocaleString()} Hz`,
    progress: `Setting ${rate.toLocaleString()} Hz…`,
    preview: (status) => {
      status.pollingRateHz = rate;
    },
    apply: async () => {
      await requireClientMethod("setPollingRate", "the polling rate").setPollingRate(rate);
    },
  });
}

function applyLiftOffDistance(lod: NonNullable<MouseStatus["liftOffDistance"]>): void {
  if (!hasActiveClient()) return;
  stageChange({
    key: "lift-off-distance",
    label: `${lod} lift-off`,
    command: `Set lift-off distance to ${lod}`,
    progress: `Setting ${lod.toLowerCase()} lift-off distance…`,
    preview: (status) => {
      status.liftOffDistance = lod;
      // Writing a tracking level is also how a mouse with a pair leaves
      // asymmetric mode, so the switch has to follow.
      if (status.asymmetricLiftOff) status.asymmetricLiftOff = { ...status.asymmetricLiftOff, enabled: false };
    },
    apply: async () => {
      await requireClientMethod("setLiftOffDistance", "the lift-off distance").setLiftOffDistance(lod);
    },
  });
}

/**
 * Mice that expose separate cut-off and re-engage heights get a mode switch, in
 * the shape the vendor software uses: one control or the other, never both.
 * Drivers that do not report the pair never see the switch and keep the plain
 * three-stop control.
 */
function renderAsymmetricLiftOff(status: MouseStatus, settingsPending: boolean): void {
  const pair = status.asymmetricLiftOff;
  const modeRow = document.querySelector<HTMLElement>("#lod-mode-row");
  const single = document.querySelector<HTMLElement>("#lod-single");
  const asymmetric = document.querySelector<HTMLElement>("#lod-asymmetric");
  if (!modeRow || !single || !asymmetric) return;
  modeRow.hidden = !pair;
  // A driver that cannot establish the mode leaves both buttons unselected
  // rather than claiming one, and the single control stays visible. Choosing
  // either mode writes it, so one click makes the display true.
  const showPair = pair?.enabled === true;
  single.hidden = Boolean(pair) && showPair;
  asymmetric.hidden = !showPair;
  document.querySelectorAll<HTMLButtonElement>("[data-lod-mode]").forEach((button) => {
    const isPair = button.dataset.lodMode === "asymmetric";
    setSelected(button, pair?.enabled === null ? false : isPair === showPair);
    button.disabled = settingsPending || !pair;
  });
  if (!pair) return;
  for (const [selector, value, range] of [
    ["#lod-lift-off", pair.liftOff, pair.liftOffRange],
    ["#lod-landing", pair.landing, pair.landingRange],
  ] as const) {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (!input) continue;
    input.min = String(range.min);
    input.max = String(range.max);
    input.value = String(value);
    input.disabled = settingsPending;
  }
  capLandingToLiftOff();
}

/**
 * Landing is bounded by lift-off on the device, and the vendor software caps its
 * own slider the same way. Enforcing it on the control means an invalid pair is
 * not expressible, rather than accepted and then quietly altered — the firmware
 * stores an inverted pair without complaint, so nothing downstream would catch
 * it. The driver still caps as a backstop.
 */
export function capLandingToLiftOff(): void {
  const liftOff = document.querySelector<HTMLInputElement>("#lod-lift-off");
  const landing = document.querySelector<HTMLInputElement>("#lod-landing");
  if (!liftOff || !landing) return;
  // Clamp the value, never the range. A range input positions its thumb
  // relative to its own bounds, so narrowing `max` to the ceiling made the
  // thumb slide across the track whenever lift-off moved even though the
  // number under it had not changed. Both sliders keep the device's full range,
  // which also lines the two tracks up: they are the same 24 steps wide, offset
  // by one, so a landing sitting just below its lift-off reads that way.
  const ceiling = Math.max(Number(landing.min), Number(liftOff.value) - 1);
  if (Number(landing.value) > ceiling) landing.value = String(ceiling);
  setText("#lod-lift-off-value", liftOff.value);
  setText("#lod-landing-value", landing.value);
}

/** Both modes are set by writing one, because the mouse honours the last write. */
function applyLiftOffMode(mode: "single" | "asymmetric"): void {
  const status = withPendingChanges(latestDeviceStatus ?? ({} as MouseStatus));
  const pair = status.asymmetricLiftOff;
  if (!latestDeviceStatus || !pair) return;
  if (mode === "asymmetric") applyAsymmetricLiftOff(pair.liftOff, pair.landing);
  else applyLiftOffDistance(status.liftOffDistance ?? "Medium");
}

function applyAsymmetricLiftOff(liftOff: number, requested: number): void {
  if (!hasActiveClient()) return;
  // Capped here too, so the staged label and the preview show what will actually
  // be written rather than what was asked for.
  const landing = Math.min(requested, liftOff - 1);
  stageChange({
    key: "lift-off-distance",
    label: `Lift-off ${liftOff} / landing ${landing}`,
    command: `Set lift-off to ${liftOff} and landing to ${landing}`,
    progress: `Setting lift-off ${liftOff} and landing ${landing}…`,
    preview: (status) => {
      if (!status.asymmetricLiftOff) return;
      status.asymmetricLiftOff = { ...status.asymmetricLiftOff, enabled: true, liftOff, landing };
    },
    apply: async () => {
      await requireClientMethod("setLiftOff", "the lift-off distance").setLiftOff(liftOff, landing);
    },
  });
}

/**
 * Gaming surface and LightForce are two fields of one 0x8090 byte, so they are
 * staged as a group and written together. Each apply sends the whole group's
 * staged state; whichever runs is the last one staged.
 */
const MODE_STATUS_GROUP = "logitech-mode-status";
let stagedGamingSurface: MouseStatus["gamingSurfaceMode"] = null;
let stagedLightforce: MouseStatus["lightforceSwitchMode"] = null;

async function writeStagedModeStatus(): Promise<void> {
  if (!activeClient) throw new Error("The mouse is no longer connected.");
  await activeClient.setModeStatus({
    gamingSurface: stagedGamingSurface,
    lightforce: stagedLightforce,
  });
}

function applyGamingSurfaceMode(mode: NonNullable<MouseStatus["gamingSurfaceMode"]>): void {
  if (!activeClient) return;
  stagedGamingSurface = mode;
  stageChange({
    key: "gaming-surface",
    group: MODE_STATUS_GROUP,
    label: `Gaming surface ${mode.toLowerCase()}`,
    command: `Set gaming surface to ${mode}`,
    progress: `Setting gaming surface to ${mode.toLowerCase()}…`,
    preview: (status) => { status.gamingSurfaceMode = mode; },
    apply: writeStagedModeStatus,
  });
}

function applyLightforceSwitchMode(mode: NonNullable<MouseStatus["lightforceSwitchMode"]>): void {
  if (!activeClient) return;
  stagedLightforce = mode;
  stageChange({
    key: "lightforce-switch-mode",
    group: MODE_STATUS_GROUP,
    label: `LightForce ${mode.toLowerCase()}`,
    command: `Set LightForce switches to ${mode}`,
    progress: `Setting LightForce switches to ${mode.toLowerCase()}…`,
    preview: (status) => { status.lightforceSwitchMode = mode; },
    apply: writeStagedModeStatus,
  });
}

function toggleDongleLed(): void {
  const button = document.querySelector<HTMLButtonElement>("#dongle-led-toggle");
  if (!button || !activePulsarClient) return;
  const enabled = button.dataset.enabled !== "true";
  stageChange({
    key: "dongle-led",
    label: `Receiver LED ${enabled ? "on" : "off"}`,
    command: `${enabled ? "Enable" : "Disable"} receiver LED`,
    progress: `${enabled ? "Enabling" : "Disabling"} the receiver LED…`,
    preview: (status) => {
      status.dongleLedEnabled = enabled;
    },
    apply: async () => {
      if (!activePulsarClient) throw new Error("The receiver is no longer connected.");
      await activePulsarClient.setDongleLed(enabled);
    },
  });
}

type PulsarToggleSetting = "motionSync" | "angleSnapping" | "rippleControl" | "performanceMode";

function applyPulsarToggle(setting: PulsarToggleSetting, enabled: boolean): void {
  if (!hasActiveClient()) return;
  stageChange({
    key: setting,
    label: `${settingLabel(setting)} ${enabled ? "on" : "off"}`,
    command: `${enabled ? "Enable" : "Disable"} ${settingLabel(setting)}`,
    progress: `${enabled ? "Enabling" : "Disabling"} ${settingLabel(setting)}…`,
    preview: (status) => {
      status[setting] = enabled;
    },
    apply: async () => {
      if (setting === "motionSync") await requireClientMethod("setMotionSync", "Motion Sync").setMotionSync(enabled);
      if (setting === "angleSnapping") await requireClientMethod("setAngleSnapping", "angle snapping").setAngleSnapping(enabled);
      if (setting === "rippleControl") await requireClientMethod("setRippleControl", "ripple control").setRippleControl(enabled);
      if (setting === "performanceMode") await requireClientMethod("setPerformanceMode", "performance mode").setPerformanceMode(enabled);
    },
  });
}

function settingLabel(setting: PulsarToggleSetting): string {
  return ({
    motionSync: "Motion Sync",
    angleSnapping: "angle snapping",
    rippleControl: "ripple control",
    performanceMode: activeTeevolutionClient ? "highest performance" : "performance mode",
  } as const)[setting];
}

function applyTeevolutionSensorMode(mode: NonNullable<MouseStatus["sensorMode"]>): void {
  if (!activeTeevolutionClient) return;
  stageChange({
    key: "teevolution-sensor-mode",
    label: `Sensor mode ${mode}`,
    command: `Set sensor mode to ${mode}`,
    progress: `Setting sensor mode to ${mode}…`,
    preview: (status) => {
      status.sensorMode = mode;
      status.sensorModeStored = mode === "High" ? 1 : 0;
    },
    apply: async () => {
      await requireClientMethod("setSensorMode", "sensor mode").setSensorMode(mode);
    },
  });
}

function applyTeevolutionPerformanceDuration(duration: number): void {
  if (!activeTeevolutionClient) return;
  const label = sleepLabel(duration * 10);
  stageChange({
    key: "teevolution-performance-duration",
    label: `Highest performance ${label}`,
    command: `Set highest-performance duration to ${label}`,
    progress: "Setting highest-performance duration…",
    preview: (status) => {
      status.performanceDuration = duration;
    },
    apply: async () => {
      await requireClientMethod("setPerformanceDuration", "highest-performance duration").setPerformanceDuration(duration);
    },
  });
}

const TEEVOLUTION_DPI_LIGHT_GROUP = "teevolution-dpi-lighting";

async function writeStagedTeevolutionDpiLighting(): Promise<void> {
  if (!activeTeevolutionClient || !latestDeviceStatus) {
    throw new Error("The Teevolution mouse is no longer connected.");
  }
  const status = withPendingChanges(latestDeviceStatus);
  await activeTeevolutionClient.setDpiLighting(
    status.dpiLedMode ?? 0,
    status.dpiLedBrightness ?? 5,
    status.dpiLedSpeed ?? 3,
  );
}

function applyTeevolutionDpiLighting(setting: "mode" | "brightness" | "speed", value: number): void {
  if (!activeTeevolutionClient) return;
  const names = { mode: "effect", brightness: "brightness", speed: "speed" } as const;
  const display = setting === "mode" ? (["Off", "Steady", "Breathing"][value] ?? `${value}`) : `${value}`;
  stageChange({
    key: `teevolution-dpi-light-${setting}`,
    group: TEEVOLUTION_DPI_LIGHT_GROUP,
    label: `DPI light ${names[setting]} ${display}`,
    command: `Set DPI light ${names[setting]} to ${display}`,
    progress: `Setting DPI light ${names[setting]}…`,
    preview: (status) => {
      if (setting === "mode") status.dpiLedMode = value;
      if (setting === "brightness") status.dpiLedBrightness = value;
      if (setting === "speed") status.dpiLedSpeed = value;
    },
    apply: writeStagedTeevolutionDpiLighting,
  });
}

function applyEggFilter(setting: "slamclick" | "motionJitter", enabled: boolean): void {
  if (!activeEggClient) return;
  const label = setting === "slamclick" ? "slamclick filter" : "motion-jitter filter";
  stageChange({
    key: `egg-${setting}`,
    label: `${label} ${enabled ? "on" : "off"}`,
    command: `${enabled ? "Enable" : "Disable"} ${label}`,
    progress: `${enabled ? "Enabling" : "Disabling"} ${label}…`,
    preview: (status) => {
      if (setting === "slamclick") status.slamclickFilter = enabled;
      else status.motionJitterFilter = enabled;
    },
    apply: async () => {
      if (!activeEggClient) throw new Error("The mouse is no longer connected.");
      if (setting === "slamclick") await activeEggClient.setSlamclickFilter(enabled);
      else await activeEggClient.setMotionJitterFilter(enabled);
    },
  });
}

function applyEggSpdtMode(button: "left" | "right", mode: EggSpdtMode): void {
  if (!activeEggClient) return;
  stageChange({
    key: `egg-spdt-${button}`,
    label: `${button === "left" ? "Left" : "Right"} GX ${mode}`,
    command: `Set ${button} button GX mode to ${mode}`,
    progress: `Setting the ${button} button to ${mode}…`,
    preview: (status) => {
      if (button === "left") status.leftSpdtMode = mode;
      else status.rightSpdtMode = mode;
    },
    apply: async () => {
      if (!activeEggClient) throw new Error("The mouse is no longer connected.");
      await activeEggClient.setSpdtMode(button, mode);
    },
  });
}

function updateCustomPollingPreview(): void {
  const divider = Number(document.querySelector<HTMLInputElement>("#egg-polling-divider")?.value);
  setText("#egg-polling-result", Number.isInteger(divider) && divider > 0 && divider <= 255
    ? `Result: ${(8000 / divider).toLocaleString(undefined, { maximumFractionDigits: 2 })} Hz`
    : "Enter a divider from 1 to 255.");
}


function applyEggCpiLevels(levels: number): void {
  stageEggChange({
    key: "egg-cpi-levels",
    label: `${levels} CPI stage${levels === 1 ? "" : "s"}`,
    what: "CPI stage count",
    preview: (status) => {
      status.eggCpiLevels = levels;
    },
    change: async (client) => client.setCpiLevels(levels),
  });
}

function applyEggCpiStage(level: number, x: number, y: number): void {
  stageEggChange({
    key: `egg-cpi-stage-${level}`,
    label: `CPI stage ${level + 1} → ${x === y ? x.toLocaleString() : `${x.toLocaleString()}/${y.toLocaleString()}`}`,
    what: `CPI stage ${level + 1}`,
    preview: (status) => {
      const stage = status.eggCpiStages?.[level];
      if (stage) {
        stage.x = x;
        stage.y = y;
      }
    },
    change: async (client) => client.setCpiStage(level, x, y),
  });
}

function applyEggPollingDivider(divider: number): void {
  stageEggChange({
    key: "egg-polling-divider",
    label: `Polling divider ${divider}`,
    what: "custom polling divider",
    preview: (status) => {
      status.eggPollingDivider = divider;
    },
    change: async (client) => client.setCustomPollingDivider(divider),
  });
}

function applyEggMulticlick(button: EggButtonIndex, value: number): void {
  stageEggChange({
    key: `egg-multiclick-${button}`,
    label: `${EGG_BUTTON_NAMES[button]} multiclick ${value}`,
    what: `${EGG_BUTTON_NAMES[button]} multiclick filter`,
    preview: (status) => {
      if (status.eggMulticlickFilters) status.eggMulticlickFilters[button] = value;
    },
    change: async (client) => client.setMulticlickFilter(button, value),
  });
}

function applyEggButtonMapping(button: EggButtonIndex, mapping: EggButtonMapping): void {
  stageEggChange({
    key: `egg-mapping-${button}`,
    label: `${EGG_BUTTON_NAMES[button]} → ${mapping}`,
    what: `${EGG_BUTTON_NAMES[button]} mapping`,
    preview: (status) => {
      if (status.eggButtonMappings) status.eggButtonMappings[button] = mapping;
    },
    change: async (client) => client.setButtonMapping(button, mapping),
  });
}

function stageEggChange(options: {
  key: string;
  label: string;
  what: string;
  preview: PendingChange["preview"];
  change: (client: EggOp1HidClient) => Promise<void>;
}): void {
  if (!activeEggClient) return;
  stageChange({
    key: options.key,
    label: options.label,
    command: `Change ${options.what}`,
    progress: `Changing ${options.what}…`,
    preview: options.preview,
    apply: async () => {
      if (!activeEggClient) throw new Error("The mouse is no longer connected.");
      await options.change(activeEggClient);
    },
  });
}

function applyPulsarValue(setting: "debounce" | "sleep", value: number): void {
  if (!(activePulsarClient ?? activeDmClient ?? activeOrbitalClient ?? activeRazerClient ?? activeViperClient ?? activeTeevolutionClient ?? activeVgnClient)) return;
  const asleep = value !== WLMOUSE_SLEEP_NEVER;
  stageChange({
    key: setting,
    label: setting === "debounce"
      ? `${value} ms debounce`
      : asleep ? `Auto sleep ${sleepLabel(value)}` : "Auto sleep off",
    command: setting === "debounce" ? `Set debounce to ${value} ms` : `Set auto sleep to ${value} seconds`,
    progress: `Setting ${setting === "debounce" ? `${value} ms debounce` : "auto sleep"}…`,
    preview: (status) => {
      if (setting === "debounce") status.debounceMs = value;
      // Drivers report a disabled sleep timer as null, so mirror that here.
      else status.sleepTimeout = asleep ? value : null;
    },
    // Checked per setting rather than per client: a driver may confirm the sleep
    // command without confirming a debounce one, and the Razer driver does.
    apply: async () => {
      if (setting === "debounce") await requireClientMethod("setDebounceTime", "the debounce time").setDebounceTime(value);
      else await requireClientMethod("setSleepTimeout", "auto sleep").setSleepTimeout(value);
    },
  });
}

function applyLowPowerThreshold(percent: number): void {
  if (!activeRazerClient) return;
  stageChange({
    key: "low-power",
    label: `Low power below ${percent}%`,
    command: `Set low power mode to ${percent}%`,
    progress: "Setting low power mode…",
    preview: (status) => {
      status.lowBatteryWarning = percent;
    },
    apply: async () => {
      await requireClientMethod("setLowPowerThreshold", "low power mode").setLowPowerThreshold(percent);
    },
  });
}

function applyProSetting(setting: "wheelAcceleration" | "angleTuning" | "profile", value: boolean | number): void {
  if (!(activePulsarClient instanceof PulsarProHidClient)) return;
  const what = setting === "wheelAcceleration" ? "wheel acceleration" : setting === "angleTuning" ? "angle tuning" : "onboard profile";
  stageChange({
    key: `pro-${setting}`,
    label: setting === "wheelAcceleration"
      ? `Wheel acceleration ${value ? "on" : "off"}`
      : setting === "angleTuning" ? `Angle tuning ${value}°` : `Profile ${value}`,
    command: `Change ${what}`,
    progress: `Changing ${what}…`,
    preview: (status) => {
      if (setting === "wheelAcceleration") status.wheelAcceleration = Boolean(value);
      if (setting === "angleTuning") status.angleTuning = Number(value);
      if (setting === "profile") status.activeProfile = Number(value);
    },
    apply: async () => {
      if (!(activePulsarClient instanceof PulsarProHidClient)) throw new Error("The mouse is no longer connected.");
      if (setting === "wheelAcceleration") await activePulsarClient.setWheelAcceleration(Boolean(value));
      if (setting === "angleTuning") await activePulsarClient.setAngleTuning(Number(value));
      if (setting === "profile") await activePulsarClient.setProfile(Number(value));
    },
  });
}

function applyFinalmouseSetting(setting: "dongleLed" | "tournamentScroll" | "tournamentTimeout", value: number): void {
  if (!activeFinalmouseClient) return;
  const label = ({
    dongleLed: "dongle LED mode",
    tournamentScroll: "tournament scroll mode",
    tournamentTimeout: "tournament scroll timeout",
  } as const)[setting];
  const key = ({
    dongleLed: "finalmouse-dongle-led",
    tournamentScroll: "finalmouse-tournament-scroll",
    tournamentTimeout: "finalmouse-tournament-timeout",
  } as const)[setting];
  stageChange({
    key,
    label: `Finalmouse ${label}`,
    command: `Change Finalmouse ${label}`,
    progress: `Changing Finalmouse ${label}…`,
    preview: (status) => {
      if (setting === "dongleLed") status.finalmouseDongleLedMode = value;
      if (setting === "tournamentScroll") status.finalmouseTournamentScrollMode = value;
      if (setting === "tournamentTimeout") status.finalmouseTournamentScrollTimeoutMs = value;
    },
    apply: async () => {
      if (!activeFinalmouseClient) throw new Error("The Finalmouse UltralightX is no longer connected.");
      if (setting === "dongleLed") await activeFinalmouseClient.setDongleLedMode(value);
      if (setting === "tournamentScroll") await activeFinalmouseClient.setTournamentScrollMode(value);
      if (setting === "tournamentTimeout") await activeFinalmouseClient.setTournamentScrollTimeout(value);
    },
  });
}

function startAutomaticRefresh(): void {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  const client = activeSettingsClient();
  const interval = client && "pollIntervalMs" in client
    ? Number((client as { pollIntervalMs: number }).pollIntervalMs)
    : 5000;
  if (!interval || interval <= 0) {
    refreshTimer = null;
    return;
  }
  refreshTimer = window.setInterval(() => {
    void refreshStatus();
  }, interval);
}

async function refreshStatus(): Promise<void> {
  const client = activeSettingsClient();
  if (!client || refreshInProgress || settingInProgress) return;
  if ("pollIntervalMs" in client && Number((client as { pollIntervalMs: number }).pollIntervalMs) <= 0) {
    return;
  }
  refreshInProgress = true;
  markHidActivity(BACKGROUND, { transient: true });
  try {
    const status = activeDmClient && client === activeDmClient
      ? await activeDmClient.readStatus(true)
      : await client.readStatus();
    const currentClient = activeSettingsClient();
    if (client !== currentClient || client.device !== activeDevice) return;
    if (JSON.stringify(status) !== lastRenderedStatusKey) showStatus(status);
  } catch (error) {
    lastRenderedStatusKey = null;
    const message = error instanceof Error ? error.message : "Unable to refresh the mouse status.";
    setText("#device-status", "Waiting to refresh");
    setText("#read-status", message);
  } finally {
    refreshInProgress = false;
  }
}

window.addEventListener("beforeunload", (event) => {
  if (hasPendingChanges()) event.preventDefault();
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  navigator.hid?.removeEventListener("connect", handleHidConnect);
  navigator.hid?.removeEventListener("disconnect", handleHidDisconnect);
  void activeClient?.close();
  void activePulsarClient?.close();
  void activeEggClient?.close();
  void activeEggWeClient?.close();
  void activeDmClient?.close();
  void activeOrbitalClient?.close();
  void activeRazerClient?.close();
  void activeTeevolutionClient?.close();
  void activeVgnClient?.close();
  void activeViperClient?.close();
  void activeFinalmouseClient?.close();
});

function isChromium(): boolean {
  const brands = (navigator as Navigator & {
    userAgentData?: { brands?: { brand: string }[] };
  }).userAgentData?.brands;
  if (brands) return brands.some((entry) => /chromium/i.test(entry.brand));
  return /Chrom(e|ium)\/|Edg\//.test(navigator.userAgent);
}

const notice = unsupportedNotice({
  hasWebHid: Boolean(navigator.hid),
  touchCapable: navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches,
  secureContext: window.isSecureContext,
  chromium: isChromium(),
});
if (notice) {
  appRoot.innerHTML = unsupportedTemplate(notice);
} else {
  renderControl();
  if (isSuperstrikePreview) showSuperstrikePreview();
  else if (isSlotsPreview) showSlotsPreview();
  else if (previewMode !== null) void showFixturePreview(previewMode);
}
