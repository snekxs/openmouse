const TOGGLE = "switch-button";
const TOGGLE_ROW = "switch-row";
const FIELD_LABEL = "field-label";
const CARD_HEADING = "setting-heading compact";

function superstrikeSteps(id: string, min: number, max: number): string {
  return `<div class="superstrike-steps" role="group" aria-label="${id.replace("logitech-", "").replaceAll("-", " ")}"><input id="${id}" type="hidden" /><div>${Array.from({ length: max - min + 1 }, (_, index) => {
    const value = min + index;
    return `<button type="button" data-superstrike-input="${id}" data-superstrike-value="${value}" aria-pressed="false">${value}</button>`;
  }).join("")}</div></div>`;
}

export function controlTemplate(buildLabel: string): string {
  return `
    <div class="control-shell is-empty">
      <aside class="sidebar">
        <div class="build-identity">
          <span class="demo-wordmark">OpenMouse</span>
          <span class="build-badge" title="OpenMouse ${buildLabel}">${buildLabel}</span>
        </div>
        <div class="device-label">CONNECTED DEVICES</div>
        <div id="sidebar-device-list" class="sidebar-device-list">
          <div class="device-select">
            <span class="device-dot is-idle"></span>
            <span><strong>No device connected</strong><small>Choose a supported device</small></span>
          </div>
        </div>
        <button id="connect-button" class="sidebar-action" type="button">Add device</button>
        <nav aria-label="Sections">
          <button id="interface-settings-button" class="nav-item interface-settings-button" type="button" aria-current="false">Interface settings</button>
        </nav>
        <div class="sidebar-footer"><span>WebHID device control</span><span>OpenMouse Control</span></div>
      </aside>

      <main class="control-panel">
        <div class="panel-top">
          <header class="panel-header">
            <div class="panel-title"><button id="sidebar-menu-toggle" class="sidebar-menu-toggle" type="button" aria-label="Toggle sidebar" aria-pressed="false" title="Toggle sidebar"><i></i><i></i><i></i></button><div><p class="overline">DEVICE CONTROL</p><h1 id="device-title">Connect a mouse</h1></div></div>
            <div class="device-status"><span class="status-dot is-idle"></span><span id="device-status">No device connected</span></div>
          </header>
          <p class="live-status"><i aria-hidden="true"></i><span id="read-status" role="status" aria-live="polite">Add a supported device from the sidebar to read its current status.</span></p>
        </div>
        <section class="empty-state" aria-labelledby="empty-state-title">
          <p class="overline">READY WHEN YOU ARE</p>
          <h2 id="empty-state-title">Connect a supported mouse.</h2>
          <p>Choose your mouse in the browser prompt to view and adjust its onboard settings.</p>
          <small>Your browser will only show compatible WebHID devices.</small>
          <button id="empty-connect-button" class="empty-connect-action" type="button">Add device</button>
        </section>
        <section class="device-overview device-data" aria-label="Device status">
          <article id="device-thumbnail" class="device-thumbnail" hidden><img id="device-thumbnail-image" alt="" /></article>
          <article id="battery-summary" class="summary-stat"><span>BATTERY</span><strong id="battery-value">—</strong><small id="battery-detail">Read after connection</small><div class="meter"><i id="battery-meter" style="width:0%"></i></div></article>
          <article class="summary-stat"><span>FIRMWARE</span><strong id="firmware-value">—</strong><small id="firmware-detail">Read after connection</small></article>
          <article class="summary-stat" data-pending-key="dongle-led"><span>CONNECTION</span><strong id="connection-value">—</strong><small id="connection-detail">2.4 GHz receiver</small><button id="dongle-led-toggle" class="dongle-led-button" type="button" hidden disabled>Receiver LED</button></article>
        </section>
        <section id="logitech-onboard" class="profile-disclosure device-data" hidden>
          <div class="profile-summary">
            <button id="profile-disclosure-toggle" class="profile-summary-main" type="button" aria-expanded="false" aria-controls="profile-disclosure-body">
              <span class="profile-summary-text">
                <span class="profile-summary-label">EDITING</span>
                <strong id="profile-summary-name">—</strong>
                <small id="profile-summary-detail"></small>
              </span>
              <i class="profile-summary-chevron" aria-hidden="true"></i>
            </button>
            <button id="onboard-refresh" class="icon-button" type="button" aria-label="Reload profiles" title="Reload profiles"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.6 6.6A6 6 0 1 0 14 8"/><path d="M14 2.4V6.6H9.8"/></svg></button>
            <button id="reset-logitech-profiles" class="icon-button profile-delete-button" type="button" aria-label="Delete and reset every onboard profile" title="Delete all profiles and restore defaults" hidden disabled><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10"/><path d="M6 2.5h4l.6 2H5.4l.6-2Z"/><path d="m4.2 4.5.6 9h6.4l.6-9"/><path d="M6.5 7v4M9.5 7v4"/></svg></button>
          </div>
          <div id="profile-disclosure-body" class="profile-disclosure-body">
            <div class="profile-disclosure-inner">
              <div id="onboard-profile-list"></div>
              <small id="onboard-status">Profiles load when the mouse is in onboard mode.</small>
            </div>
          </div>
        </section>
        <section class="settings-grid device-data" aria-label="Mouse status">
          <article class="setting-card dpi-card" data-pending-key="dpi"><div class="setting-heading"><div><p>DPI</p><h2>Sensitivity<span class="setting-scope" id="dpi-scope-badge" hidden></span></h2></div><div class="dpi-header-actions"><input id="dpi-output" type="text" inputmode="numeric" value="— DPI" aria-label="DPI value" readonly /><button id="custom-dpi" type="button" disabled>Custom</button></div></div><div id="dpi-presets" class="segmented dpi-presets" role="group" aria-label="Common DPI values"></div><div id="logitech-axis-controls" style="display:none"><div class="axis-grid"><label>X axis<input id="logitech-dpi-x" type="number" min="100" step="50" /></label><label>Y axis<input id="logitech-dpi-y" type="number" min="100" step="50" /></label><button id="apply-logitech-axes" class="axis-apply" type="button">Apply</button></div></div><div id="logitech-dpi-slots" hidden><div class="dpi-slot-header"><span>Slots in use</span><div id="dpi-slot-count" class="dpi-slot-count" role="group" aria-label="Number of DPI slots"></div></div><div class="dpi-slot-rule"></div><div id="dpi-slot-list" class="dpi-slot-list"></div><small id="dpi-slot-note" class="setting-note"></small></div><div class="setting-action"><span id="dpi-pending">Choose a DPI value</span></div></article>
          <article id="polling-card" class="setting-card" data-pending-key="polling-rate"><div class="setting-heading"><div><p>POLLING RATE</p><h2>Report frequency<span class="setting-scope" id="rate-scope-badge" hidden></span></h2></div></div><div id="profile-rate-rows" hidden><div id="profile-rate-wireless" class="rate-slider" data-rate-link="wireless"></div><div id="profile-rate-wired" class="rate-slider" data-rate-link="wired"></div></div><div id="host-rate-slider" class="rate-slider"></div><small id="polling-note" class="setting-note">Higher rates update cursor movement more often, but use more battery.</small></article>
          <article class="setting-card" data-pending-key="lift-off-distance gaming-surface"><div class="setting-heading tight"><div><p>SENSOR</p></div></div><div id="gaming-surface-row" hidden><div class="setting-heading"><div><h2>Gaming surface</h2></div></div><div class="segmented three" role="group" aria-label="Gaming surface"><button data-gaming-surface="On" disabled>On</button><button data-gaming-surface="Off" disabled>Off</button><button data-gaming-surface="Auto" disabled>Auto</button></div><small class="setting-note">Tunes the sensor for gaming mouse pads. Auto lets the mouse decide; turn it off if tracking misbehaves on a non-gaming surface.</small></div><div id="host-lod-row"><div class="setting-heading"><div><h2>Lift-off distance</h2></div></div><div id="lod-mode-row" class="lod-mode" hidden><div class="segmented two" role="group" aria-label="Lift-off mode"><button data-lod-mode="single" disabled>Single</button><button data-lod-mode="asymmetric" disabled>Asymmetric</button></div></div><div id="lod-single"><div class="segmented three" role="group" aria-label="Lift-off distance"><button data-lod="Low" disabled>Low</button><button data-lod="Medium" disabled>Medium</button><button data-lod="High" disabled>High</button></div></div><div id="lod-asymmetric" class="lod-sliders" hidden><label>Lift-off<output id="lod-lift-off-value">—</output><input id="lod-lift-off" type="range" min="2" max="26" step="1" /></label><label>Landing<output id="lod-landing-value">—</output><input id="lod-landing" type="range" min="1" max="25" step="1" /></label></div><small id="lod-note" class="setting-note">Controls how far you can lift the mouse before tracking stops. Higher values keep tracking a little longer.</small></div></article>
          <article id="lightforce-card" class="setting-card" data-pending-key="lightforce-switch-mode" hidden><div class="setting-heading"><div><p>SWITCHES</p><h2>LightForce</h2></div></div><div class="segmented" role="group" aria-label="LightForce switch mode"><button data-lightforce="Hybrid" disabled>Hybrid</button><button data-lightforce="Optical" disabled>Optical only</button></div><small class="setting-note">Hybrid saves power by using the mechanical contact and only waking the optical sensor when needed. Optical only is consistent but uses more battery.</small><div id="bunny-hop-row" hidden><div class="setting-heading"><div><h2>Bunny hop<span class="setting-scope">Per-profile</span></h2></div></div><div class="bunny-hop-controls"><button id="bunny-hop-enabled" class="${TOGGLE}" type="button" role="switch" aria-checked="false">Off</button><input id="bunny-hop-input" type="number" min="100" max="1000" step="10" value="100" aria-label="Bunny hop time in milliseconds" /><span>ms</span></div><small class="setting-note" id="bunny-hop-note"></small></div></article>
          <article id="lighting-card" class="setting-card" data-pending-key="lighting" hidden><div class="setting-heading"><div><p>LIGHTING</p><h2>Lighting<span class="setting-scope" id="lighting-write-only-badge" hidden>Write-only</span></h2></div></div><div id="lighting-modes" class="segmented lighting-modes" role="group" aria-label="Lighting effect"></div><div id="lighting-color-row" class="lighting-color-row" hidden><label class="lighting-color-field"><span>Colour</span><input id="lighting-color" type="color" value="#00ff00" aria-label="Lighting colour" /></label><label id="lighting-color2-field" class="lighting-color-field" hidden><span>Colour 2</span><input id="lighting-color2" type="color" value="#ff0000" aria-label="Second lighting colour" /></label></div><div id="lighting-speed-row" class="lighting-speed-row" hidden><div class="setting-heading tight"><div><h2>Reactive speed<span class="setting-scope">1 fast · 4 slow</span></h2></div></div><div id="lighting-speeds" class="segmented" role="group" aria-label="Reactive speed"></div></div><div class="setting-action"><span id="lighting-pending">Choose an effect</span></div><small id="lighting-note" class="setting-note"></small></article>
        </section>
        <section id="logitech-device-details" class="device-data" style="display:none">
          <details class="egg-collapsible"><summary><span><small>LOGITECH HID++</small>Device details</span><i aria-hidden="true"></i></summary><div class="egg-collapsible-body"><article class="setting-card"><div id="logitech-detail-list"></div></article></div></details>
        </section>
        <section id="logitech-analog-button-settings" class="device-data" aria-label="HITS tuning settings" style="display:none">
          <article class="setting-card superstrike-tuning-card"><div class="setting-heading superstrike-tuning-heading"><div><h2>HITS Tuning</h2></div></div><div class="superstrike-tabs" role="tablist" aria-label="HITS tuning mode"><button type="button" role="tab" aria-selected="true" data-superstrike-tab="both">Both buttons</button><button type="button" role="tab" aria-selected="false" data-superstrike-tab="independent">Independent</button></div><div class="superstrike-tuning-panels" data-superstrike-mode="both"><div class="superstrike-tuning-grid superstrike-independent-panel"><fieldset class="superstrike-button-card"><legend><span class="superstrike-button-dot"></span>Left button</legend><div class="superstrike-control-row"><label>Actuation Point <small>1 Short Click <span>10 Long Click</span></small></label>${superstrikeSteps("logitech-left-actuation", 1, 10)}</div><div class="superstrike-control-row"><label>Rapid Trigger <small>1 Fast <span>5 Slow</span></small></label>${superstrikeSteps("logitech-left-rapid-trigger", 1, 5)}</div><div class="superstrike-control-row"><label>Click Haptics <small>0 Off <span>5 Maximum feedback</span></small></label>${superstrikeSteps("logitech-left-haptics", 0, 5)}</div><button id="apply-logitech-left-button" class="superstrike-apply-button" type="button">Apply left</button></fieldset><fieldset class="superstrike-button-card"><legend><span class="superstrike-button-dot"></span>Right button</legend><div class="superstrike-control-row"><label>Actuation Point <small>1 Short Click <span>10 Long Click</span></small></label>${superstrikeSteps("logitech-right-actuation", 1, 10)}</div><div class="superstrike-control-row"><label>Rapid Trigger <small>1 Fast <span>5 Slow</span></small></label>${superstrikeSteps("logitech-right-rapid-trigger", 1, 5)}</div><div class="superstrike-control-row"><label>Click Haptics <small>0 Off <span>5 Maximum feedback</span></small></label>${superstrikeSteps("logitech-right-haptics", 0, 5)}</div><button id="apply-logitech-right-button" class="superstrike-apply-button" type="button">Apply right</button></fieldset></div><fieldset class="superstrike-button-card superstrike-both-panel"><legend><span class="superstrike-button-dot"></span>Both primary buttons</legend><p>Apply the same values to the left and right buttons.</p><div class="superstrike-control-row"><label>Actuation Point <small>1 Short Click <span>10 Long Click</span></small></label>${superstrikeSteps("logitech-both-actuation", 1, 10)}</div><div class="superstrike-control-row"><label>Rapid Trigger <small>1 Fast <span>5 Slow</span></small></label>${superstrikeSteps("logitech-both-rapid-trigger", 1, 5)}</div><div class="superstrike-control-row"><label>Click Haptics <small>0 Off <span>5 Maximum feedback</span></small></label>${superstrikeSteps("logitech-both-haptics", 0, 5)}</div><button id="apply-logitech-both-buttons" class="superstrike-apply-button" type="button">Apply to both buttons</button></fieldset></div></article>
        </section>
        <section id="pulsar-advanced" class="device-data" aria-label="Advanced device settings" style="display:none">
          <article id="signal-settings" class="setting-card"><div class="${CARD_HEADING}"><div><p>WIRELESS</p><h2>Signal strength</h2></div><output id="signal-output">—</output></div><small id="signal-detail" class="setting-note">Receiver signal is unavailable.</small></article>
          <article id="debounce-settings" class="setting-card"><div class="${CARD_HEADING}"><div><p>CLICK</p><h2>Debounce</h2></div></div><select id="debounce-select"></select></article>
          <article id="sleep-settings" class="setting-card"><div class="${CARD_HEADING}"><div><p>POWER</p><h2>Auto sleep</h2></div><button id="sleep-toggle" class="${TOGGLE}" type="button" role="switch" aria-checked="false" hidden>Off</button></div><select id="sleep-select"><option value="1">10 seconds</option><option value="3">30 seconds</option><option value="6">1 minute</option><option value="12">2 minutes</option><option value="30">5 minutes</option><option value="60">10 minutes</option><option value="180">30 minutes</option></select></article>
          <article id="low-power-settings" class="setting-card" hidden><div class="${CARD_HEADING}"><div><p>POWER</p><h2>Low power mode</h2></div></div><select id="low-power-select"></select><small id="low-power-note" class="setting-note">Slows the mouse down to save battery below this level.</small></article>
          <article id="processing-settings" class="setting-card"><div class="${CARD_HEADING}"><div><p>SENSOR</p><h2>Processing</h2></div></div><div class="${TOGGLE_ROW}"><span>Motion Sync</span><button id="motion-sync-toggle" class="${TOGGLE}" type="button" role="switch" aria-checked="false">Off</button></div><div class="${TOGGLE_ROW}"><span>Angle snapping</span><button id="angle-snapping-toggle" class="${TOGGLE}" type="button" role="switch" aria-checked="false">Off</button></div><div class="${TOGGLE_ROW}"><span>Ripple control</span><button id="ripple-control-toggle" class="${TOGGLE}" type="button" role="switch" aria-checked="false">Off</button></div><div id="performance-mode-setting" class="${TOGGLE_ROW}"><span>Performance mode</span><button id="performance-mode-toggle" class="${TOGGLE}" type="button" role="switch" aria-checked="false">Off</button></div></article>
          <article id="finalmouse-settings" class="setting-card" style="display:none" data-pending-key="finalmouse-dongle-led finalmouse-tournament-scroll finalmouse-tournament-timeout"><div class="${CARD_HEADING}"><div><p>FINALMOUSE</p><h2>Dongle and tournament mode</h2></div></div><label class="${FIELD_LABEL}">Dongle LED<select id="finalmouse-dongle-led"><option value="0">Off</option><option value="1">Battery indicator</option><option value="2">Solid white</option></select></label><label class="${FIELD_LABEL} spaced">Tournament scroll<select id="finalmouse-tournament-scroll"><option value="0">Off</option><option value="1">Scroll up</option><option value="2">Scroll down</option><option value="3">Both directions</option></select></label><label class="${FIELD_LABEL} spaced">Passthrough window<select id="finalmouse-tournament-timeout"><option value="100">100 ms</option><option value="500">500 ms</option><option value="1000">1 second</option><option value="1500">1.5 seconds</option></select></label></article>
          <article id="egg-filter-settings" class="setting-card" style="display:none"><div class="${CARD_HEADING}"><div><p>SENSOR</p><h2>Filters</h2></div></div><div class="${TOGGLE_ROW}"><span>Slamclick filter</span><button id="slamclick-filter-toggle" class="${TOGGLE}" type="button" role="switch" aria-checked="false">Off</button></div><div class="${TOGGLE_ROW}"><span>Motion-jitter filter</span><button id="motion-jitter-filter-toggle" class="${TOGGLE}" type="button" role="switch" aria-checked="false">Off</button></div></article>
          <article id="egg-spdt-settings" class="setting-card" style="display:none"><div class="${CARD_HEADING}"><div><p>CLICK</p><h2>GX switch mode</h2></div></div><label class="${FIELD_LABEL}">Left button<select id="left-spdt-select"><option>Off</option><option>GX Safe</option><option>GX Speed</option></select></label><label class="${FIELD_LABEL} spaced">Right button<select id="right-spdt-select"><option>Off</option><option>GX Safe</option><option>GX Speed</option></select></label></article>
          <details id="egg-polling-settings" class="egg-experimental" data-pending-key="egg-polling-divider" style="display:none"><summary><span><small>EXPERIMENTAL</small>Experimental settings</span><i aria-hidden="true"></i></summary><div class="egg-experimental-body"><article class="setting-card egg-form-card"><div class="setting-heading"><div><p>POLLING</p><h2>Custom divider</h2></div></div><p class="egg-warning">Nonstandard polling dividers may behave differently across firmware versions.</p><label>8K divider<input id="egg-polling-divider" type="number" min="1" max="255" step="1" /></label><small id="egg-polling-result" class="setting-note">—</small><button id="apply-egg-polling" class="egg-action-button" type="button">Apply divider</button></article></div></details>
          <details id="egg-cpi-settings" class="egg-collapsible" data-pending-key="egg-cpi-levels" style="display:none"><summary><span><small>SENSOR</small>CPI stages</span><i aria-hidden="true"></i></summary><div class="egg-collapsible-body"><article class="setting-card"><label class="${FIELD_LABEL}">Enabled stages<select id="egg-cpi-levels"><option value="1">1 stage</option><option value="2">2 stages</option><option value="3">3 stages</option><option value="4">4 stages</option></select></label><div id="egg-cpi-stage-list"></div></article></div></details>
          <details id="egg-button-settings" class="egg-collapsible" style="display:none"><summary><span><small>BUTTONS</small>Multiclick and mapping</span><i aria-hidden="true"></i></summary><div class="egg-collapsible-body"><article class="setting-card"><div id="egg-button-list"></div></article></div></details>
          <article id="pulsar-pro-settings" class="setting-card" style="display:none"><div class="${CARD_HEADING}"><div><p>PRO</p><h2>Advanced</h2></div></div><div class="${TOGGLE_ROW}"><span>Wheel acceleration</span><button id="wheel-acceleration-toggle" class="${TOGGLE}" type="button" role="switch" aria-checked="false">Off</button></div><label class="${FIELD_LABEL} spaced">Angle tuning<select id="angle-tuning-select"></select></label><label class="${FIELD_LABEL} spaced">Onboard profile<select id="profile-select"><option value="1">Profile 1</option><option value="2">Profile 2</option><option value="3">Profile 3</option><option value="4">Profile 4</option><option value="5">Profile 5</option><option value="6">Profile 6</option></select></label></article>
        </section>
        <aside class="testing-note" aria-label="Development testing guidance">
          <strong>Development testing</strong>
          <span>Record the device identifier, protocol version, and any failing setting in the issue or pull request. Do not use factory reset during initial testing.</span>
        </aside>
        <section id="device-debug-details" class="device-data" aria-label="Device diagnostics">
          <details class="egg-collapsible"><summary><span><small>DEVELOPMENT</small>Diagnostics</span><i aria-hidden="true"></i></summary><div class="egg-collapsible-body"><article class="setting-card device-debug-card"><div id="device-debug-overview" class="device-debug-overview"></div><div class="device-debug-actions"><button id="download-diagnostics" type="button" disabled>Download diagnostics</button><button id="capture-open" type="button" hidden>Verify profile format</button><span id="diagnostic-download-status" role="status" aria-live="polite"></span></div><details id="device-debug-readlog" class="device-debug-raw"><summary>Reads</summary><pre id="device-debug-reads" class="device-debug-snapshot"></pre></details><details id="device-debug-raw" class="device-debug-raw"><summary>Raw snapshot</summary><pre id="device-debug-snapshot" class="device-debug-snapshot">Connect a mouse to collect diagnostics.</pre></details></article></div></details>
        </section>
        <section id="interface-settings-page" class="interface-settings-page" aria-labelledby="interface-settings-title">
          <header class="interface-settings-header"><div><p class="overline">OPENMOUSE</p><h2 id="interface-settings-title">Interface settings</h2></div><button id="close-interface-settings" class="interface-settings-back" type="button">Back to device</button></header>
          <div class="interface-settings-grid">
            <article class="interface-setting-card"><span>LAYOUT</span><h3>Interface density</h3><p>Choose tighter controls or add more breathing room throughout the panel.</p><select id="interface-density"><option>Compact</option><option>Comfortable</option></select></article>
            <article class="interface-setting-card"><span>APPEARANCE</span><h3>Accent theme</h3><p>Customize active controls, status lights, switches, and focus highlights.</p><select id="interface-theme"><option>Emerald</option><option>Violet</option><option>Ice</option><option>Ember</option><option>Mono</option></select><div class="theme-preview" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div></article>
            <article class="interface-setting-card"><span>MOTION</span><h3>Animation</h3><p>Disable interface transitions and animated state changes.</p><label class="interface-switch-row"><span>Reduce motion</span><input id="interface-reduced-motion" type="checkbox" /></label></article>
            <article class="interface-setting-card"><span>SECTIONS</span><h3>Advanced editors</h3><p>Choose whether CPI, button mapping, and experimental sections begin expanded.</p><label class="interface-switch-row"><span>Expand by default</span><input id="interface-expand-sections" type="checkbox" /></label></article>
            <article class="interface-setting-card"><span>EXPERIMENTAL</span><h3>Experimental controls</h3><p>Show or completely hide controls that may vary between firmware versions.</p><label class="interface-switch-row"><span>Show experimental settings</span><input id="interface-show-experimental" type="checkbox" /></label></article>
          </div>
          <section id="preview-launcher" class="preview-launcher" hidden aria-labelledby="preview-launcher-title">
            <div class="interface-setting-card">
              <span>DEVELOPMENT</span>
              <h3 id="preview-launcher-title">Driver previews</h3>
              <p>Render any supported driver without its hardware, to check a change against every brand. Nothing is written to a device.</p>
              <div id="preview-launcher-list" class="preview-launcher-list"></div>
            </div>
          </section>
          <button id="reset-interface-settings" class="interface-reset" type="button">Reset interface preferences</button>
        </section>
      </main>

      <div id="pending-changes-bar" class="pending-bar" role="region" aria-label="Unsaved changes" hidden>
        <div class="pending-bar-inner">
          <span class="pending-bar-progress" aria-hidden="true"></span>
          <span class="pending-bar-dot" aria-hidden="true"></span>
          <div class="pending-bar-copy">
            <p class="overline">PENDING</p>
            <strong id="pending-changes-count">1 unsaved change</strong>
            <small id="pending-changes-summary" role="status" aria-live="polite"></small>
          </div>
          <div class="pending-bar-actions">
            <button id="pending-revert" class="pending-revert" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5h11a5.5 5.5 0 0 1 0 11H8" /><path d="M7.5 4 3 8.5 7.5 13" /></svg><span>Revert</span></button>
            <button id="pending-flash" class="pending-flash" type="button"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.8 2 4 13.9h5.7L8.9 22 20 9.8h-6.1L13.8 2Z" /></svg><i class="pending-spinner" aria-hidden="true"></i><span id="pending-flash-label">Flash</span></button>
          </div>
        </div>
      </div>
      <dialog id="capture-dialog" style="width:min(1100px,94vw);max-width:none;height:min(88vh,900px);padding:0;border:1px solid #303036;border-radius:12px;background:#131316;color:#d8d8dc">
        <div style="display:flex;flex-direction:column;height:100%;padding:1rem 1.1rem;box-sizing:border-box;gap:.6rem">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem">
            <div>
              <p style="margin:0;color:#77777c;font-size:.6rem;letter-spacing:.05em">DEVELOPMENT</p>
              <h2 style="margin:.1rem 0 0;font-size:1rem;color:#ececef">HID++ capture</h2>
            </div>
            <button id="capture-close" type="button" aria-label="Close capture">Close</button>
          </div>
          <small style="color:#77777c;font-size:.64rem"><strong style="color:#a8a8ae">Verify a format:</strong> copy a read-only bundle containing the memory geometry, full directory, every profile and all CRC results. To map an individual setting, snapshot the profiles, change only that setting in G HUB or Onboard Memory Manager, compare, mark the change and copy the comparison.</small>
          <div style="display:flex;flex-wrap:wrap;gap:.4rem;align-items:center">
            <button id="capture-verification" type="button" class="is-primary">Copy verification data</button>
            <button id="capture-snapshot" type="button">Snapshot profiles</button>
            <button id="capture-compare" type="button">Compare</button>
            <button id="capture-reset" type="button">Clear</button>
            <button id="capture-copy" type="button">Copy comparison</button>
            <span id="capture-status" role="status" aria-live="polite" style="color:#77777c;font-size:.62rem"></span>
          </div>
          <div id="capture-diff" style="flex:1;min-height:0;overflow:auto;border:1px solid #26262a;border-radius:8px;padding:.5rem"></div>
          <div><p style="margin:0 0 .25rem;color:#77777c;font-size:.62rem">What did you change?</p><div id="capture-action-list" style="display:flex;flex-wrap:wrap;gap:.3rem"></div></div>
          <textarea id="capture-notes" rows="2" placeholder="Optional detail, e.g. wireless polling 8000 Hz to 1000 Hz" style="width:100%;box-sizing:border-box;padding:.45rem;border:1px solid #343438;border-radius:6px;background:#171719;color:#d8d8dc;font-size:.66rem"></textarea>
        </div>
      </dialog>
    </div>
    <section id="size-blocker" class="small-screen-blocker">
      <h1>Make the window wider.</h1>
      <p>OpenMouse needs more room than this to show the control panel.</p>
    </section>`;
}
