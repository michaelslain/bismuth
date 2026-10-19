// Paints one frame of the morph. Each pair has its own clock, staggered by `delay` so lifts and
// landings sweep across the slide: a char holds its own glyph at rest, lifts, flies toward its target
// as a scrambling glyph that keeps its source colour, and lands as the target glyph at full strength.
// Chars at rest and landed chars draw over the flock, so the outgoing words read until they lift and
// the incoming words read as soon as they land. Orphaned `from` chars scramble and fade where they
// stand; unpaired `to` chars condense out of noise just beside their own cell, late.
//
// A text char (a MorphCell with x/y/scale) is drawn on its real footprint: in flight it moves and
// resizes from its source footprint to its target's, and at rest it sits exactly on it. Given a
// `fitted` list, those chars go there (the overlay paints them one by one at their own size); without
// one they fall back to their base cells in the grid frame.
import { cellHash, clearFrame, putChar, type GlyphColor, type GlyphFrame } from '../../ui/ascii/glyphScene'
import type { MorphCell } from './morphGrid'
import type { MorphPair, MorphPlan } from './morphPlan'

export const MORPH_MS = 1000

/** A text char on its real footprint at this instant: `x`/`y`/`scale` as on MorphCell, `col`/`row`
 *  its base cell now (a retarget pairs on it), `alpha` 0..255. */
export type MorphGlyph = Required<MorphCell> & { alpha: number }

/** Lifts are spread evenly over [LIFT_AT, LIFT_AT + LIFT_SPAN], in stagger order. */
const LIFT_AT = 0.08
const LIFT_SPAN = 0.38
/** How long a flight takes; the last landing is LIFT_AT + LIFT_SPAN + FLIGHT (0.78), which leaves
 *  the end of the morph for the settled overlay to hand over to the real slide. */
const FLIGHT = 0.32
/** Share of a flight at its start that still shows the source glyph and colour. */
const GLYPH_HOLD = 0.12
/** Share of a flight at its end that already shows the target glyph and colour: the char locks in
 *  while it glides home, so nothing snaps on arrival. */
const LAND_HOLD = 0.4
/** A spawned char appears this long before its landing, this close to its cell. */
const SPAWN_LEAD = 0.2
const SPAWN_DRIFT_COLS = 2
const SPAWN_DRIFT_ROWS = 1
/** An orphaned char scrambles and fades over this long after it lifts. */
const FADE = 0.3
/** Flock alpha (0..1): never below FLY_ALPHA_MID, so the mid-morph cloud reads; brighter near either
 *  end. Rest and landed are full. */
const FLY_ALPHA_MID = 0.65
const FLY_ALPHA_END = 0.9
/** A spawned char condenses from this alpha up to full. */
const SPAWN_ALPHA = 0.6
/** Share of flying chars that glint in the accent token while mid-flight. */
const GLINT = 0.16
/** Scramble glyph changes this many times per morph. */
const SCRAMBLE_STEPS = 22
const NOISE = '|-+/\\`_#.o@%*=:'

function smooth(x: number): number {
    return x * x * (3 - 2 * x)
}

/** Fast out, slow in: a flight decelerates into its cell. */
function settle(x: number): number {
    const k = 1 - x
    return 1 - k * k * k
}

function noiseChar(a: number, b: number, step: number, seed: number): string {
    return NOISE[Math.floor(cellHash(a + step * 131, b, seed) * NOISE.length)]
}

/** Each pair's lift time, by the rank of its delay: lifts spread evenly over the lift window
 *  whatever the layout (min/max scaling let edge chrome squeeze the content into a narrow band). */
const liftTimes = new WeakMap<MorphPlan, Float32Array>()
function liftsOf(plan: MorphPlan): Float32Array {
    let t = liftTimes.get(plan)
    if (!t) {
        const n = plan.pairs.length
        const order = plan.pairs.map((_, i) => i).sort((a, b) => plan.pairs[a].delay - plan.pairs[b].delay || a - b)
        t = new Float32Array(n)
        order.forEach((pi, rank) => (t![pi] = LIFT_AT + LIFT_SPAN * (n > 1 ? rank / (n - 1) : 0)))
        liftTimes.set(plan, t)
    }
    return t
}

function flyAlpha(u: number): number {
    // the lift dips from FLY_ALPHA_END to the mid; the landing climbs from the mid all the way to full,
    // so a landed char does not step up in brightness when it comes to rest
    if (u < 0.5) return Math.round(255 * (FLY_ALPHA_MID + (FLY_ALPHA_END - FLY_ALPHA_MID) * (1 - 2 * u)))
    return Math.round(255 * (FLY_ALPHA_MID + (1 - FLY_ALPHA_MID) * smooth(2 * u - 1)))
}

const isFitted = (c: MorphCell) => c.scale !== undefined
/** A cell's footprint in cell units; a base cell is its own slot, centred on its row. */
const fx = (c: MorphCell) => (c.scale !== undefined ? c.x! : c.col)
const fy = (c: MorphCell) => (c.scale !== undefined ? c.y! : c.row + 0.5)
const fs = (c: MorphCell) => c.scale ?? 1

