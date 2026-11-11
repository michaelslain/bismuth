// app/src/preview/PreviewBar.stories.tsx
// Visual + behavioural spec for <PreviewBar> — the preview tab's view bar for images and PDFs. Every
// play() probes what a person sees (ui/_previewBarAssertions.ts): the gaps between adjacent
// controls are the bar's one ink distance (~16.5px between every neighbour pair, measured glyph to
// glyph), the number of accent frames, one glyph size and one icon box, and nothing leaving the
// 36px band.
import { createSignal, type JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import PreviewBar, { type PreviewBarProps } from './PreviewBar'
import {
    median,
    mutedColor,
    OPTICAL_LINE_TOLERANCE,
    opticalCentre,
    probeBar,
    WITHIN_INK_GAP,
} from '../ui/_previewBarAssertions'

const meta = {
    title: 'Preview/PreviewBar',
    component: PreviewBar,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PreviewBar>

export default meta
type Story = StoryObj<typeof meta>

type HarnessProps = {
    width: number
    kind: PreviewBarProps['kind'] extends () => infer K ? K : never
    name?: string
    native?: boolean
    draw?: boolean
    scratch?: boolean
    panel?: boolean
    /** `annotReady` — false until the sidecar has loaded (default true). */
    ready?: boolean
    imageSize?: { w: number; h: number }
    /** PDF dark mode on. */
    dark?: boolean
}

/** A live bar: every toggle flips its own signal, so a play() can press it and read the result. */
function Harness(props: HarnessProps): JSX.Element {
    const [page, setPage] = createSignal(0)
    const [zoom, setZoom] = createSignal(1)
    const [draw, setDraw] = createSignal(props.draw ?? false)
    const [armed, setArmed] = createSignal(false)
    const [scratch, setScratch] = createSignal(props.scratch ?? false)
    const [panel, setPanel] = createSignal(props.panel ?? false)
    const [dark, setDark] = createSignal(props.dark ?? false)
    const [hlColor, setHlColor] = createSignal('hl')
    return (
        <div style={{ width: `${props.width}px` }} data-testid="bar-frame">
            <PreviewBar
                kind={() => props.kind}
                name={() => props.name ?? 'quarterly-reading-notes.pdf'}
                icon={() => (props.kind === 'image' ? 'Image' : 'FileText')}
                currentPage={page}
                pageCount={() => 12}
                onGoToPage={setPage}
                zoom={zoom}
                onZoomBy={f => setZoom(z => z * f)}
                onFit={() => setZoom(1)}
                annotReady={() => props.ready ?? true}
                drawMode={draw}
                onToggleDraw={() => setDraw(v => !v)}
                highlightArmed={armed}
                onHighlight={() => setArmed(v => !v)}
                highlightColor={hlColor}
                onHighlightColor={c => {
                    setHlColor(c)
                    setArmed(true)
                }}
                scratchOn={scratch}
                onToggleScratch={() => setScratch(v => !v)}
                darkOn={dark}
                onToggleDark={() => setDark(v => !v)}
                panelOpen={panel}
                onTogglePanel={() => setPanel(v => !v)}
                nativeActions={() => props.native ?? false}
                onOpenExternal={() => {}}
                imageSize={() => props.imageSize}
            />
        </div>
    )
}

const barOf = (root: HTMLElement) => root.querySelector('[data-viewbar]') as HTMLElement

/** The checks every shape shares: one spacing and nothing else, measured ink to ink (visible glyph
 *  to visible glyph, never box to box) — every neighbour pair within 1px of one another and of
 *  ~16.5px, with no wider gap anywhere — one glyph size, one icon box (every icon reserves
 *  the same unpainted `[ ]` room, so the box is the same whether the control is a toggle or a plain
 *  icon), all inside the band on one centre line, and a visible filename. `annotatePairs` is the number
 *  of adjacent-control pairs INSIDE the annotate group — 2 for highlight+draw+scratch (pdf), 0 for
 *  draw alone (image). */
function expectCalm(bar: HTMLElement, annotatePairs: number) {
    const p = probeBar(bar)
    expect(
        p.strayGaps,
        `ink gaps ${JSON.stringify(p.inkGaps)}: stray wide gaps ${JSON.stringify(p.seamGaps)}`,
    ).toEqual([])
    const said = `ink gaps ${JSON.stringify(p.inkGaps)}: want every gap ${WITHIN_INK_GAP}`
    if (p.withinGaps.length) expect(median(p.withinGaps), said).toBeCloseTo(WITHIN_INK_GAP, 0)
    expect(p.groupBoundaries, `wide gaps in ink gaps ${JSON.stringify(p.inkGaps)}`).toBe(0)
    expect(p.annotateGaps, `annotate within-group gaps in ink gaps ${JSON.stringify(p.inkGaps)}`).toBe(
        annotatePairs,
    )
    expect(p.glyphSizes, 'glyph sizes').toEqual(['12x12'])
    expect(p.iconHeights, 'icon-only heights').toHaveLength(1)
    expect(p.iconWidths.normal.length, 'normal icon widths').toBeLessThanOrEqual(1)
    expect(p.iconWidths.toggle.length, 'toggle icon widths').toBeLessThanOrEqual(1)
    expect(p.outside, 'controls outside the bar').toEqual([])
    expect(p.overlaps, 'overlapping controls').toEqual([])
    expect(p.maxCentreOffset, 'controls on the bar centre line').toBeLessThanOrEqual(1)
    // One tone family at rest: every unselected, enabled control paints --text-muted (icons, the
    // page readout, `100%`, and `fit`, whose brackets are unpainted at rest).
    expect(p.restTones, 'resting ink colours').toEqual([mutedColor(bar)])
    // One optical line: icon glyph centres and text x-height centres agree to within a pixel.
    expect(p.lineSpread, 'optical line spread').toBeLessThanOrEqual(OPTICAL_LINE_TOLERANCE)
    expect(p.crumbWidth, 'filename visible').toBeGreaterThan(0)
    return p
}

/** A freshly opened PDF at 100%: `p. 1 / 12` · `− 100% + FIT` · highlight draw scratch · bookmarks.
 *  Zero accent frames at rest (FIT is a one-shot, never selected) AND with any toggle on — the
 *  button family draws no border for a selected state (DESIGN.md: "states are colour and weight,
 *  nothing drawn"). SCRATCH on raises `selectedCount` to one, BOOKMARKS open to two, with frames
 *  staying at zero throughout. */
export const Pdf: Story = {
    render: () => <Harness width={1000} kind="pdf" />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const canvas = within(bar)
        const p = expectCalm(bar, 2)
        await expect(p.frames, 'accent frames at rest').toBe(0)
        await expect(p.selectedCount, 'selected controls at rest').toBe(0)
        const fit = canvas.getByLabelText('Fit width')
        await expect(fit.getAttribute('aria-pressed')).toBeNull()
        // `fit` is quiet: muted ink and unpainted brackets at rest, like every icon beside it.
        await expect(getComputedStyle(fit).color, 'fit ink').toBe(mutedColor(bar))
        await expect(getComputedStyle(fit, '::before').visibility, 'fit [ at rest').toBe('hidden')
        await expect(getComputedStyle(fit, '::after').visibility, 'fit ] at rest').toBe('hidden')

        // Draw shows its live combo: the button names the catalog id; TooltipHost renders the Kbd.
        const draw = canvas.getByLabelText('Draw')
        await expect(draw.getAttribute('data-tooltip-keybinding')).toBe('toggle-draw-mode')
        await expect(draw.getAttribute('data-tooltip')).toBe('Draw')
        await fireEvent.pointerEnter(draw)
        await fireEvent.mouseOver(draw)
        const tip = document.querySelector('[data-tooltip-host] [data-kbd], [data-kbd]')
        if (tip) await expect(tip.textContent?.length).toBeGreaterThan(0)

        const scratch = canvas.getByLabelText('Scratch paper')
        await fireEvent.click(scratch)
        await waitFor(() => expect(scratch.getAttribute('aria-pressed')).toBe('true'))
        await expect(probeBar(bar).frames, 'accent frames, scratch on').toBe(0)
        await expect(probeBar(bar).selectedCount, 'scratch on').toBe(1)
        const bookmarks = canvas.getByLabelText('Bookmarks')
        await fireEvent.click(bookmarks)
        await waitFor(() => expect(bookmarks.getAttribute('aria-pressed')).toBe('true'))
        await expect(probeBar(bar).frames, 'accent frames, scratch on + bookmarks open').toBe(0)
        await expect(probeBar(bar).selectedCount, 'scratch on + bookmarks open').toBe(2)
        // Toggling on never moves anything: no frame is drawn, so nothing shifts.
        expectCalm(bar, 2)
        await fireEvent.click(scratch)
        await fireEvent.click(bookmarks)
        await waitFor(() => expect(probeBar(bar).selectedCount).toBe(0))
        await expect(probeBar(bar).frames).toBe(0)
    },
}

const menuOf = () => document.querySelector<HTMLElement>('.bismuth-popover')

/** Right-clicking HIGHLIGHT opens its colour menu at the cursor: five named rows, each with a small
 *  swatch, the current colour marked. The bar itself gains nothing, so its rhythm and its
 *  nothing-selected-at-rest rule are untouched. A pick closes the menu, arms highlight and the
 *  button's tooltip names the new colour (in PreviewView a pick with text selected highlights it
 *  at once instead). */
export const PdfHighlightColorMenu: Story = {
    render: () => <Harness width={1000} kind="pdf" />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        expectCalm(bar, 2)
        const hl = within(bar).getByLabelText('Highlight text')
        await expect(hl.getAttribute('data-tooltip')).toContain('yellow')
        // the glyph is drawn in the current colour: yellow now (red and green high, blue low)
        // a color-mix() computes to `color(srgb r g b)` in 0..1, so scale that form to 0..255
        const ink = () => {
            const c = getComputedStyle(hl.querySelector('svg')!).color
            const n = c.match(/[\d.]+/g)!.map(Number)
            return c.startsWith('color(') ? n.map(v => v * 255) : n
        }
        await expect(ink()[2]!).toBeLessThan(ink()[0]! - 40)
        const r = hl.getBoundingClientRect()
        await fireEvent.contextMenu(hl, { clientX: r.left + 4, clientY: r.bottom })
        const menu = await waitFor(() => {
            const el = menuOf()
            if (!el) throw new Error('menu not open')
            return el
        })
        const rows = Array.from(menu.querySelectorAll<HTMLElement>('.bismuth-popover-row'))
        await expect(rows).toHaveLength(5)
        await expect(rows[0]!.textContent).toContain('yellow')
        await expect(rows[0]!.textContent).toContain('current')
        const sw = rows[2]!.querySelector('.bismuth-popover-prefix > *') as HTMLElement
        await expect(getComputedStyle(sw).backgroundColor).toBe('rgb(116, 192, 252)')
        await expect(Math.round(sw.getBoundingClientRect().width)).toBe(6)
        await fireEvent.click(rows[2]!)
        await waitFor(() => expect(menuOf()).toBeNull())
        await expect(hl.getAttribute('aria-pressed')).toBe('true')
        await expect(hl.getAttribute('data-tooltip')).toContain('blue')
        // ...and blue once blue is picked
        await waitFor(() => expect(ink()[2]!).toBeGreaterThan(ink()[0]! + 40))
    },
}

