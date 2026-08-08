import type { EggSpdtMode } from "./devices/endgame/egg-op1-hid";
import type { MouseStatus } from "./devices/mouse-types";
import { clampBunnyHopMs } from "./devices/logitech/onboard-profiles";

type EggLiftOffLevel = NonNullable<MouseStatus["liftOffDistance"]>;

/** Closes every open lift-off menu; only one may be open at a time. */
function closeLodMenus(): void {
  document.querySelectorAll<HTMLElement>(".lod-select.is-open").forEach((select) => {
    select.classList.remove("is-open");
    select.querySelector("[data-lod-toggle]")?.setAttribute("aria-expanded", "false");
  });
}
type PulsarToggleSetting = "motionSync" | "angleSnapping" | "rippleControl" | "performanceMode";
type EggFilterSetting = "slamclick" | "motionJitter";

export interface ControlEventHandlers {
  connect(): Promise<void>;
  selectAuthorizedDevice(index: number): Promise<void>;
  openInterfaceSettings(): void;
  closeInterfaceSettings(): void;
  setInterfaceDensity(value: string): void;
  setInterfaceTheme(value: string): void;
  setReducedMotion(enabled: boolean): void;
  setExpandSections(enabled: boolean): void;
  setShowExperimental(enabled: boolean): void;
  toggleSidebar(): void;
  resetInterfacePreferences(): void;
  downloadDiagnostics(): void;
  resetLogitechProfiles(): Promise<void>;
  chooseCustomDpi(): void;
  sanitizeCustomDpi(): void;
  finishCustomDpiEditing(): void;
  applyLogitechAxisDpi(): void;
  applyLogitechAnalogButton(button: 0 | 1): void;
  applyLogitechAnalogButtons(): void;
  setSuperstrikeTuningMode(mode: "independent" | "both"): void;
  toggleDongleLed(): void;
  applyPulsarValue(setting: "debounce" | "sleep", value: number): void;
  toggleSleep(enabled: boolean): void;
  applyLowPowerThreshold(percent: number): void;
  applyPulsarToggle(setting: PulsarToggleSetting, enabled: boolean): void;
  applyTeevolutionSensorMode(mode: NonNullable<MouseStatus["sensorMode"]>): void;
  applyTeevolutionPerformanceDuration(duration: number): void;
  applyTeevolutionDpiLighting(setting: "mode" | "brightness" | "speed", value: number): void;
  applyEggFilter(setting: EggFilterSetting, enabled: boolean): void;
  applyEggSpdtMode(button: "left" | "right", mode: EggSpdtMode): void;
  applyEggCpiLevels(levels: number): void;
  updateCustomPollingPreview(): void;
  applyEggPollingDivider(divider: number): void;
  applyProSetting(setting: "wheelAcceleration" | "angleTuning" | "profile", value: boolean | number): void;
  applyFinalmouseSetting(setting: "dongleLed" | "tournamentScroll" | "tournamentTimeout", value: number): void;
  applyPollingRate(rate: number): void;
  applyLiftOffDistance(lod: NonNullable<MouseStatus["liftOffDistance"]>): void;
  applyLiftOffMode(mode: "single" | "asymmetric"): void;
  applyAsymmetricLiftOff(liftOff: number, landing: number): void;
  capLandingToLiftOff(): void;
  applyGamingSurfaceMode(mode: NonNullable<MouseStatus["gamingSurfaceMode"]>): void;
  applyLightforceSwitchMode(mode: NonNullable<MouseStatus["lightforceSwitchMode"]>): void;
  // Mode and profile selection apply immediately: both are volatile navigation
  // actions, and the profiles cannot be re-read until they have taken effect.
  applyOnboardMode(mode: "Onboard" | "Host"): Promise<void>;
  applyBunnyHopMs(milliseconds: number): void;
  setDpiSlotCount(count: number): void;
  setDpiSlotAxis(index: number, axis: "x" | "y", value: number): void;
  setDpiSlotLod(index: number, level: EggLiftOffLevel): void;
  setDpiSlotDefault(index: number): void;
  setDpiAxisLock(index: number, locked: boolean): void;
  /** Switches the mouse to a profile. */
  selectOnboardProfile(sector: number): Promise<void>;
  /** Opens a profile, or the host layer, without switching the mouse to it. */
  openOnboardProfile(sector: number | "host"): void;
  renameOnboardProfile(sector: number): void;
  /** Expands or collapses the profile list; selecting one does not close it. */
  toggleProfilesExpanded(): void;
  setProfileReportRate(link: "wireless" | "wired", hz: number): void;
  /** Slider positions are indices; this maps one back to hertz. */
  rateFromSlider(selector: string, index: number): number | null;
  /** Repaints a slider's readout and dots mid-drag, without staging anything. */
  previewRateSlider(selector: string, index: number): void;
  toggleOnboardProfileEnabled(sector: number, enabled: boolean): Promise<void>;
  reloadOnboardProfiles(): Promise<void>;
  flashPendingChanges(): Promise<void>;
  revertPendingChanges(): void;
}

