// app/src/preview/PreviewBar.stories.tsx
// Visual + behavioural spec for <PreviewBar> — the preview tab's view bar for images and PDFs. Every
// play() probes what a person sees (ui/_previewBarAssertions.ts): the gaps between adjacent
// controls are only the bar's two spacing tokens (icon-gap inside a group, including the annotate
// group; crumb-gap between groups), the number of accent frames, one glyph size and one icon box,
// and nothing leaving the 36px band.
import { createSignal, type JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import PreviewBar, { type PreviewBarProps } from './PreviewBar'
import { probeBar } from '../ui/_previewBarAssertions'

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
    imageSize?: { w: number; h: number }
}

/** A live bar: every toggle flips its own signal, so a play() can press it and read the result. */
function Harness(props: HarnessProps): JSX.Element {
    const [page, setPage] = createSignal(0)
    const [zoom, setZoom] = createSignal(1)
    const [draw, setDraw] = createSignal(props.draw ?? false)
    const [armed, setArmed] = createSignal(false)
    const [scratch, setScratch] = createSignal(props.scratch ?? false)
    const [panel, setPanel] = createSignal(props.panel ?? false)
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
                annotReady={() => true}
                drawMode={draw}
                onToggleDraw={() => setDraw(v => !v)}
                highlightArmed={armed}
                onHighlight={() => setArmed(v => !v)}
                scratchOn={scratch}
                onToggleScratch={() => setScratch(v => !v)}
                drawKey={() => 'Mod+Shift+D'}
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

/** The checks every shape shares: two spacings and nothing else (`--bar-icon-gap` inside a group,
 *  including the annotate group; `--bar-crumb-gap` between groups), one glyph size, one icon box,
 *  all inside the band on one centre line, and a visible filename. `annotatePairs` is the number
 *  of adjacent-control pairs INSIDE the annotate group — 2 for highlight+draw+scratch (pdf), 0 for
 *  draw alone (image). */
function expectCalm(bar: HTMLElement, groups: number, annotatePairs: number) {
    const p = probeBar(bar)
    expect(p.strayGaps, `gaps ${JSON.stringify(p.gaps)}`).toEqual([])
    expect(p.groupBoundaries, `group boundaries in ${JSON.stringify(p.gaps)}`).toBe(groups)
    expect(p.annotateGaps, `annotate within-group gaps in ${JSON.stringify(p.gaps)}`).toBe(
        annotatePairs,
    )
    expect(p.glyphSizes, 'glyph sizes').toEqual(['12x12'])
    expect(p.iconBoxes, 'icon-only boxes').toHaveLength(1)
    expect(p.outside, 'controls outside the bar').toEqual([])
    expect(p.overlaps, 'overlapping controls').toEqual([])
    expect(p.maxCentreOffset, 'controls on the bar centre line').toBeLessThanOrEqual(1)
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
        const p = expectCalm(bar, 3, 2)
        await expect(p.frames, 'accent frames at rest').toBe(0)
        await expect(p.selectedCount, 'selected controls at rest').toBe(0)
        const fit = canvas.getByLabelText('Fit width')
        await expect(fit.getAttribute('aria-pressed')).toBeNull()

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
        expectCalm(bar, 3, 2)
        await fireEvent.click(scratch)
        await fireEvent.click(bookmarks)
        await waitFor(() => expect(probeBar(bar).selectedCount).toBe(0))
        await expect(probeBar(bar).frames).toBe(0)
    },
}

/** Draw, scratch and bookmarks all on: zero accent frames (the button family draws none for a
 *  selected state), three selected controls, same boxes, same gaps. */
export const PdfModesOn: Story = {
    render: () => <Harness width={1000} kind="pdf" draw scratch panel />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const p = expectCalm(bar, 3, 2)
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

/** An image: the same DRAW toggle and the same file-actions group as a PDF, in the same places —
 *  and nothing PDF-only (no readout, zoom, highlight, scratch or bookmarks). */
export const Image: Story = {
    render: () => <Harness width={1000} kind="image" name="whiteboard-2026-09-15.png" native />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const canvas = within(bar)
        const p = expectCalm(bar, 1, 0)
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
        for (const label of ['Zoom in', 'Fit width', 'Highlight text', 'Scratch paper', 'Bookmarks']) {
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
        expectCalm(bar, 0, 0)
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
    },
}

/** A 320px pane with the desktop app's file actions: the ladder drops the file actions, the zoom
 *  steps and the page readout; FIT, highlight draw scratch and bookmarks stay in ONE row beside an
 *  ellipsized filename. */
export const Narrow: Story = {
    render: () => <Harness width={320} kind="pdf" native />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const canvas = within(bar)
        const p = expectCalm(bar, 2, 2)
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

        // Below ui.css's 430px floor tier the lead would otherwise become a masked scroller
        // (`.viewbar .vb-lead { mask-image: linear-gradient(...) }`) — the wrong look for a bar
        // whose lead only ever ellipsizes, never overflows. This bar's own override
        // (`.bar:global(.viewbar) :global(.vb-lead)`, three classes) must win on specificity, not
        // just on load order, or the fade silently comes back.
        const lead = bar.querySelector('[data-testid="vb-lead"]') as HTMLElement
        await expect(getComputedStyle(lead).maskImage).toBe('none')
    },
}

/** The full desktop PDF bar: the file actions are icon-only, muted like every other glyph, and the
 *  fourth group boundary. */
export const WithNativeActions: Story = {
    render: () => <Harness width={1000} kind="pdf" native />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const p = expectCalm(bar, 4, 2)
        await expect(p.frames).toBe(0)
        const open = within(bar).getByLabelText('Open in default app')
        const draw = within(bar).getByLabelText('Draw')
        await expect(open.textContent?.trim()).toBe('')
        await expect(open.getAttribute('title')).toBe('Open in default app')
        await expect(getComputedStyle(open).color).toBe(getComputedStyle(draw).color)
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
        const p = expectCalm(bar, 0, 0)
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
        const p = expectCalm(bar, 0, 0)
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
