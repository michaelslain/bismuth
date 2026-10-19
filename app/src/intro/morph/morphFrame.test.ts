import { describe, expect, test } from 'bun:test'
import { GLYPH_COLORS, createFrame, frameToText, putChar, type GlyphColor, type GlyphFrame } from '../../ui/ascii/glyphScene'
import type { MorphCell, MorphGrid } from './morphGrid'
import { MORPH_MS, writeMorphFrame, type MorphGlyph } from './morphFrame'
import { planMorph } from './morphPlan'

const letters = 'abcdefghijklmnopqrstuvwxyz'
function grid(cols: number, rows: number, c0: number, r0: number, w: number, h: number, base: number): MorphGrid {
    const cells: MorphCell[] = []
    for (let r = 0; r < h; r++)
        for (let c = 0; c < w; c++)
            cells.push({
                col: c0 + c,
                row: r0 + r,
                ch: letters[(base + c * 3 + r) % 26],
                color: GLYPH_COLORS[(c + r + base) % GLYPH_COLORS.length],
            })
    return { cols, rows, cells }
}
function paint(g: MorphGrid): GlyphFrame {
    const f = createFrame(g.cols, g.rows)
    for (const c of g.cells) putChar(f, c.col, c.row, c.ch, c.color)
    return f
}
function same(a: GlyphFrame, b: GlyphFrame) {
    expect(frameToText(a)).toBe(frameToText(b))
    expect(Array.from(a.color)).toEqual(Array.from(b.color))
    expect(Array.from(a.alpha)).toEqual(Array.from(b.alpha))
}

describe('writeMorphFrame', () => {
    const from = grid(80, 30, 5, 3, 40, 12, 0)
    const to = grid(80, 30, 20, 10, 40, 12, 9)
    const plan = planMorph(from, to, 5)

    test('MORPH_MS is one second', () => expect(MORPH_MS).toBe(1000))

    test('p=0 is the from grid and p=1 the to grid, chars and colours', () => {
        const out = createFrame(80, 30)
        writeMorphFrame(plan, 0, 5, out)
        same(out, paint(from))
        writeMorphFrame(plan, 1, 5, out)
        same(out, paint(to))
    })

    test('p=0 / p=1 hold with spawned and faded cells', () => {
        const big = grid(80, 30, 20, 10, 40, 14, 9)
        const pl = planMorph(from, big, 5)
        const out = createFrame(80, 30)
        writeMorphFrame(pl, 0, 5, out)
        same(out, paint(from))
        writeMorphFrame(pl, 1, 5, out)
        same(out, paint(big))
        const pl2 = planMorph(big, from, 5)
        writeMorphFrame(pl2, 0, 5, out)
        same(out, paint(big))
        writeMorphFrame(pl2, 1, 5, out)
        same(out, paint(from))
    })

    test('mid frame is scrambled, distinct, and in bounds', () => {
        const out = createFrame(80, 30)
        writeMorphFrame(plan, 0.5, 5, out)
        const text = frameToText(out)
        expect(text).not.toBe(frameToText(paint(from)))
        expect(text).not.toBe(frameToText(paint(to)))
        const letterSet = new Set(letters)
        let noise = 0
        let ink = 0
        for (const code of out.chars) {
            const ch = String.fromCharCode(code)
            if (ch === ' ') continue
            ink++
            if (!letterSet.has(ch)) noise++
        }
        expect(ink).toBeGreaterThan(from.cells.length * 0.5)
        expect(noise).toBeGreaterThan(20)
        expect(out.chars.length).toBe(80 * 30)
    })

    test('deterministic and writes only inside cols x rows (tight frame)', () => {
        const a = createFrame(80, 30)
        const b = createFrame(80, 30)
        writeMorphFrame(plan, 0.37, 5, a)
        writeMorphFrame(plan, 0.37, 5, b)
        same(a, b)
        // a frame smaller than the plan must clip, not throw or wrap
        const tiny = createFrame(10, 5)
        for (const p of [0.1, 0.5, 0.9]) expect(() => writeMorphFrame(plan, p, 5, tiny)).not.toThrow()
        expect(tiny.chars.length).toBe(50)
    })

    test('stagger: cells land in a sweep, not all at once', () => {
        const out = createFrame(80, 30)
        const landed = (p: number) => {
            writeMorphFrame(plan, p, 5, out)
            const want = paint(to)
            let n = 0
            for (let i = 0; i < out.chars.length; i++)
                if (want.chars[i] !== 32 && want.chars[i] === out.chars[i]) n++
            return n
        }
        const early = landed(0.55)
        const late = landed(0.62)
        expect(early).toBeLessThan(late)
        expect(late).toBeLessThan(to.cells.length)
    })

    test('200x60 ~4000 cells writes under 4ms', () => {
        const x = grid(200, 60, 0, 0, 100, 40, 0)
        const y = grid(200, 60, 30, 10, 100, 40, 4)
        const pl = planMorph(x, y, 1)
        const out = createFrame(200, 60)
        writeMorphFrame(pl, 0.5, 1, out)
        let best = Infinity
        for (let i = 0; i < 5; i++) {
            const t0 = performance.now()
            writeMorphFrame(pl, 0.3 + i * 0.1, 1, out)
            best = Math.min(best, performance.now() - t0)
        }
        console.log(`writeMorphFrame ${pl.pairs.length} pairs: ${best.toFixed(2)}ms`)
        expect(best).toBeLessThan(4)
    })
})

