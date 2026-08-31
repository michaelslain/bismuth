// app/src/graph/asciiGrid.ts
//
// The pure half of the ASCII knowledge graph: everything about the CHARACTER GRID that can be
// computed without a DOM. AsciiGraphRenderer.ts owns the canvas, the camera and the rAF loop; this
// file owns the arithmetic — grid sizing, world→cell mapping, the degree/depth glyph ramp, the
// Bresenham edge trace with "+" junctions, and the cell→node hit test. All of it is unit-tested
// (asciiGrid.test.ts).
//
// Sources: bismuth-design/ascii/design-system/tokens/ascii.css (cell metrics + glyph vocabulary),
// bismuth-design/ascii/design-system/guidelines/ascii-graph.card.html (the field), ascii-zoom.card.html
// (THE LAW: zoom is resolution — the cell never changes size, the grid subdivides), and
// bismuth-design/ascii/PORTING.md §4.

/** Cell metrics at --fs-ui (11.5px Monaspace Xenon) — asciiGraph.css --cell-w / --cell-h. CELL_W is
 *  the font's own advance width at that size; CELL_H is the app's unified row unit (--row-h, owned
 *  by ui/ui.css — same rhythm the sidebar tree/tabs/tables use), NOT derived from the font metric.
 *  Both the main field and the sidebar mini-graph draw on this one cell — there is no denser variant
 *  any more (killed with setDense; see AsciiGraphRenderer). Fallbacks only: the renderer reads the
 *  live --cell-h/--row-h off the host at runtime, these are just the pre-mount / test defaults. */
export const CELL_W = 6.3
export const CELL_H = 18
/** Font size that goes WITH the cell pair above. Change one, change the other, or the drawing shears. */
export const FONT_PX = 11.5

/** The field's inset, matching the reference card (GraphField.tsx uses the same numbers). */
export const PAD_X = 8
export const PAD_Y = 10

/** Node degree ramp — a node's weight is its GLYPH, never its size (tokens/ascii.css). */
export const NODE_GLYPHS = ['.', 'o', '@'] as const

/** Layer priority in the cell buffer. A higher layer overwrites a lower one, which is how the
 *  noise field gets CLEARED beneath every edge and node ("or the field reads as mush"). */
export const LAYER_EMPTY = 0
export const LAYER_NOISE = 1
export const LAYER_EDGE = 2
export const LAYER_NODE = 3

/**
 * Below this box dimension (the SMALLER of width/height — a graph is usually wide, so a narrow
 * pane is the binding constraint), the fixed cell/font size starts shrinking. At or above it, the
 * field draws at the normal, un-shrunk cell size — "zoom is resolution, not scale" still governs
 * everything ABOVE this floor; this only kicks in for a panel too small for that law to read as
 * anything but oversized text (a corner split, an embedded block dragged small).
 */
export const COMPACT_MAX_DIM = 460

/** Below this box dimension the shrink is fully floored at COMPACT_FLOOR_SCALE — going smaller
 *  still doesn't shrink the cell further, so text never becomes illegibly tiny in a sliver pane. */
export const COMPACT_MIN_DIM = 90

/** The smallest the cell/font size ever shrinks to, as a fraction of the normal size. */
export const COMPACT_FLOOR_SCALE = 0.5

/**
 * Cell/font size multiplier for a `w`x`h` CSS-px box: 1 (no shrink) at/above COMPACT_MAX_DIM,
 * linearly down to COMPACT_FLOOR_SCALE at/below COMPACT_MIN_DIM. Pure function of the box, not the
 * camera — unlike zoom (`resolutionPercent`/`fitPxPerWorld` above), this never changes as the user
 * scrolls, only as the pane itself is resized.
 */
export function compactScale(w: number, h: number): number {
    const dim = Math.min(w, h)
    if (!Number.isFinite(dim) || dim >= COMPACT_MAX_DIM) return 1
    if (dim <= COMPACT_MIN_DIM) return COMPACT_FLOOR_SCALE
    const t = (dim - COMPACT_MIN_DIM) / (COMPACT_MAX_DIM - COMPACT_MIN_DIM)
    return COMPACT_FLOOR_SCALE + (1 - COMPACT_FLOOR_SCALE) * t
}

export interface GridMetrics {
    cols: number
    rows: number
    cellW: number
    cellH: number
    padX: number
    padY: number
}

