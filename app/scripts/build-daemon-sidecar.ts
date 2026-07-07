// Prebuild step: compile the per-vault daemon runtime into a standalone binary, staged as a
// Tauri RESOURCE (NOT an externalBin sidecar).
//
// The core sidecar is a Tauri-managed child that dies with the app. The daemon is the
// opposite: it must OUTLIVE the app — it keeps firing each vault's crons + supervising its
// processes while Bismuth is closed. So it can't be a Tauri-spawned child. Instead it ships
// like bismuth-tools: a resource that core copies to ~/.bismuth/bin on boot and registers as
// a launchd LaunchAgent / systemd --user service (run from that stable path, independent of
// the .app bundle).
//
// Unlike the OLD claude-bot (which shipped as source because its daemon spawned `bun run`
// itself), this single-process runtime compiles cleanly to one executable (~59MB), so a
// compiled binary is the simplest shippable form. No target-triple suffix — core copies the
// binary itself rather than Tauri resolving it as a sidecar.
//
// Run: cd app && bun run scripts/build-daemon-sidecar.ts   (or `bun run build:daemon-sidecar`)
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertBuiltBinary } from "./buildUtils";
import { findSigningIdentity } from "./signingIdentity";

const here = dirname(new URL(import.meta.url).pathname);
const appDir = join(here, "..");                 // app/
const repoRoot = join(appDir, "..");             // repo root
const daemonEntry = join(repoRoot, "daemon", "src", "daemon", "index.ts");
const outDir = join(appDir, "src-tauri", "resources", "daemon", "bin");
const outFile = join(outDir, "bismuth-daemon");  // plain name — core copies it to ~/.bismuth/bin
mkdirSync(outDir, { recursive: true });

console.log(`compiling daemon → ${outFile}`);
const build = spawnSync(
  "bun",
  ["build", "--compile", daemonEntry, "--outfile", outFile],
  { cwd: repoRoot, stdio: "inherit" },
);
if (build.status !== 0) { console.error("bun build --compile failed"); process.exit(1); }

// Smoke: the file exists and is non-trivial.
assertBuiltBinary(outFile, "daemon binary");

// ── Stable code identity (macOS) ─────────────────────────────────────────────
// The daemon binary is swapped over the SAME path (~/.bismuth/bin/bismuth-daemon) on every
// update; with only the default ad-hoc (linker) signature, macOS TCC pins Files-and-Folders
// grants to the binary's content hash, so EVERY update silently revoked the user's folder
// permissions. If a signing identity is available (see findSigningIdentity in
// ./signingIdentity — APPLE_SIGNING_IDENTITY, or a "Bismuth" codesigning certificate in the
// login keychain; see docs/overview/install.md) sign with it so the identity (not the hash)
// stays stable and grants survive updates. Purely opt-in: without a cert this is a no-op,
// exactly as before.
if (process.platform === "darwin") {
  const identity = findSigningIdentity();
  if (identity) {
    console.log(`codesigning daemon with "${identity}"`);
    const sign = spawnSync("codesign", ["--force", "--sign", identity, outFile], { stdio: "inherit" });
    if (sign.status !== 0) console.warn("codesign failed — continuing with the ad-hoc signature");
  } else {
    console.log("no signing identity found — leaving ad-hoc signature (folder grants won't survive updates)");
  }
}
