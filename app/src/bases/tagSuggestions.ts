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