/** The colour menu left open, for looking at. */
export const PdfHighlightColorMenuOpen: Story = {
    render: () => (
        <div style={{ height: '200px' }}>
            <Harness width={1000} kind="pdf" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const hl = within(barOf(canvasElement)).getByLabelText('Highlight text')
        const r = hl.getBoundingClientRect()
        await fireEvent.contextMenu(hl, { clientX: r.left + 4, clientY: r.bottom })
        await waitFor(() => expect(menuOf()).not.toBeNull())
    },
}

/** Before the sidecar has loaded the three annotate toggles are DISABLED, and a disabled control reads
 *  as one: `--faint` ink, no opacity (the button family's one disabled recipe). They once painted
 *  as enabled, indistinguishable from the live ones (wave-1 cascade bug: a selected/unselected rule
 *  outranked the disabled one). The enabled neighbours (zoom) keep their own ink as the contrast. */
export const NotReady: Story = {
    render: () => <Harness width={1000} kind="pdf" ready={false} />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const probe = document.createElement('span')
        probe.style.color = 'var(--faint)'
        bar.appendChild(probe)
        const faint = getComputedStyle(probe).color
        probe.style.color = 'var(--text-muted)'
        const muted = getComputedStyle(probe).color
        probe.remove()
        await expect(faint).not.toBe(muted)
        for (const label of ['Highlight text', 'Draw', 'Scratch paper']) {
            const btn = within(bar).getByLabelText(label) as HTMLButtonElement
            await expect(btn.disabled, `${label} disabled`).toBe(true)
            await expect(getComputedStyle(btn).color, `${label} ink`).toBe(faint)
            await expect(getComputedStyle(btn).opacity, `${label} opacity`).toBe('1')
        }
        // ...while an enabled neighbour keeps its own ink, so the three above are not simply the
        // bar's resting colour.
        const zoomIn = within(bar).getByLabelText('Zoom in')
        await expect(getComputedStyle(zoomIn).color).not.toBe(faint)
    },
}

