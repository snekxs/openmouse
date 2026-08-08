import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BUDGET_BYTES: Record<string, number> = {
  // Viper V3 sleep and low-power controls add a small, device-specific row to
  // the existing settings UI.
  ".css": 46_000,
  // Raised from 280 kB for the production Logitech onboard-profile codec,
  // guarded flash editor, verification exporter, upstream Finalmouse driver,
  // the dedicated Viper Mini protocol driver, Viper V3 sleep/low-power plus
  // asymmetric lift-off protocol and controls, and Logi Bolt / MX Master 3S
  // transport. Preview fixtures remain dev-only.
  ".js": 330_000,
};

const ASSETS = join("dist", "assets");

function bundles(): { name: string; ext: string; bytes: number }[] {
  return readdirSync(ASSETS)
    .filter((name) => name.endsWith(".css") || name.endsWith(".js"))
    .map((name) => ({
      name,
      ext: name.slice(name.lastIndexOf(".")),
      bytes: statSync(join(ASSETS, name)).size,
    }));
}

const found = bundles();
if (found.length === 0) {
  console.error(`No bundles in ${ASSETS}. Run "npm run build" first.`);
  process.exit(1);
}

const totals = new Map<string, number>();
for (const { ext, bytes } of found) totals.set(ext, (totals.get(ext) ?? 0) + bytes);

let failed = false;
for (const [ext, budget] of Object.entries(BUDGET_BYTES)) {
  const bytes = totals.get(ext) ?? 0;
  const percent = Math.round((bytes / budget) * 100);
  const label = `${ext.slice(1).toUpperCase().padEnd(3)} ${String(bytes).padStart(7)} / ${budget} bytes (${percent}%)`;
  if (bytes > budget) {
    failed = true;
    console.error(`over budget  ${label}`);
  } else {
    console.log(`ok           ${label}`);
  }
}

if (failed) {
  console.error("");
  console.error("A bundle grew past its budget. Justify the growth and raise BUDGET_BYTES,");
  console.error("or find what was added. Adding a CSS framework once cost 19 kB unnoticed.");
  process.exit(1);
}
