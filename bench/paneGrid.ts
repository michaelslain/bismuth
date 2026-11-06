// bench/paneGrid.ts — a persisted pane tree (the shape panes.ts serializes) laying a list of pane
// contents out as a balanced grid: halve the list, alternating row and column splits.

export type GridNode =
    | { kind: 'leaf'; id: string; content: string }
    | { kind: 'split'; id: string; dir: 'row' | 'col'; ratio: number; a: GridNode; b: GridNode }

export function paneGrid(items: readonly string[]): GridNode {
    if (items.length === 0) throw new Error('paneGrid needs at least one pane')
    let n = 0
    const build = (list: readonly string[], dir: 'row' | 'col'): GridNode => {
        if (list.length === 1) return { kind: 'leaf', id: `l${n++}`, content: list[0] }
        const mid = Math.ceil(list.length / 2)
        const next = dir === 'row' ? 'col' : 'row'
        return {
            kind: 'split',
            id: `s${n++}`,
            dir,
            ratio: mid / list.length,
            a: build(list.slice(0, mid), next),
            b: build(list.slice(mid), next),
        }
    }
    return build(items, 'row')
}

export const firstLeafId = (node: GridNode): string =>
    node.kind === 'leaf' ? node.id : firstLeafId(node.a)
