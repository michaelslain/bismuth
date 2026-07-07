import { homedir } from "os"
import { join } from "path"
import { existsSync } from "fs"

// The machine-wide Bismuth tools the GUI app installs (core/src/bismuthInstall.ts): the compiled
// bismuth-mcp + bismuth binaries under ~/.bismuth/bin and the docs tree under ~/.bismuth/docs. The
// daemon gives its Claude sessions the bismuth MCP by pointing at these ABSOLUTE paths (launchd's
// minimal PATH never resolves a bare `bismuth`), each existsSync-gated so a machine where the app
// never installed the tools degrades gracefully to no-MCP (matching how memory injection no-ops
// without BISMUTH_MEMORY_DIR).
//
// These paths are a DELIBERATE literal duplicate of bismuthInstall.ts's BIN_DIR/MCP_DEST/CLI_DEST/
// DOCS_DIR — the same convention as daemon/src/lib/claudeWhich.ts: the daemon is a separate
// workspace + separately-bundled binary, so it must not import across into @bismuth/core.
const BISMUTH_HOME = join(homedir(), ".bismuth")
const BIN_DIR = join(BISMUTH_HOME, "bin")

/** The installed bismuth-mcp binary, or undefined when the app never installed the tools. */
export function mcpBin(): string | undefined {
  const p = join(BIN_DIR, "bismuth-mcp")
  return existsSync(p) ? p : undefined
}

/** The installed bismuth CLI binary (consumed by the MCP's bismuth_cli tool via BISMUTH_CLI). */
export function cliBin(): string | undefined {
  const p = join(BIN_DIR, "bismuth")
  return existsSync(p) ? p : undefined
}

/** The installed docs tree (consumed by the MCP's docs tools via BISMUTH_DOCS_DIR). */
export function docsDir(): string | undefined {
  const p = join(BISMUTH_HOME, "docs")
  return existsSync(p) ? p : undefined
}