describe('writeMorphFrame structure', () => {
    const from = grid(80, 30, 5, 3, 40, 12, 0)
    const to = grid(80, 30, 20, 10, 40, 12, 9)
    const plan = planMorph(from, to, 5)
    const showing = (g: MorphGrid, out: GlyphFrame) =>
        g.cells.filter(c => out.chars[c.row * out.cols + c.col] === c.ch.charCodeAt(0)).length / g.cells.length

    test('outgoing words read early, incoming words read late', () => {
        const out = createFrame(80, 30)
        const at = (p: number) => {
            writeMorphFrame(plan, p, 5, out)
            return { src: showing(from, out), dst: showing(to, out) }
        }
        expect(at(0.2).src).toBeGreaterThanOrEqual(0.7)
        expect(at(0.25).src).toBeGreaterThanOrEqual(0.55)
        expect(at(0.75).dst).toBeGreaterThanOrEqual(0.6)
        expect(at(0.8).dst).toBeGreaterThanOrEqual(0.7)
        // the middle is mostly in flight: neither slide is still standing
        const mid = at(0.5)
        expect(mid.src).toBeLessThan(0.3)
        expect(mid.dst).toBeLessThan(0.55)
    })

    test('lifts sweep left to right', () => {
        const out = createFrame(80, 30)
        writeMorphFrame(plan, 0.3, 5, out)
        let restCol = 0, rest = 0, goneCol = 0, gone = 0
        for (const c of from.cells) {
            if (out.chars[c.row * 80 + c.col] === c.ch.charCodeAt(0)) {
                restCol += c.col
                rest++
            } else {
                goneCol += c.col
                gone++
            }
        }
        expect(rest).toBeGreaterThan(0)
        expect(gone).toBeGreaterThan(0)
        expect(goneCol / gone).toBeLessThan(restCol / rest - 5)
    })

    test('in-flight chars are dimmer than chars at rest or landed', () => {
        const out = createFrame(80, 30)
        writeMorphFrame(plan, 0.5, 5, out)
        const letterSet = new Set(letters)
        let noise = 0
        for (let i = 0; i < out.chars.length; i++) {
            const ch = String.fromCharCode(out.chars[i])
            if (ch === ' ' || letterSet.has(ch)) continue
            noise++
            expect(out.alpha[i]).toBeLessThan(255)
        }
        expect(noise).toBeGreaterThan(50)
    })

    test('a char on the same cell with the same glyph on both slides never moves', () => {
        const a = grid(80, 30, 2, 1, 8, 1, 0)
        const b: MorphGrid = { cols: 80, rows: 30, cells: [...a.cells, ...grid(80, 30, 30, 15, 10, 3, 4).cells] }
        const pl = planMorph({ cols: 80, rows: 30, cells: [...a.cells, ...grid(80, 30, 40, 5, 10, 3, 1).cells] }, b, 3)
        const out = createFrame(80, 30)
        for (let p = 0; p <= 1.0001; p += 0.05) {
            writeMorphFrame(pl, p, 3, out)
            for (const c of a.cells) expect(String.fromCharCode(out.chars[c.row * 80 + c.col])).toBe(c.ch)
        }
    })

    test('spawned chars appear beside their own cell, not across the screen', () => {
        const target = grid(80, 30, 30, 12, 12, 3, 2)
        const pl = planMorph({ cols: 80, rows: 30, cells: [] }, target, 4)
        const out = createFrame(80, 30)
        for (const p of [0.3, 0.5, 0.7, 0.85]) {
            writeMorphFrame(pl, p, 4, out)
            for (let i = 0; i < out.chars.length; i++) {
                if (out.chars[i] === 32) continue
                const col = i % 80
                const row = Math.floor(i / 80)
                expect(col).toBeGreaterThanOrEqual(30 - 2)
                expect(col).toBeLessThan(42 + 2)
                expect(row).toBeGreaterThanOrEqual(12 - 1)
                expect(row).toBeLessThan(15 + 1)
            }
        }
        writeMorphFrame(pl, 0.1, 4, out)
        expect(frameToText(out).trim()).toBe('') // nothing has spawned yet early on
    })
})

