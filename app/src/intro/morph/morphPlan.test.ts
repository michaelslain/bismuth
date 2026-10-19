import { describe, expect, test } from 'bun:test'
import type { MorphCell, MorphGrid } from './morphGrid'
import { planMorph } from './morphPlan'

function block(cols: number, rows: number, c0: number, r0: number, w: number, h: number, skip = 0): MorphGrid {
    const cells: MorphCell[] = []
    for (let r = 0; r < h; r++)
        for (let c = 0; c < w; c++)
            if (!skip || (c * 7 + r * 3) % skip !== 0)
                cells.push({ col: c0 + c, row: r0 + r, ch: 'a', color: 'fg' })
    return { cols, rows, cells }
}

const key = (c: MorphCell) => `${c.col},${c.row}`
const meanFlight = (pairs: { from?: MorphCell; to?: MorphCell }[]) => {
    let sum = 0
    let n = 0
    for (const p of pairs)
        if (p.from && p.to) {
            sum += Math.hypot(p.from.col - p.to.col, p.from.row - p.to.row)
            n++
        }
    return sum / n
}

describe('planMorph', () => {
    const a = block(200, 60, 10, 5, 60, 20)
    const b = block(200, 60, 18, 8, 60, 20)

    test('deterministic per seed, and the seed matters', () => {
        const x = planMorph(a, b, 3)
        expect(planMorph(a, b, 3)).toEqual(x)
        expect(planMorph(a, b, 4)).not.toEqual(x)
    })

    test('every to cell once, no from cell twice, equal grids pair everything', () => {
        const plan = planMorph(a, b, 1)
        const tos = plan.pairs.filter(p => p.to).map(p => key(p.to!))
        expect(tos.length).toBe(b.cells.length)
        expect(new Set(tos).size).toBe(b.cells.length)
        const froms = plan.pairs.filter(p => p.from).map(p => key(p.from!))
        expect(new Set(froms).size).toBe(froms.length)
        expect(plan.pairs.every(p => p.from && p.to)).toBe(true)
        expect(plan.pairs.every(p => p.delay >= 0 && p.delay <= 1)).toBe(true)
    })

    test('unequal grids spawn or fade the surplus', () => {
        const more = planMorph(a, block(200, 60, 18, 8, 60, 24), 1)
        expect(more.pairs.filter(p => !p.from).length).toBe(60 * 4)
        const fewer = planMorph(block(200, 60, 18, 8, 60, 24), a, 1)
        expect(fewer.pairs.filter(p => !p.to).length).toBe(60 * 4)
        expect(fewer.pairs.filter(p => p.to).length).toBe(a.cells.length)
    })

    test('flights are short: far below a random pairing', () => {
        const x = block(200, 60, 5, 5, 40, 30)
        const y = block(200, 60, 12, 8, 40, 30)
        const near = meanFlight(planMorph(x, y, 2).pairs)
        // a random pairing, same cells
        const shuffled = y.cells.slice().sort((p, q) => ((p.col * 31 + p.row * 17) % 97) - ((q.col * 31 + q.row * 17) % 97))
        const rand = meanFlight(x.cells.map((f, i) => ({ from: f, to: shuffled[i] })))
        console.log(`mean flight ${near.toFixed(2)} vs random ${rand.toFixed(2)}`)
        expect(near).toBeLessThan(rand * 0.5)
    })

    test('pairs nearest-first across a bucket edge', () => {
        const cell = (col: number): MorphCell => ({ col, row: 0, ch: 'a', color: 'fg' })
        const plan = planMorph(
            { cols: 200, rows: 60, cells: [cell(3), cell(8)] },
            { cols: 200, rows: 60, cells: [cell(7)] },
            1,
        )
        const p = plan.pairs.find(x => x.to)
        expect(p?.from?.col).toBe(8)
    })

    test('200x60 ~4000 cells plans under 30ms', () => {
        const x = block(200, 60, 0, 0, 100, 40)
        const y = block(200, 60, 30, 10, 100, 40, 11)
        planMorph(x, y, 1)
        let ms = Infinity
        for (let i = 0; i < 3; i++) {
            const t0 = performance.now()
            planMorph(x, y, 1)
            ms = Math.min(ms, performance.now() - t0)
        }
        console.log(`planMorph ${x.cells.length}x${y.cells.length}: ${ms.toFixed(2)}ms`)
        expect(ms).toBeLessThan(30)
    })
})

describe('planMorph identical cells', () => {
    test('a cell with the same place and glyph on both slides pairs with itself', () => {
        const chrome = (row: number): MorphCell[] =>
            [...'bismuth_'].map((ch, i) => ({ col: i, row, ch, color: 'fg' as const }))
        // the incoming slide has many more cells nearby, which the nearest-first pass could
        // otherwise hand the wordmark's chars to
        const extra: MorphCell[] = []
        for (let i = 0; i < 60; i++) extra.push({ col: (i * 7) % 40, row: 1 + (i % 6), ch: '.', color: 'graph0' })
        const plan = planMorph(
            { cols: 50, rows: 10, cells: chrome(0) },
            { cols: 50, rows: 10, cells: [...chrome(0), ...extra] },
            7,
        )
        for (const p of plan.pairs)
            if (p.to && p.to.row === 0) expect(p.from).toEqual(p.to)
    })
})
