// Pairs the outgoing slide's cells with the incoming slide's cells, nearest first, so the morph
// reads as a local drift rather than a full-screen criss-cross. Pure and deterministic per seed.
import { cellHash } from '../../ui/ascii/glyphScene'
import type { MorphCell, MorphGrid } from './morphGrid'

export type MorphPair = {
    /** absent = spawned from noise */
    from?: MorphCell
    /** absent = fades out */
    to?: MorphCell
    /** 0..1: when this pair starts moving, as a fraction of the flight phase (stagger) */
    delay: number
}
export type MorphPlan = { cols: number; rows: number; pairs: MorphPair[] }

/** A glyph cell is about twice as tall as wide, so a row step counts double. */
const ROW_WEIGHT = 2
const BUCKET_COLS = 8
const BUCKET_ROWS = 4
/** Share of the stagger taken by the left-to-right sweep; the rest is per-cell jitter. */
const SWEEP = 0.72

/** Squared weighted distance: ordering only, so no sqrt. */
function dist2(a: MorphCell, b: MorphCell): number {
    const dx = a.col - b.col
    const dy = (a.row - b.row) * ROW_WEIGHT
    return dx * dx + dy * dy
}

/** Deterministic for (from, to, seed). Every `to` cell appears in exactly one pair; every `from`
 *  cell in at most one. Pairing prefers spatially near cells (no full-screen criss-cross). */
export function planMorph(from: MorphGrid, to: MorphGrid, seed: number): MorphPlan {
    const cols = Math.max(from.cols, to.cols)
    const rows = Math.max(from.rows, to.rows)

    const bw = Math.ceil(cols / BUCKET_COLS) || 1
    const bh = Math.ceil(rows / BUCKET_ROWS) || 1
    const buckets: number[][] = Array.from({ length: bw * bh }, () => [])
    const bucketOf = (c: MorphCell) => {
        const bx = Math.min(bw - 1, Math.max(0, Math.floor(c.col / BUCKET_COLS)))
        const by = Math.min(bh - 1, Math.max(0, Math.floor(c.row / BUCKET_ROWS)))
        return { bx, by }
    }
    // A cell identical on both slides (same place, same glyph: the wordmark, [skip]) pairs with
    // itself before the nearest-first pass, which could otherwise hand it to an earlier neighbour
    // and send it flying.
    const matched: (MorphCell | undefined)[] = new Array(to.cells.length)
    const fromAt = new Map<number, number>()
    from.cells.forEach((c, i) => fromAt.set(c.row * cols + c.col, i))
    const used = new Set<number>()
    to.cells.forEach((t, ti) => {
        const fi = fromAt.get(t.row * cols + t.col)
        if (fi === undefined || used.has(fi) || from.cells[fi].ch !== t.ch) return
        matched[ti] = from.cells[fi]
        used.add(fi)
    })
    from.cells.forEach((c, i) => {
        if (used.has(i)) return
        const { bx, by } = bucketOf(c)
        buckets[by * bw + bx].push(i)
    })

    // Visit `to` cells in a seeded shuffled order so no side of the screen always wins the
    // contested neighbours.
    const order = to.cells.map((_, i) => i)
    const key = order.map(i => cellHash(to.cells[i].col, to.cells[i].row, seed))
    order.sort((a, b) => key[a] - key[b])

    let remaining = from.cells.length - used.size
    const maxR = Math.max(bw, bh)

    for (const ti of order) {
        if (remaining === 0) break
        if (matched[ti]) continue
        const t = to.cells[ti]
        const { bx, by } = bucketOf(t)
        let best = -1
        let bestD = Infinity
        let bestBucket = -1
        for (let r = 0; r <= maxR; r++) {
            // every cell in ring r or beyond is at least (r-1) * bucket size away
            const reach = Math.max(0, r - 1) * Math.min(BUCKET_COLS, BUCKET_ROWS * ROW_WEIGHT)
            if (best >= 0 && bestD <= reach * reach) break
            for (let y = by - r; y <= by + r; y++) {
                if (y < 0 || y >= bh) continue
                const edgeRow = y === by - r || y === by + r
                for (let x = bx - r; x <= bx + r; x += edgeRow || r === 0 ? 1 : 2 * r) {
                    if (x < 0 || x >= bw) continue
                    const list = buckets[y * bw + x]
                    for (let k = 0; k < list.length; k++) {
                        const d = dist2(from.cells[list[k]], t)
                        if (d < bestD) {
                            bestD = d
                            best = k
                            bestBucket = y * bw + x
                        }
                    }
                }
            }
        }
        if (best < 0) continue
        const list = buckets[bestBucket]
        matched[ti] = from.cells[list[best]]
        list[best] = list[list.length - 1]
        list.pop()
        remaining--
    }

    const pairs: MorphPair[] = []
    const delayOf = (c: MorphCell) =>
        Math.min(
            1,
            Math.max(
                0,
                SWEEP * (c.col / Math.max(1, cols - 1)) +
                    (1 - SWEEP) * cellHash(c.col, c.row, seed + 1),
            ),
        )
    to.cells.forEach((t, i) => {
        pairs.push({ from: matched[i], to: t, delay: delayOf(t) })
    })
    // Whatever `from` cells are left have nowhere to go: they fade where they stand.
    for (const list of buckets)
        for (const fi of list) {
            const f = from.cells[fi]
            pairs.push({ from: f, delay: delayOf(f) })
        }
    return { cols, rows, pairs }
}
