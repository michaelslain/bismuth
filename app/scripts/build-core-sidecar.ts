// Prebuild step: compile the core server into a standalone Tauri sidecar binary.
//
// core (the @oa/core HTTP server) is plain Bun/TS and compiles cleanly to a single
// self-contained executable via `bun build --compile` (native deps like bun-pty are
// embedded). Unlike claude-bot (which must ship as source because its daemon spawns
// `bun run` itself), core just needs to run, so a compiled binary is the simplest
// shippable form — a Tauri "sidecar".
//
// Tauri resolves sidecars by a target-triple suffix, so we name the output
// `bismuth-core-<triple>` and reference `binaries/bismuth-core` in tauri.conf.json
// (externalBin). The binary is heavy (~58MB) and platform-specific → gitignored.
//
// Run: cd app && bun run scripts/build-core-sidecar.ts   (or `bun run build:core-sidecar`)
// Wired into beforeBuildCommand so `tauri build` always has a fresh sidecar.
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname(new URL(import.meta.url).pathname);
const appDir = join(here, "..");                 // app/
const repoRoot = join(appDir, "..");             // repo root
const serverEntry = join(repoRoot, "core", "src", "server.ts");
const outDir = join(appDir, "src-tauri", "binaries");

// Target triple Tauri expects in the sidecar filename — taken from the Rust host.
function targetTriple(): string {
  const r = spawnSync("rustc", ["-Vv"], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error("rustc not found — needed to resolve the sidecar target triple");
    process.exit(1);
  }
  const host = r.stdout.split("\n").find((l) => l.startsWith("host:"));
  if (!host) { console.error("could not parse `host:` from rustc -Vv"); process.exit(1); }
  return host.replace("host:", "").trim();
}

const triple = targetTriple();
const outFile = join(outDir, `bismuth-core-${triple}`);
mkdirSync(outDir, { recursive: true });

console.log(`compiling core → ${outFile}`);
const build = spawnSync(
  "bun",
  ["build", "--compile", serverEntry, "--outfile", outFile],
  { cwd: repoRoot, stdio: "inherit" },
);
if (build.status !== 0) { console.error("bun build --compile failed"); process.exit(1); }

// Smoke: the file exists and is non-trivial.
if (!existsSync(outFile) || statSync(outFile).size < 1_000_000) {
  console.error(`sidecar missing or too small: ${outFile}`);
  process.exit(1);
}
console.log(`✓ sidecar built: ${outFile} (${(statSync(outFile).size / 1e6).toFixed(0)}MB)`);
