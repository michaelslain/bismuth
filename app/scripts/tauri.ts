// Wraps the real `@tauri-apps/cli` binary so EVERY `bun run tauri …` invocation — a
// developer's plain `bun run tauri build`, the `installer`/root `build:app` scripts,
// `tauri dev`, AND the self-update rebuild pipeline (core/src/selfUpdate.ts, which already
// exported APPLE_SIGNING_IDENTITY for its own spawned build) — picks up a stable macOS
// signing identity automatically. See ./signingIdentity for what "stable identity" means and
// why it fixes bug #48 ("computer permissions are not persistent between Bismuth updates").
//
// Why this file needs to exist at all: before it did, the identity auto-detect only ran
// inside selfUpdate.ts's own pipeline. A manual `bun run tauri build` — the documented normal
// build path (docs/overview/install.md "Tauri native binary") that produces the very first
// install and any hand-built update — never saw APPLE_SIGNING_IDENTITY, so it landed
// ad-hoc-signed even after the user created the one-time certificate. Centralizing the
// detection in the ONE npm script every path funnels through ("tauri") closes that gap: it's
// now impossible to invoke `tauri build` without the check running.
//
// No signing identity found → forwards args unchanged, exactly the prior ad-hoc-signed
// behavior. Opt-in, zero-cost.
import { spawnSync } from "node:child_process";
import { findSigningIdentity } from "./signingIdentity";

const args = process.argv.slice(2);
const identity = findSigningIdentity();

if (identity) {
  console.log(`[tauri] signing with "${identity}" — stable identity, TCC grants survive this build`);
} else if (process.platform === "darwin" && args[0] === "build") {
  console.log(
    "[tauri] no signing identity found — building ad-hoc; macOS will re-ask for folder/accessibility " +
      'permissions after this update. One-time fix: docs/overview/install.md "macOS folder ' +
      'permissions surviving updates".',
  );
}

// Resolve the REAL tauri binary via PATH (node_modules/.bin, which `bun run` already
// prepends for this process) — spawns the bare command name, so this does NOT recurse into
// the "tauri" npm script that invoked this file.
const result = spawnSync("tauri", args, {
  stdio: "inherit",
  env: { ...process.env, ...(identity ? { APPLE_SIGNING_IDENTITY: identity } : {}) },
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
