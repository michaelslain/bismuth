// app/src/ui/ascii/asciiGlyphTiles.ts — the UI font's own `+ - = |` glyphs, rasterised ONCE into
// mask sprites that AsciiCellEdges paints a cell's edges with.
//
// Why: a typed grid of thousands of cells cannot afford a line of text per edge (a 2000x8 table
// took ~17s to lay out as glyph runs). So each glyph is drawn once, with canvas `fillText` in the
// COMPUTED `--ui-font-stack` at `--fs-ui`, into one-`ch`-wide tiles at devicePixelRatio, and a cell
// becomes ONE element whose edges are a nine-slice mask over its ink colour.
//
// A sprite is 3x3 tiles — the nine-slice of one cell's edges:
//
//     + - +        corners `+` (only where both of its edges are drawn),
//     |   |        top/bottom `-` or `=`, left/right `|`,
//     + - +        and an empty tile wherever the cell does not own that part.
//
// One sprite per edge set (top none/rule/heavy x right x bottom none/rule/heavy x left = 36 keys,
// 35 with ink), installed on :root as `--ascii-edges-<key>: url(data:…)` plus the corner tile's CSS
// size (`--ascii-tile-w`, `--ascii-tile-h`), the vertical run's pitch (`--ascii-pitch-y`), the
// shortest typed row (`--ascii-row-h` = tile-h + pitch-y: corner halves + one `|`) and the corner
// tile's bitmap size (`--ascii-slice-x`, `--ascii-slice-y`).
//
// The rows are NOT equal: corners and top/bottom runs are `+`-ink + one gap tall, the side slice is
// `|`-ink + one gap tall, where the gap is the one a `-` run leaves between two `-` — so a vertical
// line reads as the same dashed stroke as a horizontal one (tileGeometry).
// Colour is NOT in the sprite: it is a mask, and the ink comes from the element's
// background-color, so a theme switch needs no regeneration. Only the font stack, font size, cell
// height or dpr changing does (the cache key).
//
// Every glyph in a sprite is drawn at the SAME offset inside its tile, chosen so the `+`'s ink
// centre lands exactly on the tile centre: the tile centre is the cell corner, so the `+` sits
// centred on its corner, the `|` stems share its x (same advance, same origin) and the `-`/`=`
// strokes share its baseline. A `|` is centred, ink on the tile centre, in its own side slice.

/** 0 = edge not drawn, 1 = rule (`-`), 2 = heavy (`=`); vertical edges are 0 or 1 (`|`). */
export type HorizontalEdge = 0 | 1 | 2
export type VerticalEdge = 0 | 1

type Edge = 'top' | 'right' | 'bottom' | 'left'
type Weight = 'rule' | 'heavy'

/** The sprite key for an edge set: four digits, top right bottom left (clockwise, like CSS).
 *  Pure — AsciiCellEdges derives its data-edges / data-heavy attributes from this (edgeAttrs). */
export function edgesKey(
    edges: readonly Edge[] | undefined,
    weight: Weight | undefined,
    edgeWeight: Partial<Record<'top' | 'bottom', Weight>> | undefined,
): string {
    const on = edges ?? ['top', 'left']
    const h = (edge: 'top' | 'bottom'): HorizontalEdge =>
        !on.includes(edge) ? 0 : (edgeWeight?.[edge] ?? weight ?? 'rule') === 'heavy' ? 2 : 1
    const v = (edge: 'left' | 'right'): VerticalEdge => (on.includes(edge) ? 1 : 0)
    return `${h('top')}${v('right')}${h('bottom')}${v('left')}`
}

/** The overlay's runtime `data-*` hooks for an edge set (the contract other code reads):
 *  `edges` = the drawn edges, space-separated, in the fixed order `top right bottom left`;
 *  `heavy` = the horizontal edges drawn as `=`, same format, `undefined` (attribute absent) when
 *  none. Corners are implied: one exists where both of its edges are drawn. */
export function edgeAttrs(key: string): { edges: string; heavy: string | undefined } {
    const [t, r, b, l] = key.split('').map(Number) as [number, number, number, number]
    const edges = [t && 'top', r && 'right', b && 'bottom', l && 'left'].filter(Boolean).join(' ')
    const heavy = [t === 2 && 'top', b === 2 && 'bottom'].filter(Boolean).join(' ')
    return { edges, heavy: heavy || undefined }
}

