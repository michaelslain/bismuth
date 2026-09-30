// app/src/ui/ascii/asciiGlyphTiles.ts — the UI font's own `+ - = |` glyphs, rasterised ONCE into
// mask sprites that AsciiCellEdges paints a cell's edges with.
//
// Why: a typed grid of thousands of cells cannot afford a line of text per edge (a 2000x8 table
// took ~17s to lay out as glyph runs). So each glyph is drawn once, with canvas `fillText` in the
// COMPUTED `--ui-font-stack` at `--fs-ui`, into a one-`ch` x `--cell-h` tile at devicePixelRatio,
// and a cell becomes ONE element whose edges are a nine-slice mask over its ink colour.
//
// A sprite is 3x3 tiles — the nine-slice of one cell's edges:
//
//     + - +        corners `+` (only where both of its edges are drawn),
//     |   |        top/bottom `-` or `=`, left/right `|`,
//     + - +        and an empty tile wherever the cell does not own that part.
//
// One sprite per edge set (top none/rule/heavy x right x bottom none/rule/heavy x left = 36 keys,
// 35 with ink), installed on :root as `--ascii-edges-<key>: url(data:…)` plus the tile's CSS size
// (`--ascii-tile-w`, `--ascii-tile-h`) and its bitmap size (`--ascii-slice-x`, `--ascii-slice-y`).
// Colour is NOT in the sprite: it is a mask, and the ink comes from the element's
// background-color, so a theme switch needs no regeneration. Only the font stack, font size, cell
// height or dpr changing does (the cache key).
//
// Every glyph in a sprite is drawn at the SAME offset inside its tile, chosen so the `+`'s ink
// centre lands exactly on the tile centre: the tile centre is the cell corner, so the `+` sits
// centred on its corner, the `|` stems share its x (same advance, same origin) and the `-`/`=`
// strokes share its baseline — exactly as the text-run build typed them.

/** 0 = edge not drawn, 1 = rule (`-`), 2 = heavy (`=`); vertical edges are 0 or 1 (`|`). */
export type HorizontalEdge = 0 | 1 | 2
export type VerticalEdge = 0 | 1

type Edge = 'top' | 'right' | 'bottom' | 'left'
type Weight = 'rule' | 'heavy'

/** The sprite key for an edge set: four digits, top right bottom left (clockwise, like CSS).
 *  Pure — AsciiCellEdges derives its `data-ascii-edges` attribute from this. */
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

/** A tile's bitmap size in device pixels and the CSS size it is painted at. The bitmap is a whole
 *  number of device pixels and is painted 1:1 (the CSS size is bitmap / dpr), so a `+` is never
 *  resampled; that moves a corner by at most a quarter of a device pixel from the true `ch`. */
export function tileSize(chPx: number, cellHPx: number, dpr: number) {
    const bw = Math.max(1, Math.round(chPx * dpr))
    const bh = Math.max(1, Math.round(cellHPx * dpr))
    return { bw, bh, cssW: bw / dpr, cssH: bh / dpr }
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

function install(): void {
    const m = readMetrics()
    if (!m.family || !(m.size > 0) || !(m.cellH > 0)) return
    const dpr = window.devicePixelRatio || 1
    const font = `400 ${m.size}px ${m.family}`
    // never rasterise from a fallback face: wait for the real one, then come back
    if (!document.fonts.check(font, '+-=|')) {
        document.fonts.load(font, '+-=|').then(install, () => {})
        return
    }
    const key = tileCacheKey(m.family, m.size, m.cellH, dpr)
    if (key === installedKey) return

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.font = `400 ${m.size * dpr}px ${m.family}`
    const ch = ctx.measureText('-').width / dpr
    const { bw, bh, cssW, cssH } = tileSize(ch, m.cellH, dpr)
    canvas.width = bw * 3
    canvas.height = bh * 3
    const setup = () => {
        // resizing the canvas resets its state
        ctx.font = `400 ${m.size * dpr}px ${m.family}`
        ctx.textBaseline = 'alphabetic'
        ctx.textAlign = 'left'
        ;(ctx as CanvasRenderingContext2D & { fontKerning?: string }).fontKerning = 'none'
        ctx.fillStyle = '#000'
    }
    setup()
    const plus = ctx.measureText('+')
    const o = glyphOrigin(bw, bh, {
        left: plus.actualBoundingBoxLeft,
        right: plus.actualBoundingBoxRight,
        ascent: plus.actualBoundingBoxAscent,
        descent: plus.actualBoundingBoxDescent,
    })

    const root = document.documentElement.style
    for (const k of EDGE_KEYS) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        spriteGlyphs(k).forEach((g, i) => {
            if (g) ctx.fillText(g, (i % 3) * bw + o.x, Math.floor(i / 3) * bh + o.y)
        })
        root.setProperty(spriteVar(k), `url(${canvas.toDataURL('image/png')})`)
    }
    root.setProperty('--ascii-tile-w', `${cssW}px`)
    root.setProperty('--ascii-tile-h', `${cssH}px`)
    root.setProperty('--ascii-slice-x', String(bw))
    root.setProperty('--ascii-slice-y', String(bh))
    installedKey = key
    markInstalled()
}

/** Rasterise and install the sprites for the current font / size / cell height / dpr, once the
 *  UI font has loaded. Idempotent and cheap when nothing in the key changed; a no-op outside the
 *  DOM. Called from settingsCssVars.ts's setCssVars, which every surface routes through. */
export function refreshAsciiGlyphTiles(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined' || !document.fonts) return
    if (!listening) {
        listening = true
        document.fonts.addEventListener('loadingdone', () => refreshAsciiGlyphTiles())
    }
    if (scheduled) return
    scheduled = true
    document.fonts.ready.then(() => {
        scheduled = false
        install()
    })
}
