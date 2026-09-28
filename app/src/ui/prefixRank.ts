// app/src/ui/prefixRank.ts
// Pure filter + rank for a typed query over a fixed option list (MultiSelect's filter field). It
// follows the note editor's tag completion (editor/autocomplete.ts's `tagListSource`: a
// case-insensitive `startsWith`), so the best match is the first PREFIX match — that row is the
// one a picker highlights and Tab/Enter autofills. Substring-only matches are still listed, after
// every prefix match, so a filter never hides a row it used to show. Within each group the input
// order is kept: a picker freezes its row order while open, and reshuffling it would move rows
// out from under the pointer. No framework imports, so `bun test` runs it.

/** `order` narrowed to the rows matching `query` (case-insensitive), prefix matches first. An
 *  empty/whitespace query returns `order` unchanged. */
export function prefixRank(order: ReadonlyArray<string>, query: string): string[] {
    const q = query.trim().toLowerCase()
    if (!q) return [...order]
    const prefix: string[] = []
    const inner: string[] = []
    for (const o of order) {
        const l = o.toLowerCase()
        if (l.startsWith(q)) prefix.push(o)
        else if (l.includes(q)) inner.push(o)
    }
    return [...prefix, ...inner]
}
