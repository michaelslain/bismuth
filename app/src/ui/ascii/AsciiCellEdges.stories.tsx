// Visual spec for <AsciiCellEdges> — a cell's edges typed with `+ - | =` as real text, the
// overlay every typed grid (Bases table, calendar month/week) is built from. See DESIGN.md's
// Typed Grid Rule.
//
// Props: edges? (default ['top','left']), weight? ('rule' `-` | 'heavy' `=`), edgeWeight?
// ({ top?, bottom? } per-edge override), ink? ('soft' --faint | 'firm' --border), class?.
//
// The mini-grid stories build a 4x3 grid with the ownership rule exactly as a caller would, at
// two container widths that are NOT a whole number of `ch`, and `play()` asserts the geometry
// acceptance item 5 states: every `+` shares its x-centre with the `|` glyphs above and below
// it and its crossbar sits on the same baseline as the adjacent `-`/`=` runs.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { For, type JSX } from 'solid-js'
import { expect } from 'storybook/test'
import AsciiCellEdges, {
    type AsciiCellEdgesProps,
    type AsciiEdge,
} from './AsciiCellEdges'
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

const glyphOf = (el: Element) =>
    getComputedStyle(el, '::before').content.charAt(1)

type InkBox = { cx: number; cy: number }

/** The ink centre of `glyph`, relative to the LEFT of its advance box (x) and to the top of a
 *  line box of the same font and height (y). The baseline is read off a real inline-block in a
 *  real line box rather than computed from font metrics: Chrome rounds ascent and descent to
 *  whole pixels for layout, so a metrics formula is off by up to a pixel. */
function inkCentre(sample: HTMLElement, glyph: string): InkBox {
    const cs = getComputedStyle(sample)
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    const m = ctx.measureText(glyph)
    const probe = document.createElement('div')
    probe.style.cssText = `position:absolute;visibility:hidden;left:0;top:0;white-space:pre;
        font:${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily};
        font-variant-ligatures:none;font-feature-settings:'calt' 0,'liga' 0;font-kerning:none`
    const strut = document.createElement('span')
    strut.style.cssText = 'display:inline-block;width:0;height:0'
    probe.append(strut, glyph)
    document.body.append(probe)
    const baseline = strut.getBoundingClientRect().bottom - probe.getBoundingClientRect().top
    probe.remove()
    return {
        cx: (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2,
        cy: baseline - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2,
    }
}

/** Measures every glyph in `root` and returns what disagrees. `problems` empty means acceptance
 *  item 5 holds: each `+`'s stem is within 1px of the `|` glyphs above/below it, its crossbar
 *  is within 1px of the `-`/`=` runs beside it, and both land on the cell boundary. */
async function probeGrid(root: HTMLElement) {
    await document.fonts.ready
    const parts = [...root.querySelectorAll('[aria-hidden="true"] > div')]
        .map(el => ({ el: el as HTMLElement, g: glyphOf(el) }))
        .filter(p => '+-=|'.includes(p.g))
    const rect = (el: HTMLElement) => el.getBoundingClientRect()
    const corners = parts.filter(p => p.g === '+')
    const bars = parts.filter(p => p.g === '|')
    const runs = parts.filter(p => p.g === '-' || p.g === '=')
    const problems: string[] = []
    const stats = { corners: corners.length, bars: bars.length, runs: runs.length, maxDx: 0, maxDy: 0, maxOff: 0, maxGap: 0 }
    if (corners.length === 0) problems.push('no + glyphs rendered')

    const ink: Record<string, InkBox> = {}
    for (const g of ['+', '-', '=', '|'])
        ink[g] = inkCentre((parts.find(p => p.g === g) ?? corners[0]!).el, g)
    // ink centres relative to each box's own origin (left / line-box top)
    const cross = ink['+']!.cy
    for (const g of ['-', '=']) {
        const d = Math.abs(ink[g]!.cy - cross)
        if (d > 1) problems.push(`'${g}' crossbar is ${d.toFixed(2)}px off the '+' crossbar`)
    }
    const dxGlyph = Math.abs(ink['|']!.cx - ink['+']!.cx)
    if (dxGlyph > 1) problems.push(`'|' stem is ${dxGlyph.toFixed(2)}px off the '+' stem`)

    for (const c of corners) {
        const cr = rect(c.el)
        const host = rect(c.el.parentElement!.parentElement as HTMLElement)
        const isTop = Math.abs(cr.top + cr.height / 2 - host.top) < cr.height
        const isLeft = Math.abs(cr.left + cr.width / 2 - host.left) < cr.width
        const boundaryY = isTop ? host.top : host.bottom
        const boundaryX = isLeft ? host.left : host.right
        // where the ink actually lands
        const inkY = cr.top + ink['+']!.cy
        const inkX = cr.left + ink['+']!.cx
        stats.maxOff = Math.max(stats.maxOff, Math.abs(inkY - boundaryY), Math.abs(inkX - boundaryX))
        if (Math.abs(inkY - boundaryY) > 0.75) problems.push(`'+' crossbar ${(inkY - boundaryY).toFixed(2)}px off its boundary`)
        if (Math.abs(inkX - boundaryX) > 1) problems.push(`'+' stem ${(inkX - boundaryX).toFixed(2)}px off its boundary`)

        // the `|` runs above and below (this cell's own and the neighbour's) share the stem
        const cy = cr.top + cr.height / 2
        for (const b of bars) {
            const br = rect(b.el)
            const near = br.top < cy + cr.height * 1.6 && br.bottom > cy - cr.height * 1.6
            const dx = br.left + ink['|']!.cx - inkX
            if (!near || Math.abs(dx) > 4) continue
            stats.maxDx = Math.max(stats.maxDx, Math.abs(dx))
            if (Math.abs(dx) > 1) problems.push(`'|' ${dx.toFixed(2)}px off the '+' stem`)
        }
        // the runs beside share the crossbar, and abut the '+' box
        for (const r of runs) {
            const rr = rect(r.el)
            // a run ends within half a glyph of the '+' box: it is clipped to whole glyphs and
            // the leftover is split across both ends
            const gap = Math.min(Math.abs(rr.left - cr.right), Math.abs(rr.right - cr.left))
            if (gap > cr.width || Math.abs(rr.top + rr.height / 2 - cy) > cr.height) continue
            stats.maxGap = Math.max(stats.maxGap, gap)
            if (gap > cr.width / 2 + 0.5) problems.push(`'${r.g}' run ends ${gap.toFixed(2)}px from its '+'`)
            const dy = rr.top + ink[r.g]!.cy - inkY
            stats.maxDy = Math.max(stats.maxDy, Math.abs(dy))
            if (Math.abs(dy) > 1) problems.push(`'${r.g}' run ${dy.toFixed(2)}px off the '+' crossbar`)
        }
    }
    return { problems, stats }
}

const miniGrid = (width: number): Story => ({
    render: () => <MiniGrid width={width} />,
    play: async ({ canvasElement }) => {
        const grid = canvasElement.querySelector<HTMLElement>('[data-mini-grid]')!
        const { problems, stats } = await probeGrid(grid)
        // 4x3 cells with the ownership rule: 5 corners across the header/first-body seam are
        // typed once each, so the corner count is fixed by the rule, not by the width
        expect(stats.corners).toBeGreaterThan(0)
        expect(problems).toEqual([])
    },
})

/** 437px wide: 109.25px columns, not a whole number of `ch`. */
export const MiniGrid437: Story = miniGrid(437)

/** 611px wide: 152.75px columns, not a whole number of `ch`. */
export const MiniGrid611: Story = miniGrid(611)