/** The CSS selector (on the overlay's own class) that matches exactly `key`'s attributes. */
export function edgeSelector(key: string): string {
    const a = edgeAttrs(key)
    return `[data-edges='${a.edges}']` + (a.heavy ? `[data-heavy='${a.heavy}']` : ':not([data-heavy])')
}

/** Every key that paints something (the all-zero key paints nothing and gets no sprite). */
export const EDGE_KEYS: readonly string[] = (() => {
    const keys: string[] = []
    for (const t of [0, 1, 2])
        for (const r of [0, 1])
            for (const b of [0, 1, 2])
                for (const l of [0, 1]) keys.push(`${t}${r}${b}${l}`)
    return keys.filter(k => k !== '0000')
})()

/** The glyph each of the nine tiles holds for `key` ('' = empty), row-major, top row first. */
export function spriteGlyphs(key: string): string[] {
    const [t, r, b, l] = key.split('').map(Number) as [number, number, number, number]
    const run = (w: number) => (w === 2 ? '=' : w === 1 ? '-' : '')
    const corner = (hz: number, vt: number) => (hz && vt ? '+' : '')
    return [
        corner(t, l), run(t), corner(t, r),
        l ? '|' : '', '', r ? '|' : '',
        corner(b, l), run(b), corner(b, r),
    ]
}

/** The cache key: regenerate only when one of these changes. Colour is deliberately absent. */
export function tileCacheKey(fontFamily: string, fontSizePx: number, cellHPx: number, dpr: number): string {
    return `${fontFamily}|${fontSizePx}|${cellHPx}|${dpr}`
}

/** The key an install is recorded under: the cache key, plus `|fallback` when the tiles were drawn
 *  before the face passed `document.fonts.check`. A face that loads later therefore re-keys and is
 *  redrawn; one that never loads keeps `|fallback` and is drawn once. */
export function installKey(cacheKey: string, ready: boolean): string {
    return ready ? cacheKey : `${cacheKey}|fallback`
}

/** The ink extents the geometry is derived from, in CSS px, measured from the face itself:
 *  `dashW` = the `-` ink width, `pipeH` = the `|` ink height, `plusH` = the `+` ink height. */
export type GlyphInk = { dashW: number; pipeH: number; plusH: number }

/** The nine-slice's geometry in device pixels, and the CSS sizes it is painted at (bitmap / dpr, so
 *  every glyph paints 1:1 and is never resampled).
 *
 *  ONE rhythm on both axes: `gap` is the ink-to-ink gap between two `-` in a horizontal run (a
 *  `ch` advance minus the `-` ink), and a vertical run stacks `|` at `py` = `|` ink + that same gap,
 *  so a vertical line reads as the same dashed stroke as a horizontal one. The corner (and
 *  top/bottom run) tiles are `bw` x `cy`, with `cy` = `+` ink + that gap: the `+` is centred in it,
 *  so the first `|` below a `+` sits one gap from the `+` ink too (half a gap each side of the slice
 *  boundary). `cy` is rounded to an EVEN number of device pixels: the overlay overhangs the host by
 *  half of it, and a half-device-pixel overhang would resample every glyph. */
export function tileGeometry(chPx: number, ink: GlyphInk, dpr: number) {
    const bw = Math.max(1, Math.round(chPx * dpr))
    const gap = Math.max(0, bw - ink.dashW * dpr)
    const py = Math.max(1, Math.round(ink.pipeH * dpr + gap))
    const cy = Math.max(2, 2 * Math.round((ink.plusH * dpr + gap) / 2))
    return { bw, cy, py, gap, cssW: bw / dpr, cssH: cy / dpr, cssPitchY: py / dpr }
}

/** What `mask-repeat: round` does to a run: a whole number of tiles fills `room`, each stretched
 *  (or squeezed) to `pitch`. The stretch is under 1/(2n) of a tile, so no glyph is ever cut. */
export function fitTiles(room: number, tile: number) {
    const n = Math.max(1, Math.round(room / tile))
    return { n, pitch: room / n, stretch: room / n / tile - 1 }
}

