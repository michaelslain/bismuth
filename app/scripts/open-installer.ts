// app/scripts/open-installer.ts
// After `tauri build`, open the built .dmg so the user can drag Bismuth → Applications.
// `tauri build` does NOT auto-open an installer, so this is the "one command → ready to
// install" convenience used by the `installer` package.json script (and root `build:app`).
// macOS: opens the dmg (mounts it, Finder shows the drag window). Elsewhere: just prints
// where the artifacts are.
import { readdirSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, "..", "src-tauri", "target", "release", "bundle");
const dmgDir = join(bundle, "dmg");
const appPath = join(bundle, "macos", "Bismuth.app");

/** Newest .dmg under the bundle dir (handles versioned filenames). */
function newestDmg(): string | null {
  if (!existsSync(dmgDir)) return null;
  const dmgs = readdirSync(dmgDir)
    .filter((f) => f.endsWith(".dmg"))
    .map((f) => join(dmgDir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return dmgs[0] ?? null;
}

const dmg = newestDmg();

if (!dmg && !existsSync(appPath)) {
  console.error(`\nNo .dmg or .app found under ${bundle} — did 'tauri build' succeed?\n`);
  process.exit(1);
}

if (process.platform === "darwin" && dmg) {
  console.log(`\n✓ Built. Opening the installer:\n  ${dmg}`);
  console.log("→ Drag Bismuth into Applications, then eject the volume.\n");
  spawnSync("open", [dmg], { stdio: "inherit" });
} else {
  console.log("\n✓ Built. Install it by dragging into /Applications:");
  if (dmg) console.log(`  dmg: ${dmg}`);
  if (existsSync(appPath)) console.log(`  app: ${appPath}`);
  console.log("");
}