/** Size the character grid for a box of `w`×`h` CSS px. Never returns a zero dimension — a
 *  degenerate (mid-layout) box yields a 1×1 grid rather than an empty buffer. */
export function gridMetrics(
    w: number,
    h: number,
    cellW: number,
    cellH: number,
    padX = PAD_X,
    padY = PAD_Y,
): GridMetrics {
    const cols = Math.max(1, Math.floor((w - padX * 2) / cellW))
    const rows = Math.max(1, Math.floor((h - padY * 2) / cellH))
    return { cols, rows, cellW, cellH, padX, padY }
}

/** Top-left px of a cell, relative to the field's own top-left corner. */
export function cellToPx(
    col: number,
    row: number,
    m: GridMetrics,
): { x: number; y: number } {
    return { x: m.padX + col * m.cellW, y: m.padY + row * m.cellH }
}

/** The cell a px point (relative to the field's top-left) falls in. Can return out-of-range
 *  indices — callers clamp or reject; wrapping would silently teleport a hit across the field. */
export function pxToCell(
    x: number,
    y: number,
    m: GridMetrics,
): { col: number; row: number } {
    return {
        col: Math.floor((x - m.padX) / m.cellW),
        row: Math.floor((y - m.padY) / m.cellH),
    }
}

/** Snap a projected screen px position (relative to the field's top-left) onto the nearest cell
 *  CENTRE. This is the whole of "zoom is resolution": the caller scales world→px by the current
 *  resolution, and the grid it lands on always has the same cell size. */
export function snapToCell(
    x: number,
    y: number,
    m: GridMetrics,
): { col: number; row: number } {
    return {
        col: Math.round((x - m.padX) / m.cellW),
        row: Math.round((y - m.padY) / m.cellH),
    }
}

export function inGrid(col: number, row: number, m: GridMetrics): boolean {
    return col >= 0 && col < m.cols && row >= 0 && row < m.rows
}

/** Degree tier: 0 = "." leaf, 1 = "o" linked, 2 = "@" hub (ascii-graph.card.html). */
export function degreeTier(deg: number): number {
    return deg >= 5 ? 2 : deg >= 2 ? 1 : 0
}

/** Bucket a 0..1 depth rank (0 = farthest from the camera, 1 = nearest) into `bands` bands. */
export function depthBand(dr: number, bands = 3): number {
    if (!Number.isFinite(dr)) return bands - 1
    const b = Math.floor(dr * bands)
    return b < 0 ? 0 : b >= bands ? bands - 1 : b
}

/**
 * The 3D depth cue: shift the DEGREE RAMP by depth band, never the font size. A near hub reads
 * "@", the same hub in the back plane drops to "o" and then "."; a near leaf is promoted to "o".
 * `is3d === false` returns the flat degree tier untouched (2D has no depth to encode).
 */
export function glyphTier(
    deg: number,
    dr: number,
    is3d: boolean,
    bands = 3,
): number {
    const base = degreeTier(deg)
    if (!is3d) return base
    const shifted = base + (depthBand(dr, bands) - Math.floor(bands / 2))
    return shifted < 0 ? 0 : shifted > 2 ? 2 : shifted
}

export function nodeGlyph(
    deg: number,
    dr: number,
    is3d: boolean,
    bands = 3,
): string {
    return NODE_GLYPHS[glyphTier(deg, dr, is3d, bands)]
}

/** Per-band alpha for the 3D depth fade (near = opaque, far = faint). */
export function depthAlpha(dr: number, min = 0.22, curve = 1.8): number {
    if (!Number.isFinite(dr)) return 1
    const t = dr < 0 ? 0 : dr > 1 ? 1 : dr
    return min + (1 - min) * Math.pow(t, curve)
}

const EDGE_CHARS = new Set(['-', '|', '/', '\\', '+'])

/**
 * Merge an incoming edge glyph with whatever an edge already drew in that cell: two edges of
 * DIFFERENT orientation crossing produce a "+" junction; the same glyph twice stays itself.
 * `existing` that isn't an edge glyph (empty, or a noise character) is simply replaced — which is
 * how the edge layer clears the noise beneath it.
 */
