// app/src/ui/ascii/treePrefix.ts
// Pure connector-prefix builder for <AsciiTree> rows. Ported 1:1 from
// bismuth-design/ascii/design-system/components/ascii/AsciiTree.jsx — plain ASCII only,
// never box-drawing characters.

/** Connector prefix for a node at `depth`.
 *
 *  `ancestorsLast[k]` says whether the ancestor at depth `k` was the LAST child of its parent. A
 *  last ancestor has no siblings below it, so the column under it is BLANK (`'    '`); only an
 *  ancestor that still has siblings to come keeps its `|` running down (`'|   '`). Drawing `|`
 *  under a `` `-- `` terminator implies siblings that do not exist. Entries missing for a level
 *  read as "not last" (the `|` stays) — so the argument may be omitted, which is ONLY there to keep
 *  the callers that have not converted yet (FileTree, ChartDrill) compiling with their old output;
 *  a caller that knows its ancestors passes them. */
export function treePrefix(depth: number, isLast: boolean, ancestorsLast: boolean[] = []): string {
    let out = ''
    for (let k = 0; k < depth; k++) out += ancestorsLast[k] ? '    ' : '|   '
    return out + (isLast ? '`-- ' : '|-- ')
}

/** For a flat, depth-first list of rows, each row's `ancestorsLast` array: entry `k` is the `last`
 *  flag of the nearest preceding row at depth `k` (that row IS the row's ancestor at depth `k`).
 *  A row's own depth entries are what `treePrefix` reads. */
export function ancestorsLastOf(rows: { depth?: number; last?: boolean }[]): boolean[][] {
    const lastAt: boolean[] = []
    return rows.map(r => {
        const depth = r.depth ?? 0
        const mine = lastAt.slice(0, depth)
        lastAt[depth] = !!r.last
        lastAt.length = depth + 1
        return mine
    })
}
