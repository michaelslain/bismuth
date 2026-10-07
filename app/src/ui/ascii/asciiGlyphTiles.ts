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
// 35 with ink), installed on :root as `--ascii-edges-<key>: url(data:…)` plus the `ch` tile
// (`--ascii-tile-w`), the corner tile's CSS size (`--ascii-corner-w`, `--ascii-tile-h`), the dash
// pitch both axes repeat at (`--ascii-pitch`), the shortest typed row (`--ascii-row-h` = tile-h +
// pitch: corner halves + one dash) and the corner tile's bitmap size (`--ascii-slice-x`/`-y`).
//
// ONE dash on both axes (tileGeometry): every dash is the `-` ink's length — a `|` is the font's own
// stem CROPPED to that length, an `=` held to it — and dashes repeat at the `--ascii-dash-pitch`
// token (global.css, in `ch` tiles; 2 = a dash then a blank tile, `- - - -`) along both axes. The
// tiles are NOT equal: run tiles are one pitch long, corner tiles the `+` ink + one gap each way,
// so the gap from a `+` to its first dash is the gap between two dashes.
// Colour is NOT in the sprite: it is a mask, and the ink comes from the element's
// background-color, so a theme switch needs no regeneration. Only the font stack, font size, cell
// height, dpr or pitch changing does (the cache key).
//
// The `+` ink is centred in its corner tile — the tile centre is the cell corner, so the `+` sits
// centred on its corner; the `-`/`=` strokes share its baseline (its crossbar) and the `|` ink is
// centred on its stem x. Every glyph draws at a whole device-pixel origin.

import { clamp } from '../../math'

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
export function tileCacheKey(
    fontFamily: string,
    fontSizePx: number,
    cellHPx: number,
    dpr: number,
    pitchTiles: number = DEFAULT_DASH_PITCH,
): string {
    return `${fontFamily}|${fontSizePx}|${cellHPx}|${dpr}|${pitchTiles}`
}

/** The key an install is recorded under: the cache key, plus `|fallback` when the tiles were drawn
 *  before the face passed `document.fonts.check`. A face that loads later therefore re-keys and is
 *  redrawn; one that never loads keeps `|fallback` and is drawn once. */
export function installKey(cacheKey: string, ready: boolean): string {
    return ready ? cacheKey : `${cacheKey}|fallback`
}

/** The dash pitch, in `ch` tiles, when the `--ascii-dash-pitch` token (global.css — the ONE place
 *  the rhythm is tuned) is absent: a dash, then one blank tile, so a run reads `- - - -`. */
export const DEFAULT_DASH_PITCH = 2

/** The ink extents the geometry is derived from, in CSS px, measured from the face's painted
 *  pixels: `dashW` = the `-` ink length (the ONE dash length both axes use), `plusW`/`plusH` = the
 *  `+` ink's width and height. */
export type GlyphInk = { dashW: number; plusW: number; plusH: number }

/** The nine-slice's geometry in device pixels, and the CSS sizes it is painted at (bitmap / dpr, so
 *  every glyph paints 1:1 and is never resampled).
 *
 *  ONE dash on both axes: a dash is `dash` long (the `-` ink; a `|` is its own stem CROPPED to that
 *  length), and dashes repeat at `pitch` = `pitchTiles` x the `ch` tile along BOTH axes, so the gap
 *  between two dashes is `gap` = pitch - dash on both. The sprite is 3x3 tiles of unequal size:
 *  columns [cx, pitch, cx], rows [cy, pitch, cy]. A run tile holds one dash centred in its pitch
 *  (half a gap each side, dashOffset); a corner tile is the `+` ink + one gap on each axis, the `+`
 *  centred in it — so from a `+` arm or stem to the first dash is half a gap + half a gap = one gap,
 *  and the rhythm runs straight through a crossing. `cx`/`cy` are rounded to EVEN device pixels:
 *  the overlay overhangs the host by half a corner, and a half-device-pixel overhang would
 *  resample every glyph. */