export function mergeEdgeChar(existing: string, incoming: string): string {
    if (!existing || !EDGE_CHARS.has(existing)) return incoming
    if (existing === incoming) return existing
    return '+'
}

/** Char CODES for the edge vocabulary, so the renderer's hot loop can merge junctions without
 *  allocating a string per cell (600k+ of them a frame at 2.6k edges). */
export const CODE_PLUS = 43 // "+"

/**
 * mergeEdgeChar at the char-CODE level: `prevWasEdge` says whether the cell currently holds an
 * edge glyph (anything else — empty, or a noise character — is simply overwritten, which is how
 * the edge layer clears the noise). Allocation-free; asciiGrid.test.ts pins it to mergeEdgeChar.
 */
export function mergeEdgeCode(
    prevCode: number,
    incomingCode: number,
    prevWasEdge: boolean,
): number {
    if (!prevWasEdge) return incomingCode
    return prevCode === incomingCode ? prevCode : CODE_PLUS
}

/**
 * Bresenham-trace the segment (x0,y0)→(x1,y1) across the grid, calling `put` for every stepped
 * cell with the run glyph: "-" horizontal, "|" vertical, "/" or "\" diagonal (by the sign
 * relationship of the two axis steps). The endpoints themselves are NOT emitted — the node layer
 * owns those cells. Allocation-free (the caller supplies the sink), so it is safe in the per-frame
 * hot loop. Guarded so a pathological pair can't spin.
 *
 * Same algorithm as ui/ascii/rasterEdges.ts, restated against a callback instead of a string grid
 * so the renderer can write straight into its typed-array buffers.
 */
export function traceEdge(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    put: (x: number, y: number, ch: string) => void,
    guardMax = 4000,
): void {
    let x = x0,
        y = y0
    const dx = Math.abs(x1 - x0),
        dy = Math.abs(y1 - y0)
    const sx = x1 > x0 ? 1 : -1,
        sy = y1 > y0 ? 1 : -1
    let err = dx - dy
    let guard = 0
    while (guard++ < guardMax && !(x === x1 && y === y1)) {
        const e2 = 2 * err
        let mx = false,
            my = false
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
        if (x === x1 && y === y1) break // the far endpoint belongs to the node layer
        put(x, y, mx && my ? (sx === sy ? '\\' : '/') : mx ? '-' : '|')
    }
}

/**
 * Liang-Barsky clip of the segment (x0,y0)-(x1,y1) — grid CELL-index space, not px — against the
 * rectangle [0, cols-1] x [0, rows-1]. Used to draw the ON-SCREEN portion of an edge whose far
 * endpoint is off the field, instead of dropping the whole edge: the old rule ("skip unless BOTH
 * endpoints are on-grid") reads as "edges vanish at deep zoom" — every hub's links to off-screen
 * neighbours simply disappeared, when what a zoomed-in field should show is each visible node's
 * local edges running off-field as partial lines. Returns `null` when the segment never crosses the
 * rectangle at all (both endpoints off-grid on the same side), so a genuinely invisible edge still
 * draws nothing. Endpoints are already-rounded cell coordinates; the clipped result is re-rounded
 * for `traceEdge`'s Bresenham walk (a sub-cell clip point isn't itself a cell).
 */
export function clipSegmentToGrid(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    m: GridMetrics,
): { x0: number; y0: number; x1: number; y1: number } | null {
    const dx = x1 - x0,
        dy = y1 - y0
    const xMax = m.cols - 1,
        yMax = m.rows - 1
    let tMin = 0,
        tMax = 1
    // p/q per Liang-Barsky: p<0 is an ENTERING boundary (raises tMin), p>0 is EXITING (lowers tMax),
    // p===0 means the segment runs parallel to that boundary — reject only if it's outside on that axis.
    const clipEdge = (p: number, q: number): boolean => {
        if (p === 0) return q >= 0
        const r = q / p
        if (p < 0) {
            if (r > tMax) return false
            if (r > tMin) tMin = r
        } else {
            if (r < tMin) return false
            if (r < tMax) tMax = r
        }
        return true
    }
    if (
        !clipEdge(-dx, x0) ||
        !clipEdge(dx, xMax - x0) ||
        !clipEdge(-dy, y0) ||
        !clipEdge(dy, yMax - y0)
    )
        return null
    if (tMin > tMax) return null
    return {
        x0: Math.round(x0 + tMin * dx),
        y0: Math.round(y0 + tMin * dy),
        x1: Math.round(x0 + tMax * dx),
        y1: Math.round(y0 + tMax * dy),
    }
}

