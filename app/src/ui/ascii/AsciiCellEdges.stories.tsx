// Visual spec for <AsciiCellEdges> — a cell's edges typed with the UI font's own `+ - | =` glyphs
// (rasterised once into mask sprites by asciiGlyphTiles.ts), the overlay every typed grid (Bases
// table, calendar month/week) is built from. See DESIGN.md's Typed Grid Rule.
//
// Props: edges? (default ['top','left']), weight? ('rule' `-` | 'heavy' `=`), edgeWeight?
// ({ top?, bottom? } per-edge override), ink? ('soft' --border-soft | 'firm' --border), class?.
//
// The mini-grid stories build a 4x3 grid with the ownership rule exactly as a caller would, at
// two container widths that are NOT a whole number of `ch`, and `play()` checks the geometry
// acceptance item 5 states against what is actually painted: each overlay's box, its computed
// nine-slice mask (sprite, slice, width, round), and the ink of the sprite's own pixels — every
// `+` is centred on its cell corner, the `|` stems share its x-centre and the `-`/`=` strokes
// share its crossbar.
//
// The PITCH is asserted too (`pitchReport`): the dash repeat painted across a run and down a bar
// must be one number on both axes — global.css says it is, and `mask-border-repeat: round` makes it
// so only where the host's box is a whole number of pitches. Every host here is snapped to one
// (width corner-w + n x pitch, height tile-h + m x pitch), and the typed rows of the mini grid are
// one pitch of room, so a regression to an unsnapped host or a changed repeat fails these stories.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { For, type JSX } from 'solid-js'
import { expect } from 'storybook/test'
import AsciiCellEdges, {
    type AsciiCellEdgesProps,
    type AsciiEdge,
} from './AsciiCellEdges'
import { fitTiles, whenAsciiGlyphTilesInstalled } from './asciiGlyphTiles'
import Text from '../Text'
import { Row } from '../_storyKit'

/** What `mask-border-repeat: round` paints on each axis of every overlay under `root` that has both
 *  a run and a bar: it fits a WHOLE number of tiles into the run's room (the overlay's box less one
 *  corner tile at each end) and stretches each to fill it (`fitTiles`). `across` is the dash pitch
 *  along the top/bottom, `down` along the left/right, in CSS px. */
async function pitchReport(root: HTMLElement) {
    await whenAsciiGlyphTilesInstalled()
    const cs = getComputedStyle(document.documentElement)
    const cornerW = parseFloat(cs.getPropertyValue('--ascii-corner-w'))
    const tileH = parseFloat(cs.getPropertyValue('--ascii-tile-h'))
    const pitch = parseFloat(cs.getPropertyValue('--ascii-pitch'))
    expect(pitch, 'the dash pitch is installed').toBeGreaterThan(0)
    const rows = [...root.querySelectorAll<HTMLElement>('[data-edges]')]
        .filter(el => /top|bottom/.test(el.dataset.edges!) && /left|right/.test(el.dataset.edges!))
        .map(el => {
            expect(getComputedStyle(el).webkitMaskBoxImageRepeat, 'the runs repeat with round').toBe('round')
            const r = el.getBoundingClientRect()
            const across = fitTiles(r.width - 2 * cornerW, pitch)
            const down = fitTiles(r.height - 2 * tileH, pitch)
            return { edges: el.dataset.edges!, pitch, across: across.pitch, down: down.pitch, gap: Math.abs(across.pitch - down.pitch) }
        })
    return rows
}

/** Asserts the dash pitch is the same across and down, within `tol` CSS px. */
async function expectOnePitch(root: HTMLElement, tol: number) {
    const rows = await pitchReport(root)
    expect(rows.length, 'an overlay with both a run and a bar was measured').toBeGreaterThan(0)
    for (const r of rows)
        expect(r.gap, `[${r.edges}] dash pitch ${r.across.toFixed(2)} across vs ${r.down.toFixed(2)} down`).toBeLessThanOrEqual(tol)
}

const meta = {
    title: 'UI/Ascii/AsciiCellEdges',
    component: AsciiCellEdges,
    parameters: { layout: 'centered' },
    argTypes: {
        weight: { control: 'inline-radio', options: ['rule', 'heavy'] },
        ink: { control: 'inline-radio', options: ['soft', 'firm'] },
    },
} satisfies Meta<typeof AsciiCellEdges>