export function tileGeometry(chPx: number, ink: GlyphInk, dpr: number, pitchTiles: number = DEFAULT_DASH_PITCH) {
    const bw = Math.max(1, Math.round(chPx * dpr))
    const pitch = Math.max(1, Math.round(pitchTiles * bw))
    const dash = clamp(Math.round(ink.dashW * dpr), 1, pitch)
    const gap = pitch - dash
    const even = (v: number) => Math.max(2, 2 * Math.round(v / 2))
    const cx = even(ink.plusW * dpr + gap)
    const cy = even(ink.plusH * dpr + gap)
    const v = verticalDash(pitch, dash, cy, Math.round(ink.plusH * dpr))
    return {
        bw,
        pitch,
        dash,
        gap,
        /** The `|` dash's length and its start inside the side tile — see verticalDash. */
        dashV: v.len,
        dashVOffset: v.offset,
        cx,
        cy,
        cssW: bw / dpr,
        cssCornerW: cx / dpr,
        cssH: cy / dpr,
        cssPitch: pitch / dpr,
    }
}

/** The `|` dash's length and offset inside its pitch-long side tile, chosen so the dash sits
 *  EXACTLY between its two `+`: the gap from the top `+` to the dash equals the gap from the dash
 *  to the bottom `+`.
 *
 *  The two gaps differ by (e mod 2) - (g mod 2), where e = the corner tile's spare height around
 *  the `+` ink (cy - plusH, split floor / ceil) and g = pitch - dash. When the parities disagree no
 *  integer offset can balance them, and a dash one device pixel off-centre is visible between two
 *  glyphs. A `|` is the font's stem cropped to a window, so — unlike a `-` — its length is ours to
 *  set: lengthen the window by ONE device pixel (never shorten: the stem is always taller) and the
 *  parities agree. The other axis keeps the `-` ink's own length, so the two dashes differ by one
 *  device pixel at most, only where that is the price of being centred. */
export function verticalDash(pitch: number, dash: number, cy: number, plusH: number): { len: number; offset: number } {
    const e = cy - plusH
    const len = (pitch - dash) % 2 === ((e % 2) + 2) % 2 || dash + 1 > pitch ? dash : dash + 1
    return { len, offset: Math.max(0, Math.floor((pitch - len - (((e % 2) + 2) % 2)) / 2)) }
}