/**
 * Split a continuous pan offset into a WHOLE-CELL part (fed into the world→cell projection so the
 * phase between world space and cell space never shifts) and the sub-cell residual (applied as a
 * plain canvas translate at paint time, for smooth motion). This is the pan-jitter fix: with a
 * screen-anchored grid, every sub-cell pan re-phases the world→cell rounding, so the SAME world-space
 * line rasterizes into a DIFFERENT discrete cell path from one drag frame to the next — the lines
 * visibly wiggle while panning. Quantizing pan to whole cells keeps that phase fixed (identical world
 * geometry always produces the identical discrete raster); the residual keeps the on-screen motion
 * continuous instead of stepping in whole-cell jumps.
 */
export function quantizePan(
    pan: number,
    cell: number,
): { whole: number; frac: number } {
    if (!Number.isFinite(pan) || !(cell > 0)) return { whole: 0, frac: 0 }
    const whole = Math.round(pan / cell) * cell
    return { whole, frac: pan - whole }
}

/**
 * Nearest node to a cell, searching outward in square rings up to `radius` cells. `cellNode` is a
 * cols*rows Int32Array of node indices (-1 = no node), rebuilt on every rasterization. Returns -1
 * when nothing is within the radius. Rings mean the closest hit wins, so a dense field doesn't
 * pick a node several cells away when one sits under the cursor.
 */
export function nearestCellNode(
    col: number,
    row: number,
    m: GridMetrics,
    cellNode: Int32Array,
    radius = 2,
): number {
    for (let r = 0; r <= radius; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (r > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== r)
                    continue // ring only
                const c = col + dx,
                    rw = row + dy
                if (!inGrid(c, rw, m)) continue
                const idx = cellNode[rw * m.cols + c]
                if (idx >= 0) return idx
            }
        }
    }
    return -1
}

/**
 * Resolution → the world-units-per-cell ratio, expressed as the px-per-world-unit scale the
 * projection multiplies by. At `res = 1` the whole graph fits the grid (100% zoom — see the HUD
 * convention below); at `res = maxRes` the field is at maximum resolution (0%). The CELL SIZE is
 * not a term in this function — that is the point. `radius` is the graph's own bounding radius, so
 * this scale is graph-size RELATIVE — a bigger graph gets a smaller fit scale to fit the same box.
 */
export function fitPxPerWorld(
    cols: number,
    rows: number,
    m: GridMetrics,
    radius: number,
    fitFraction = 0.42,
): number {
    const boxPx = Math.min(cols * m.cellW, rows * m.cellH)
    return (boxPx * fitFraction) / Math.max(1e-6, radius)
}

