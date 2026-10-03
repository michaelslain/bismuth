// app/src/intro/glyphScenes/wordmark.ts
// The welcome hero: lowercase `bismuth` in block letters over a sparse noise field.
// Pure (time -> characters); GlyphCanvas paints it. `drawWordmark` and `drawNoiseField` are
// shared with the begin scene.
import {
    AMBIENT_FPS,
    cellHash,
    clearFrame,
    putChar,
    type GlyphColor,
    type GlyphFrame,
    type GlyphScene,
} from '../../ui/ascii/glyphScene'
import { WORDMARK, WORDMARK_ROWS } from './wordmarkBitmap'

export const SHEEN_PERIOD_MS = 8000

const COLS = 96
const ROWS = 16
const WORDMARK_TOP = 3
const SHEEN_WIDTH = 3
const SHEEN_COLORS: readonly GlyphColor[] = [
    'graph0',
    'graph1',
    'graph2',
    'graph3',
    'graph4',
]
/**
 * Plain-ASCII noise vocabulary: light marks only. It deliberately shares no glyph with the
 * letters (all '#', and '@' in the sheen) so noise never blurs into a stroke.
 */
const NOISE = ['.', '`', "'", ',', ':']
const NOISE_DENSITY = 0.08
/** Noise-free margin around the wordmark: columns left/right, rows above/below. */
const QUIET_COLS = 2
const QUIET_ROWS = 1
const WORDMARK_WIDTH = WORDMARK[0].length

const filled = (x: number, y: number) =>
    y >= 0 &&
    y < WORDMARK_ROWS &&
    x >= 0 &&
    x < WORDMARK_WIDTH &&
    WORDMARK[y][x] === '#'

const inQuietZone = (x: number, y: number) =>
    x >= -QUIET_COLS &&
    x < WORDMARK_WIDTH + QUIET_COLS &&
    y >= -QUIET_ROWS &&
    y < WORDMARK_ROWS + QUIET_ROWS

/** Sheen band's left edge (bitmap column) `ambientMs` after the reveal ended. */
function sheenLeft(ambientMs: number): number {
    const phase = (ambientMs % SHEEN_PERIOD_MS) / SHEEN_PERIOD_MS
    return Math.floor(phase * (WORDMARK_WIDTH + 24)) - 12
}

/**
 * Draw the wordmark with its top-left at (col, row). `t` is AMBIENT time in ms (time since the
 * reveal finished; it only drives the sheen, which runs once revealT reaches 1). `revealT` is
 * 0..1: a letter cell shows its final glyph iff cellHash < revealT, else a noise glyph.
 */
export function drawWordmark(
    out: GlyphFrame,
    col: number,
    row: number,
    t: number,
    revealT: number,
): void {
    const left = revealT >= 1 ? sheenLeft(t) : Number.NEGATIVE_INFINITY
    for (let y = 0; y < WORDMARK_ROWS; y++) {
        for (let x = 0; x < WORDMARK_WIDTH; x++) {
            if (!filled(x, y)) continue
            const c = col + x
            const r = row + y
            if (cellHash(c, r, 3) >= revealT) {
                const n = NOISE[Math.floor(cellHash(c, r, 11) * NOISE.length)]
                putChar(out, c, r, n, 'faint', 160)
                continue
            }
            if (x >= left && x < left + SHEEN_WIDTH) {
                putChar(out, c, r, '@', SHEEN_COLORS[x % 5])
                continue
            }
            putChar(out, c, r, '#', 'fg')
        }
    }
}

/**
 * The sparse noise field over every cell outside the wordmark's quiet zone (its bounding box
 * grown by QUIET_COLS each side and QUIET_ROWS above/below) and not on `skipRow`, if given.
 * Re-seeds every 8 ambient frames, so it twinkles at about 1.5Hz while the cadence stays 12fps.
 */
export function drawNoiseField(
    out: GlyphFrame,
    t: number,
    wordmarkCol: number,
    wordmarkRow: number,
    skipRow = -1,
): void {
    const k = Math.floor(t / (1000 / AMBIENT_FPS))
    const seed = 7 + (k >> 3)
    for (let r = 0; r < out.rows; r++) {
        if (r === skipRow) continue
        for (let c = 0; c < out.cols; c++) {
            if (inQuietZone(c - wordmarkCol, r - wordmarkRow)) continue
            if (cellHash(c, r, seed) >= NOISE_DENSITY) continue
            putChar(
                out,
                c,
                r,
                NOISE[Math.floor(cellHash(c, r, 11) * NOISE.length)],
                'faint',
                90,
            )
        }
    }
}

const REVEAL_MS = 900
const COL = Math.floor((COLS - WORDMARK_WIDTH) / 2)

export const wordmarkScene: GlyphScene = {
    cols: COLS,
    rows: ROWS,
    revealMs: REVEAL_MS,
    frame(t, out) {
        clearFrame(out)
        drawNoiseField(out, t, COL, WORDMARK_TOP)
        drawWordmark(
            out,
            COL,
            WORDMARK_TOP,
            Math.max(0, t - REVEAL_MS),
            Math.min(1, t / REVEAL_MS),
        )
    },
}
