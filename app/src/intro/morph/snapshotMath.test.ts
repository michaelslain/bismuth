import { describe, expect, test } from 'bun:test'
import {
    LUMA_RAMP,
    layoutText,
    lumaToChar,
    nearestGlyphColor,
    pseudoContentText,
    rectToCell,
    splitRuns,
    type CellGrid,
    type TextAlign,
    type TextGlyph,
} from './snapshotMath'
import type { MorphCell } from './morphGrid'
import type { GlyphColor } from '../../ui/ascii/glyphScene'

describe('lumaToChar', () => {
    test('floor is blank, top is the densest char', () => {
        expect(lumaToChar(0)).toBe(' ')
        expect(lumaToChar(0.02)).toBe(' ')
        expect(lumaToChar(1)).toBe('@')
        expect(lumaToChar(2)).toBe('@')
        expect(lumaToChar(-1)).toBe(' ')
        expect(lumaToChar(NaN)).toBe(' ')
    })
    test('is monotonic along the ramp', () => {
        let last = 0
        for (let i = 0; i <= 100; i++) {
            const idx = LUMA_RAMP.indexOf(lumaToChar(i / 100))
            expect(idx).toBeGreaterThanOrEqual(last)
            last = idx
        }
    })
})

describe('rectToCell', () => {
    test('floors to the containing cell', () => {
        expect(rectToCell(0, 0, 10, 20)).toEqual({ col: 0, row: 0 })
        expect(rectToCell(9.99, 19.99, 10, 20)).toEqual({ col: 0, row: 0 })
        expect(rectToCell(10, 20, 10, 20)).toEqual({ col: 1, row: 1 })
        expect(rectToCell(25, 41, 10, 20)).toEqual({ col: 2, row: 2 })
    })
    test('negative coordinates land left/above the grid', () => {
        expect(rectToCell(-0.1, -0.1, 10, 20)).toEqual({ col: -1, row: -1 })
    })
})

describe('nearestGlyphColor', () => {
    const palette = {
        fg: [240, 240, 240],
        muted: [140, 140, 140],
        faint: [70, 70, 70],
        accent: [255, 80, 0],
        graph0: [0, 120, 255],
        graph1: [0, 200, 100],
        graph2: [200, 0, 200],
        graph3: [200, 200, 0],
        graph4: [0, 200, 200],
    } as Record<GlyphColor, [number, number, number]>
    test('an exact token colour picks that token', () => {
        expect(nearestGlyphColor([255, 80, 0], palette)).toBe('accent')
        expect(nearestGlyphColor([0, 120, 255], palette)).toBe('graph0')
    })
    test('picks a token, never an average', () => {
        expect(nearestGlyphColor([250, 235, 238], palette)).toBe('fg')
        expect(nearestGlyphColor([20, 20, 20], palette)).toBe('faint')
        expect(nearestGlyphColor([120, 130, 125], palette)).toBe('muted')
    })
})

/** Glyphs for `text` set in a face whose advance is `adv` px (spaces included), starting at x, on a
 *  line box [y, y + h). Uneven per-char widths stand in for a proportional serif. */
function setLine(text: string, x: number, y: number, h: number, adv: number, align: TextAlign, uneven = false) {
    const out: TextGlyph[] = []
    for (const ch of text) {
        const w = uneven ? adv * (ch === 'i' || ch === 'l' ? 0.45 : ch === 'm' || ch === 'w' ? 1.4 : 1) : adv
        out.push({ ch, l: x, r: x + w, t: y, b: y + h, color: 'fg', align })
        x += w
    }
    return out
}
const G: CellGrid = { originX: 0, originY: 0, cellW: 10, cellH: 20, cols: 100, rows: 40 }
/** The cells as text, one string per used row, trailing blanks trimmed. */
function rowsOf(cells: MorphCell[]): Record<number, string> {
    const by: Record<number, string[]> = {}
    for (const c of cells) (by[c.row] ??= Array(G.cols).fill(' '))[c.col] = c.ch
    return Object.fromEntries(Object.entries(by).map(([r, a]) => [r, a.join('').trimEnd()]))
}