/** Where to draw a glyph inside a tile (alphabetic baseline) so the `+` ink centre is the tile
 *  centre. `ink` is the `+`'s TextMetrics bounding box. */
export function glyphOrigin(
    bw: number,
    bh: number,
    ink: { left: number; right: number; ascent: number; descent: number },
) {
    // ink spans x in [-left, right] and y in [-ascent, descent] around the origin/baseline
    return { x: bw / 2 - (ink.right - ink.left) / 2, y: bh / 2 - (ink.descent - ink.ascent) / 2 }
}

export const spriteVar = (key: string) => `--ascii-edges-${key}`

// ---------------------------------------------------------------------------------------------
// the DOM half: measure, rasterise, install
// ---------------------------------------------------------------------------------------------

let installedKey = ''
let markInstalled: () => void = () => {}
const installed: Promise<void> | undefined =
    typeof Promise === 'undefined' ? undefined : new Promise(res => (markInstalled = res))

/** Resolves once the sprites have been installed at least once — the deterministic seam a story
 *  or probe waits on instead of a timeout. */
export const whenAsciiGlyphTilesInstalled = (): Promise<void> => installed ?? Promise.resolve()

let scheduled = false
let listening = false

function readMetrics() {
    const root = document.documentElement
    const probe = document.createElement('div')
    probe.style.cssText =
        'position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;' +
        'height:var(--cell-h);font-family:var(--ui-font-stack);font-size:var(--fs-ui)'
    root.append(probe)
    const cs = getComputedStyle(probe)
    const out = {
        family: cs.fontFamily,
        size: parseFloat(cs.fontSize),
        cellH: parseFloat(cs.height),
    }
    probe.remove()
    return out
}