/** Draw, scratch and bookmarks all on: zero accent frames (the button family draws none for a
 *  selected state), three selected controls, same boxes, same gaps. */
export const PdfModesOn: Story = {
    render: () => <Harness width={1000} kind="pdf" draw scratch panel />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const p = expectCalm(bar, 2)
        await expect(p.frames, 'accent frames').toBe(0)
        await expect(p.selectedCount).toBe(3)
        for (const label of ['Draw', 'Scratch paper', 'Bookmarks']) {
            await expect(within(bar).getByLabelText(label).getAttribute('aria-pressed')).toBe('true')
        }
        await expect(within(bar).getByLabelText('Highlight text').getAttribute('aria-pressed')).toBe(
            'false',
        )
    },
}

/** Dark mode on: the moon is the one selected control, in its own group after the annotate
 *  tools, and pressing it turns it off again. */
export const PdfDarkOn: Story = {
    render: () => <Harness width={1000} kind="pdf" dark />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const moon = within(bar).getByLabelText('Dark mode')
        await expect(moon.getAttribute('aria-pressed')).toBe('true')
        await expect(probeBar(bar).selectedCount).toBe(1)
        await expect(probeBar(bar).frames).toBe(0)
        await fireEvent.click(moon)
        await waitFor(() => expect(moon.getAttribute('aria-pressed')).toBe('false'))
        await expect(probeBar(bar).selectedCount).toBe(0)
    },
}

