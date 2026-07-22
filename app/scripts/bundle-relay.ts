// Prebuild step: stage relay/ as a Tauri resource so the bundled app's terminal tabs can
// auto-load the agent-graph relay plugin. At runtime the compiled core sidecar resolves
// BISMUTH_RELAY_BUNDLE to this staged dir (core/src/terminal.ts) — import.meta.dir is a virtual
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
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, ".."); // app/
const relayDir = join(appDir, "..", "relay"); // repo/relay
const memoryDir = join(appDir, "..", "memory"); // repo/memory (@bismuth/memory)
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

// Stage @bismuth/memory into the bundle's node_modules so the recall/collect hooks'
// `import "@bismuth/memory"` resolves at runtime. In dev this comes from the Bun workspace
// symlink (relay/node_modules/@bismuth/memory -> ../../memory), but bundle-relay drops
// node_modules entirely, so we ship a real copy here. The memory package is pure
// (node-builtin imports only, no transitive workspace deps), so a flat copy suffices.
if (!existsSync(memoryDir)) {
  console.error(`memory/ not found at ${memoryDir}`);
  process.exit(1);
}
const stagedMemoryDir = join(stagedDir, "node_modules", "@bismuth", "memory");
cpSync(memoryDir, stagedMemoryDir, {
  recursive: true,
  // Skip the package's own dev-only node_modules (@types/*) — the source uses only
  // Bun/node builtins, so nothing else is needed at runtime.
  filter: (src) => basename(src) !== "node_modules",
});

console.log(`staged relay (hooks-only) + @bismuth/memory -> ${stagedDir}`);