/** Where a dash starts inside its pitch-long run tile: centred, half a gap each side. */
export function dashOffset(pitch: number, dash: number): number {
    return Math.max(0, Math.floor((pitch - dash) / 2))
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
    const pitch = parseFloat(getComputedStyle(root).getPropertyValue('--ascii-dash-pitch'))
    const out = {
        family: cs.fontFamily,
        size: parseFloat(cs.fontSize),
        cellH: parseFloat(cs.height),
        pitch: pitch > 0 ? pitch : DEFAULT_DASH_PITCH,
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
    const key = installKey(tileCacheKey(m.family, m.size, m.cellH, dpr, m.pitch), ready)
    if (key === installedKey) return

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.font = `400 ${m.size * dpr}px ${m.family}`
    const ch = ctx.measureText('-').width / dpr
    // the ink of each glyph read the way the eye (and the story probe) reads it: the pixels it
    // paints at half alpha or more, drawn at a WHOLE-pixel origin and baseline. TextMetrics' box is
    // fractional and lands a device pixel off the painted ink, which is how a `|` once touched the
    // `+` at one end of a run and not the other. The sprite draws at whole origins too, so every
    // glyph paints exactly as it was measured.
    const scratch = document.createElement('canvas')
    const sctx = scratch.getContext('2d', { willReadFrequently: true })
    if (!sctx) return
    const bw = Math.max(1, Math.round(ch * dpr))
    const baseline = Math.ceil(m.size * dpr * 2)
    const ox = bw
    scratch.width = bw * 3
    scratch.height = baseline * 2
    const setup = (c: CanvasRenderingContext2D) => {
        // (re)sizing a canvas resets its state
        c.font = `400 ${m.size * dpr}px ${m.family}`
        c.textBaseline = 'alphabetic'
        c.textAlign = 'left'
        ;(c as CanvasRenderingContext2D & { fontKerning?: string }).fontKerning = 'none'
        c.fillStyle = '#000'
    }
    setup(sctx)
    /** `left`/`top`: the ink's first column / row relative to the draw origin / baseline. */
    const inkOf = (g: string) => {
        sctx.clearRect(0, 0, scratch.width, scratch.height)
        sctx.fillText(g, ox, baseline)
        const { data, width, height } = sctx.getImageData(0, 0, scratch.width, scratch.height)
        let x0 = width, x1 = -1, y0 = height, y1 = -1
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++)
                if (data[(y * width + x) * 4 + 3]! >= 128) {
                    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
                    y0 = Math.min(y0, y); y1 = Math.max(y1, y)
                }
        return x1 < 0
            ? { left: 0, top: 0, w: 0, h: 0 }
            : { left: x0 - ox, top: y0 - baseline, w: x1 - x0 + 1, h: y1 - y0 + 1 }
    }
    const plus = inkOf('+')
    const pipe = inkOf('|')
    const dash = inkOf('-')
    const heavy = inkOf('=')
    const g = tileGeometry(ch, { dashW: dash.w / dpr, plusW: plus.w / dpr, plusH: plus.h / dpr }, dpr, m.pitch)
    const { pitch, cx, cy } = g
    const colX = [0, cx, cx + pitch]
    const rowY = [0, cy, cy + pitch]
    canvas.width = cx * 2 + pitch
    canvas.height = cy * 2 + pitch
    setup(ctx)
    // the `+` ink centred in its corner tile; `-`/`=` share its baseline, so its crossbar
    const plusL = Math.floor((cx - plus.w) / 2)
    const baseY = Math.floor((cy - plus.h) / 2) - plus.top
    // the `|` ink centred on the `+` ink's centre x (the face's `|` sits a fraction off the `+`
    // stem at a shared origin), and on the side tile's centre y — then cropped to ONE dash
    const pipeL = Math.round(plusL + plus.w / 2 - pipe.w / 2)
    const pipeY = Math.floor((pitch - pipe.h) / 2) - pipe.top
    const d0 = dashOffset(pitch, g.dash)
    const draw = (glyph: string, col: number, row: number) => {
        const x = colX[col]!
        const y = rowY[row]!
        if (glyph === '+') return ctx.fillText('+', x + plusL - plus.left, y + baseY)
        ctx.save()
        ctx.beginPath()
        if (glyph === '|') {
            // the font's own stem, just a dash-long piece of it: same thickness, same ink
            ctx.rect(x, y + g.dashVOffset, cx, g.dashV)
            ctx.clip()
            ctx.fillText('|', x + pipeL - pipe.left, y + pipeY)
        } else {
            // a `-` is naturally one dash long; an `=` is held to the same length (both strokes)
            const ink = glyph === '=' ? heavy : dash
            ctx.rect(x + d0, y, g.dash, cy)
            ctx.clip()
            ctx.fillText(glyph, x + Math.floor((pitch - ink.w) / 2) - ink.left, y + baseY)
        }
        ctx.restore()
    }

    const root = document.documentElement.style
    for (const k of EDGE_KEYS) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        spriteGlyphs(k).forEach((glyph, i) => {
            if (glyph) draw(glyph, i % 3, Math.floor(i / 3))
        })
        root.setProperty(spriteVar(k), `url(${canvas.toDataURL('image/png')})`)
    }
    root.setProperty('--ascii-tile-w', `${g.cssW}px`)
    root.setProperty('--ascii-corner-w', `${g.cssCornerW}px`)
    root.setProperty('--ascii-tile-h', `${g.cssH}px`)
    root.setProperty('--ascii-pitch', `${g.cssPitch}px`)
    // the shortest typed row: two corner halves + one dash pitch — a row this tall gets exactly one
    root.setProperty('--ascii-row-h', `${g.cssH + g.cssPitch}px`)
    root.setProperty('--ascii-slice-x', String(cx))
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