function install(retried = false): void {
    const m = readMetrics()
    if (!m.family || !(m.size > 0) || !(m.cellH > 0)) return
    const dpr = window.devicePixelRatio || 1
    const font = `400 ${m.size}px ${m.family}`
    // never rasterise from a fallback face: wait for the real one and come back ONCE. If the load
    // rejects (a face that 404s) or the check is still false after it, draw with whatever face
    // resolved rather than leave the mask transparent and the whole grid invisible.
    const ready = document.fonts.check(font, '+-=|')
    if (!retried && !ready) {
        document.fonts.load(font, '+-=|').then(() => install(true), () => install(true))
        return
    }
    // the key records whether the face was loaded: fallback tiles are redrawn once the real face
    // arrives (its key differs), yet a permanently missing face is not redrawn on every call
    const key = installKey(tileCacheKey(m.family, m.size, m.cellH, dpr), ready)
    if (key === installedKey) return

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.font = `400 ${m.size * dpr}px ${m.family}`
    const ch = ctx.measureText('-').width / dpr
    // the ink extents of the three glyphs the rhythm is built from, read the way the eye (and the
    // story probe) reads them: the pixels a glyph paints at half alpha or more, drawn at an
    // INTEGER baseline. TextMetrics' bounding box is fractional and lands a device pixel off the
    // painted ink, which is how a `|` once touched the `+` at one end of a run and not the other.
    const scratch = document.createElement('canvas')
    const sctx = scratch.getContext('2d', { willReadFrequently: true })
    if (!sctx) return
    const bw = Math.max(1, Math.round(ch * dpr))
    const baseline = Math.ceil(m.size * dpr * 2)
    scratch.width = bw * 2
    scratch.height = baseline * 2
    sctx.font = `400 ${m.size * dpr}px ${m.family}`
    sctx.textBaseline = 'alphabetic'
    sctx.textAlign = 'left'
    ;(sctx as CanvasRenderingContext2D & { fontKerning?: string }).fontKerning = 'none'
    sctx.fillStyle = '#000'
    /** `top`: the ink's first row relative to the baseline (negative = above it), `h`/`w`: its size. */
    const inkOf = (g: string) => {
        sctx.clearRect(0, 0, scratch.width, scratch.height)
        const t = sctx.measureText(g)
        sctx.fillText(g, bw / 2 - (t.actualBoundingBoxRight - t.actualBoundingBoxLeft) / 2, baseline)
        const { data, width, height } = sctx.getImageData(0, 0, scratch.width, scratch.height)
        let x0 = width, x1 = -1, y0 = height, y1 = -1
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++)
                if (data[(y * width + x) * 4 + 3]! >= 128) {
                    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
                    y0 = Math.min(y0, y); y1 = Math.max(y1, y)
                }
        return { top: y0 - baseline, h: y1 - y0 + 1, w: x1 - x0 + 1, box: t }
    }
    const plus = inkOf('+')
    const pipe = inkOf('|')
    const dash = inkOf('-')
    const { cy, py, cssW, cssH, cssPitchY } = tileGeometry(
        ch,
        { dashW: dash.w / dpr, pipeH: pipe.h / dpr, plusH: plus.h / dpr },
        dpr,
    )
    // rows of the sprite: corner/run tiles (cy), the side slice (py), corner/run tiles (cy)
    const rowY = [0, cy, cy + py]
    canvas.width = bw * 3
    canvas.height = cy * 2 + py
    const setup = () => {
        // resizing the canvas resets its state
        ctx.font = `400 ${m.size * dpr}px ${m.family}`
        ctx.textBaseline = 'alphabetic'
        ctx.textAlign = 'left'
        ;(ctx as CanvasRenderingContext2D & { fontKerning?: string }).fontKerning = 'none'
        ctx.fillStyle = '#000'
    }
    setup()
    // corners and runs: the `+` ink centred in its bw x cy tile (`-`/`=` share its baseline);
    // the side slice: the `|` ink centred in its bw x py tile — so on the same x as the `+` ink
    // centre (the face's `|` sits a fraction of a pixel off the `+` stem at a shared origin).
    // Baselines are whole device pixels, so every glyph paints exactly as it was measured.
    const originX = (g: ReturnType<typeof inkOf>) =>
        bw / 2 - (g.box.actualBoundingBoxRight - g.box.actualBoundingBoxLeft) / 2
    const o = { x: originX(plus), y: Math.floor((cy - plus.h) / 2) - plus.top }
    const oSide = { x: originX(pipe), y: Math.floor((py - pipe.h) / 2) - pipe.top }

    const root = document.documentElement.style
    for (const k of EDGE_KEYS) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        spriteGlyphs(k).forEach((g, i) => {
            if (!g) return
            const row = Math.floor(i / 3)
            const at = row === 1 ? oSide : o
            ctx.fillText(g, (i % 3) * bw + at.x, rowY[row]! + at.y)
        })
        root.setProperty(spriteVar(k), `url(${canvas.toDataURL('image/png')})`)
    }
    root.setProperty('--ascii-tile-w', `${cssW}px`)
    root.setProperty('--ascii-tile-h', `${cssH}px`)
    root.setProperty('--ascii-pitch-y', `${cssPitchY}px`)
    // the shortest typed row: two corner halves + one `|` — a row this tall gets exactly one
    root.setProperty('--ascii-row-h', `${cssH + cssPitchY}px`)
    root.setProperty('--ascii-slice-x', String(bw))
    root.setProperty('--ascii-slice-y', String(cy))
    installedKey = key
    markInstalled()
}

/** Rasterise and install the sprites for the current font / size / cell height / dpr, once the
 *  UI font has loaded. Idempotent and cheap when nothing in the key changed; a no-op outside the
 *  DOM. Re-runs from settingsCssVars.ts's setCssVars (which every surface routes through), from
 *  the fonts `loadingdone` event, and from a resolution watcher — a devicePixelRatio change (the
 *  window moved between a 2x and a 1x display, or the app zoom in zoom.ts) fires no event of its
 *  own, but a `(resolution: <dpr>dppx)` media query stops matching, and `install()` re-keys on dpr. */
export function refreshAsciiGlyphTiles(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined' || !document.fonts) return
    if (!listening) {
        listening = true
        document.fonts.addEventListener('loadingdone', () => refreshAsciiGlyphTiles())
        const watchDpr = () => {
            window
                .matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
                .addEventListener('change', () => { refreshAsciiGlyphTiles(); watchDpr() }, { once: true })
        }
        watchDpr()
    }
    if (scheduled) return
    scheduled = true
    document.fonts.ready.then(() => {
        scheduled = false
        install()
    })
}
