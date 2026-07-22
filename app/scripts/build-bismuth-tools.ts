// Prebuild step: compile the bismuth CLI + MCP server into standalone binaries and stage
// them (plus the docs/ reference) as a Tauri resource at resources/bismuth-tools/.
//
// At runtime the core sidecar points BISMUTH_INSTALL_SRC here, and
// core/src/bismuthInstall.ts copies these into ~/.bismuth and registers them MACHINE-WIDE
// (the `bismuth` CLI on PATH + the bismuth MCP in the user's global ~/.claude.json), so
// every terminal + every Claude session gets them — not just Bismuth app tabs.
//
// Unlike the core sidecar (named with a target-triple for Tauri's sidecar resolver), these
// are plain resources we copy ourselves, so no triple suffix. Both compile + run today
// (verified). Heavy + platform-specific → gitignored.
//
// Run: cd app && bun run scripts/build-bismuth-tools.ts   (or `bun run build:bismuth-tools`)
// Wired into beforeBuildCommand so `tauri build` always has fresh tools.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertBuiltBinary } from "./buildUtils";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, ".."); // app/
const repoRoot = join(appDir, ".."); // repo root
const outDir = join(appDir, "src-tauri", "resources", "bismuth-tools");
const binDir = join(outDir, "bin");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });

function compile(entry: string, outName: string): void {
  const outFile = join(binDir, outName);
  console.log(`compiling ${entry} → ${outFile}`);
  const r = spawnSync("bun", ["build", "--compile", entry, "--outfile", outFile], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error(`bun build --compile failed for ${entry}`);
    process.exit(1);
  }
  assertBuiltBinary(outFile, outName);
}

compile(join(repoRoot, "cli", "src", "index.ts"), "bismuth");
compile(join(repoRoot, "mcp", "src", "server.ts"), "bismuth-mcp");

// Stage docs/ for the MCP docs tools (the installer sets BISMUTH_DOCS_DIR → ~/.bismuth/docs).
const docsSrc = join(repoRoot, "docs");
if (!existsSync(docsSrc)) {
  console.error(`docs/ not found at ${docsSrc}`);
  process.exit(1);
}
cpSync(docsSrc, join(outDir, "docs"), { recursive: true });
console.log(`✓ docs staged → ${join(outDir, "docs")}`);

// Record where this build came from so the installed app can git-fetch/pull + rebuild to
// self-update (core/src/selfUpdate.ts reads ${BISMUTH_INSTALL_SRC}/build-origin.json).
//
// The recorded repoRoot must be the STABLE main-worktree clone — NOT the checkout this build ran
// from. Building inside an ephemeral `.claude/worktrees/*` checkout (e.g. via the create/merge
// worktree flow) would otherwise bake a repoRoot that DISAPPEARS when that worktree is cleaned up,
// leaving the installed app git-probing a missing dir and reporting "update source unavailable"
// forever. `git worktree list` always lists the main worktree first, so its path is the durable
// clone that tracks origin/main — exactly where self-update's `git pull --ff-only origin main` +
// rebuild belong. Compilation above intentionally still uses the current checkout (we ship the
// code that was built); only the self-update origin is canonicalized.
function canonicalRepoRoot(checkout: string): string {
  const wl = spawnSync("git", ["-C", checkout, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  if (wl.status === 0) {
    const m = wl.stdout.match(/^worktree (.+)$/m);
    if (m?.[1]) return m[1].trim();
  }
  return checkout; // not a git repo / git unavailable → fall back to the checkout path
}

let sha = "";
const rev = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
if (rev.status === 0) sha = rev.stdout.trim();
const originRepoRoot = canonicalRepoRoot(repoRoot);
if (originRepoRoot !== repoRoot) {
  console.log(`  build-origin repoRoot canonicalized: ${repoRoot} → ${originRepoRoot} (main worktree)`);
}
writeFileSync(
  join(outDir, "build-origin.json"),
  JSON.stringify({ repoRoot: originRepoRoot, sha, builtAt: new Date().toISOString() }, null, 2),
);
console.log(`✓ build-origin → ${join(outDir, "build-origin.json")} (sha ${sha.slice(0, 7) || "unknown"})`);

console.log(`✓ bismuth-tools staged → ${outDir}`);
