// The per-session memory tools (remember / recall / forget), exposed by the Bismuth MCP
// server ONLY when the daemon is enabled for this vault. They delegate to the shared
// @bismuth/memory graph, so these tools, the daemon writer, and the relay collect-hook all
// read/write ONE note format against <vault>/.daemon/memory.
import { dirname, join, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { parse } from 'yaml'
import {
    writeNote,
    deleteNote,
    readNote,
    query,
    parseNoteRef,
    todayISO,
    type NoteType,
    type MemoryNote,
} from '@bismuth/memory'

const SETTINGS_FILE = '.settings'

/** The refusal text for the memory tools when the daemon is not enabled for the vault — shared by the
 *  MCP server and the `bismuth memory` CLI so both say the same thing. */
export const MEMORY_UNAVAILABLE =
    'Memory is unavailable — the daemon is not enabled for this vault.'

/** Walk up from `start` looking for a vault root, marked by a `.settings` file (the vault's
 *  single settings file — see core/src/settings.ts). Stops at the filesystem root. */
function findVaultRoot(start: string): string | null {
    let dir = resolve(start)
    for (;;) {
        if (existsSync(join(dir, SETTINGS_FILE))) return dir
        const parent = dirname(dir)
        if (parent === dir) return null
        dir = parent
    }
}

/** Read just `daemon.enabled` out of a vault's `.settings` (YAML). A literal duplicate of
 *  core/src/settings.ts's readDaemonEnabledSync — this workspace can't import @bismuth/core
 *  (same convention as daemon/src/lib/bismuthPaths.ts). Degrades to false on any
 *  missing/corrupt/malformed file; never throws. */
function daemonEnabledForVault(vault: string): boolean {
    try {
        const raw = readFileSync(join(vault, SETTINGS_FILE), 'utf8')
        const parsed = parse(raw) as Record<string, unknown> | null
        const daemon =
            parsed && typeof parsed === 'object' ? parsed.daemon : undefined
        if (
            daemon &&
            typeof daemon === 'object' &&
            typeof (daemon as Record<string, unknown>).enabled === 'boolean'
        ) {
            return (daemon as { enabled: boolean }).enabled
        }
    } catch {
        // missing/corrupt/unreadable → not enabled
    }
    return false
}

/**
 * Resolve the active vault root when BISMUTH_MEMORY_DIR isn't already set: BISMUTH_VAULT
 * (set explicitly by, e.g., the daemon's own session wiring) if present, else walk up from
 * the current working directory looking for a `.settings` file. Exported so daemon.ts's
 * daemonVaultRoot() shares the exact same resolution — same gate, same vault (daemonEnabled()
 * is defined as memoryDir() != null).
 */
export function resolveVaultRoot(): string | null {
    if (process.env.BISMUTH_VAULT) return resolve(process.env.BISMUTH_VAULT)
    return findVaultRoot(process.cwd())
}

/**
 * The active vault's memory dir, or null when the daemon is disabled / not a Bismuth session.
 *
 * BISMUTH_MEMORY_DIR, when already set, is trusted as-is — a trusted caller
 * (core/src/terminal.ts for an in-app terminal tab, or the daemon's own session wiring)
 * already checked daemon.enabled before setting it. Otherwise we resolve the vault ourselves
 * (resolveVaultRoot: BISMUTH_VAULT, else the cwd walked up to a `.settings` file) and check
 * THAT vault's own `.settings` directly. This fallback is what makes the memory tools work for
 * the machine-wide MCP install (`claude mcp add -s user`, which every interactive Claude
 * session on the machine gets, per bismuthInstall.ts): a session started from a plain
 * terminal/IDE with cwd inside a daemon-enabled vault never had BISMUTH_MEMORY_DIR injected by
 * anything — only Bismuth's own embedded terminal tabs and the daemon's own sessions do that —
 * so without this fallback the memory tools could never appear outside those two paths even
 * though the daemon IS enabled for the vault the user is actually working in.
 */
export function memoryDir(): string | null {
    if (process.env.BISMUTH_MEMORY_DIR) return process.env.BISMUTH_MEMORY_DIR
    const vault = resolveVaultRoot()
    return vault ? memoryDirFor(vault) : null
}

/**
 * A given vault's memory dir — `<vault>/.daemon/memory` when THAT vault's `.settings` has
 * `daemon.enabled: true`, else null. The vault-explicit half of memoryDir(), shared with the
 * `bismuth memory` CLI group so a `--vault` flag and the MCP gate agree on what "enabled" means.
 */
export function memoryDirFor(vault: string): string | null {
    return daemonEnabledForVault(vault) ? join(vault, '.daemon', 'memory') : null
}

/** Which agent channel an MCP-served call runs as. A literal mirror of core's `mcpChannel()` (this
 *  workspace can't import @bismuth/core): `chat` stays `chat`; unset or anything else is `daemon`, the
 *  stricter default. */
export function mcpAgentChannel(
    env: Record<string, string | undefined> = process.env,
): 'chat' | 'daemon' {
    return env.BISMUTH_MCP_CHANNEL === 'chat' ? 'chat' : 'daemon'
}

/** Who is calling a memory write. `null`/`undefined` = the owner (no restriction). */
export type MemoryCallOpts = { channel?: 'chat' | 'daemon' | null }

export const MEMORY_NOTE_REFUSED =
    'refused: that memory note is not visible to this agent'

/** Throw when `channel` may not see a note whose frontmatter carries `visibility`. */
function assertNoteVisible(
    visibility: 'chat-only' | 'hidden' | undefined,
    channel: MemoryCallOpts['channel'],
): void {
    if (!channel || !visibility) return
    if (visibility === 'hidden' || channel === 'daemon')
        throw new Error(MEMORY_NOTE_REFUSED)
}

export async function remember(
    args: {
        name: string
        type?: string
        tags?: string[]
        content: string
        folder?: string
    },
    dir: string,
    opts?: MemoryCallOpts,
): Promise<{ ok: true; name: string }> {
    const folder = args.folder || undefined
    const date = todayISO()
    // Preserve an existing note's type/created/visibility when overwriting. Dropping `visibility`
    // here silently un-hid a hidden note; an agent may not overwrite a note it cannot see at all.
    const existing = await readNote(args.name, dir, folder)
    assertNoteVisible(existing?.frontmatter.visibility, opts?.channel)
    await writeNote(
        args.name,
        {
            type:
                (args.type as NoteType) ?? existing?.frontmatter.type ?? 'fact',
            tags: args.tags ?? existing?.frontmatter.tags ?? [],
            created: existing?.frontmatter.created ?? date,
            updated: date,
            ...(existing?.frontmatter.visibility
                ? { visibility: existing.frontmatter.visibility }
                : {}),
        },
        args.content,
        dir,
        folder,
    )
    return { ok: true, name: folder ? `${folder}/${args.name}` : args.name }
}

export async function recall(
    args: { query: string; folder?: string },
    dir: string,
): Promise<{ ok: true; count: number; notes: MemoryNote[] }> {
    const results = await query(args.query, dir, args.folder || undefined)
    return { ok: true, count: results.length, notes: results }
}

export async function forget(
    args: { name: string },
    dir: string,
    opts?: MemoryCallOpts,
): Promise<{ ok: boolean; name: string }> {
    const ref = parseNoteRef(args.name)
    const existing = await readNote(ref.name, dir, ref.folder)
    assertNoteVisible(existing?.frontmatter.visibility, opts?.channel)
    const deleted = await deleteNote(ref.name, dir, ref.folder)
    return { ok: deleted, name: args.name }
}
