import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'

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
const BISMUTH_HOME = join(homedir(), '.bismuth')
const BIN_DIR = join(BISMUTH_HOME, 'bin')

/** The installed bismuth-mcp binary, or undefined when the app never installed the tools. */
export function mcpBin(): string | undefined {
    const p = join(BIN_DIR, 'bismuth-mcp')
    return existsSync(p) ? p : undefined
}

/** The installed bismuth CLI binary (consumed by the MCP's bismuth_cli tool via BISMUTH_CLI). */
export function cliBin(): string | undefined {
    const p = join(BIN_DIR, 'bismuth')
    return existsSync(p) ? p : undefined
}

/** The installed docs tree (consumed by the MCP's docs tools via BISMUTH_DOCS_DIR). */
export function docsDir(): string | undefined {
    const p = join(BISMUTH_HOME, 'docs')
    return existsSync(p) ? p : undefined
}

// ---- The owner-token run record -----------------------------------------------------------------
//
// `~/.bismuth/run/<base64url(vault)>.json` is where a running core drops this boot's owner token
// (core/src/runRegistry.ts + core/src/ownerToken.ts). Presenting that token in `X-Bismuth-Token`
// makes an HTTP request the OWNER — no visibility filter at all — so a daemon session that can read
// the file can read back, over HTTP, every note its sandbox exists to hide. It therefore belongs in
// this workspace's sandbox deny list (lib/visibility.ts's buildSandboxDenyPaths), which is the only
// consumer of what follows.
//
// A DELIBERATE literal duplicate of core's runRegistryDir/runKey/runRecordPath + ownerTokenDenyPaths,
// for the same reason as mcpBin/cliBin/docsDir above: the daemon is a separate workspace and a
// separately-bundled binary and must not import across into @bismuth/core. The two computations MUST
// agree byte for byte or this deny silently covers a path that no process ever opens — pinned by the
// parity test in core/test/ownerToken.test.ts, which imports THIS module and compares against core's.

/** `~/.bismuth/run`, honouring the same BISMUTH_RUN_DIR override core does (tests set it). */
function runRegistryDir(): string {
    return process.env.BISMUTH_RUN_DIR || join(BISMUTH_HOME, 'run')
}

/** This vault's run record. */
export function ownerTokenDenyPath(vault: string): string {
    return join(
        runRegistryDir(),
        `${Buffer.from(vault).toString('base64url')}.json`,
    )
}

/**
 * Every absolute spelling of {@link ownerTokenDenyPath}.
 *
 * A deny path that names the record through a symlink is a SILENT NO-OP: Seatbelt resolves symlinks
 * before matching, so a `/var/folders/…` deny does not stop a read of the same file when `/var` is a
 * link to `/private/var`. Both forms are emitted, mirroring core's ownerTokenDenyPaths and
 * visibility.ts's own DenyEntry.aliases.
 */
export function ownerTokenDenyPaths(vault: string): string[] {
    const raw = ownerTokenDenyPath(vault)
    let canonical: string
    try {
        canonical = realpathSync(raw)
    } catch {
        try {
            canonical = join(realpathSync(dirname(raw)), basename(raw))
        } catch {
            canonical = raw
        }
    }
    return canonical === raw ? [raw] : [raw, canonical]
}
