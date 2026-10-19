// Pure maths for snapshotSlide: luminance -> char, pixel -> cell, colour -> nearest token, rendered
// glyph boxes -> monospace runs, ::before/::after content -> text.
// No DOM, no framework.
import { GLYPH_COLORS, type GlyphColor } from '../../ui/ascii/glyphScene'
import type { MorphCell } from './morphGrid'

/** Light-on-dark density ramp, blank to densest. */
export const LUMA_RAMP = ' .:-=+*#%@'

/** Below this luminance a cell is blank. */
const LUMA_FLOOR = 0.06

/** 0..1 luminance -> a ramp char; blank below a floor, clamped above 1. */
export function lumaToChar(luma: number): string {
    if (!(luma >= LUMA_FLOOR)) return ' '
    const t = Math.min(1, (luma - LUMA_FLOOR) / (1 - LUMA_FLOOR))
    const i = 1 + Math.floor(t * (LUMA_RAMP.length - 1))
    return LUMA_RAMP[Math.min(LUMA_RAMP.length - 1, i)]
}

/** The cell containing the point (x, y), measured from the grid origin. */
export function rectToCell(
    x: number,
    y: number,
    cellW: number,
    cellH: number,
): { col: number; row: number } {
    return { col: Math.floor(x / cellW), row: Math.floor(y / cellH) }
}

/** The palette token closest in RGB distance. Always a token, never a blend. */
export function nearestGlyphColor(
    rgb: [number, number, number],
    palette: Record<GlyphColor, [number, number, number]>,
): GlyphColor {
    let best: GlyphColor = GLYPH_COLORS[0]
    let bestD = Infinity
    for (const name of GLYPH_COLORS) {
        const p = palette[name]
        if (!p) continue
        const d = (p[0] - rgb[0]) ** 2 + (p[1] - rgb[1]) ** 2 + (p[2] - rgb[2]) ** 2
        if (d < bestD) {
            bestD = d
            best = name
        }
    }
    return best
}

/** The cell grid a snapshot paints into: origin in px, cell size in px, size in cells. */
export type CellGrid = {
    originX: number
    originY: number
    cellW: number
    cellH: number
    cols: number
    rows: number
}

export type TextAlign = 'left' | 'center' | 'right'

/** One rendered glyph (a text char or one char of a ::before/::after string): its box in px. */
export type TextGlyph = {
    ch: string
    l: number
    r: number
    t: number
    b: number
    color: GlyphColor
    align: TextAlign
}

/** A gap wider than this many average glyph widths starts a new run (flex gaps, separate buttons). */
const RUN_BREAK = 2.5
/** A gap wider than this many average glyph widths reads as a word space. */
const WORD_GAP = 0.5
/** Rows tried, in order, when a run's cells are already taken by an earlier run. */
const ROW_TRIES = [0, 1, -1, 2, -2]

type Line = { glyphs: TextGlyph[]; cy: number; h: number }

const isSpace = (ch: string) => /\s/.test(ch)

/** Glyphs sharing a rendered line: vertical centres within half the taller box. Input order kept. */
export function groupLines(glyphs: TextGlyph[]): TextGlyph[][] {
    const lines: Line[] = []
    for (const g of glyphs) {
        const cy = (g.t + g.b) / 2
        const h = g.b - g.t
        let hit: Line | undefined
        for (const line of lines) {
            if (Math.abs(cy - line.cy) < 0.5 * Math.max(h, line.h)) {
                hit = line
                break
            }
        }
        if (hit) {
            hit.glyphs.push(g)
            hit.h = Math.max(hit.h, h)
        } else lines.push({ glyphs: [g], cy, h })
    }
    return lines
        .sort((a, b) => a.cy - b.cy)
        .map(l => l.glyphs)
}

export type TextRun = { text: string; l: number; r: number; cy: number; color: GlyphColor[]; align: TextAlign }

/** One rendered line -> runs of words: sorted left to right, split at wide gaps, one space per
 *  word gap, no leading or trailing space. `color` holds one token per char of `text`. */
export function splitRuns(line: TextGlyph[]): TextRun[] {
    const sorted = line.map((g, i) => ({ g, i })).sort((a, b) => a.g.l - b.g.l || a.i - b.i).map(x => x.g)
    const ink = sorted.filter(g => !isSpace(g.ch))
    if (ink.length === 0) return []
    const avgW = ink.reduce((s, g) => s + (g.r - g.l), 0) / ink.length || 1
    const runs: TextRun[] = []
    let cur: TextRun | null = null
    let prevR = -Infinity
    let pendingSpace = false
    let cyMin = Infinity
    let cyMax = -Infinity
    for (const g of sorted) {
        if (isSpace(g.ch)) {
            pendingSpace = true
            prevR = Math.max(prevR, g.r)
            continue
        }
        const gap = g.l - prevR
        if (!cur || gap > RUN_BREAK * avgW) {
            cur = { text: '', l: g.l, r: g.r, cy: 0, color: [], align: g.align }
            runs.push(cur)
        } else if (pendingSpace || gap > WORD_GAP * avgW) {
            cur.text += ' '
            cur.color.push(g.color)
        }
        cur.text += g.ch
        cur.color.push(g.color)
        cur.r = Math.max(cur.r, g.r)
        prevR = g.r
        pendingSpace = false
        cyMin = Math.min(cyMin, (g.t + g.b) / 2)
        cyMax = Math.max(cyMax, (g.t + g.b) / 2)
    }
    const cy = (cyMin + cyMax) / 2
    for (const run of runs) run.cy = cy
    return runs
}