function onClick(selector: string, listener: () => void): void {
  document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", listener);
}

export function bindControlEvents(handlers: ControlEventHandlers): void {
  const showDevice = (run: () => void) => () => {
    handlers.closeInterfaceSettings();
    run();
  };
  onClick("#connect-button", showDevice(() => void handlers.connect()));
  onClick("#empty-connect-button", showDevice(() => void handlers.connect()));
  document.querySelector<HTMLElement>("#sidebar-device-list")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-device-index]");
    if (button) showDevice(() => void handlers.selectAuthorizedDevice(Number(button.dataset.deviceIndex)))();
  });
  onClick("#pending-flash", () => void handlers.flashPendingChanges());
  onClick("#pending-revert", handlers.revertPendingChanges);
  onClick("#interface-settings-button", handlers.openInterfaceSettings);
  onClick("#close-interface-settings", handlers.closeInterfaceSettings);

  document.querySelector<HTMLSelectElement>("#interface-density")?.addEventListener("change", (event) => {
    handlers.setInterfaceDensity((event.target as HTMLSelectElement).value);
  });
  document.querySelector<HTMLSelectElement>("#interface-theme")?.addEventListener("change", (event) => {
    handlers.setInterfaceTheme((event.target as HTMLSelectElement).value);
  });
  document.querySelector<HTMLInputElement>("#interface-reduced-motion")?.addEventListener("change", (event) => {
    handlers.setReducedMotion((event.target as HTMLInputElement).checked);
  });
  document.querySelector<HTMLInputElement>("#interface-expand-sections")?.addEventListener("change", (event) => {
    handlers.setExpandSections((event.target as HTMLInputElement).checked);
  });
  document.querySelector<HTMLInputElement>("#interface-show-experimental")?.addEventListener("change", (event) => {
    handlers.setShowExperimental((event.target as HTMLInputElement).checked);
  });
  onClick("#sidebar-menu-toggle", handlers.toggleSidebar);
  onClick("#reset-interface-settings", handlers.resetInterfacePreferences);
  onClick("#download-diagnostics", handlers.downloadDiagnostics);
  onClick("#reset-logitech-profiles", () => void handlers.resetLogitechProfiles());
  onClick("#custom-dpi", () => void handlers.chooseCustomDpi());
  onClick("#apply-logitech-axes", () => void handlers.applyLogitechAxisDpi());
  onClick("#apply-logitech-left-button", () => void handlers.applyLogitechAnalogButton(0));
  onClick("#apply-logitech-right-button", () => void handlers.applyLogitechAnalogButton(1));
  onClick("#apply-logitech-both-buttons", () => void handlers.applyLogitechAnalogButtons());
  document.querySelectorAll<HTMLButtonElement>("[data-superstrike-tab]").forEach((button) => {
    button.addEventListener("click", () => handlers.setSuperstrikeTuningMode(button.dataset.superstrikeTab as "independent" | "both"));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-superstrike-input]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector<HTMLInputElement>(`#${button.dataset.superstrikeInput}`);
      if (!input || !button.dataset.superstrikeValue) return;
      input.value = button.dataset.superstrikeValue;
      document.querySelectorAll<HTMLButtonElement>(`[data-superstrike-input="${input.id}"]`).forEach((option) => {
        option.setAttribute("aria-pressed", String(option === button));
      });
    });
  });
  document.querySelector<HTMLInputElement>("#dpi-output")?.addEventListener("input", handlers.sanitizeCustomDpi);
  document.querySelector<HTMLInputElement>("#dpi-output")?.addEventListener("click", (event) => {
    if ((event.currentTarget as HTMLInputElement).readOnly) handlers.chooseCustomDpi();
  });
  document.querySelector<HTMLInputElement>("#dpi-output")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handlers.chooseCustomDpi();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      handlers.finishCustomDpiEditing();
    }
  });
  onClick("#dongle-led-toggle", () => void handlers.toggleDongleLed());

  for (let angle = -30; angle <= 30; angle += 1) {
    document.querySelector<HTMLSelectElement>("#angle-tuning-select")?.add(new Option(`${angle}°`, String(angle)));
  }
  document.querySelector<HTMLSelectElement>("#debounce-select")?.addEventListener("change", (event) => {
    void handlers.applyPulsarValue("debounce", Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLSelectElement>("#sleep-select")?.addEventListener("change", (event) => {
    void handlers.applyPulsarValue("sleep", Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLSelectElement>("#low-power-select")?.addEventListener("change", (event) => {
    void handlers.applyLowPowerThreshold(Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLButtonElement>("#sleep-toggle")?.addEventListener("click", (event) => {
    const enabled = (event.currentTarget as HTMLButtonElement).getAttribute("aria-checked") !== "true";
    void handlers.toggleSleep(enabled);
  });

  for (const [selector, setting] of [["#motion-sync-toggle", "motionSync"], ["#angle-snapping-toggle", "angleSnapping"], ["#ripple-control-toggle", "rippleControl"], ["#performance-mode-toggle", "performanceMode"]] as const) {
    document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", (event) => {
      void handlers.applyPulsarToggle(setting, (event.currentTarget as HTMLButtonElement).getAttribute("aria-checked") !== "true");
    });
  }
  document.querySelector<HTMLSelectElement>("#teevolution-sensor-mode")?.addEventListener("change", (event) => {
    const mode = (event.target as HTMLSelectElement).value as NonNullable<MouseStatus["sensorMode"]>;
    void handlers.applyTeevolutionSensorMode(mode);
  });
  document.querySelector<HTMLSelectElement>("#teevolution-performance-duration")?.addEventListener("change", (event) => {
    void handlers.applyTeevolutionPerformanceDuration(Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLSelectElement>("#teevolution-dpi-light-mode")?.addEventListener("change", (event) => {
    handlers.applyTeevolutionDpiLighting("mode", Number((event.target as HTMLSelectElement).value));
  });
  for (const setting of ["brightness", "speed"] as const) {
    const input = document.querySelector<HTMLInputElement>(`#teevolution-dpi-light-${setting}`);
    input?.addEventListener("input", () => {
      const output = document.querySelector<HTMLOutputElement>(`#teevolution-dpi-light-${setting}-output`);
      if (output) output.value = input.value;
    });
    input?.addEventListener("change", () => {
      handlers.applyTeevolutionDpiLighting(setting, Number(input.value));
    });
  }
  for (const [selector, setting] of [["#slamclick-filter-toggle", "slamclick"], ["#motion-jitter-filter-toggle", "motionJitter"]] as const) {
    document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", (event) => {
      void handlers.applyEggFilter(setting, (event.currentTarget as HTMLButtonElement).getAttribute("aria-checked") !== "true");
    });
  }
  document.querySelector<HTMLSelectElement>("#left-spdt-select")?.addEventListener("change", (event) => {
    void handlers.applyEggSpdtMode("left", (event.target as HTMLSelectElement).value as EggSpdtMode);
  });
  document.querySelector<HTMLSelectElement>("#right-spdt-select")?.addEventListener("change", (event) => {
    void handlers.applyEggSpdtMode("right", (event.target as HTMLSelectElement).value as EggSpdtMode);
  });
  document.querySelector<HTMLSelectElement>("#egg-cpi-levels")?.addEventListener("change", (event) => {
    void handlers.applyEggCpiLevels(Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLInputElement>("#egg-polling-divider")?.addEventListener("input", handlers.updateCustomPollingPreview);
  onClick("#apply-egg-polling", () => {
    const divider = Number(document.querySelector<HTMLInputElement>("#egg-polling-divider")?.value);
    void handlers.applyEggPollingDivider(divider);
  });
  document.querySelector<HTMLButtonElement>("#wheel-acceleration-toggle")?.addEventListener("click", (event) => {
    void handlers.applyProSetting("wheelAcceleration", (event.currentTarget as HTMLButtonElement).getAttribute("aria-checked") !== "true");
  });
  document.querySelector<HTMLSelectElement>("#angle-tuning-select")?.addEventListener("change", (event) => {
    void handlers.applyProSetting("angleTuning", Number((event.target as HTMLSelectElement).value));
  });
  document.querySelector<HTMLSelectElement>("#profile-select")?.addEventListener("change", (event) => {
    void handlers.applyProSetting("profile", Number((event.target as HTMLSelectElement).value));
  });
  // "change" rather than "input": dragging across stops must not stage every
  // rate it passes over, only the one the thumb is released on.
  document.querySelector<HTMLElement>("#host-rate-slider")?.addEventListener("change", (event) => {
    const hz = handlers.rateFromSlider("#host-rate-slider", Number((event.target as HTMLInputElement).value));
    if (hz !== null) void handlers.applyPollingRate(hz);
  });
  // Redraw while dragging so the readout and the lit dots follow the thumb.
  document.querySelector<HTMLElement>("#host-rate-slider")?.addEventListener("input", (event) => {
    handlers.previewRateSlider("#host-rate-slider", Number((event.target as HTMLInputElement).value));
  });
  for (const [selector, setting] of [
    ["#finalmouse-dongle-led", "dongleLed"],
    ["#finalmouse-tournament-scroll", "tournamentScroll"],
    ["#finalmouse-tournament-timeout", "tournamentTimeout"],
  ] as const) {
    document.querySelector<HTMLSelectElement>(selector)?.addEventListener("change", (event) => {
      handlers.applyFinalmouseSetting(setting, Number((event.target as HTMLSelectElement).value));
    });
  }
  document.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((button) => {
    button.addEventListener("click", () => {
      const lod = button.dataset.lod as MouseStatus["liftOffDistance"];
      if (lod) void handlers.applyLiftOffDistance(lod);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lod-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.lodMode;
      if (mode === "single" || mode === "asymmetric") handlers.applyLiftOffMode(mode);
    });
  });
  const liftOffSlider = document.querySelector<HTMLInputElement>("#lod-lift-off");
  const landingSlider = document.querySelector<HTMLInputElement>("#lod-landing");
  for (const slider of [liftOffSlider, landingSlider]) {
    // `input` keeps the readout and the landing ceiling honest while dragging;
    // `change` fires on release, so a drag stages one change rather than thirty.
    slider?.addEventListener("input", () => handlers.capLandingToLiftOff());
    slider?.addEventListener("change", () => {
      handlers.capLandingToLiftOff();
      const liftOff = Number(liftOffSlider?.value);
      const landing = Number(landingSlider?.value);
      if (Number.isFinite(liftOff) && Number.isFinite(landing)) handlers.applyAsymmetricLiftOff(liftOff, landing);
    });
  }
  document.querySelectorAll<HTMLButtonElement>("[data-gaming-surface]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.gamingSurface as MouseStatus["gamingSurfaceMode"];
      if (mode) void handlers.applyGamingSurfaceMode(mode);
    });
  });
  // The profile list is re-rendered wholesale, so its buttons are delegated.
  document.querySelector<HTMLElement>("#onboard-profile-list")?.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!target || target.disabled) return;

    if (target.dataset.onboardMode === "Host") {
      void handlers.applyOnboardMode("Host");
      return;
    }
    if (target.dataset.profileEnabled !== undefined) {
      void handlers.toggleOnboardProfileEnabled(
        Number(target.dataset.profileEnabled),
        target.dataset.enabled !== "true",
      );
      return;
    }
    if (target.dataset.profileRename !== undefined) {
      handlers.renameOnboardProfile(Number(target.dataset.profileRename));
      return;
    }
    if (target.dataset.profileActivate !== undefined) {
      void handlers.selectOnboardProfile(Number(target.dataset.profileActivate));
      return;
    }
    // Opening a profile only changes what the settings panels edit; switching
    // the mouse to it is the separate button above.
    const opened = target.dataset.onboardProfile;
    if (opened !== undefined) {
      handlers.openOnboardProfile(opened === "host" ? "host" : Number(opened));
    }
  });
  // "change" rather than "input": a number field fires it on blur or Enter, so
  // a value is not staged on every keystroke.
  document.querySelector<HTMLInputElement>("#bunny-hop-input")?.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    // min/max/step only gate the spinner, not typing, so snap the typed value
    // into range here rather than rejecting it with an error.
    const milliseconds = clampBunnyHopMs(Number(input.value));
    input.value = String(milliseconds);
    handlers.applyBunnyHopMs(milliseconds);
  });
  document.querySelector<HTMLButtonElement>("#bunny-hop-enabled")?.addEventListener("click", (event) => {
    const toggle = event.currentTarget as HTMLButtonElement;
    const enabled = toggle.getAttribute("aria-checked") !== "true";
    const input = document.querySelector<HTMLInputElement>("#bunny-hop-input");
    // Turning it back on restores whatever is in the field, defaulting to the
    // lowest value G HUB allows.
    handlers.applyBunnyHopMs(enabled ? clampBunnyHopMs(Number(input?.value)) : 0);
  });
  for (const link of ["wireless", "wired"] as const) {
    const slider = document.querySelector<HTMLElement>(`#profile-rate-${link}`);
    slider?.addEventListener("change", (event) => {
      const hz = handlers.rateFromSlider(`#profile-rate-${link}`, Number((event.target as HTMLInputElement).value));
      if (hz !== null) handlers.setProfileReportRate(link, hz);
    });
    slider?.addEventListener("input", (event) => {
      handlers.previewRateSlider(`#profile-rate-${link}`, Number((event.target as HTMLInputElement).value));
    });
  }
  // Both the count stops and the slot rows are rebuilt on every render, so
  // their clicks are delegated to the containers.
  onClick("#profile-disclosure-toggle", handlers.toggleProfilesExpanded);
  document.querySelector<HTMLElement>("#dpi-slot-count")?.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-dpi-slot-count]");
    if (target && !target.disabled) handlers.setDpiSlotCount(Number(target.dataset.dpiSlotCount));
  });
  // The slot rows are rebuilt on every render, so their events are delegated.
  const slotList = document.querySelector<HTMLElement>("#dpi-slot-list");
  slotList?.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    const slot = target.dataset.dpiSlot;
    if (slot !== undefined && target.dataset.dpiAxis !== undefined) {
      const axis = target.dataset.dpiAxis === "y" ? "y" : "x";
      handlers.setDpiSlotAxis(Number(slot), axis, Number((target as HTMLInputElement).value));
    }
  });
  slotList?.addEventListener("click", (event) => {
    // The lift-off menu is a listbox rather than a select, so opening,
    // choosing and closing are all clicks handled here.
    const toggle = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-lod-toggle]");
    if (toggle && !toggle.disabled) {
      const select = toggle.closest<HTMLElement>(".lod-select");
      const opening = !select?.classList.contains("is-open");
      closeLodMenus();
      if (opening && select) {
        select.classList.add("is-open");
        toggle.setAttribute("aria-expanded", "true");
      }
      return;
    }
    const option = (event.target as HTMLElement).closest<HTMLElement>("[data-lod-value]");
    if (option) {
      const menu = option.closest<HTMLElement>("[data-dpi-slot-lod]");
      closeLodMenus();
      if (menu) {
        handlers.setDpiSlotLod(Number(menu.dataset.dpiSlotLod), option.dataset.lodValue as EggLiftOffLevel);
      }
      return;
    }
    const lock = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-dpi-axis-lock]");
    if (lock && !lock.disabled) {
      handlers.setDpiAxisLock(Number(lock.dataset.dpiAxisLock), lock.getAttribute("aria-pressed") !== "true");
      return;
    }
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-dpi-slot-default]");
    if (target && !target.disabled) handlers.setDpiSlotDefault(Number(target.dataset.dpiSlotDefault));
  });
  // A click anywhere else, or Escape, dismisses an open lift-off menu.
  document.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest(".lod-select")) closeLodMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeLodMenus();
  });
  document.querySelector<HTMLButtonElement>("#onboard-refresh")?.addEventListener("click", () => {
    void handlers.reloadOnboardProfiles();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lightforce]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.lightforce as MouseStatus["lightforceSwitchMode"];
      if (mode) void handlers.applyLightforceSwitchMode(mode);
    });
  });
  const shell = document.querySelector<HTMLElement>(".control-shell");
  const panel = document.querySelector<HTMLElement>(".control-panel");
  shell?.addEventListener("wheel", (event) => {
    if (!panel || panel.contains(event.target as Node) || event.deltaY === 0) return;
    panel.scrollTop += event.deltaY;
    event.preventDefault();
  }, { passive: false });
}