export default meta
type Story = StoryObj<typeof meta>

/** A host cell as a caller builds one: `position: relative`, NOT clipping, with the overlay as a
 *  child. The margin leaves room for the glyphs that straddle the boundary. */
function Host(props: {
    children?: JSX.Element
    width?: string
    height?: string
    edges: AsciiCellEdgesProps
}) {
    return (
        <div
            data-cell-host
            style={{
                position: 'relative',
                // snapped to whole pitches (corner tile + n x pitch each way) so `round` has nothing
                // to stretch: the dash pitch is then exactly --ascii-pitch across AND down
                width: props.width ?? 'calc(var(--ascii-corner-w, 1ch) + 8 * var(--ascii-pitch, 2ch))',
                height: props.height ?? 'calc(var(--ascii-tile-h, var(--cell-h)) + 3 * var(--ascii-pitch, 2ch))',
                margin: '18px',
                padding: 'var(--sp-3) var(--sp-4)',
                'box-sizing': 'border-box',
            }}
        >
            <Text as="span" size="ui" tone="muted">
                {props.children ?? 'cell'}
            </Text>
            <AsciiCellEdges {...props.edges} />
        </div>
    )
}

/** A snapped host paints --ascii-pitch to the pixel on both axes: assert it, exactly (0.01px). */
const onePitchPlay: Story['play'] = async ({ canvasElement }) => {
    await expectOnePitch(canvasElement, 0.01)
    for (const r of await pitchReport(canvasElement))
        expect(r.across, `[${r.edges}] paints the token pitch, not a stretched one`).toBeCloseTo(r.pitch, 1)
}

const single = (edges: AsciiEdge[], extra: AsciiCellEdgesProps = {}): Story => ({
    render: () => (
        <Row label={edges.join(' + ')}>
            <Host edges={{ ...extra, edges }} />
        </Row>
    ),
    play: onePitchPlay,
})

/** The default: top + left, the two edges every cell owns. */
export const TopLeft: Story = single(['top', 'left'])

/** Top + left + right: the last column's cell, and a full-width band (a group row) — no
 *  interior `|`. */
export const Band: Story = single(['top', 'left', 'right'])

/** Top + left + bottom: a last-row cell that is not in the last column. */
export const TopLeftBottom: Story = single(['top', 'left', 'bottom'])

/** All four edges: a lone cell, or the bottom-right cell of a grid. */
export const AllFour: Story = single(['top', 'right', 'bottom', 'left'])

/** `-` (rule) vs `=` (heavy), and --border-soft (soft) vs --border (firm). */
export const WeightsAndInks: Story = {
    render: () => (
        <Row label="rule / heavy x soft / firm">
            <Host
                edges={{ edges: ['top', 'right', 'bottom', 'left'] }}
            >
                rule soft
            </Host>
            <Host
                edges={{
                    edges: ['top', 'right', 'bottom', 'left'],
                    weight: 'heavy',
                }}
            >
                heavy soft
            </Host>
            <Host
                edges={{
                    edges: ['top', 'right', 'bottom', 'left'],
                    ink: 'firm',
                }}
            >
                rule firm
            </Host>
            <Host
                edges={{
                    edges: ['top', 'right', 'bottom', 'left'],
                    weight: 'heavy',
                    ink: 'firm',
                }}
            >
                heavy firm
            </Host>
        </Row>
    ),
    play: onePitchPlay,
}

/** A header cell: `edgeWeight={{ bottom: 'heavy' }}` types the `=` underline in firm ink while
 *  the top stays a `-` rule. */
export const HeaderCell: Story = {
    render: () => (
        <Row label="edgeWeight bottom heavy">
            <Host
                edges={{
                    edges: ['top', 'left', 'right', 'bottom'],
                    edgeWeight: { bottom: 'heavy' },
                    ink: 'firm',
                }}
            >
                header
            </Host>
        </Row>
    ),
    play: onePitchPlay,
}

/** A summary row's cell: `=` on top, `-` below. */
export const SummaryCell: Story = {
    render: () => (
        <Row label="edgeWeight top heavy">
            <Host
                edges={{
                    edges: ['top', 'left', 'right', 'bottom'],
                    edgeWeight: { top: 'heavy' },
                    ink: 'firm',
                }}
            >
                summary
            </Host>
        </Row>
    ),
    play: onePitchPlay,
}

