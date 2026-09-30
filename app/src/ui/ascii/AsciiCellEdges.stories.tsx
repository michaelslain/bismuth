// Visual spec for <AsciiCellEdges> — a cell's edges typed with the UI font's own `+ - | =` glyphs
// (rasterised once into mask sprites by asciiGlyphTiles.ts), the overlay every typed grid (Bases
// table, calendar month/week) is built from. See DESIGN.md's Typed Grid Rule.
//
// Props: edges? (default ['top','left']), weight? ('rule' `-` | 'heavy' `=`), edgeWeight?
// ({ top?, bottom? } per-edge override), ink? ('soft' --faint | 'firm' --border), class?.
//
// The mini-grid stories build a 4x3 grid with the ownership rule exactly as a caller would, at
// two container widths that are NOT a whole number of `ch`, and `play()` checks the geometry
// acceptance item 5 states against what is actually painted: each overlay's box, its computed
// nine-slice mask (sprite, slice, width, round), and the ink of the sprite's own pixels — every
// `+` is centred on its cell corner, the `|` stems share its x-centre and the `-`/`=` strokes
// share its crossbar.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { For, type JSX } from 'solid-js'
import { expect } from 'storybook/test'
import AsciiCellEdges, {
    type AsciiCellEdgesProps,
    type AsciiEdge,
} from './AsciiCellEdges'
import { whenAsciiGlyphTilesInstalled } from './asciiGlyphTiles'
import Text from '../Text'
import { Row } from '../_storyKit'

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
                width: props.width ?? '132px',
                height: props.height ?? 'calc(var(--cell-h) * 3)',
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

const single = (edges: AsciiEdge[], extra: AsciiCellEdgesProps = {}): Story => ({
    render: () => (
        <Row label={edges.join(' + ')}>
            <Host edges={{ ...extra, edges }} />
        </Row>
    ),
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

/** `-` (rule) vs `=` (heavy), and --faint (soft) vs --border (firm). */
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
        const tileW = parseFloat(cs.getPropertyValue('--ascii-tile-w'))
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
                                    position: 'relative',
                                    height: 'calc(var(--cell-h) * 2)',
                                    padding: 'var(--sp-3) var(--sp-4)',
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

type Ink = { cx: number; cy: number; strokes: number }

/** Where one tile of a sprite puts its ink, in CSS px from the tile's top-left, read off the
 *  sprite's own pixels: `cx` = the x of its vertical stroke (the columns carrying at least half the
 *  heaviest column's alpha, alpha-weighted), `cy` = the y of its horizontal stroke, the same way
 *  over rows. So a `+` gives its stem and its crossbar, a `|` its stem, a `-`/`=` its stroke —
 *  unaffected by a neighbouring glyph's ink. `strokes` = the number of maximal runs of rows whose
 *  alpha is at least half the peak row's: 1 for a `-`, 2 for an `=` (its two bars), which is what
 *  tells the two sprites apart. `null` = the tile is empty. */
function tileInk(px: ImageData, col: number, row: number, bw: number, bh: number, dpr: number): Ink | null {
    const cols = new Array<number>(bw).fill(0)
    const rows = new Array<number>(bh).fill(0)
    for (let y = 0; y < bh; y++)
        for (let x = 0; x < bw; x++) {
            const a = px.data[((row * bh + y) * px.width + col * bw + x) * 4 + 3]!
            cols[x]! += a
            rows[y]! += a
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
    return { cx: peak(cols) / dpr, cy: peak(rows) / dpr, strokes }
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
 *  within 1px of its crossbar. */
async function probeGrid(root: HTMLElement) {
    await whenAsciiGlyphTilesInstalled()
    const rootCs = getComputedStyle(document.documentElement)
    const tileW = parseFloat(rootCs.getPropertyValue('--ascii-tile-w'))
    const tileH = parseFloat(rootCs.getPropertyValue('--ascii-tile-h'))
    const bw = Number(rootCs.getPropertyValue('--ascii-slice-x'))
    const bh = Number(rootCs.getPropertyValue('--ascii-slice-y'))
    const dpr = bw / tileW
    const overlays = [...root.querySelectorAll<HTMLElement>('[data-edges]')]
    const problems: string[] = []
    const stats = { overlays: overlays.length, corners: 0, bars: 0, runs: 0, heavy: 0, maxOff: 0, maxDx: 0, maxDy: 0 }
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

        // the mask actually applied: this edge set's sprite, sliced into one-glyph tiles, round
        const cs = getComputedStyle(el)
        // the ink is the element's background-color seen through the mask: transparent = nothing paints
        expect(cs.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
        const src = urlOf(cs.webkitMaskBoxImageSource)
        if (!src.startsWith('data:image/png')) {
            problems.push(`[${el.dataset.edges}] has no glyph sprite (${cs.webkitMaskBoxImageSource.slice(0, 40)})`)
            continue
        }
        if (cs.webkitMaskBoxImageRepeat !== 'round') problems.push(`mask repeat ${cs.webkitMaskBoxImageRepeat}, not round`)
        if (cs.webkitMaskBoxImageSlice !== `${bh} ${bw}`) problems.push(`mask slice ${cs.webkitMaskBoxImageSlice}`)
        if (cs.webkitMaskBoxImageWidth !== `${tileH}px ${tileW}px`) problems.push(`mask width ${cs.webkitMaskBoxImageWidth}`)

        // the overlay overhangs its host by exactly half a tile on every side
        const r = el.getBoundingClientRect()
        const host = el.parentElement!.getBoundingClientRect()
        const hang = [host.left - r.left, r.right - host.right].map(d => d - tileW / 2)
            .concat([host.top - r.top, r.bottom - host.bottom].map(d => d - tileH / 2))
        if (hang.some(d => Math.abs(d) > 0.5)) problems.push(`[${el.dataset.edges}] overhang off by ${hang.map(d => d.toFixed(2))}`)

        if (!pixels.has(src)) pixels.set(src, await spritePixels(src))
        const px = pixels.get(src)!
        // what each of the nine tiles holds, and where its ink sits
        const ink = (col: number, row: number) => tileInk(px, col, row, bw, bh, dpr)
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
            const inkX = (h === 'left' ? r.left : r.right - tileW) + plus.cx
            const inkY = (v === 'top' ? r.top : r.bottom - tileH) + plus.cy
            const dx = inkX - (h === 'left' ? host.left : host.right)
            const dy = inkY - (v === 'top' ? host.top : host.bottom)
            stats.maxOff = Math.max(stats.maxOff, Math.abs(dx), Math.abs(dy))
            if (Math.abs(dx) > 1) problems.push(`'+' stem ${dx.toFixed(2)}px off its corner [${el.dataset.edges}]`)
            if (Math.abs(dy) > 0.75) problems.push(`'+' crossbar ${dy.toFixed(2)}px off its corner [${el.dataset.edges}]`)
            // the `|` beside it (same column) shares the stem, the run beside it (same row) the crossbar
            const bar = ink(col, 1)
            if (bar) {
                stats.maxDx = Math.max(stats.maxDx, Math.abs(bar.cx - plus.cx))
                if (Math.abs(bar.cx - plus.cx) > 1) problems.push(`'|' ${(bar.cx - plus.cx).toFixed(2)}px off the '+' stem`)
            }
            const run = ink(1, row)
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
        expect(problems).toEqual([])
    },
})

/** 437px wide: 109.25px columns, not a whole number of `ch`. */
export const MiniGrid437: Story = miniGrid(437)

/** 611px wide: 152.75px columns, not a whole number of `ch`. */
export const MiniGrid611: Story = miniGrid(611)