/** The lead's minimum is the clamped lead measured directly and respects the consumer floor: at
 *  370 and 380px the PDF trail ends inside the bar. */
const trailInside = (width: number): Story => ({
    render: () => <Harness width={width} kind="pdf" native />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        await new Promise(r => setTimeout(r, 300))
        const barRight = bar.getBoundingClientRect().right
        for (const el of bar.querySelectorAll<HTMLElement>('button, [data-bar-overflow]')) {
            if (el.closest('[data-bar-hidden]') || !el.getBoundingClientRect().width) continue
            await expect(el.getBoundingClientRect().right, el.getAttribute('aria-label') ?? '')
                .toBeLessThanOrEqual(barRight + 1)
        }
    },
})
export const PdfNative370: Story = trailInside(370)
export const PdfNative380: Story = trailInside(380)

/** An image: the same zoom group, DRAW toggle and file-actions group as a PDF, in the same places —
 *  and nothing PDF-only (no page readout, highlight, scratch or bookmarks). */
export const Image: Story = {
    render: () => <Harness width={1000} kind="image" name="whiteboard-2026-09-15.png" native />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const canvas = within(bar)
        const p = expectCalm(bar, 0)
        await expect(p.frames).toBe(0)
        // The annotate + file-actions groups are the two wrappers stories actually query by
        // testid (probeBar itself reads controls by aria-label/rect, never these).
        const annotate = bar.querySelector('[data-testid="preview-annotate"]') as HTMLElement
        const fileActions = bar.querySelector('[data-testid="preview-file-actions"]') as HTMLElement
        await expect(annotate.querySelector('[aria-label="Draw"]')).toBeInTheDocument()
        await expect(fileActions.querySelector('[aria-label="Open in default app"]')).toBeInTheDocument()
        await expect(canvas.getByLabelText('Draw')).toBeInTheDocument()
        await expect(canvas.getByLabelText('Open in default app')).toBeInTheDocument()
        await expect(canvas.getByLabelText('Reveal in file manager')).toBeInTheDocument()
        for (const label of ['Zoom out', 'Zoom in', 'Fit width']) {
            await expect(canvas.getByLabelText(label)).toBeInTheDocument()
        }
        for (const label of ['Highlight text', 'Scratch paper', 'Bookmarks']) {
            await expect(canvas.queryByLabelText(label)).toBeNull()
        }
        await expect(bar.querySelector('[data-testid="page-readout"]')).toBeNull()
        // No natural size known → no readouts region at all (image-size readout is the only
        // thing that region ever holds for an image).
        await expect(bar.querySelector('[data-testid="vb-readouts"]')).toBeNull()

        // The image bar's Draw button actually works — no test previously pressed it.
        const draw = canvas.getByLabelText('Draw')
        await expect(draw.getAttribute('aria-pressed')).toBe('false')
        await fireEvent.click(draw)
        await waitFor(() => expect(draw.getAttribute('aria-pressed')).toBe('true'))
        await expect(probeBar(bar).frames, 'accent frames, draw on').toBe(0)
        await expect(probeBar(bar).selectedCount, 'draw on').toBe(1)
        await fireEvent.click(draw)
        await waitFor(() => expect(draw.getAttribute('aria-pressed')).toBe('false'))
        await expect(probeBar(bar).frames, 'accent frames, draw off').toBe(0)
        await expect(probeBar(bar).selectedCount, 'draw off').toBe(0)
    },
}

