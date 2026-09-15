// app/src/preview/outlineCurrent.ts
// Resolves the outline node a reader is CURRENTLY inside, from the current page — what draws the
// OUTLINE section's "you are here" marker (OutlineTree's `aria-current="location"` row) and what
// a fresh bookmark's default label borrows from (BookmarksPanel's `+`). Pure: walks the tree in
// the same pre-order OutlineTree renders it in, so "current" always means "the node this page's
// row would sit under."
import type { OutlineNode } from './annotationTypes'

/** Index path (through `children`) to the CURRENT section: the deepest node whose page is <=
 *  `page` — the LAST match in a pre-order walk. Pre-order visits a parent before its children, so
 *  once a later ancestor-or-descendant also matches it simply overwrites the running answer,
 *  which is what makes "last match" and "deepest match" the same node for a normal outline (one
 *  whose nested sections don't start before their parent's own page). `[]` when nothing on `page`
 *  or before it resolves — before the first entry, or every entry up to here is a dead
 *  `page: null` destination. */
export function currentOutlinePath(
    nodes: OutlineNode[],
    page: number,
): number[] {
    let best: number[] = []
    const walk = (list: OutlineNode[], prefix: number[]) => {
        list.forEach((node, i) => {
            const path = [...prefix, i]
            if (node.page !== null && node.page <= page) best = path
            walk(node.children, path)
        })
    }
    walk(nodes, [])
    return best
}

/** The title of the current section (see `currentOutlinePath`), or `null` when none resolves —
 *  what a newly-added bookmark defaults its label to before falling back to `Page N`. */
export function outlineTitleForPage(
    nodes: OutlineNode[],
    page: number,
): string | null {
    const path = currentOutlinePath(nodes, page)
    if (path.length === 0) return null
    let list = nodes
    let node: OutlineNode | undefined
    for (const i of path) {
        node = list[i]
        list = node.children
    }
    return node ? node.title : null
}