/** The first column of a run of `n` cells: left runs start at their left edge, centred runs centre
 *  on their own centre, right runs end at their right edge. */
export function runStartCol(run: Pick<TextRun, 'l' | 'r' | 'align'>, n: number, g: CellGrid): number {
    if (run.align === 'center') return Math.round(((run.l + run.r) / 2 - g.originX) / g.cellW - n / 2)
    if (run.align === 'right') return Math.round((run.r - g.originX) / g.cellW) - n
    return Math.round((run.l - g.originX) / g.cellW)
}

/** A run's real footprint in cell units: `x` the left edge of its first slot, `y` its vertical
 *  centre, `scale` the slot width as a multiple of one cell, so `n * scale` cells span the measured
 *  line from `l` to `r`. */
export function runFit(
    run: Pick<TextRun, 'l' | 'r' | 'cy'>,
    n: number,
    g: CellGrid,
): { x: number; y: number; scale: number } {
    const scale = n > 0 && run.r > run.l ? (run.r - run.l) / (n * g.cellW) : 1
    return { x: (run.l - g.originX) / g.cellW, y: (run.cy - g.originY) / g.cellH, scale }
}

/** Rendered text -> monospace cells: every rendered line becomes runs of consecutive cells on one
 *  row, so proportional or oversized text reads as the same words, in order. A run whose cells an
 *  earlier run took moves to the nearest free row; one that would overhang the grid is pulled in.
 *  Each cell also carries the run's real footprint (x, y, scale in cell units): the run's glyphs
 *  are sized so its monospace width equals the measured line width, on the line's own centre. */
export function layoutText(glyphs: TextGlyph[], g: CellGrid): MorphCell[] {
    const taken = new Set<number>()
    const out: MorphCell[] = []
    for (const line of groupLines(glyphs)) {
        for (const run of splitRuns(line)) {
            const n = run.text.length
            // a run wider in cells than on screen is pulled back inside the grid, not clipped
            const c0 = Math.max(0, Math.min(g.cols - n, runStartCol(run, n, g)))
            const row0 = Math.floor((run.cy - g.originY) / g.cellH)
            let row = row0
            for (const dr of ROW_TRIES) {
                const rr = row0 + dr
                if (rr < 0 || rr >= g.rows) continue
                let free = true
                for (let k = 0; k < n && free; k++) if (taken.has(rr * g.cols + c0 + k)) free = false
                if (free) {
                    row = rr
                    break
                }
            }
            if (row < 0 || row >= g.rows) continue
            const fit = runFit(run, n, g)
            for (let k = 0; k < n; k++) {
                const col = c0 + k
                const ch = run.text[k]
                if (col < 0 || col >= g.cols || ch === ' ') continue
                taken.add(row * g.cols + col)
                out.push({ col, row, ch, color: run.color[k], x: fit.x + k * fit.scale, y: fit.y, scale: fit.scale })
            }
        }
    }
    return out
}

/** A computed ::before/::after `content` value -> the text it paints. Quoted strings only; the
 *  alt text after a top-level `/` is dropped; `none`, `normal`, counters, attr() and url() give ''. */
export function pseudoContentText(content: string): string {
    let out = ''
    let i = 0
    while (i < content.length) {
        const c = content[i]
        if (c === '"' || c === "'") {
            let j = i + 1
            while (j < content.length && content[j] !== c) {
                if (content[j] === '\\' && j + 1 < content.length) {
                    const hex = content.slice(j + 1).match(/^[0-9a-fA-F]{1,6}\s?/)
                    if (hex) {
                        out += String.fromCodePoint(parseInt(hex[0], 16))
                        j += 1 + hex[0].length
                        continue
                    }
                    out += content[j + 1]
                    j += 2
                    continue
                }
                out += content[j]
                j++
            }
            i = j + 1
            continue
        }
        if (c === '/') break
        if (/\s/.test(c)) {
            i++
            continue
        }
        return '' // a non-string token: none, normal, counter(), attr(), url(), ...
    }
    // icon fonts paint private-use code points, which are not text
    return out.replace(/[\uE000-\uF8FF]/g, '')
}

/** The region a box's content shows in, in px: the client box of a clipping ancestor, or the
 *  intersection of several. An axis nothing clips stays at ±Infinity. */
export type ClipBox = { l: number; r: number; t: number; b: number }

/** No clip: everything shows. */
export const NO_CLIP: ClipBox = { l: -Infinity, r: Infinity, t: -Infinity, b: Infinity }

/** The overlap of two clip regions; an empty overlap keeps r <= l or b <= t, which clips everything. */
export function intersectClip(a: ClipBox, b: ClipBox): ClipBox {
    return {
        l: Math.max(a.l, b.l),
        r: Math.min(a.r, b.r),
        t: Math.max(a.t, b.t),
        b: Math.min(a.b, b.b),
    }
}

/** Whether a glyph box paints inside a clip region: its centre lies within it. A row a scroller has
 *  scrolled out of view (or cut through its middle) is left out of the snapshot, like it is on screen. */
export function insideClip(box: { l: number; r: number; t: number; b: number }, clip: ClipBox): boolean {
    const cx = (box.l + box.r) / 2
    const cy = (box.t + box.b) / 2
    return cx >= clip.l && cx <= clip.r && cy >= clip.t && cy <= clip.b
}
