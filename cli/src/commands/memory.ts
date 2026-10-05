// The `memory` command group: the CLI twin of the MCP's remember/recall/forget tools. Both call the
// same functions in mcp/src/memory.ts against the vault's 3rd-brain graph (`<vault>/.daemon/memory`),
// so a note written one way is read the other. Headless — no server.
//
// Which graph: `--memory <dir>`, else BISMUTH_MEMORY_DIR (an in-app terminal tab injects it), else
// the resolved vault's own `.daemon/memory` — but only when THAT vault has the daemon enabled, the
// same gate the MCP applies before it lists the memory tools. Otherwise: the MCP's own refusal text.
import { resolve, relative } from 'node:path'
import type { CommandMap } from '../types'
import { realpathLoose } from '../../../core/src/realPath'
import { flag, positionals, fail, out } from '../args'
import {
    agentChannel,
    agentDenyEntries,
    agentMemoryDirAllowed,
    isDeniedPath,
} from '../../../core/src/visibilityFilter'
import { memoryNotePath, parseNoteRef } from '../../../memory/src'
import {
    remember,
    recall,
    forget,
    memoryDirFor,
    resolveVaultRoot,
    MEMORY_UNAVAILABLE,
    MEMORY_NOTE_REFUSED,
} from '../../../mcp/src/memory'

const OUTSIDE_VAULT_MEMORY =
    "refused: --memory outside the vault's .daemon/memory cannot be visibility-checked"

/**
 * An agent may only reach the vault's own memory graph. Memory visibility is per note and is checked
 * on the note alone, so pointing `--memory` at the vault root (or anywhere else) would read, overwrite
 * or delete notes inside hidden FOLDERS that nothing here can see. The owner is unrestricted.
 */
function confineAgentToVaultMemory(dir: string, args: string[]): string | null {
    if (!agentChannel()) return null
    const vaultFlag = flag(args, 'vault')
    const vault = vaultFlag ? resolve(vaultFlag) : resolveVaultRoot()
    if (!vault) fail(OUTSIDE_VAULT_MEMORY)
    if (!agentMemoryDirAllowed(vault, dir)) fail(OUTSIDE_VAULT_MEMORY)
    try {
        return realpathLoose(vault)
    } catch {
        fail(OUTSIDE_VAULT_MEMORY)
    }
}

/**
 * The memory dir, plus a `denied(name, folder)` check for an agent. The `@bismuth/memory` parser reads
 * a note's own frontmatter; core reads the same files with real YAML and is the authority on what is
 * hidden, so an agent's remember/forget/recall also asks core's deny list about the note's path. That
 * keeps the CLI correct even if the memory parser ever drifts from core again. The owner is unrestricted.
 */
async function resolveMemory(args: string[]): Promise<{
    dir: string
    denied: (name: string, folder?: string) => boolean
}> {
    const dir = unconfinedMemoryDir(args)
    const vault = confineAgentToVaultMemory(dir, args)
    if (!vault) return { dir, denied: () => false }
    // agentDenyEntries throws when visibility cannot be determined: let it propagate (fail closed).
    const entries = await agentDenyEntries(vault)
    return {
        dir,
        denied: (name, folder) => {
            let path: string
            try {
                path = realpathLoose(memoryNotePath(name, dir, folder))
            } catch {
                return true
            }
            return isDeniedPath(entries, relative(vault, path))
        },
    }
}

function unconfinedMemoryDir(args: string[]): string {
    const explicit = flag(args, 'memory') ?? process.env.BISMUTH_MEMORY_DIR
    if (explicit) return explicit
    const vaultFlag = flag(args, 'vault')
    const vault = vaultFlag ? resolve(vaultFlag) : resolveVaultRoot()
    const dir = vault ? memoryDirFor(vault) : null
    if (!dir) fail(MEMORY_UNAVAILABLE)
    return dir
}

export const commands: CommandMap = {
    'memory remember': {
        summary: "Save a note to this vault's memory graph (the 3rd brain); overwrites by name",
        usage: '--name <n> --content <md> [--type <t>] [--tags a,b] [--folder <f>] [--memory <dir>] [--vault <dir>]',
        run: async args => {
            const name = flag(args, 'name')
            const content = flag(args, 'content')
            if (!name) fail('--name <name> required')
            if (content === undefined) fail('--content <markdown> required')
            const tags = flag(args, 'tags')
            const { dir, denied } = await resolveMemory(args)
            const folder = flag(args, 'folder') || undefined
            if (denied(name, folder)) fail(MEMORY_NOTE_REFUSED)
            out(
                await remember(
                    {
                        name,
                        content,
                        type: flag(args, 'type'),
                        tags: tags
                            ? tags
                                  .split(',')
                                  .map(t => t.trim())
                                  .filter(Boolean)
                            : undefined,
                        folder: flag(args, 'folder'),
                    },
                    dir,
                    { channel: agentChannel() },
                ),
                args,
            )
        },
    },
    'memory recall': {
        summary: "Search this vault's memory graph (tag: type: keyword: link: after: before: filters)",
        usage: '<query…> [--folder <f>] [--memory <dir>] [--vault <dir>] [--pretty]',
        run: async args => {
            const query = positionals(args).join(' ')
            if (!query) fail('usage: bismuth memory recall <query…> [--folder <f>]')
            const { dir, denied } = await resolveMemory(args)
            const result = await recall({ query, folder: flag(args, 'folder') }, dir)
            const notes = result.notes.filter(n => {
                const ref = parseNoteRef(n.name)
                return !denied(ref.name, ref.folder)
            })
            out({ ...result, count: notes.length, notes }, args)
        },
    },
    'memory forget': {
        summary: "Remove a note from this vault's memory graph (name may be folder-prefixed)",
        usage: '<name> [--memory <dir>] [--vault <dir>]',
        run: async args => {
            const [name] = positionals(args)
            if (!name) fail('usage: bismuth memory forget <name>')
            const { dir, denied } = await resolveMemory(args)
            const ref = parseNoteRef(name)
            if (denied(ref.name, ref.folder)) fail(MEMORY_NOTE_REFUSED)
            out(await forget({ name }, dir, { channel: agentChannel() }), args)
        },
    },
}