/** An image whose natural pixel size is known: `W × H` in the readouts region (the same slot the
 *  PDF page readout occupies), muted like every other readout, dropping at bar-drop level 2. */
export const ImageWithSize: Story = {
    render: () => (
        <Harness
            width={1000}
            kind="image"
            name="whiteboard-2026-09-15.png"
            imageSize={{ w: 1600, h: 900 }}
        />
    ),
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        expectCalm(bar, 0)
        const readouts = bar.querySelector('[data-testid="vb-readouts"]') as HTMLElement
        await expect(readouts).toBeInTheDocument()
        const label = within(readouts).getByText('1600 × 900')
        await expect(label.closest('[data-bar-drop]')?.getAttribute('data-bar-drop')).toBe('2')

        // Muted like every other readout: the same colour a probe resolves --text-muted to.
        const probe = document.createElement('span')
        probe.style.color = 'var(--text-muted)'
        readouts.appendChild(probe)
        const expectedColor = getComputedStyle(probe).color
        probe.remove()
        await expect(getComputedStyle(label).color).toBe(expectedColor)
        // ...and on the same optical line as the icons beside it (it is not a control, so the
        // bar probe does not read it).
        const zoomOut = within(bar).getByLabelText('Zoom out')
        await expect(
            Math.abs(opticalCentre(label as HTMLElement) - opticalCentre(zoomOut)),
            'W × H against the icon line',
        ).toBeLessThanOrEqual(OPTICAL_LINE_TOLERANCE)
    },
}

/** A 320px pane with the desktop app's file actions: the fit rule drops the file actions, the zoom
 *  steps and the page readout; FIT, highlight draw scratch and bookmarks stay in ONE row beside an
 *  ellipsized filename. */
export const Narrow: Story = {
    render: () => <Harness width={320} kind="pdf" native />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const canvas = within(bar)
        // The fit rule measures after layout: wait for it to hide level 4 (and 2) before measuring.
        await waitFor(() =>
            expect(bar.querySelectorAll('[data-bar-hidden]').length, 'fit settled').toBeGreaterThan(0),
        )
        // 3 seams, not 2: fit | annotate | bookmarks as before, plus bookmarks | [≡]. The trigger is
        // the trail's last control and sits one seam (~24.7px ink to ink) after bookmarks, so the
        // two-distance rule holds: every gap is ~16.7 (inside a group) or ~24.5 (a seam).
        const p = expectCalm(bar, 2)
        await expect(p.frames).toBe(0)
        await expect(bar.getBoundingClientRect().height).toBeCloseTo(36, 0)
        const title = bar.querySelector('[data-testid="crumb-title"]') as HTMLElement
        await expect(getComputedStyle(title).textOverflow).toBe('ellipsis')
        await expect(title.scrollWidth).toBeGreaterThan(title.clientWidth)
        for (const label of ['Zoom in', 'Zoom out', 'Open in default app', 'Reveal in file manager']) {
            await expect(canvas.getByLabelText(label).getClientRects().length, label).toBe(0)
        }
        await expect(
            (bar.querySelector('[data-testid="page-readout"]') as HTMLElement).getClientRects()
                .length,
        ).toBe(0)
        for (const label of ['Fit width', 'Highlight text', 'Draw', 'Scratch paper', 'Bookmarks']) {
            await expect(canvas.getByLabelText(label).getClientRects().length, label).toBeGreaterThan(0)
        }

        // Below ViewBar.module.css's 430px floor tier the lead would otherwise become a masked scroller
        // (`.viewbar .vb-lead { mask-image: linear-gradient(...) }`) — the wrong look for a bar
        // whose lead only ever ellipsizes, never overflows. This bar's own override
        // (`.bar:global(.viewbar) :global(.vb-lead)`, three classes) must win on specificity, not
        // just on load order, or the fade silently comes back.
        const lead = bar.querySelector('[data-testid="vb-lead"]') as HTMLElement
        await expect(getComputedStyle(lead).maskImage).toBe('none')
    },
}