/** `backdrop`: for a cell in a sticky header. The ring is an opaque `--bg` frame over the glyph
 *  overhang only, so busy content scrolling beneath the header cannot show through the half tile the
 *  glyphs straddle outside the host. Left: backdrop on; right: off, the overhang shows the content. */
const BUSY = Array.from({ length: 9 }, (_, i) => (i % 2 ? '+-----+-----+-----+' : '|     |     |     |')).join('\n')

function BackdropHost(props: { backdrop: boolean; label: string }) {
    return (
        <div style={{ position: 'relative', margin: '18px' }}>
            <Text as="div" size="ui" tone="faint" style={{ 'white-space': 'pre', 'line-height': 'var(--cell-h)' }}>
                {BUSY}
            </Text>
            <div
                data-cell-host={props.label}
                style={{
                    position: 'absolute',
                    top: 'calc(var(--cell-h) * 3)',
                    left: '40px',
                    width: '96px',
                    height: 'calc(var(--cell-h) * 2)',
                    'box-sizing': 'border-box',
                    padding: 'var(--sp-3) var(--sp-4)',
                    background: 'var(--bg)',
                }}
            >
                <Text as="span" size="ui" tone="muted" data-cell-label>
                    {props.label}
                </Text>
                <AsciiCellEdges
                    edges={['top', 'right', 'bottom', 'left']}
                    edgeWeight={{ bottom: 'heavy' }}
                    backdrop={props.backdrop}
                />
            </div>
        </div>
    )
}

export const Backdrop: Story = {
    render: () => (
        <Row label="backdrop on // off">
            <BackdropHost backdrop label="on" />
            <BackdropHost backdrop={false} label="off" />
        </Row>
    ),
    play: async ({ canvasElement }) => {
        await whenAsciiGlyphTilesInstalled()
        const cs = getComputedStyle(document.documentElement)
        const tileW = parseFloat(cs.getPropertyValue('--ascii-corner-w'))
        const tileH = parseFloat(cs.getPropertyValue('--ascii-tile-h'))
        expect(tileW, 'the glyph tiles are installed').toBeGreaterThan(0)
        const on = canvasElement.querySelector<HTMLElement>('[data-cell-host="on"]')!
        const off = canvasElement.querySelector<HTMLElement>('[data-cell-host="off"]')!
        expect(off.querySelectorAll('[data-backdrop]').length, 'no ring without backdrop').toBe(0)
        const rings = on.querySelectorAll<HTMLElement>('[data-backdrop]')
        expect(rings.length, 'exactly one ring with backdrop').toBe(1)
        const ring = rings[0]
        const r = ring.getBoundingClientRect()
        const h = on.getBoundingClientRect()
        const near = (a: number, b: number) => Math.abs(a - b) <= 0.75
        // outside the host box on all four sides, by half a tile
        expect(near(h.top - r.top, tileH / 2), 'ring overhangs the top by half a tile').toBe(true)
        expect(near(r.bottom - h.bottom, tileH / 2), 'ring overhangs the bottom by half a tile').toBe(true)
        expect(near(h.left - r.left, tileW / 2), 'ring overhangs the left by half a tile').toBe(true)
        expect(near(r.right - h.right, tileW / 2), 'ring overhangs the right by half a tile').toBe(true)
        // it is a ring: its own border is exactly the overhang wide, so its inner edge IS the host box
        const rc = getComputedStyle(ring)
        expect(near(r.left + parseFloat(rc.borderLeftWidth), h.left), 'inner left edge is the host left').toBe(true)
        expect(near(r.right - parseFloat(rc.borderRightWidth), h.right), 'inner right edge is the host right').toBe(true)
        expect(near(r.top + parseFloat(rc.borderTopWidth), h.top), 'inner top edge is the host top').toBe(true)
        expect(near(r.bottom - parseFloat(rc.borderBottomWidth), h.bottom), 'inner bottom edge is the host bottom').toBe(true)
        expect(rc.borderTopColor, 'the ring is opaque --bg').not.toBe('rgba(0, 0, 0, 0)')
        expect(rc.backgroundColor, 'the ring does not fill the host box').toBe('rgba(0, 0, 0, 0)')
        // and it never reaches the host's content: the label sits wholly inside the ring's hole
        const l = on.querySelector<HTMLElement>('[data-cell-label]')!.getBoundingClientRect()
        const hole = {
            left: r.left + parseFloat(rc.borderLeftWidth),
            right: r.right - parseFloat(rc.borderRightWidth),
            top: r.top + parseFloat(rc.borderTopWidth),
            bottom: r.bottom - parseFloat(rc.borderBottomWidth),
        }
        const disjoint =
            l.right <= hole.left || l.left >= hole.right || l.bottom <= hole.top || l.top >= hole.bottom
        const inside = l.left >= hole.left && l.right <= hole.right && l.top >= hole.top && l.bottom <= hole.bottom
        expect(disjoint, 'the label is not under a ring band').toBe(false)
        expect(inside, 'the label sits inside the ring hole').toBe(true)
        // the glyph element paints after the ring, so the host's own glyphs stay on top of it
        const glyphs = on.querySelector<HTMLElement>('[data-edges]')!
        expect(
            ring.compareDocumentPosition(glyphs) & Node.DOCUMENT_POSITION_FOLLOWING,
            'the glyph element follows the ring',
        ).toBeTruthy()
    },
}

