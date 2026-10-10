// `bismuth map`: the vault's structural overview (folders, clusters, hubs, tags, surfaces) as the
// markdown an agent reads, or its neighbourhood view of one note with --around. The CLI twin of
// the MCP `vault_map` tool.
import type { CommandMap } from '../types'
import { BOOLEAN_FLAGS, bool, fail, flag, out, positionals, requireVault } from '../args'
import {
    buildVaultMap,
    formatVaultMap,
    vaultNeighbourhood,
    type VaultMap,
} from '../../../core/src/vaultMap'
import { agentDenyEntries } from '../../../core/src/visibilityFilter'
import { semanticQuery } from '../semantic'
import { memoryDirFor } from '../../../mcp/src/memory'

const MAP_BUDGET_CHARS = 6000
const SIMILAR_MAX = 5
const SIMILAR_WAIT_MS = 2000

/** The map limited to one folder subtree: folders, clusters (by their folders) and hubs. */
export function mapInFolder(map: VaultMap, folder: string): VaultMap {
    const base = folder.replace(/^\/+|\/+$/g, '')
    const inside = (p: string) => p === base || p.startsWith(`${base}/`)
    return {
        ...map,
        folders: map.folders.filter(f => inside(f.path)),
        clusters: map.clusters.filter(c => c.folders.some(inside)),
        hubs: map.hubs.filter(h => inside(h.path)),
    }
}

export const commands: CommandMap = {
    map: {
        summary: 'Print the vault map (folders, clusters, hubs, tags), or one note neighbourhood',
        usage: '[--folder <f>] [--around <note>] [--json] [--vault <dir>]',
        run: async args => {
            const vault = requireVault(args)
            const json = bool(args, 'json')
            if (positionals(args, [...BOOLEAN_FLAGS, 'json']).length > 0)
                fail('usage: bismuth map [--folder <f>] [--around <note>] [--json]')
            // Fail closed: throws when visibility cannot be determined. [] is the owner.
            const deny = await agentDenyEntries(vault)
            const around = flag(args, 'around')
            if (around) {
                const n = await vaultNeighbourhood(vault, around, {
                    deny,
                    memoryDir: memoryDirFor(vault) ?? undefined,
                })
                if (!n) fail(`note not found: ${around}`)
                // Best effort: embeddings off, unavailable or slow leave the output unchanged.
                const sim = await semanticQuery(args, vault, { around: n.path }, deny, SIMILAR_MAX, SIMILAR_WAIT_MS).catch(() => null)
                const similar = Array.isArray(sim) ? sim.map(h => h.path) : []
                if (json) return out(similar.length ? { ...n, similar } : n, args)
                const list = (label: string, items: string[]) =>
                    items.length ? `${label}: ${items.join(', ')}` : ''
                console.log(
                    [
                        `# ${n.path}`,
                        n.cluster ? `cluster: ${n.cluster}` : '',
                        list('links to', n.outLinks),
                        list('linked from', n.backLinks),
                        list('siblings', n.siblings),
                        list('tags', n.tags),
                        list('memories', n.memories),
                        list('similar', similar),
                    ]
                        .filter(Boolean)
                        .join('\n'),
                )
                return
            }
            let map = await buildVaultMap(vault, { deny })
            const folder = flag(args, 'folder')
            if (folder) map = mapInFolder(map, folder)
            if (json) return out(map, args)
            console.log(formatVaultMap(map, MAP_BUDGET_CHARS))
        },
    },
}