/** A 480px pane (the trail lost its to-markdown glyph, so 500px now holds the zoom steps) where the full trail plus the filename's 7ch minimum does not fit: the level-4 elements
 *  (zoom steps, dark mode, the file actions) are dropped for fit (`data-bar-hidden`)
 *  and `More controls` is the trail's last control. Opening it lists them, and a toggle pressed in
 *  the panel is the real one: dark mode turns on. Those assertions need ui/ViewBar's fit-driven drop
 *  (the pdf-bar-redesign overflow task): they read `data-bar-hidden` and the `More controls` label. */
export const PdfNarrowOverflow: Story = {
    render: () => <Harness width={480} kind="pdf" native />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const level4 = Array.from(bar.querySelectorAll<HTMLElement>('[data-bar-drop="4"]'))
        await expect(level4.length, 'level-4 elements').toBeGreaterThan(0)
        // The fit rule measures after layout (a ResizeObserver): wait for it to settle.
        await waitFor(() =>
            expect(level4.every(el => el.hasAttribute('data-bar-hidden')), 'level 4 hidden').toBe(true),
        )
        for (const el of level4) {
            await expect(el.hasAttribute('data-bar-hidden'), 'level-4 element hidden').toBe(true)
        }
        const more = within(bar).getByLabelText('More controls')
        const trail = bar.querySelector('[data-testid="vb-trail"]') as HTMLElement
        await expect(trail.lastElementChild, 'More controls is the trail last child').toBe(more)
        // What does not drop at this width stays put.
        for (const label of ['Fit width', 'Highlight text', 'Draw', 'Scratch paper', 'Bookmarks']) {
            await expect(within(bar).getByLabelText(label).getClientRects().length, label).toBeGreaterThan(0)
        }
        await fireEvent.click(more)
        const dark = await waitFor(() => {
            const el = within(document.body).getByLabelText('Dark mode')
            if (!el.getClientRects().length) throw new Error('dark mode not shown in the panel')
            return el
        })
        // One row per label, in bar order: zoom, dark mode, file. The file actions share one row.
        const panel = dark.closest('[data-popover]') as HTMLElement
        // No tooltip over the panel (focus rests on the rows, not a control), the panel sits inside
        // the bar's right edge, and every plain icon in it rests muted like its bar neighbours.
        await expect(document.querySelector('[data-tooltip-bubble]'), 'tooltip over the panel').toBeNull()
        await expect(panel.getBoundingClientRect().right, 'panel inside the bar').toBeLessThanOrEqual(
            bar.getBoundingClientRect().right + 1,
        )
        const zoomOut = within(panel).getByLabelText('Zoom out')
        for (const l of ['Open in default app', 'Reveal in file manager']) {
            await expect(getComputedStyle(within(panel).getByLabelText(l)).color, l).toBe(
                getComputedStyle(zoomOut).color,
            )
        }
        const rowLabels = Array.from(panel.querySelectorAll('[data-bar-menu-label]')).map(e =>
            e.getAttribute('data-bar-menu-label'),
        )
        await expect(new Set(rowLabels).size, `labels in the panel ${rowLabels}`).toBe(3)
        const fileLabel = within(panel).getByText('file')
        await expect(within(panel).getAllByText('file').length, 'one file row').toBe(1)
        const fileRow = fileLabel.parentElement as HTMLElement
        for (const l of ['Open in default app', 'Reveal in file manager']) {
            await expect(within(fileRow).getByLabelText(l), l).toBeTruthy()
        }
        await expect(dark.getAttribute('aria-pressed')).toBe('false')
        await fireEvent.click(dark)
        await waitFor(() => expect(dark.getAttribute('aria-pressed')).toBe('true'))
        await expect(dark.getAttribute('data-state'), 'moon shows selected').toBe('selected')
    },
}