// ---------------------------------------------------------------------------------------------
// the mini grid: 4 columns x 3 rows (header + two body rows), the ownership rule verbatim
// ---------------------------------------------------------------------------------------------

const COLS = 4
const ROWS = 3
const HEAD = ['name', 'status', 'due', 'tag']
const BODY = [
    ['read borges', 'doing', 'mon', 'books'],
    ['write draft', 'todo', 'thu', 'work'],
]

/** What one cell of the grid types. Row 0 is the header: it types its bottom heavy and firm.
 *  Row 1 (first body row) omits `top` — the header already typed that boundary. The last column
 *  adds `right`; the last row adds `bottom`. */
function edgesFor(row: number, col: number): AsciiCellEdgesProps {
    const edges: AsciiEdge[] = ['left']
    if (row !== 1) edges.push('top')
    if (col === COLS - 1) edges.push('right')
    if (row === 0 || row === ROWS - 1) edges.push('bottom')
    return row === 0
        ? { edges, edgeWeight: { bottom: 'heavy' }, ink: 'firm' }
        : { edges }
}

function MiniGrid(props: { width: number }) {
    return (
        <div
            data-mini-grid
            style={{
                display: 'grid',
                'grid-template-columns': `repeat(${COLS}, minmax(0, 1fr))`,
                width: `${props.width}px`,
                margin: '18px',
            }}
        >
            <For each={Array.from({ length: ROWS }, (_, r) => r)}>
                {r => (
                    <For each={Array.from({ length: COLS }, (_, c) => c)}>
                        {c => (
                            <div
                                style={{
                                    // one typed row, as the Bases table builds it: corner halves +
                                    // one dash pitch, so a `|` dash is never stretched by `round`
                                    position: 'relative',
                                    display: 'flex',
                                    'align-items': 'center',
                                    height: 'max(var(--ascii-row-h, var(--h-control)), var(--h-control))',
                                    padding: '0 var(--ascii-tile-w, 1ch)',
                                    'box-sizing': 'border-box',
                                }}
                            >
                                <Text
                                    as="span"
                                    size="ui"
                                    tone={r === 0 ? 'default' : 'muted'}
                                >
                                    {r === 0 ? HEAD[c] : BODY[r - 1]![c]}
                                </Text>
                                <AsciiCellEdges {...edgesFor(r, c)} />
                            </div>
                        )}
                    </For>
                )}
            </For>
        </div>
    )
}

type Ink = { cx: number; cy: number; strokes: number; w: number; h: number; left: number; right: number; top: number; bottom: number }

/** Where one tile of a sprite puts its ink, read off the sprite's own pixels. The tiles are NOT
 *  equal (columns [corner, pitch, corner], rows the same), so a tile is addressed by its box:
 *  `x0`/`tw` across, `y0`/`th` down. `cx`/`cy` (CSS px from the tile's top-left) = the x of its
 *  vertical stroke / the y of its horizontal stroke (the columns / rows carrying at least half the
 *  heaviest one's alpha, alpha-weighted) — so a `+` gives its stem and its crossbar, a `|` its
 *  stem, a `-`/`=` its stroke. `strokes` = the maximal runs of rows at least half the peak row's
 *  alpha: 1 for a `-`, 2 for an `=`. The rest are in DEVICE px, at half alpha: `w` along the
 *  heaviest row (a dash's length, a `+`'s crossbar), `left`/`right` its first / last column; `h`
 *  down the heaviest column (a `|` dash's length, a `+`'s stem), `top`/`bottom` its first / last
 *  row — what the rhythm checks measure lengths and gaps with. `null` = the tile is empty. */
