// app/scripts/postbuild-clean.ts
// Runs after `tauri build`, before open-installer. Deletes the staged
// bundle/macos/Bismuth.app once the dmg exists, so a source build stops leaving a second
// Bismuth in Spotlight / the Applications list (github issue #4). The decision lives in
// postbuildClean.ts (pure + tested); this file only does the filesystem work.
// macOS-only; a no-op elsewhere. Run standalone: bun run scripts/postbuild-clean.ts
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stagedAppToRemove } from "./postbuildClean";

if (process.platform !== "darwin") process.exit(0);

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, "..", "src-tauri", "target", "release", "bundle");
const dmgDir = join(bundle, "dmg");
const appPath = join(bundle, "macos", "Bismuth.app");

const dmgExists =
  existsSync(dmgDir) && readdirSync(dmgDir).some((f) => f.endsWith(".dmg"));

const target = stagedAppToRemove({ dmgExists, appPath, appExists: existsSync(appPath) });

if (target) {
  rmSync(target, { recursive: true, force: true });
  console.log(`postbuild: removed the staged ${target}`);
  console.log("postbuild: install from the dmg — only /Applications should hold a Bismuth.");
} else if (!dmgExists) {
  console.log("postbuild: no dmg produced — keeping the staged .app as the installable artifact.");
}
