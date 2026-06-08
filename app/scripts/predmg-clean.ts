// Make `tauri build` self-healing: detach stale DMG scratch volumes and remove leftover
// rw.*.dmg files before bundling. tauri's bundle_dmg.sh intermittently fails when a prior
// (failed) build left a /Volumes/dmg.* volume mounted — the next build then can't create
// its scratch. Running this first clears that. macOS-only; a no-op elsewhere.
//
// Wired as the first step of beforeBuildCommand. Run standalone: bun run scripts/predmg-clean.ts
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

if (process.platform !== "darwin") process.exit(0);

// Detach leftover DMG scratch volumes (dmg.XXXX) + any mounted Bismuth installer.
let volumes: string[] = [];
try {
  volumes = readdirSync("/Volumes");
} catch {
  volumes = [];
}
for (const v of volumes) {
  if (v.startsWith("dmg.") || v.startsWith("Bismuth")) {
    const r = spawnSync("hdiutil", ["detach", "-force", join("/Volumes", v)], { stdio: "ignore" });
    if (r.status === 0) console.log(`predmg: detached /Volumes/${v}`);
  }
}

// Remove leftover read-write scratch images from a prior failed bundle.
const here = dirname(new URL(import.meta.url).pathname);
const macosDir = join(here, "..", "src-tauri", "target", "release", "bundle", "macos");
try {
  for (const f of readdirSync(macosDir)) {
    if (f.startsWith("rw.") && f.endsWith(".dmg")) {
      rmSync(join(macosDir, f), { force: true });
      console.log(`predmg: removed scratch ${f}`);
    }
  }
} catch {
  // no prior bundle dir — nothing to clean
}
