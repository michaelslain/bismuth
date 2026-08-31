// app/src/ui/ascii/rasterEdges.ts
// Bresenham line rasterizer for the ASCII knowledge graph. Pure — no DOM, no
// Solid — GraphField.tsx just renders the string these return.
//
// Ported from bismuth-design/ascii/design-system/components/ascii/GraphField.jsx
// (rasterEdges) and bismuth-design/ascii/design-system/guidelines/ascii-graph.card.html
// (the noise-clearing law, PORTING.md §4: "the noise layer ... is cleared
// beneath every edge and label").

export interface GraphNode {
    x: number
    y: number
}

/** Index pairs into a `GraphNode[]` array. */
export type GraphEdge = [number, number]

/**
 * Rasterize every edge into a `cols`×`rows` character grid (rows newline-
 * joined) using Bresenham's line algorithm: "-" for a horizontal step, "|"
 * for a vertical step, "/" or "\" for a diagonal step (by the sign
 * relationship of the two axis steps). Every node is stamped "+" last, so a
 * node's cell always reads "+" — a junction — regardless of what any edge
 * drew under it. Out-of-range node coordinates are clipped (ignored), never
 * wrapped, and out-of-range edge endpoints are skipped entirely.
 */
export function rasterEdges(
    cols: number,
    rows: number,
    nodes: GraphNode[],
    edges: GraphEdge[],
): string {
    const grid: string[][] = []
    for (let r = 0; r < rows; r++) grid.push(new Array(cols).fill(' '))

    const put = (x: number, y: number, ch: string) => {
        if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = ch
    }

    edges.forEach(([ai, bi]) => {
        const a = nodes[ai]
        const b = nodes[bi]
        if (!a || !b) return
        let x = a.x
        let y = a.y
        const dx = Math.abs(b.x - x)
        const dy = Math.abs(b.y - y)
        const sx = b.x > x ? 1 : -1
        const sy = b.y > y ? 1 : -1
        let err = dx - dy
        let guard = 0
        while (guard++ < 2000 && !(x === b.x && y === b.y)) {
            const e2 = 2 * err
            let mx = false
            let my = false
            if (e2 > -dy) {
                err -= dy
                x += sx
                mx = true
            }
            if (e2 < dx) {
                err += dx
                y += sy
                my = true
            }
            put(x, y, mx && my ? (sx === sy ? '\\' : '/') : mx ? '-' : '|')
        }
    })

    nodes.forEach(n => put(n.x, n.y, '+'))

    return grid.map(r => r.join('')).join('\n')
}

/**
 * Blank the noise field wherever the edges layer drew a non-space character —
 * "clear the noise under every edge ... or the field reads as mush"
 * (GraphField.prompt.md). `noise` and `edges` must be the same `cols`×`rows`
 * grid (newline-joined rows); mismatched line lengths are handled cell by
 * cell rather than assumed.
 */
export function clearNoiseUnderEdges(noise: string, edges: string): string {
    const noiseRows = noise.split('\n')
    const edgeRows = edges.split('\n')
    return noiseRows
        .map((row, r) => {
            const edgeRow = edgeRows[r] ?? ''
            let out = ''
            for (let c = 0; c < row.length; c++) {
                const edgeCh = edgeRow[c]
                out += edgeCh && edgeCh !== ' ' ? ' ' : row[c]
            }
            return out
        })
        .join('\n')
}