/**
 * THE 0% floor: world units per cell at maximum resolution, independent of the graph — the whole
 * point of "0% = deepest zoom" is that it does NOT depend on graph size the way `fitPxPerWorld`
 * does.
 *
 * 0.4, was 0.8, was 3.125. The ORIGINAL 3.125 was derived from "two touching notes must land on
 * separate cells", which is the wrong bar twice over. It only counted CELL WIDTH (a row is 2.86× a
 * column in world terms, so vertically two adjacent notes were only ~1.6 rows apart), and a mark
 * being merely *distinct* is not the same as its NEIGHBOURHOOD being *readable* — a note carries a
 * label. Measured on the reference 2114-note vault at 1400×900 it put ~170 notes (and their labels) on
 * the field at 0%: a wall of text, i.e. no deep end at all.
 *
 * The value is derived from the target the deep end is actually for — "a readable local
 * neighbourhood of a few dozen notes", now tightened to 15-25 notes ("max zoom still needs to be
 * greater"):
 *
 *   1. NOTES ON SCREEN. The visible world box at 0% is `cols·W` wide by `rows·W·(cellH/cellW)` tall.
 *      On the reference field (219 cols × 48 rows, cellH/cellW = 2.857) that is 30,033·W² world units².
 *      The vault's own local spacing — set by layout.ts's collide floor, measured, not assumed — has a
 *      median nearest-neighbour distance of 14.0 world units. Sampling 400 windows centred on real
 *      notes of the settled layout (the CONTAINED grid-island layout — layout.ts CONTAINMENT) gives a
 *      median count of 36 at W = 0.8, 21 at W = 0.5, 15 at W = 0.4 and 9 at W = 0.3.
 *      W = 0.4 is the value whose whole band lands on the 15-25 target (median 15, p90 25) — and it is
 *      exactly half the previous floor, so it is also "twice the resolution" in one word.
 *   2. LABEL ROOM, the reason that band is the right one. At W the two closest notes sit 14.0/W
 *      columns apart horizontally and 14.0/(W·2.857) ROWS apart vertically. At W = 0.4 that is 35
 *      columns and 12.3 rows — comfortably more than a label needs beside a glyph (a capped cluster
 *      name is 26 columns; a file label is placed 2 columns off the glyph and simply drops if it
 *      doesn't fit). At the old 3.125 it was 4.5 columns and 1.6 rows, which is exactly the
 *      overlapping soup that was reported.
 *
 * Changing this changes nothing but the ladder's DEPTH: `maxResFor` reaches further, and the 10%
 * steps (`ZOOM_STEP_PCT`) simply each cover more range — on the reference vault maxRes goes
 * 8.6 (at 3.125) → 34 (at 0.8) → 68 (at 0.4), i.e. ~1.52× per notch. It does NOT change what the
 * field looks like at any other stop, only how far past them the wheel can go.
 * Two things are pinned to it and must move with it: the `MIN_ZOOM_SPAN` floor below (only if the
 * FLOORED case needs it — see there, it did not) and `RING_SCALE` in AsciiGraphRenderer.test.ts
 * (maxRes for a fixture is proportional to RING_SCALE / this, so halving one halves the other).
 */
export const DEEPEST_WORLD_PER_CELL = 0.4

/**
 * The ladder's MINIMUM span, as a multiple of the fit resolution.
 *
 * `maxResFor` below reaches a FIXED ABSOLUTE target (`DEEPEST_WORLD_PER_CELL`) from a fit scale
 * that is not fixed at all: `fitPxPerWorld` is a fraction of the FIELD, so the same graph gets
 * denser-at-fit as the window grows. Any graph therefore eventually crosses the absolute target
 * just by being looked at on a big enough display — the real 2251-note vault does it at roughly a
 * 2200px-wide field, i.e. a maximized window on a large monitor.
 *
 * Past that crossover the old `Math.max(1, …)` floor pinned `maxRes` to exactly 1, and BOTH
 * directions of the percent mapping degenerate there (`resFromPercent` returns 1 for every step,
 * `resolutionPercent` returns 100 for every res): the whole 11-stop ladder collapsed onto a single
 * stop. The wheel moved the percent state, nothing else moved — no re-rasterization, and a HUD
 * frozen at "100%" however far you scrolled. "Nothing left to resolve" is a fair reading of the
 * design law, but a dead control is not an acceptable expression of it.
 *
 * So the ceiling is floored at a span instead of at unity: 0% is always at least this multiple of the
 * fit resolution. Where the absolute target asks for MORE than that it still wins, so the "0% is a
 * fixed absolute detail level" law holds wherever it is meaningful.
 *
 * 8, was 4. This floor is what a graph gets when it is ALREADY denser than the absolute target — i.e.
 * a small graph, or any graph on a big enough display — and 4 was too shallow to explore one: it gave
 * only ~15% per `ZOOM_STEP_PCT` notch and a 2× total magnification from the middle of the ladder.
 * Raised in step with `DEEPEST_WORLD_PER_CELL` (3.125 → 0.8, a 3.9× deeper absolute end) so the
 * floored case gets a comparable amount of depth rather than staying at the old shallow span. The
 * steps stay at 10% — 11 stops either way, each just covering more range (~28% per notch at 8).
 *
 * DELIBERATELY left at 8 when `DEEPEST_WORLD_PER_CELL` went 0.8 → 0.4, unlike the 3.125 → 0.8 move
 * above. The two cases are not the same: the absolute target got deeper because a 2000-note vault
 * needed a deeper end, and a graph sitting on this floor is by definition one that is ALREADY finer
 * than that target — a small graph, which needs no extra depth to be read (there is nothing left to
 * resolve). Raising it would also be unfixable for the fixtures: a floored ladder is graph-INDEPENDENT,
 * so no amount of rescaling a test fixture can restore the ladder depth its stop-by-stop assertions
 * were written against (see RING_SCALE in AsciiGraphRenderer.test.ts, which is at this floor in 2D).
 */
