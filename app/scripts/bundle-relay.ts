// Prebuild step: stage relay/ as a Tauri resource so the bundled app's terminal tabs can
// auto-load the agent-graph relay plugin. At runtime the compiled core sidecar resolves
// OA_RELAY_BUNDLE to this staged dir (core/src/terminal.ts) — import.meta.dir is a virtual
// path in the compiled binary, so the source-relative relay/ wouldn't exist.
//
// Excludes:
//   - node_modules/  (dev-only @types/bun + typescript; the hook scripts use Bun builtins)
//   - .mcp.json      (the bismuth MCP is installed MACHINE-WIDE instead — see
//                     core/src/bismuthInstall.ts — so the bundled relay is hooks-only.
//                     Dev keeps relay/.mcp.json untouched.)
//
// The staged dir is gitignored. Run: cd app && bun run scripts/bundle-relay.ts
//   (or the `prebundle:relay` package.json script).
import { cpSync, rmSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";

const here = dirname(new URL(import.meta.url).pathname);
const appDir = join(here, ".."); // app/
const relayDir = join(appDir, "..", "relay"); // repo/relay
const stagedDir = join(appDir, "src-tauri", "resources", "relay");

if (!existsSync(relayDir)) {
  console.error(`relay/ not found at ${relayDir}`);
  process.exit(1);
}

rmSync(stagedDir, { recursive: true, force: true });
cpSync(relayDir, stagedDir, {
  recursive: true,
  filter: (src) => {
    const b = basename(src);
    // Drop node_modules (dev-only), .mcp.json (machine-wide install instead), and the
    // stray .zsh_history artifact (the bundle is read-only, so zsh would fail to lock it).
    return b !== "node_modules" && b !== ".mcp.json" && b !== ".zsh_history";
  },
});

console.log(`staged relay (hooks-only) -> ${stagedDir}`);