/** ~800px: the full trail and the filename fit with room to spare, so nothing is dropped and there
 *  is no `More controls`. Needs the fit-driven drop (the overflow task): before it merges, the old
 *  fixed breakpoints still hide the level-4 elements at this width. */
export const PdfNarrowFits: Story = {
    render: () => <Harness width={800} kind="pdf" native />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        await expect(bar.querySelectorAll('[data-bar-hidden]').length, 'hidden elements').toBe(0)
        await expect(within(bar).queryByLabelText('More controls')).toBeNull()
        for (const label of ['Zoom in', 'Dark mode', 'Open in default app']) {
            await expect(within(bar).getByLabelText(label).getClientRects().length, label).toBeGreaterThan(0)
        }
        const p = probeBar(bar)
        await expect(p.crumbWidth, 'filename visible').toBeGreaterThan(0)
    },
}

/** The full desktop PDF bar: the file actions are icon-only, one ink between them, and the
 *  fourth group boundary. */
export const WithNativeActions: Story = {
    render: () => <Harness width={1000} kind="pdf" native />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const p = expectCalm(bar, 2)
        await expect(p.frames).toBe(0)
        const open = within(bar).getByLabelText('Open in default app')
        const zoomIn = within(bar).getByLabelText('Zoom in')
        // icon-only: no words, and its `[ ]` (IconButton `bracketRoom`) hold an off toggle's room
        // without painting — a plain icon never reads as ON
        await expect(open.textContent?.replace(/[[\]]/g, '').trim()).toBe('')
        const marks = Array.from(open.querySelectorAll<HTMLElement>('[aria-hidden="true"]')).filter(
            m => /^[[\]]$/.test(m.textContent ?? ''),
        )
        await expect(marks.map(m => getComputedStyle(m).visibility)).toEqual(['hidden', 'hidden'])
        await expect(open.getAttribute('data-tooltip')).toBe('Open in default app')
        // a plain icon (Button `normal`), same ink as the other plain icons: not louder than zoom
        await expect(getComputedStyle(open).color).toBe(getComputedStyle(zoomIn).color)
    },
}

/** Code/text: not `inkable()`, so `config` renders nothing at all — no zoom, no annotate, no
 *  readout. Only identity + (when native) file actions. Zero group boundaries: the file-actions
 *  group is the only thing in the trail, so there is no OTHER group for its leading edge to
 *  read as a crumb-gap against. */
export const Code: Story = {
    render: () => <Harness width={1000} kind="code" name="server.ts" native />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const canvas = within(bar)
        const p = expectCalm(bar, 0)
        await expect(p.frames).toBe(0)
        await expect(canvas.getByLabelText('Open in default app')).toBeInTheDocument()
        await expect(canvas.getByLabelText('Reveal in file manager')).toBeInTheDocument()
        for (const label of [
            'Draw',
            'Zoom in',
            'Zoom out',
            'Fit width',
            'Highlight text',
            'Scratch paper',
            'Bookmarks',
        ]) {
            await expect(canvas.queryByLabelText(label)).toBeNull()
        }
        await expect(bar.querySelector('[data-testid="page-readout"]')).toBeNull()
    },
}

/** External (an unrecognised binary — a zip, say): the exact same shape as Code. Neither kind is
 *  `inkable()`, so there is nothing view-specific for either to render; only Code and External
 *  differ in which files reach them, never in what the bar shows. */
export const External: Story = {
    render: () => <Harness width={1000} kind="external" name="archive.zip" native />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const canvas = within(bar)
        const p = expectCalm(bar, 0)
        await expect(p.frames).toBe(0)
        await expect(canvas.getByLabelText('Open in default app')).toBeInTheDocument()
        await expect(canvas.getByLabelText('Reveal in file manager')).toBeInTheDocument()
        for (const label of [
            'Draw',
            'Zoom in',
            'Zoom out',
            'Fit width',
            'Highlight text',
            'Scratch paper',
            'Bookmarks',
        ]) {
            await expect(canvas.queryByLabelText(label)).toBeNull()
        }
    },
}