export const MIN_ZOOM_SPAN = 8

/**
 * The res-multiplier ceiling that reaches `deepestWorldPerCell` FROM the current fit scale.
 * Because `fitPxPerWorld` shrinks as the graph grows (see above) but the deepest-zoom target is a
 * fixed absolute scale, a bigger graph needs a BIGGER ceiling to reach the same absolute detail —
 * that's the whole "0% is fixed, 100% is graph-relative" law made concrete. Floored at
 * `MIN_ZOOM_SPAN` (see above) so a graph already at/past the absolute target keeps a usable ladder
 * rather than collapsing every stop onto fit.
 */
export function maxResFor(
    pxPerWorld: number,
    cellW: number,
    deepestWorldPerCell = DEEPEST_WORLD_PER_CELL,
): number {
    const sDeepest = cellW / Math.max(1e-6, deepestWorldPerCell)
    return Math.max(MIN_ZOOM_SPAN, sDeepest / Math.max(1e-6, pxPerWorld))
}

/** Resolution multiplier → the continuous 0..1 log-scale progress toward `maxRes` that the label
 *  crossfade math (`labelSelection.ts` `fileLabelBudget`/`fileLabelAlpha`/`clusterLevelAlphas`) keys
 *  off. 0 = res is at the fit scale (`res = 1`), 1 = res is at the deepest-zoom ceiling
 *  (`res = maxRes`). NOTE this is the internal camera/label progress, unrelated in direction to the
 *  0–100% HUD readout below (`resolutionPercent`), which is inverted (100% = fit) — everything that
 *  isn't display-facing (the label math, `AsciiGraphRenderer`'s internal `res`/`goalRes`) keeps this
 *  0=fit/1=deepest convention throughout. Unrounded, unlike the percent readout, so the crossfade
 *  stays smooth frame to frame instead of stepping in jumps. */
export function resolutionT(res: number, maxRes: number): number {
    if (maxRes <= 1) return 0
    const t = Math.log(Math.max(1, res)) / Math.log(maxRes)
    return Math.max(0, Math.min(1, t))
}

/** Inverse of `resolutionT`: the resolution multiplier sitting at internal progress `t` (0=fit,
 *  1=deepest) against a given `maxRes` ceiling. */
export function resFromT(t: number, maxRes: number): number {
    if (maxRes <= 1) return 1
    return Math.pow(maxRes, Math.max(0, Math.min(1, t)))
}

/**
 * Map a resolution multiplier onto the HUD's 0–100% readout — INVERTED from the internal `t` above:
 * 100% = fit (the whole graph exactly fills the field), 0% = the deepest-zoom ceiling (every note
 * individually distinguishable). This is the user-facing convention (see AsciiGraphRenderer's zoom
 * law comment); `resolutionT`/`resFromT` above stay in the original 0=fit/1=deepest direction
 * because that's what the label crossfade math (and `res`/`goalRes` internally) is built on.
 */
export function resolutionPercent(res: number, maxRes: number): number {
    return 100 - Math.round(resolutionT(res, maxRes) * 100)
}

/** Zoom moves in 10% increments (wheel notches / +- keys), never continuously — 11 stops from 0%
 *  (deepest) to 100% (fit). The renderer glides `res` toward whichever step's resolution smoothly
 *  (its existing per-frame easing), so motion still reads as continuous; only the STOPS are quantized. */
export const ZOOM_STEP_PCT = 10

/** Snap a raw HUD percent to the nearest `ZOOM_STEP_PCT` stop, clamped to 0..100. */
export function snapZoomPercent(pct: number): number {
    const clamped = Math.max(0, Math.min(100, pct))
    return Math.round(clamped / ZOOM_STEP_PCT) * ZOOM_STEP_PCT
}

/** Inverse of `resolutionPercent`: the resolution multiplier for a HUD percent (100=fit, 0=deepest)
 *  against a given `maxRes` ceiling. */
export function resFromPercent(pct: number, maxRes: number): number {
    const t = 1 - Math.max(0, Math.min(100, pct)) / 100
    return resFromT(t, maxRes)
}
