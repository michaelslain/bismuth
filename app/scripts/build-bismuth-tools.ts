// Prebuild step: compile the bismuth CLI + MCP server into standalone binaries and stage
// them (plus the docs/ reference) as a Tauri resource at resources/bismuth-tools/.
//
// At runtime the core sidecar points OA_BISMUTH_INSTALL_SRC here, and
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
import { mkdirSync, rmSync, cpSync, existsSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname(new URL(import.meta.url).pathname);
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
  if (!existsSync(outFile) || statSync(outFile).size < 1_000_000) {
    console.error(`binary missing or too small: ${outFile}`);
    process.exit(1);
  }
  console.log(`✓ ${outName} (${(statSync(outFile).size / 1e6).toFixed(0)}MB)`);
}

compile(join(repoRoot, "cli", "src", "index.ts"), "bismuth");
compile(join(repoRoot, "mcp", "src", "server.ts"), "bismuth-mcp");

// Stage docs/ for the MCP docs tools (the installer sets OA_DOCS_DIR → ~/.bismuth/docs).
const docsSrc = join(repoRoot, "docs");
if (!existsSync(docsSrc)) {
  console.error(`docs/ not found at ${docsSrc}`);
  process.exit(1);
}
cpSync(docsSrc, join(outDir, "docs"), { recursive: true });
console.log(`✓ docs staged → ${join(outDir, "docs")}`);

// Record where this build came from so the installed app can git-fetch/pull + rebuild to
// self-update (core/src/selfUpdate.ts reads ${OA_BISMUTH_INSTALL_SRC}/build-origin.json).
let sha = "";
const rev = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
if (rev.status === 0) sha = rev.stdout.trim();
writeFileSync(
  join(outDir, "build-origin.json"),
  JSON.stringify({ repoRoot, sha, builtAt: new Date().toISOString() }, null, 2),
);
console.log(`✓ build-origin → ${join(outDir, "build-origin.json")} (sha ${sha.slice(0, 7) || "unknown"})`);

console.log(`✓ bismuth-tools staged → ${outDir}`);