function tileInk(px: ImageData, x0: number, tw: number, y0: number, th: number, dpr: number): Ink | null {
    const a = (x: number, y: number) => px.data[((y0 + y) * px.width + x0 + x) * 4 + 3]!
    const cols = new Array<number>(tw).fill(0)
    const rows = new Array<number>(th).fill(0)
    for (let y = 0; y < th; y++)
        for (let x = 0; x < tw; x++) {
            cols[x]! += a(x, y)
            rows[y]! += a(x, y)
        }
    const peak = (sums: number[]) => {
        const max = Math.max(...sums)
        let w = 0, at = 0
        sums.forEach((v, i) => {
            if (v >= max / 2) (w += v), (at += v * (i + 0.5))
        })
        return at / w
    }
    if (Math.max(...cols) === 0) return null
    const rowMax = Math.max(...rows)
    let strokes = 0
    rows.forEach((v, i) => {
        if (v >= rowMax / 2 && !(i > 0 && rows[i - 1]! >= rowMax / 2)) strokes++
    })
    const sy = rows.indexOf(rowMax)
    const sx = cols.indexOf(Math.max(...cols))
    const across = cols.map((_, x) => x).filter(x => a(x, sy) >= 128)
    const down = rows.map((_, y) => y).filter(y => a(sx, y) >= 128)
    const left = across[0] ?? 0, right = across[across.length - 1] ?? -1
    const top = down[0] ?? 0, bottom = down[down.length - 1] ?? -1
    return {
        cx: peak(cols) / dpr,
        cy: peak(rows) / dpr,
        strokes,
        w: right - left + 1,
        h: bottom - top + 1,
        left,
        right,
        top,
        bottom,
    }
}

async function spritePixels(url: string) {
    const img = new Image()
    img.src = url
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return ctx.getImageData(0, 0, c.width, c.height)
}

const urlOf = (css: string) => css.match(/url\("?([^")]+)"?\)/)?.[1] ?? ''

/** Measures every overlay in `root` against what it paints and returns what disagrees. `problems`
 *  empty means acceptance item 5 holds: each `+` ink centre is on its cell corner (x within 1px,
 *  y within 0.75px), the `|` stems are within 1px of the `+` stem, and the `-`/`=` strokes are
 *  within 1px of its crossbar. And ONE dash on both axes, read off the sprite in device px: a `|`
 *  dash is as long as a `-` dash (within 1), and an `=` too; the gap between two `|` dashes equals
 *  the gap between two `-` dashes (within 1) — both repeat at --ascii-pitch, the
 *  --ascii-dash-pitch token; and from each `+` to its first dash on all four sides is that same
 *  gap (within 1.5 — a corner is rounded to an even height). The previous build stacked the whole
 *  `|` glyph (twice a `-`) at a 1ch-ish pitch: this fails on that. */
