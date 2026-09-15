// app/src/preview/outlinePrefix.ts
// Pure connector-prefix builder for OutlineTree's fixed-width prefix column. Same ASCII
// connector vocabulary as ui/ascii/treePrefix (plain ASCII only, never box-drawing characters),
// but conditioned on each ANCESTOR'S OWN last-child status instead of assuming every ancestor
// still has a sibling below it — treePrefix's `'|   '.repeat(depth)` draws a `|` under every
// ancestor unconditionally, which is wrong the moment an ancestor is itself a last child (a real
// file-tree ASCII listing leaves that column blank once nothing more will hang off it).
export function outlinePrefix(ancestorsLast: boolean[], last: boolean): string {
    return (
        ancestorsLast.map(l => (l ? '    ' : '|   ')).join('') +
        (last ? '`-- ' : '|-- ')
    )
}