describe('writeMorphFrame fitted text', () => {
    /** A run of text cells on its real footprint: slot `scale` cells wide from fractional col x0. */
    function fittedRun(text: string, col: number, row: number, x0: number, y: number, scale: number, color: GlyphColor): MorphCell[] {
        return [...text].map((ch, k) => ({ col: col + k, row, ch, color, x: x0 + k * scale, y, scale }))
    }
    const fromG: MorphGrid = {
        cols: 80,
        rows: 30,
        cells: [...fittedRun('An agent that never sleeps', 27, 20, 10.5, 20.4, 2.3, 'fg'), ...grid(80, 30, 30, 4, 20, 8, 1).cells],
    }
    const toG: MorphGrid = {
        cols: 80,
        rows: 30,
        cells: [...fittedRun('Bring your own agent', 30, 21, 7.25, 21.6, 3.27, 'fg'), ...grid(80, 30, 34, 6, 16, 8, 6).cells],
    }
    const plan = planMorph(fromG, toG, 2)
    const glyphKey = (g: MorphCell) => `${g.col},${g.row},${g.ch},${g.color},${g.x},${g.y},${g.scale}`
    const textOf = (g: MorphGrid) => g.cells.filter(c => c.scale !== undefined)
    const gridOf = (g: MorphGrid): MorphGrid => ({ ...g, cells: g.cells.filter(c => c.scale === undefined) })

    test('p=0 / p=1: the fitted list is the text cells exactly (place, size, colour), the grid the rest', () => {
        const out = createFrame(80, 30)
        const fitted: MorphGlyph[] = []
        for (const [p, g] of [[0, fromG], [1, toG]] as const) {
            writeMorphFrame(plan, p, 2, out, fitted)
            same(out, paint(gridOf(g)))
            expect(fitted.every(f => f.alpha === 255)).toBe(true)
            expect(fitted.map(glyphKey).sort()).toEqual(textOf(g).map(glyphKey).sort())
        }
    })

    test('without a fitted list, text falls back to its base cells', () => {
        const out = createFrame(80, 30)
        writeMorphFrame(plan, 1, 2, out)
        same(out, paint(toG))
    })

    test('a flying text char moves and resizes between its two footprints', () => {
        const fitted: MorphGlyph[] = []
        const out = createFrame(80, 30)
        writeMorphFrame(plan, 0.45, 2, out, fitted)
        const flying = fitted.filter(f => f.alpha < 255)
        expect(flying.length).toBeGreaterThan(3)
        for (const f of flying) {
            expect(f.scale).toBeGreaterThanOrEqual(1 - 1e-6)
            expect(f.scale).toBeLessThanOrEqual(3.27 + 1e-6)
        }
        // some are visibly between sizes, not snapped to either end
        expect(flying.some(f => f.scale > 1.05 && f.scale < 3.2)).toBe(true)
    })
})

describe('writeMorphFrame cloud', () => {
    const from = grid(80, 30, 5, 3, 40, 12, 0)
    const to = grid(80, 30, 20, 10, 40, 12, 9)
    const plan = planMorph(from, to, 5)

    test('in-flight chars stay at or above 0.6 alpha', () => {
        const out = createFrame(80, 30)
        writeMorphFrame(plan, 0.5, 5, out)
        let flying = 0
        for (let i = 0; i < out.chars.length; i++) {
            if (out.chars[i] === 32 || out.alpha[i] === 255) continue
            flying++
            expect(out.alpha[i]).toBeGreaterThanOrEqual(Math.round(255 * 0.6))
        }
        expect(flying).toBeGreaterThan(50)
    })

    test('a flying char keeps its source token colour until it locks in on its approach', () => {
        // graph-coloured art flying into neutral text: mid-morph the cloud is still the graph colours
        const art: MorphGrid = { cols: 80, rows: 30, cells: grid(80, 30, 10, 4, 30, 10, 0).cells.map(c => ({ ...c, color: 'graph2' as const })) }
        const text: MorphGrid = { cols: 80, rows: 30, cells: grid(80, 30, 15, 18, 30, 10, 3).cells.map(c => ({ ...c, color: 'fg' as const })) }
        const pl = planMorph(art, text, 9)
        const out = createFrame(80, 30)
        writeMorphFrame(pl, 0.3, 9, out)
        const counts: Record<string, number> = {}
        let flying = 0
        for (let i = 0; i < out.chars.length; i++) {
            if (out.chars[i] === 32 || out.alpha[i] === 255) continue
            flying++
            const name = GLYPH_COLORS[out.color[i]]
            counts[name] = (counts[name] ?? 0) + 1
        }
        expect(flying).toBeGreaterThan(50)
        expect((counts.graph2 ?? 0) / flying).toBeGreaterThan(0.6)
        expect((counts.fg ?? 0) / flying).toBeLessThan(0.2)
    })
})