async function probeGrid(root: HTMLElement) {
    await whenAsciiGlyphTilesInstalled()
    const rootCs = getComputedStyle(document.documentElement)
    const tileW = parseFloat(rootCs.getPropertyValue('--ascii-tile-w'))
    const cornerW = parseFloat(rootCs.getPropertyValue('--ascii-corner-w'))
    const tileH = parseFloat(rootCs.getPropertyValue('--ascii-tile-h'))
    const bx = Number(rootCs.getPropertyValue('--ascii-slice-x'))
    const by = Number(rootCs.getPropertyValue('--ascii-slice-y'))
    const pitchCss = parseFloat(rootCs.getPropertyValue('--ascii-pitch'))
    const dpr = bx / cornerW
    expect(pitchCss, 'the dash pitch is installed').toBeGreaterThan(0)
    const pitchTiles = parseFloat(rootCs.getPropertyValue('--ascii-dash-pitch')) || 2
    const pitch = Math.round(pitchCss * dpr)
    const overlays = [...root.querySelectorAll<HTMLElement>('[data-edges]')]
    const problems: string[] = []
    if (Math.abs(pitch - Math.round(pitchTiles * tileW * dpr)) > 0.5)
        problems.push(`pitch ${pitch}px, not ${pitchTiles} x the ${tileW * dpr}px tile`)
    const stats = {
        overlays: overlays.length, corners: 0, bars: 0, runs: 0, heavy: 0, maxOff: 0, maxDx: 0, maxDy: 0,
        pitch, dashX: 0, dashY: 0, dashEq: 0, gapX: 0, gapY: 0, plusGaps: [] as number[],
    }
    const pixels = new Map<string, ImageData>()
    for (const el of overlays) {
        const edges = el.dataset.edges!.split(' ')
        const heavy = el.dataset.heavy?.split(' ') ?? []
        const has = (e: string) => edges.includes(e)
        const corners = (['top', 'bottom'] as const).flatMap(v =>
            (['left', 'right'] as const).filter(h => has(v) && has(h)).map(h => [v, h] as const),
        )
        stats.corners += corners.length
        stats.bars += +has('left') + +has('right')
        stats.runs += +has('top') + +has('bottom')
        stats.heavy += heavy.length

        // the mask actually applied: this edge set's sprite, sliced into its nine tiles, round
        const cs = getComputedStyle(el)
        // the ink is the element's background-color seen through the mask: transparent = nothing paints
        expect(cs.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
        const src = urlOf(cs.webkitMaskBoxImageSource)
        if (!src.startsWith('data:image/png')) {
            problems.push(`[${el.dataset.edges}] has no glyph sprite (${cs.webkitMaskBoxImageSource.slice(0, 40)})`)
            continue
        }
        if (cs.webkitMaskBoxImageRepeat !== 'round') problems.push(`mask repeat ${cs.webkitMaskBoxImageRepeat}, not round`)
        if (cs.webkitMaskBoxImageSlice !== `${by} ${bx}`) problems.push(`mask slice ${cs.webkitMaskBoxImageSlice}`)
        if (cs.webkitMaskBoxImageWidth !== `${tileH}px ${cornerW}px`) problems.push(`mask width ${cs.webkitMaskBoxImageWidth}`)

        // the overlay overhangs its host by exactly half a corner tile on every side
        const r = el.getBoundingClientRect()
        const host = el.parentElement!.getBoundingClientRect()
        const hang = [host.left - r.left, r.right - host.right].map(d => d - cornerW / 2)
            .concat([host.top - r.top, r.bottom - host.bottom].map(d => d - tileH / 2))
        if (hang.some(d => Math.abs(d) > 0.5)) problems.push(`[${el.dataset.edges}] overhang off by ${hang.map(d => d.toFixed(2))}`)

        if (!pixels.has(src)) pixels.set(src, await spritePixels(src))
        const px = pixels.get(src)!
        // the sprite's tiles: [corner, one pitch, corner] across and down
        const runW = px.width - 2 * bx
        const sideH = px.height - 2 * by
        if (runW !== pitch || sideH !== pitch) problems.push(`run tile ${runW} x side tile ${sideH}, not the ${pitch}px pitch`)
        const colX = [0, bx, bx + runW], colW = [bx, runW, bx]
        const rowY = [0, by, by + sideH], rowH = [by, sideH, by]
        const ink = (col: number, row: number) => tileInk(px, colX[col]!, colW[col]!, rowY[row]!, rowH[row]!, dpr)
        const expectInk = (col: number, row: number, want: boolean, what: string) => {
            if (!!ink(col, row) !== want) problems.push(`[${el.dataset.edges}] ${what} ${want ? 'missing' : 'painted where it is not owned'}`)
        }
        for (const [v, h] of [['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']] as const)
            expectInk(h === 'left' ? 0 : 2, v === 'top' ? 0 : 2, has(v) && has(h), `${v}-${h} +`)
        expectInk(1, 0, has('top'), 'top run')
        expectInk(1, 2, has('bottom'), 'bottom run')
        expectInk(0, 1, has('left'), 'left |')
        expectInk(2, 1, has('right'), 'right |')
        expectInk(1, 1, false, 'centre')

        for (const [v, h] of corners) {
            const col = h === 'left' ? 0 : 2
            const row = v === 'top' ? 0 : 2
            const plus = ink(col, row)!
            // the tile sits in the overlay's corner; its ink must land on the host's corner
            const inkX = (h === 'left' ? r.left : r.right - cornerW) + plus.cx
            const inkY = (v === 'top' ? r.top : r.bottom - tileH) + plus.cy
            const dx = inkX - (h === 'left' ? host.left : host.right)
            const dy = inkY - (v === 'top' ? host.top : host.bottom)
            stats.maxOff = Math.max(stats.maxOff, Math.abs(dx), Math.abs(dy))
            if (Math.abs(dx) > 1) problems.push(`'+' stem ${dx.toFixed(2)}px off its corner [${el.dataset.edges}]`)
            if (Math.abs(dy) > 0.75) problems.push(`'+' crossbar ${dy.toFixed(2)}px off its corner [${el.dataset.edges}]`)
            // the `|` beside it (same column) shares the stem, the run beside it (same row) the crossbar
            const bar = ink(col, 1)
            const run = ink(1, row)
            if (bar && run) {
                const eq = heavy.includes(v)
                // ONE dash: a `|` dash as long as the `-` (or `=`) dash, and one gap on both axes
                const dashX = run.w
                const dashY = bar.h
                const gapX = runW - run.w
                const gapY = sideH - bar.h
                // `+` to its first dash: across (to the run beside it), down (to the `|` beside it)
                const plusAcross = h === 'left' ? bx - 1 - plus.right + run.left : runW - 1 - run.right + plus.left
                const plusDown = v === 'top' ? by - 1 - plus.bottom + bar.top : sideH - 1 - bar.bottom + plus.top
                if (eq) stats.dashEq = dashX
                else Object.assign(stats, { dashX, dashY, gapX, gapY })
                stats.plusGaps.push(plusAcross, plusDown)
                if (Math.abs(dashY - dashX) > 1) problems.push(`'|' dash ${dashY}px vs '${eq ? '=' : '-'}' dash ${dashX}px (device px)`)
                if (Math.abs(gapY - gapX) > 1) problems.push(`'|' gap ${gapY}px vs '${eq ? '=' : '-'}' gap ${gapX}px (device px)`)
                if (Math.abs(plusAcross - gapX) > 1.5) problems.push(`'+' to '${eq ? '=' : '-'}' gap ${plusAcross}px vs dash gap ${gapX}px [${v}-${h}]`)
                if (Math.abs(plusDown - gapX) > 1.5) problems.push(`'+' to '|' gap ${plusDown}px vs dash gap ${gapX}px [${v}-${h}]`)
            }
            if (bar) {
                stats.maxDx = Math.max(stats.maxDx, Math.abs(bar.cx - plus.cx))
                if (Math.abs(bar.cx - plus.cx) > 1) problems.push(`'|' ${(bar.cx - plus.cx).toFixed(2)}px off the '+' stem`)
            }
            if (run && run.strokes !== (heavy.includes(v) ? 2 : 1))
                problems.push(`[${el.dataset.edges}] ${v} run has ${run.strokes} strokes, want ${heavy.includes(v) ? 2 : 1}`)
            if (run) {
                stats.maxDy = Math.max(stats.maxDy, Math.abs(run.cy - plus.cy))
                if (Math.abs(run.cy - plus.cy) > 1) problems.push(`'${heavy.includes(v) ? '=' : '-'}' ${(run.cy - plus.cy).toFixed(2)}px off the '+' crossbar`)
            }
        }
    }
    return { problems, stats }
}

const miniGrid = (width: number): Story => ({
    render: () => <MiniGrid width={width} />,
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector<HTMLElement>('[data-mini-grid]')!
        const { problems, stats } = await probeGrid(grid)
        // fixed by the ownership rule for 4x3: 12 overlays, 20 `+`, 15 `|` columns, 16 runs, and
        // the header's 4 `=` underlines
        expect(stats.overlays).toBe(12)
        expect(stats.corners).toBe(20)
        expect(stats.bars).toBe(15)
        expect(stats.runs).toBe(16)
        expect(stats.heavy).toBe(4)
        expect(problems.join(' // '), JSON.stringify(stats)).toBe('')
        // fluid columns stretch the across-pitch by under 1/(2n) of a dash; the rows are one
        // pitch of room, so down is exact — within a CSS px on every typed cell
        await expectOnePitch(grid, 1)
    },
})

/** 437px wide: 109.25px columns, not a whole number of `ch`. */
export const MiniGrid437: Story = miniGrid(437)

/** 611px wide: 152.75px columns, not a whole number of `ch`. */
export const MiniGrid611: Story = miniGrid(611)