type Sink = { out: GlyphFrame; fitted?: MorphGlyph[] }

function emit(
    s: Sink,
    fit: boolean,
    col: number,
    row: number,
    ch: string,
    color: GlyphColor,
    alpha: number,
    x: number,
    y: number,
    scale: number,
): void {
    if (fit && s.fitted) s.fitted.push({ col, row, ch, color, alpha, x, y, scale })
    else putChar(s.out, col, row, ch, color, alpha)
}

/** A cell standing still, on its own footprint at full strength. */
function rest(s: Sink, c: MorphCell, color: GlyphColor = c.color): void {
    emit(s, isFitted(c), c.col, c.row, c.ch, color, 255, fx(c), fy(c), fs(c))
}

/** Pure: writes the overlay frame at progress p in [0,1] into `out` (a GlyphFrame sized cols x rows;
 *  clears it first). p=0 equals `from` exactly; p=1 equals `to` exactly. Given `fitted`, it is
 *  cleared and receives every text char (x/y/scale) instead of the grid, on its footprint and size;
 *  at p=0 / p=1 those are the `from` / `to` text cells exactly. */
export function writeMorphFrame(
    plan: MorphPlan,
    p: number,
    seed: number,
    out: GlyphFrame,
    fitted?: MorphGlyph[],
): void {
    clearFrame(out)
    if (fitted) fitted.length = 0
    const sink: Sink = { out, fitted }
    const pp = Math.min(1, Math.max(0, p))
    const step = Math.floor(pp * SCRAMBLE_STEPS)
    const lifts = liftsOf(plan)

    // pass 0: the flock (in flight, spawning, fading); pass 1: chars at rest and landed, on top
    for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < plan.pairs.length; i++) drawPair(plan.pairs[i], pp, lifts[i], pass, step, seed, sink)
    }
}

const sameSpot = (a: MorphCell, b: MorphCell) =>
    a.col === b.col && a.row === b.row && a.ch === b.ch && a.x === b.x && a.y === b.y && a.scale === b.scale

function drawPair(
    pair: MorphPair,
    p: number,
    lift: number,
    pass: number,
    step: number,
    seed: number,
    s: Sink,
): void {
    const { from, to } = pair
    const land = lift + FLIGHT
    if (from && to) {
        if (p < lift || p >= land) {
            if (pass === 1) rest(s, p < lift ? from : to)
            return
        }
        if (sameSpot(from, to)) {
            // identical on both slides: stays still and legible
            if (pass === 1) rest(s, to, from.color)
            return
        }
        if (pass !== 0) return
        const u = (p - lift) / FLIGHT
        const e = settle(u)
        const col = Math.round(from.col + (to.col - from.col) * e)
        const row = Math.round(from.row + (to.row - from.row) * e)
        let ch: string
        if (from.ch === to.ch) ch = to.ch
        else if (u < GLYPH_HOLD) ch = from.ch
        else if (u > 1 - LAND_HOLD) ch = to.ch
        else ch = noiseChar(from.col, from.row, step, seed)
        // the source colour holds through the flight and turns only as the char lands, so a graph's
        // token colours stay in the cloud instead of washing to the text's neutral
        let color: GlyphColor = u > 1 - LAND_HOLD ? to.color : from.color
        if (u > 0.2 && u < 1 - LAND_HOLD && cellHash(from.col, from.row, seed + 3) < GLINT) color = 'accent'
        emit(
            s,
            isFitted(from) || isFitted(to),
            col,
            row,
            ch,
            color,
            flyAlpha(u),
            fx(from) + (fx(to) - fx(from)) * e,
            fy(from) + (fy(to) - fy(from)) * e,
            fs(from) + (fs(to) - fs(from)) * e,
        )
    } else if (to) {
        if (p >= land) {
            if (pass === 1) rest(s, to)
            return
        }
        const appear = land - SPAWN_LEAD
        if (p < appear || pass !== 0) return
        const u = (p - appear) / SPAWN_LEAD
        const k = 1 - settle(u)
        const dx = Math.round((cellHash(to.col, to.row, seed + 7) - 0.5) * 2 * SPAWN_DRIFT_COLS * k)
        const dy = Math.round((cellHash(to.col, to.row, seed + 9) - 0.5) * 2 * SPAWN_DRIFT_ROWS * k)
        const ch = u > 1 - LAND_HOLD ? to.ch : noiseChar(to.col, to.row, step, seed)
        const alpha = Math.round(255 * (SPAWN_ALPHA + (1 - SPAWN_ALPHA) * u))
        emit(s, isFitted(to), to.col + dx, to.row + dy, ch, to.color, alpha, fx(to) + dx, fy(to) + dy, fs(to))
    } else if (from) {
        if (p < lift) {
            if (pass === 1) rest(s, from)
            return
        }
        const u = (p - lift) / FADE
        if (u >= 1 || pass !== 0) return
        const ch = u < GLYPH_HOLD ? from.ch : noiseChar(from.col, from.row, step, seed)
        const alpha = Math.round(255 * FLY_ALPHA_END * (1 - u * u * u))
        emit(s, isFitted(from), from.col, from.row, ch, from.color, alpha, fx(from), fy(from), fs(from))
    }
}
