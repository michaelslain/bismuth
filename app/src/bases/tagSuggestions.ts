// app/src/bases/tagSuggestions.ts
// Pure logic behind a tags picker's suggestion list (PropertyValueEditor's `tags` branch). The
// vault-wide half comes from the SAME source the note editor's `#tag` / frontmatter `tags:`
// completion reads: the vault graph's `tag` nodes (App.tsx's `tagCandidates` → Editor's
// `getTags`), labels with the leading `#` stripped. No framework imports, so `bun test` runs it.

/** The graph fields this module reads — structural, so a caller can pass `GraphData` as-is. */
export type TagGraph = { nodes: ReadonlyArray<{ kind: string; label: string }> }

/** Bare tag names (no `#`) from a vault graph's `tag` nodes, in graph order, deduplicated. */
export function vaultTagNames(graph: TagGraph | null | undefined): string[] {
    if (!graph) return []
    return mergeTagOptions(
        graph.nodes
            .filter(n => n.kind === 'tag')
            .map(n => n.label.replace(/^#/, ''))
            .filter(Boolean),
    )
}

/** Union of several option lists, first-seen order, exact-string dedup. The caller decides
 *  precedence by argument order — PropertyValueEditor passes the column's own values first so a
 *  table's tags lead and the rest of the vault's follow. */
export function mergeTagOptions(...lists: ReadonlyArray<string>[]): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const list of lists)
        for (const v of list) {
            if (!v || seen.has(v)) continue
            seen.add(v)
            out.push(v)
        }
    return out
}

/** A shared, time-boxed cache of the vault's tag names. Every tags editor reads it: `last()` is
 *  the last-known set (suggest it at once), `load()` refreshes it — one fetch is shared by every
 *  caller within `ttl` ms, so opening cell after cell never re-downloads the whole vault graph
 *  just to read its tag names. A failed fetch is forgotten so the next `load()` retries. */
export function createVaultTagsCache(
    fetchTags: () => Promise<string[]>,
    opts: { ttl?: number; now?: () => number } = {},
): {
    last: () => string[]
    load: () => Promise<string[]>
    reset: () => void
} {
    const ttl = opts.ttl ?? 30_000
    const now = opts.now ?? Date.now
    let last: string[] = []
    let inflight: { at: number; tags: Promise<string[]> } | null = null
    return {
        last: () => last,
        load: () => {
            if (!inflight || now() - inflight.at > ttl) {
                const entry = {
                    at: now(),
                    tags: fetchTags().then(
                        tags => {
                            last = tags
                            return tags
                        },
                        e => {
                            if (inflight === entry) inflight = null
                            throw e
                        },
                    ),
                }
                inflight = entry
            }
            return inflight.tags
        },
        reset: () => {
            inflight = null
            last = []
        },
    }
}
