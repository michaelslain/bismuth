// Prebuild step: bundle claude-bot and stage it as a Tauri resource.
//
// claude-bot is a Bun/TS daemon (its launchd plist runs `bun run daemon/index.ts`),
// so it CANNOT be a single compiled binary — it needs on-disk SOURCE + a runtime
// node_modules. claude-bot's own `bun run bundle` (scripts/bundle.ts) assembles a
// self-contained, RELOCATABLE copy at <repo>/dist/claude-bot/ carrying everything
// the daemon + ensure-installed need to run from an arbitrary path (lib/, daemon/,
// bin/, server.ts, defaults/, skills/, package.json, and a production node_modules).
//
// This script:
//   1. runs `bun run bundle` inside the sibling claude-bot repo (../../claude-bot),
//   2. copies its dist/claude-bot into app/src-tauri/resources/claude-bot.
//
// tauri.conf.json's bundle.resources includes resources/claude-bot, so the native
// `tauri build` ships that tree inside the app. At runtime, whoever launches the
// core server sets OA_CLAUDEBOT_BUNDLE=<the resource dir>; resolveEntrypoint()
// (core/src/claudebot.ts) prefers it over the file: dev dep.
//
// The staged resource dir is gitignored — we never commit the heavy artifact.
//
// Run: cd app && bun run scripts/bundle-claudebot.ts
//   (or the `prebundle:claudebot` package.json script).
//
// NOTE: this does NOT run a native `tauri build` — it only stages the resource.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname(new URL(import.meta.url).pathname);
const appDir = join(here, ".."); // app/
const claudeBotDir = join(appDir, "..", "..", "claude-bot"); // sibling repo
const builtBundle = join(claudeBotDir, "dist", "claude-bot");
const stagedDir = join(appDir, "src-tauri", "resources", "claude-bot");

if (!existsSync(claudeBotDir)) {
  console.error(`claude-bot repo not found at ${claudeBotDir}`);
  process.exit(1);
}

// 1. Build the relocatable bundle inside the claude-bot repo.
console.log(`bundling claude-bot in ${claudeBotDir} ...`);
const build = spawnSync("bun", ["run", "bundle"], {
  cwd: claudeBotDir,
  stdio: "inherit",
});
if (build.status !== 0) {
  console.error(`claude-bot "bun run bundle" failed (exit ${build.status ?? "signal"})`);
  process.exit(build.status ?? 1);
}
if (!existsSync(builtBundle)) {
  console.error(`expected bundle output at ${builtBundle} but it does not exist`);
  process.exit(1);
}

// 2. Stage it fresh as a Tauri resource (replace any prior copy).
rmSync(stagedDir, { recursive: true, force: true });
mkdirSync(dirname(stagedDir), { recursive: true });
cpSync(builtBundle, stagedDir, { recursive: true });

console.log(`staged claude-bot bundle -> ${stagedDir}`);
