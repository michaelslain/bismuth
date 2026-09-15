// app/src/preview/PreviewBar.stories.tsx
// Visual + behavioural spec for <PreviewBar> — the preview tab's view bar for images and PDFs. Every
// play() probes what a person sees (ui/_previewBarAssertions.ts): the gaps between adjacent
// controls are only the bar's two spacing tokens, the number of accent frames, one glyph size and
// one icon box, and nothing leaving the 36px band.
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
            />
        </div>
    )
}

const barOf = (root: HTMLElement) => root.querySelector('[data-viewbar]') as HTMLElement

/** The checks every shape shares: two spacings only, one glyph size, one icon box, all inside the
 *  band on one centre line, and a visible filename. */
function expectCalm(bar: HTMLElement, groups: number) {
    const p = probeBar(bar)
    expect(p.strayGaps, `gaps ${JSON.stringify(p.gaps)}`).toEqual([])
    expect(p.groupBoundaries, `group boundaries in ${JSON.stringify(p.gaps)}`).toBe(groups)
    expect(p.glyphSizes, 'glyph sizes').toEqual(['13x13'])
    expect(p.iconBoxes, 'icon-only boxes').toHaveLength(1)
    expect(p.outside, 'controls outside the bar').toEqual([])
    expect(p.overlaps, 'overlapping controls').toEqual([])
    expect(p.maxCentreOffset, 'controls on the bar centre line').toBeLessThanOrEqual(1)
    expect(p.crumbWidth, 'filename visible').toBeGreaterThan(0)
    return p
}

/** A freshly opened PDF at 100%: `p. 1 / 12` · `− 100% + FIT` · highlight draw scratch · bookmarks.
 *  Zero accent frames at rest (FIT is a one-shot, never selected). Then SCRATCH on paints exactly
 *  one frame, BOOKMARKS open exactly one more. */
export const Pdf: Story = {
    render: () => <Harness width={1000} kind="pdf" />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const canvas = within(bar)
        const p = expectCalm(bar, 3)
        await expect(p.frames, 'accent frames at rest').toBe(0)
        const fit = canvas.getByLabelText('Fit width')
        await expect(fit.getAttribute('aria-pressed')).toBeNull()

        const scratch = canvas.getByLabelText('Scratch paper')
        await fireEvent.click(scratch)
        await waitFor(() => expect(scratch.getAttribute('aria-pressed')).toBe('true'))
        await expect(probeBar(bar).frames, 'scratch on').toBe(1)
        const bookmarks = canvas.getByLabelText('Bookmarks')
        await fireEvent.click(bookmarks)
        await waitFor(() => expect(bookmarks.getAttribute('aria-pressed')).toBe('true'))
        await expect(probeBar(bar).frames, 'scratch on + bookmarks open').toBe(2)
        // Toggling on never moves anything: the frame is a border every state reserves.
        expectCalm(bar, 3)
        await fireEvent.click(scratch)
        await fireEvent.click(bookmarks)
        await waitFor(() => expect(probeBar(bar).frames).toBe(0))
    },
}

/** Draw, scratch and bookmarks all on: exactly three frames, same boxes, same gaps. */
export const PdfModesOn: Story = {
    render: () => <Harness width={1000} kind="pdf" draw scratch panel />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const p = expectCalm(bar, 3)
        await expect(p.frames).toBe(3)
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
        const p = expectCalm(bar, 1)
        await expect(p.frames).toBe(0)
        await expect(canvas.getByLabelText('Draw')).toBeInTheDocument()
        await expect(canvas.getByLabelText('Open in default app')).toBeInTheDocument()
        await expect(canvas.getByLabelText('Reveal in file manager')).toBeInTheDocument()
        for (const label of ['Zoom in', 'Fit width', 'Highlight text', 'Scratch paper', 'Bookmarks']) {
            await expect(canvas.queryByLabelText(label)).toBeNull()
        }
        await expect(bar.querySelector('[data-testid="page-readout"]')).toBeNull()
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
        const p = expectCalm(bar, 2)
        await expect(p.frames).toBe(0)
        await expect(bar.getBoundingClientRect().height).toBeCloseTo(36, 0)
        const title = bar.querySelector('.crumb b') as HTMLElement
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
    },
}

/** The full desktop PDF bar: the file actions are icon-only, muted like every other glyph, and the
 *  fourth group boundary. */
export const WithNativeActions: Story = {
    render: () => <Harness width={1000} kind="pdf" native />,
    play: async ({ canvasElement }) => {
        const bar = barOf(canvasElement)
        const p = expectCalm(bar, 4)
        await expect(p.frames).toBe(0)
        const open = within(bar).getByLabelText('Open in default app')
        const draw = within(bar).getByLabelText('Draw')
        await expect(open.textContent?.trim()).toBe('')
        await expect(open.getAttribute('title')).toBe('Open in default app')
        await expect(getComputedStyle(open).color).toBe(getComputedStyle(draw).color)
    },
}