describe('layoutText', () => {
    test('a proportional centred headline reads as its words, contiguous, centred on its own centre', () => {
        // 23px advance at a 10px cell: the old per-char centre mapping spread it into "B  r  i  n  g"
        const line = setLine('Bring your own agent', 100, 200, 60, 23, 'center', true)
        const cells = layoutText(line, G)
        const rows = rowsOf(cells)
        expect(Object.keys(rows)).toEqual(['11'])
        expect(rows[11].trim()).toBe('Bring your own agent')
        const mid = (line[0].l + line[line.length - 1].r) / 2 / G.cellW
        const c0 = Math.min(...cells.map(c => c.col))
        const c1 = Math.max(...cells.map(c => c.col)) + 1
        expect(Math.abs((c0 + c1) / 2 - mid)).toBeLessThanOrEqual(0.5)
    })

    test('each run carries its real footprint: n slots of `scale` cells span the measured line, on its centre', () => {
        const line = setLine('Bring your own agent', 100, 200, 60, 23, 'center', true)
        const cells = layoutText(line, G)
        const l = line[0].l / G.cellW
        const r = line[line.length - 1].r / G.cellW
        const s = cells[0].scale!
        expect(s).toBeCloseTo((r - l) / 'Bring your own agent'.length, 6)
        expect(cells.every(c => c.scale === s && c.y === (200 + 30) / G.cellH)).toBe(true)
        expect(cells[0].x).toBeCloseTo(l, 6)
        const lastX = Math.max(...cells.map(c => c.x!))
        expect(lastX + s).toBeCloseTo(r, 6)
        // the base cells are still one consecutive run, for the plan to pair on
        const cols = cells.map(c => c.col).sort((a, b) => a - b)
        expect(cols[cols.length - 1] - cols[0]).toBe('Bring your own agent'.length - 1)
    })

    test('a narrow face does not collide chars into neighbours (no split words)', () => {
        const line = setLine('Daemon runs on whatever service you are already using:', 40, 400, 18, 6.8, 'center', true)
        expect(rowsOf(layoutText(line, G))[20].trim()).toBe('Daemon runs on whatever service you are already using:')
    })

    test('left-aligned text starts at its own start cell; wide gaps split runs', () => {
        const a = setLine('5/12 // agents', 30, 700, 18, 10, 'left')
        const b = setLine('[back]', 800, 700, 18, 10, 'left')
        const cells = layoutText([...a, ...b], G)
        const row = rowsOf(cells)[35]
        expect(row.indexOf('5/12 // agents')).toBe(3)
        expect(row.indexOf('[back]')).toBe(80)
    })

    test('several rendered lines keep their own rows; a run on a taken row moves to a free one', () => {
        // centres 6px apart: two rendered lines, both in row 5
        const l1 = setLine('first line', 100, 100, 8, 9, 'left')
        const l2 = setLine('second', 100, 106, 8, 9, 'left')
        const rows = rowsOf(layoutText([...l1, ...l2], G))
        expect(Object.values(rows).map(r => r.trim()).sort()).toEqual(['first line', 'second'])
    })

    test('the same run lays out on the same cells every time (still through a morph)', () => {
        const run = setLine('bismuth_', 37, 13, 30, 14, 'left')
        expect(layoutText(run, G)).toEqual(layoutText(run.map(g => ({ ...g })), G))
    })

    test('splitRuns drops collapsed spaces and inserts one space per word gap', () => {
        const g = setLine('ab', 0, 0, 10, 10, 'left')
        const h = setLine('cd', 26, 0, 10, 10, 'left') // a 6px gap, no space glyph: still one run
        expect(splitRuns([...g, ...h]).map(r => r.text)).toEqual(['ab cd'])
    })
})

describe('pseudoContentText', () => {
    test('reads the quoted string, dropping alt text after /', () => {
        expect(pseudoContentText('"["')).toBe('[')
        expect(pseudoContentText('"[" / ""')).toBe('[')
        expect(pseudoContentText("']' / ''")).toBe(']')
        expect(pseudoContentText('"a" "b"')).toBe('ab')
        expect(pseudoContentText('"\\5b"')).toBe('[')
    })
    test('non-text content gives nothing', () => {
        expect(pseudoContentText('none')).toBe('')
        expect(pseudoContentText('normal')).toBe('')
        expect(pseudoContentText('""')).toBe('')
        expect(pseudoContentText('counter(item)')).toBe('')
        expect(pseudoContentText('"\\e900"')).toBe('')
    })
})
