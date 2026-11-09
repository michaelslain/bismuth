// Visual spec for <BookView> — the book base's pane. Page images are canvases drawn here and served
// through a patched `api.assetUrl` as data URLs, so a story needs no files; the PDF is a repo
// fixture. The bar slots the view pushes up are drawn in a ViewBar above the pane, as BaseView
// does. `data-turn-state` on the view's root is the settled seam.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, Show } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { pickRead, readRow, readState } from './_readModePick'
import { ToastHost } from '../ui/ToastHost'
import { api, setTransport, type Transport } from '../api'
import { settings, setSettings } from '../settings'
import { toasts } from '../ui/toastStore'
import { fakeTransport } from '../ui/_fakeTransport'
import { AppError } from '../../../core/src/error'
import { inkSidecarFor } from '../../../core/src/fileKinds'
import ViewBar, { Crumb, type ViewBarSlots } from '../ui/ViewBar'
import pdfFixtureUrl from '../../../core/test/drawing/fixtures/pdfkit-highlights.pdf?url'
import type { Row, ViewConfig } from '../../../core/src/bases/types'
import BookView from './BookView'
import { start as startServerVersion } from '../serverVersion'
import type { TranscriptionController } from './transcription'
import { fakeTranscribe, type FakeOptions, type FakeTranscription } from './_transcriptionFake'
import { bookPage, bookPageUrl } from './_bookPages'
import { darkRgb } from './darkPage'
import { ARTICLE_CHART, ARTICLE_PHOTO, buildArticlePdf } from '../preview/_articlePdf'
import { paneMenuItemsOf, withPaneItems } from '../paneMenuExtras'
import { ContextMenu } from '../ui/ContextMenu'

const meta = {
    title: 'Bases/BookView',
    component: BookView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof BookView>

export default meta
type Story = StoryObj<typeof meta>


/** A typeset book page as a PNG data URL. */
const pageImage = (n: number, landscape = false): string =>
    bookPageUrl(n, landscape ? { w: 400, h: 300 } : { w: 300, h: 400 })

const IMAGES = new Map<string, string>()
const PDF_PATH = 'scans/lecture.pdf'
const ARTICLE_PATH = 'articles/rivers.pdf'
const imagePath = (n: number) => `pages/page-${n}.png`

/** Serves the fixture pages through the real `api.assetUrl` seam; any other path 404s. */
function serveFixtures(count: number, landscape = false) {
    for (let n = 1; n <= count; n++) IMAGES.set(imagePath(n), pageImage(n, landscape))
    const original = api.assetUrl
    api.assetUrl = (target: string) =>
        IMAGES.get(target) ?? (target === PDF_PATH ? pdfFixtureUrl : '/book-fixture-missing.png')
    return () => {
        api.assetUrl = original
    }
}

function row(file: string, index?: number): Row {
    const name = file.split('/').pop()!
    return {
        file: {
            name,
            basename: name,
            path: `${file}.md`,
            folder: 'pages',
            ext: 'md',
            size: 64,
            ctime: 0,
            mtime: 0,
            tags: [],
            links: [],
        },
        note: { page: file },
        formula: {},
        index,
    }
}

const images = (n: number): Row[] => Array.from({ length: n }, (_, i) => row(imagePath(i + 1)))

const bookView = (over: Partial<ViewConfig> = {}): ViewConfig => ({ type: 'book', ...over }) as ViewConfig

/** The bar and the pane, sized like an editor pane. */
function Harness(props: { w: number; h?: number; basePath?: string; rows: Row[]; view?: ViewConfig; transcription?: TranscriptionController; onOuterMenu?: () => void }) {
    const [slots, setSlots] = createSignal<ViewBarSlots | undefined>()
    return (
        <div
            style={{ width: `${props.w}px`, height: `${props.h ?? 640}px`, display: 'flex', 'flex-direction': 'column' }}
            onContextMenu={() => props.onOuterMenu?.()}
        >
            <div data-testid="book-bar">
                <ViewBar
                    identity={<Crumb icon="BookOpen">notebook</Crumb>}
                    readouts={slots()?.readouts}
                    config={slots()?.config}
                    actions={slots()?.actions}
                />
            </div>
            <div style={{ flex: 1, 'min-height': 0 }}>
                <BookView
                    rows={props.rows}
                    basePath={props.basePath}
                    view={props.view ?? bookView()}
                    ownsRows
                    onChange={() => {}}
                    onBarSlots={setSlots}
                    transcription={props.transcription}
                />
            </div>
        </div>
    )
}

/** The text a person sees in the bar: the long variants only (BarLabel keeps both lengths in the DOM). */
const shown = (el: HTMLElement) => {
    const c = el.cloneNode(true) as HTMLElement
    c.querySelectorAll('[data-bar-abbr="short"]').forEach(n => n.remove())
    return c.textContent ?? ''
}
const readout = (root: HTMLElement) => {
    const n = within(root.querySelector<HTMLElement>('[data-testid="book-bar"]')!).queryByText(/^pp?\. \d/)
    return n ? shown(n) : undefined
}

const host = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-book]')!

const ready = async (root: HTMLElement, text: string) => {
    await waitFor(() => expect(readout(root)).toBe(text), { timeout: 8000 })
    await waitFor(() => expect(root.querySelector('[data-book-page="right"]')).not.toBeNull(), { timeout: 8000 })
    await waitFor(() => expect(host(root).hasAttribute('data-book-prefetched')).toBe(true), { timeout: 8000 })
}

/** Presses next `n` times with the real key and waits for the readout. */
async function pressNext(root: HTMLElement, n: number, expected: string) {
    for (let i = 0; i < n; i++) await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(readout(root)).toBe(expected), { timeout: 8000 })
    await waitFor(() => expect(host(root).dataset.turnState).toBe('settled'), { timeout: 8000 })
}

export const Empty: Story = {
    render: () => <Harness w={900} rows={[]} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('drop photos, scans or PDFs here')).toBeInTheDocument()
        await expect(c.getAllByText('+ pages').length).toBeGreaterThan(0)
    },
}

export const Cover: Story = {
    beforeEach: () => serveFixtures(6),
    render: () => <Harness w={900} rows={images(6)} />,
    play: async ({ canvasElement }) => ready(canvasElement, 'p. 1 / 6'),
}

export const Spread: Story = {
    beforeEach: () => serveFixtures(8),
    render: () => <Harness w={900} rows={images(8)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 8')
        await pressNext(canvasElement, 1, 'pp. 2–3 / 8')
    },
}

/** Scroll: every page in one column at the pane's width; the readout follows the page at the top,
 *  and `pages` turns from that page. */
export const ScrollMode: Story = {
    name: 'Scroll mode',
    beforeEach: () => serveFixtures(6),
    render: () => <Harness w={900} h={700} rows={images(6)} view={bookView({ bookMode: 'scroll' })} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelectorAll('[data-book-scroll-page]')).toHaveLength(6), { timeout: 8000 })
        await waitFor(() => expect(readout(canvasElement)).toBe('p. 1 / 6'), { timeout: 8000 })
        const col = canvasElement.querySelector<HTMLElement>('[data-book-scroll]')!
        const third = canvasElement.querySelector<HTMLElement>('[data-book-scroll-page="2"]')!
        col.scrollTop = third.offsetTop - col.offsetTop + 4
        col.dispatchEvent(new Event('scroll'))
        await waitFor(() => expect(readout(canvasElement)).toBe('p. 3 / 6'), { timeout: 8000 })
        await expect(await readState(canvasElement, 'scroll or flip')).toBe('scroll')
        await pickRead(canvasElement, 'scroll or flip', 'flip')
        await waitFor(() => expect(readout(canvasElement)).toBe('pp. 2–3 / 6'), { timeout: 8000 })
        await expect(canvasElement.querySelector('[data-book-scroll]')).toBeNull()
    },
}

/** 4:3 landscape photos: the pages take the photos' aspect, not a portrait slab. */
export const LandscapePages: Story = {
    name: 'Landscape pages',
    beforeEach: () => serveFixtures(8, true),
    render: () => <Harness w={1100} rows={images(8)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 8')
        await pressNext(canvasElement, 1, 'pp. 2–3 / 8')
        const r = canvasElement.querySelector('[data-book-page="right"]')!.getBoundingClientRect()
        await expect(r.width / r.height).toBeCloseTo(4 / 3, 1)
    },
}

export const Single: Story = {
    beforeEach: () => serveFixtures(8),
    render: () => <Harness w={900} rows={images(8)} view={bookView({ bookLayout: 'single' })} />,
    play: async ({ canvasElement }) => ready(canvasElement, 'p. 1 / 8'),
}

export const NarrowPane: Story = {
    beforeEach: () => serveFixtures(8),
    render: () => <Harness w={480} rows={images(8)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 8')
        expect(canvasElement.querySelector('[data-book-page="left"]')).toBeNull()
        // the bar drops its controls into [≡] before it squeezes the crumb to `n…`
        const title = canvasElement.querySelector<HTMLElement>('[data-bar-title]')!
        await waitFor(() => expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth), { timeout: 8000 })
    },
}

/** The bar holds icons; the layout is a row of the display
 *  panel. Choosing `single` there turns a wide pane's spreads into one page at a time. */
export const DisplayPanel: Story = {
    name: 'Display panel',
    beforeEach: () => serveFixtures(8),
    render: () => <Harness w={900} rows={images(8)} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await ready(canvasElement, 'p. 1 / 8')
        for (const name of ['highlight', 'bookmarks', 'add pages', 'display'])
            await expect(c.getByRole('button', { name })).toBeInTheDocument()
        await expect(c.queryByRole('button', { name: 'transcript' })).toBeNull()
        await expect(c.queryByText('spread')).toBeNull()
        await userEvent.click(c.getByRole('button', { name: 'display' }))
        const panel = await waitFor(() => {
            const el = document.querySelector<HTMLElement>('[data-bar-settings-panel]')
            expect(el).not.toBeNull()
            return el!
        })
        await expect(within(panel).getByText('layout')).toBeInTheDocument()
        await userEvent.click(within(panel).getByText('single'))
        await waitFor(() => expect(canvasElement.querySelector('[data-book-page="left"]')).toBeNull(), { timeout: 8000 })
        await userEvent.keyboard('{Escape}')
        await pressNext(canvasElement, 1, 'p. 2 / 8')
    },
}

export const OddCountEnd: Story = {
    beforeEach: () => serveFixtures(5),
    render: () => <Harness w={900} rows={images(5)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 5')
        await pressNext(canvasElement, 2, 'pp. 4–5 / 5')
    },
}

export const EvenCountEnd: Story = {
    beforeEach: () => serveFixtures(6),
    render: () => <Harness w={900} rows={images(6)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 6')
        await pressNext(canvasElement, 3, 'p. 6 / 6')
    },
}

/** The cover file is gone: a paper placeholder names it. */
export const MissingPage: Story = {
    beforeEach: () => serveFixtures(4),
    render: () => <Harness w={900} rows={[row('pages/lost scan.png'), ...images(4)]} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 5')
        await expect(within(canvasElement).getByText('missing: lost scan.png')).toBeInTheDocument()
    },
}

/** A missing page does not stop the book turning. */
export const MissingPageStillTurns: Story = {
    beforeEach: () => serveFixtures(4),
    render: () => <Harness w={900} rows={[row('pages/lost scan.png'), ...images(4)]} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 5')
        await pressNext(canvasElement, 1, 'pp. 2–3 / 5')
    },
}

export const TurnForwardByKey: Story = {
    beforeEach: () => serveFixtures(6),
    render: () => <Harness w={900} rows={images(6)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 6')
        await pressNext(canvasElement, 1, 'pp. 2–3 / 6')
    },
}

/** Pointer events straight at the book box, in the box's own pixels. */
function pointer(box: HTMLElement, type: string, x: number, y: number) {
    const r = box.getBoundingClientRect()
    box.dispatchEvent(
        new PointerEvent(type, {
            bubbles: true,
            pointerId: 7,
            button: 0,
            clientX: r.left + x,
            clientY: r.top + y,
        }),
    )
}
const frame = () => new Promise(r => requestAnimationFrame(() => r(null)))

async function dragFromRightEdge(root: HTMLElement, stops: number[]) {
    const box = root.querySelector<HTMLElement>('[data-book-spread]')!.parentElement!
    const w = box.getBoundingClientRect().width
    const y = box.getBoundingClientRect().height * 0.7
    pointer(box, 'pointerdown', w - 12, y)
    for (const f of stops) {
        pointer(box, 'pointermove', w * f, y)
        await frame()
    }
    pointer(box, 'pointerup', w * stops[stops.length - 1], y)
}

export const DragTurn: Story = {
    beforeEach: () => serveFixtures(6),
    render: () => <Harness w={900} rows={images(6)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 6')
        await dragFromRightEdge(canvasElement, [0.9, 0.8, 0.65, 0.5, 0.42])
        await waitFor(() => expect(readout(canvasElement)).toBe('pp. 2–3 / 6'), { timeout: 8000 })
    },
}

export const DragFallBack: Story = {
    beforeEach: () => serveFixtures(6),
    render: () => <Harness w={900} rows={images(6)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 6')
        await dragFromRightEdge(canvasElement, [0.9, 0.8, 0.7, 0.66])
        await waitFor(() => expect(host(canvasElement).dataset.turnState).toBe('settled'), { timeout: 8000 })
        await expect(readout(canvasElement)).toBe('p. 1 / 6')
    },
}

export const MixedImagesAndPdf: Story = {
    beforeEach: () => serveFixtures(3),
    render: () => <Harness w={900} rows={[row(imagePath(1)), row(PDF_PATH), row(imagePath(2)), row(imagePath(3))]} />,
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                const m = readout(canvasElement)?.match(/^p\. 1 \/ (\d+)$/)
                expect(m && Number(m[1])).toBeGreaterThanOrEqual(4)
            },
            { timeout: 8000 },
        )
    },
}

export const FullBook: Story = {
    name: 'Full book',
    beforeEach: () => withText(6),
    render: () => <Harness w={1100} h={720} rows={images(6)} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await ready(canvasElement, 'p. 1 / 6')
        await pressNext(canvasElement, 2, 'pp. 4–5 / 6')
        // every page has text: no transcript icon, no panel, no transcribe button
        await expect(c.queryByRole('button', { name: 'transcript' })).toBeNull()
        await expect(c.queryByText(/^text \/\//)).toBeNull()
        await expect(c.queryByText(/^transcribe \d+ pages?$/)).toBeNull()
        await expect((await readRow(canvasElement, 'text')).disabled).toBe(false)
    },
}

/** A fake transport that holds the story's PDF, answering a highlight edit with 409 PDF_NOT_WRITABLE when asked. */
let pdfBytes: Uint8Array | undefined
function pdfTransport(unwritable: boolean): Transport {
    const t = fakeTransport({ binaries: { [PDF_PATH]: pdfBytes!.slice() } })
    return {
        ...t,
        postJson: (path, body) =>
            unwritable && path === '/pdf/highlights'
                ? Promise.reject(new AppError('PDF_NOT_WRITABLE', 'This PDF cannot be rewritten', 409))
                : t.postJson(path, body),
    }
}
const withPdf = (unwritable: boolean) => async () => {
    pdfBytes ??= new Uint8Array(await (await fetch(pdfFixtureUrl)).arrayBuffer())
    setTransport(pdfTransport(unwritable))
    const unserve = serveFixtures(3)
    return () => {
        unserve()
        setTransport(fakeTransport())
    }
}
const pdfBookRows = () => [row(imagePath(1)), row(PDF_PATH), row(imagePath(2)), row(imagePath(3))]
const pdfPageOne = async () => (await api.pdfHighlights(PDF_PATH)).pages[0]?.length ?? 0

/** Turns to the first PDF leaf (left page of the second spread), arms `highlight` and drags on it. */
async function dragOnPdfLeaf(root: HTMLElement) {
    await waitFor(() => expect(readout(root)).toMatch(/^p\. 1 \/ \d+$/), { timeout: 8000 })
    await waitFor(() => expect(host(root).hasAttribute('data-book-prefetched')).toBe(true), { timeout: 8000 })
    await pressNext(root, 1, readout(root)!.replace(/^p\. 1/, 'pp. 2–3'))
    await annotationsReady(root)
    await userEvent.click(within(root).getByRole('button', { name: 'highlight' }))
    const layer = root.querySelector<HTMLElement>('[data-book-highlights]')!
    const lr = layer.getBoundingClientRect()
    const pr = root.querySelector<HTMLElement>('[data-book-page="left"]')!.getBoundingClientRect()
    // across the lower middle of the left page, clear of the fixture's own highlights at the top
    const at = (fx: number, fy: number): [number, number] => [pr.left - lr.left + pr.width * fx, pr.top - lr.top + pr.height * fy]
    dragOnLayer(root, at(0.25, 0.6), at(0.75, 0.7))
}

/** A box drawn on a PDF leaf lands in the PDF itself, and Mod+Z removes it from the PDF again. */
export const PdfHighlightWritesAndUndoes: Story = {
    name: 'PDF highlight writes and undoes',
    beforeEach: withPdf(false),
    render: () => <Harness w={1100} h={720} rows={pdfBookRows()} />,
    play: async ({ canvasElement }) => {
        const before = await pdfPageOne()
        await dragOnPdfLeaf(canvasElement)
        await waitFor(async () => expect(await pdfPageOne()).toBe(before + 1), { timeout: 8000 })
        pressUndo()
        await waitFor(async () => expect(await pdfPageOne()).toBe(before), { timeout: 8000 })
    },
}


/** A press and release at `el`'s centre, on the element under that point, as a real mouse sends
 *  them: pointerdown, pointerup, click. */
function clickOn(el: HTMLElement) {
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const under = (document.elementFromPoint(x, y) as HTMLElement | null) ?? el
    const at = { bubbles: true, clientX: x, clientY: y, button: 0 }
    under.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'mouse', buttons: 1 }))
    under.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerType: 'mouse' }))
    under.dispatchEvent(new MouseEvent('click', at))
}
/** The pointer resting on `el`'s centre, on the element under that point. */
function hoverOver(el: HTMLElement) {
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const under = (document.elementFromPoint(x, y) as HTMLElement | null) ?? el
    under.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: x, clientY: y }))
}
const cursorIsX = () => document.documentElement.hasAttribute('data-highlight-hover')
/** The toast's `undo` button, once it shows. */
const undoButton = () =>
    waitFor(() => {
        const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('undo'))
        expect(b).toBeTruthy()
        return b!
    })

/** A box is removed without arming: the pointer over it turns into an X, a click takes the box out
 *  of the PDF, and the toast's `undo` writes it back. Click a box on the PDF pages to try it. */
export const PdfHighlightClickRemoves: Story = {
    name: 'PDF highlight click removes',
    beforeEach: withPdf(false),
    render: () => (
        <>
            <Harness w={1100} h={720} rows={pdfBookRows()} />
            <ToastHost />
        </>
    ),
    play: async ({ canvasElement }) => {
        const before = await pdfPageOne()
        await dragOnPdfLeaf(canvasElement)
        await waitFor(async () => expect(await pdfPageOne()).toBe(before + 1), { timeout: 8000 })
        const boxes = () => [...canvasElement.querySelectorAll<HTMLElement>('[data-book-highlight-rect]')]
        const made = boxes().length
        hoverOver(boxes()[made - 1]!)
        await waitFor(() => expect(cursorIsX()).toBe(true))
        clickOn(boxes()[made - 1]!)
        await waitFor(() => expect(boxes().length).toBe(made - 1))
        await waitFor(async () => expect(await pdfPageOne()).toBe(before), { timeout: 8000 })
        await userEvent.click(await undoButton())
        await waitFor(async () => expect(await pdfPageOne()).toBe(before + 1), { timeout: 8000 })
    },
}

/** A PDF the server cannot rewrite (409 PDF_NOT_WRITABLE) keeps the box in its `.draw` sidecar. */
export const PdfHighlightUnwritableFallsBackToSidecar: Story = {
    name: 'PDF highlight unwritable falls back to sidecar',
    beforeEach: withPdf(true),
    render: () => <Harness w={1100} h={720} rows={pdfBookRows()} />,
    play: async ({ canvasElement }) => {
        const before = await pdfPageOne()
        await dragOnPdfLeaf(canvasElement)
        await waitFor(async () => expect(await api.read(inkSidecarFor(PDF_PATH))).toContain('highlights'), { timeout: 8000 })
        await expect(await pdfPageOne()).toBe(before)
    },
}

const annotationsReady = (root: HTMLElement) =>
    waitFor(() => expect(host(root).hasAttribute('data-book-annotations-ready')).toBe(true), { timeout: 8000 })

/** A drag across the book box, in the box's own pixels. */
function dragOnLayer(root: HTMLElement, from: [number, number], to: [number, number]) {
    const layer = root.querySelector<HTMLElement>('[data-book-highlights]')!
    const r = layer.getBoundingClientRect()
    const fire = (type: string, p: [number, number]) =>
        layer.dispatchEvent(
            new PointerEvent(type, { bubbles: true, pointerId: 9, button: 0, clientX: r.left + p[0], clientY: r.top + p[1] }),
        )
    fire('pointerdown', from)
    fire('pointermove', [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2])
    fire('pointermove', to)
    fire('pointerup', to)
}

/** Mod+Z on whichever platform the browser is: only the matching modifier is bound. */
function pressUndo(shift = false) {
    for (const mod of [{ metaKey: true }, { ctrlKey: true }])
        window.dispatchEvent(new KeyboardEvent('keydown', { key: shift ? 'Z' : 'z', shiftKey: shift, bubbles: true, ...mod }))
}

export const BookmarksPanelOpen: Story = {
    name: 'Bookmarks panel',
    beforeEach: () => serveFixtures(6),
    render: () => <Harness w={1100} h={720} rows={images(6)} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await ready(canvasElement, 'p. 1 / 6')
        await userEvent.click(c.getByRole('button', { name: 'bookmarks' }))
        await waitFor(() => expect(canvasElement.querySelector('[data-book-bookmarks]')).not.toBeNull())
        await annotationsReady(canvasElement)
        await userEvent.click(c.getByRole('button', { name: 'Bookmark this page' }))
        await waitFor(() => expect(c.getByText('Page 1')).toBeInTheDocument())
        await pressNext(canvasElement, 2, 'pp. 4–5 / 6')
        await userEvent.click(c.getByText('Page 1'))
        await waitFor(() => expect(readout(canvasElement)).toBe('p. 1 / 6'), { timeout: 8000 })
    },
}

export const RegionHighlight: Story = {
    name: 'Region highlight',
    beforeEach: () => serveFixtures(6),
    render: () => <Harness w={1100} h={720} rows={images(6)} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await ready(canvasElement, 'p. 1 / 6')
        await annotationsReady(canvasElement)
        await userEvent.click(c.getByRole('button', { name: 'highlight' }))
        const layer = canvasElement.querySelector<HTMLElement>('[data-book-highlights]')!
        await expect(layer.hasAttribute('data-armed')).toBe(true)
        const w = layer.getBoundingClientRect().width
        // the cover sits on the right half of the box
        dragOnLayer(canvasElement, [w / 2 + 40, 60], [w / 2 + 200, 120])
        await waitFor(() => expect(layer.querySelectorAll('[data-book-highlight-rect]')).toHaveLength(1))
        await expect(layer.hasAttribute('data-armed')).toBe(false)
        // saved to the page file's sidecar, where the image preview reads it
        await waitFor(async () => expect(await api.read('pages/page-1.png.draw')).toContain('highlights'), { timeout: 8000 })
        // Mod+Z takes the box back
        pressUndo()
        await waitFor(() => expect(layer.querySelectorAll('[data-book-highlight-rect]')).toHaveLength(0))
    },
}

// ── text mode ──

const WORDS = `I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.`

// ── transcription stories: a fake job client advances one page per controller tick ──
const pageText = (n: number) => `Page ${n}\nI went to the woods because I wished to live deliberately\n${WORDS}`
const LINE_TWO = 'I went to the woods because I wished to live deliberately'
let fk!: FakeTranscription

type FakeSetup = FakeOptions & { count: number; have?: number[]; auto?: boolean; math?: 'ask' | 'careful' | 'fast' }
/** Fixture pages, a fake reader and the `transcription` settings; the returned function puts it all back. */
function startFake(o: FakeSetup) {
    const fixtures = serveFixtures(o.count)
    fk = fakeTranscribe({
        text: (file, page) => pageText(Number(file.match(/(\d+)/)?.[1] ?? page)),
        lines: (_file, page) => [
            { text: `Page ${page}`, x: 0.1, y: 0.1, w: 0.2, h: 0.04 },
            { text: LINE_TWO, x: 0.1, y: 0.2, w: 0.7, h: 0.04 },
        ],
        ...o,
    })
    for (const n of o.have ?? []) fk.texts.set(`${imagePath(n)}#1`, pageText(n))
    const restore = fk.install()
    const prior = (settings as { transcription?: unknown }).transcription
    ;(setSettings as (k: string, v: unknown) => void)('transcription', { auto: o.auto ?? false, engine: 'auto', math: o.math ?? 'ask', provider: 'auto', model: '' })
    return () => {
        fixtures()
        restore()
        ;(setSettings as (k: string, v: unknown) => void)('transcription', prior)
        setSettings('reader', 'textScale', 1)
    }
}
const withText = (n: number) => startFake({ count: n, have: Array.from({ length: n }, (_, i) => i + 1) })
const textBook = (n: number, bookMode: ViewConfig['bookMode'], w = 900) => (
    <Harness w={w} rows={images(n)} view={bookView({ bookMode })} transcription={fk.controller()} />
)

const sections = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('[data-page-key]'))
const editorOf = (s: HTMLElement | undefined) => s?.querySelector<HTMLElement>('.cm-content') ?? null
const statusOf = (s: HTMLElement | undefined) => s?.querySelector('[data-page-status]')?.textContent ?? ''
const barNode = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-testid="book-bar"]')!
const barText = (root: HTMLElement) => within(barNode(root))
const textReady = (root: HTMLElement, n: number) =>
    waitFor(
        () => {
            expect(sections(root).length).toBe(n)
            expect(editorOf(sections(root)[0])?.textContent).toContain('Page 1')
        },
        { timeout: 8000 },
    )
const sideReady = (root: HTMLElement, n: number) =>
    waitFor(() => {
        expect(root.querySelectorAll('[data-side-by-side] [data-row-key]').length).toBe(n)
        expect(editorOf(root.querySelector<HTMLElement>('[data-row-key]')!)?.textContent).toContain('Page 1')
    }, { timeout: 8000 })
const bodyText = () => within(document.body)
const rightClick = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
}
/** Click into a section and select its first line with the keyboard. */
async function selectFirstLine(section: HTMLElement) {
    await userEvent.click(section.querySelector<HTMLElement>('.cm-line')!)
    await userEvent.keyboard('{Home}{Shift>}{End}{/Shift}')
}
/** Scroll a text-mode column so section `i` is at its top. */
const scrollToSection = (root: HTMLElement, i: number, into = 0) => {
    const scroller = sections(root)[0].parentElement!.parentElement!
    scroller.scrollTop += sections(root)[i].getBoundingClientRect().top - scroller.getBoundingClientRect().top + into
}
const clickLayer = (row: HTMLElement, x: number, y: number) => {
    const layer = row.querySelector<HTMLElement>('[data-locate-layer]')!
    const r = layer.getBoundingClientRect()
    layer.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + x * r.width, clientY: r.top + y * r.height }))
}

/** Text mode is one scrolling column on the pane's own background: a divider row per page (its file
 *  name, the reader that produced the text), the text rendered like a note. */
export const TextMode: Story = {
    name: 'Text mode',
    beforeEach: () => withText(3),
    render: () => textBook(3, 'text'),
    play: async ({ canvasElement }) => {
        await textReady(canvasElement, 3)
        const first = sections(canvasElement)[0]
        await expect(first.textContent).toContain('page-1.png')
        // stored pages with no job record in this run show no reader
        await expect(statusOf(first)).toBe('')
        await expect(canvasElement.querySelector('[data-text-spread]')).toBeNull()
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain('p. 1 / 3'))
        // one column: every section starts at the same left edge
        await expect(new Set(sections(canvasElement).map(s => Math.round(s.getBoundingClientRect().left))).size).toBe(1)
    },
}

/** Right-click a page: the three `read again` rows, and no `edit text` or `transcribe again with ai`. */
export const PageMenu: Story = {
    name: 'Page menu',
    beforeEach: () => withText(3),
    render: () => textBook(3, 'pages'),
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 3')
        rightClick(canvasElement.querySelector<HTMLElement>('[data-book-page="right"]')!)
        for (const label of ['read again on-device', 'read again with the math reader', 'read again with ai'])
            await bodyText().findByText(label)
        await expect(bodyText().queryByText('edit text')).toBeNull()
        await expect(bodyText().queryByText('transcribe again with ai')).toBeNull()
    },
}

/** `read again with ai` reads only that page again, with that reader, and shows it in the cell. */
export const ReadAgainWithEngine: Story = {
    name: 'Read again with engine',
    beforeEach: () => withText(3),
    render: () => textBook(3, 'pages'),
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 3')
        rightClick(canvasElement.querySelector<HTMLElement>('[data-book-page="right"]')!)
        await userEvent.click(await bodyText().findByText('read again with ai'))
        await waitFor(() => expect(fk.calls.at(-1)).toMatchObject({ file: imagePath(1), pages: [1], engine: 'ai' }))
        await fk.tick(2)
        await pickRead(canvasElement, 'read as', 'text')
        await pickRead(canvasElement, 'scroll or flip', 'scroll')
        await textReady(canvasElement, 3)
        await waitFor(() => expect(statusOf(sections(canvasElement)[0])).toBe('ai'))
        // a page with no job record shows no reader
        await expect(statusOf(sections(canvasElement)[1])).toBe('')
    },
}

/** Pages fill in place as the job reads them: queued, then reading, then the text and the reader. */
export const Transcribing: Story = {
    beforeEach: () => startFake({ count: 6, auto: true }),
    render: () => textBook(6, 'text'),
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain('p. 1 / 6 // transcribing 1 of 6'), { timeout: 8000 })
        await waitFor(() => expect(sections(canvasElement).length).toBe(6))
        await expect(statusOf(sections(canvasElement)[3])).toBe('queued')
        await expect(sections(canvasElement)[3].querySelector('.cm-placeholder')?.textContent).toBe('no text yet')
        await fk.tick(3)
        await waitFor(() => expect(editorOf(sections(canvasElement)[0])?.textContent).toContain('Page 1'))
        await waitFor(() => expect(statusOf(sections(canvasElement)[0])).toBe('on-device'))
        // a tick finishes the page being read and starts the next job's
        await waitFor(() => expect(statusOf(sections(canvasElement)[2])).toBe('reading // on-device'))
    },
}

/** A 560px pane: the estimate and the word `transcribing` give way first, and `[ cancel ]` stays in the bar
 *  or, when the bar cannot hold it, lands in the `[≡]` panel as `cancel transcribing`. */
export const PdfTranscribingNarrow: Story = {
    name: 'Transcribing narrow',
    beforeEach: () => startFake({ count: 6, auto: true }),
    render: () => textBook(6, 'text', 560),
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain('6'), { timeout: 8000 })
        await waitFor(() => expect(sections(canvasElement).length).toBe(6))
        const bar = barNode(canvasElement)
        const cancel = () => bar.querySelector<HTMLElement>('[data-bar-menu-label="cancel transcribing"]')
        await waitFor(() => expect(cancel(), bar.innerHTML.slice(0, 600)).not.toBeNull())
        const inBar = () => !cancel()!.hasAttribute('data-bar-hidden') && cancel()!.getClientRects().length > 0
        if (!inBar()) {
            const more = within(bar).getByLabelText('More controls')
            await userEvent.click(more)
            await waitFor(() => expect(within(document.body).getByText('cancel transcribing')).toBeTruthy())
        }
    },
}

/** `[ cancel ]` stops the run at once with a toast; pages done keep their text, the rest return to
 *  `not transcribed`, and the bar's `transcribe` button comes back. */
export const CancelTranscribing: Story = {
    name: 'Cancel transcribing',
    beforeEach: () => startFake({ count: 4, auto: true }),
    render: () => textBook(4, 'text'),
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain('transcribing'), { timeout: 8000 })
        await fk.tick(2)
        await waitFor(() => expect(statusOf(sections(canvasElement)[0])).toBe('on-device'))
        await userEvent.click(barText(canvasElement).getByRole('button', { name: 'cancel' }))
        await waitFor(() => expect(toasts().some(t => t.message === 'stopped transcribing page-2.png')).toBe(true))
        await waitFor(() => expect(shown(barNode(canvasElement))).not.toContain('transcribing'))
        await waitFor(() => expect(statusOf(sections(canvasElement)[1])).toBe('not transcribedtranscribe'))
        await expect(statusOf(sections(canvasElement)[0])).toBe('on-device')
        await barText(canvasElement).findByRole('button', { name: 'transcribe 3 pages' })
    },
}

/** With `transcription.math` at `ask`, the prompt appears as soon as a running job reads its first math page. */
export const MathAskedMidRun: Story = {
    name: 'Math asked mid run',
    beforeEach: () => startFake({ count: 4, auto: true, mathKeys: [`${imagePath(2)}#1`] }),
    render: () => textBook(4, 'text'),
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain('transcribing'), { timeout: 8000 })
        await fk.tick(3)
        await bodyText().findByText('this page has math')
        await expect(canvasElement.ownerDocument.querySelector('[data-math-prompt-running]')).not.toBeNull()
        await expect(shown(barNode(canvasElement))).toContain('transcribing')
        // the choice decides every running file: one decide per running file (pages 1-3); the fourth
        // file is still queued and inherits the choice when it starts
        const files = [...new Set(fk.calls.map(c => c.file))]
        await expect(files).toEqual([1, 2, 3, 4].map(imagePath))
        await userEvent.click(bodyText().getByRole('button', { name: 'go fast' }))
        await waitFor(() => expect(bodyText().queryByText('this page has math')).toBeNull())
        await waitFor(() => expect(fk.decisions).toEqual(['fast', 'fast', 'fast']))
    },
}

/** The 4th switch: each page's picture on the left, that page's section on the right, row tops aligned. */
export const SideBySide: Story = {
    name: 'Side by side',
    beforeEach: () => withText(3),
    render: () => textBook(3, 'side', 1000),
    play: async ({ canvasElement }) => {
        await sideReady(canvasElement, 3)
        const row = canvasElement.querySelector<HTMLElement>('[data-row-key]')!
        const image = row.children[0].getBoundingClientRect()
        const text = row.children[1].getBoundingClientRect()
        await expect(image.right).toBeLessThanOrEqual(text.left + 1)
        await expect(Math.abs(image.top - text.top)).toBeLessThan(2)
        await expect(image.width / row.getBoundingClientRect().width).toBeGreaterThan(0.4)
        await expect(image.width / row.getBoundingClientRect().width).toBeLessThan(0.55)
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain('p. 1 / 3'))
        await waitFor(() => expect(row.querySelector('canvas')!.width).toBeGreaterThan(0))
    },
}

/** A narrow pane keeps each page beside its text, the page narrower, so the text is in view. */
export const SideBySideNarrow: Story = {
    name: 'Side by side narrow',
    beforeEach: () => withText(2),
    render: () => textBook(2, 'side', 480),
    play: async ({ canvasElement }) => {
        await sideReady(canvasElement, 2)
        const row = canvasElement.querySelector<HTMLElement>('[data-row-key]')!
        const image = row.querySelector<HTMLElement>('[data-page-image]')!.getBoundingClientRect()
        const field = editorOf(row)!.getBoundingClientRect()
        const view = canvasElement.querySelector<HTMLElement>('[data-side-by-side]')!.getBoundingClientRect()
        await expect(image.right).toBeLessThanOrEqual(field.left + 1)
        await expect(field.top).toBeLessThan(view.bottom - 40)
        await expect(field.width).toBeGreaterThan(image.width)
    },
}

/** Side by side: right-clicking the picture offers the page's rows, and clicking the text just edits it. */
export const SideBySidePageMenu: Story = {
    name: 'Side by side page menu',
    beforeEach: () => withText(3),
    render: () => textBook(3, 'side', 1000),
    play: async ({ canvasElement }) => {
        await sideReady(canvasElement, 3)
        const row = canvasElement.querySelector<HTMLElement>('[data-row-key]')!
        await userEvent.click(row.querySelector<HTMLElement>('.cm-line')!)
        await expect(editorOf(row)?.contains(document.activeElement)).toBe(true)
        ;(document.activeElement as HTMLElement).blur()
        rightClick(row.querySelector<HTMLElement>('[data-page-image]')!)
        for (const label of ['read again on-device', 'read again with the math reader', 'read again with ai'])
            await bodyText().findByText(label)
        await expect(bodyText().queryByText('edit text')).toBeNull()
        await userEvent.keyboard('{Escape}')
    },
}

/** Records what a page turn did under `el`, which is over too fast to poll for: whether the picture
 *  curled and whether the text did. */
function watchTurn(el: HTMLElement) {
    const seen = { picture: false, text: false }
    new MutationObserver(() => {
        seen.picture ||= !!el.querySelector('[data-page-image] [data-turn-state]')
        seen.text ||= !!el.querySelector('[data-text-turn] [data-turn-state]')
    }).observe(el, { subtree: true, childList: true })
    return seen
}

/** A page at a time: a turn swaps pages built ahead (the same picture comes back), the picture fits the pane, the text scrolls alone. */
export const SideBySideFlipTurn: Story = {
    name: 'Side by side flip turn',
    beforeEach: () => {
        const undo = withText(3)
        fk.texts.set(`${imagePath(1)}#1`, Array.from({ length: 60 }, (_, n) => `Line ${n} of a long page`).join('\n\n'))
        return undo
    },
    render: () => <Harness w={1000} rows={images(3)} view={bookView({ bookMode: 'side', bookFlow: 'flip' })} transcription={fk.controller()} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const scroller = () => canvasElement.querySelector<HTMLElement>('[data-side-by-side]')!
        const shown = () => canvasElement.querySelector<HTMLElement>('[data-row-key]')!
        await waitFor(() => expect(shown()?.querySelector('canvas')!.width).toBeGreaterThan(0), { timeout: 8000 })
        const first = shown()
        await expect(canvasElement.querySelectorAll('[data-row-key]').length).toBe(1)
        await expect(scroller().scrollHeight).toBeLessThanOrEqual(scroller().clientHeight)
        const pic = first.querySelector<HTMLElement>('[data-page-image]')!.getBoundingClientRect()
        await expect(pic.bottom).toBeLessThanOrEqual(scroller().getBoundingClientRect().bottom + 1)
        const text = first.children[1] as HTMLElement
        await waitFor(() => expect(text.scrollHeight).toBeGreaterThan(text.clientHeight))
        text.scrollTop = 300
        await expect(first.querySelector<HTMLElement>('[data-page-image]')!.getBoundingClientRect().top).toBe(pic.top)

        // the open spread turns one leaf and settles; the curl draws
        // the next page's face, so it waits for that page, built ahead while hidden, to be painted
        await waitFor(() => {
            for (const cv of canvasElement.querySelectorAll('canvas')) expect(cv.width).not.toBe(300)
        }, { timeout: 8000 })
        const seen = watchTurn(canvasElement)
        await userEvent.click(c.getByRole('button', { name: 'next page' }))
        await waitFor(() => expect(shown()).not.toBe(first))
        // one leaf over the spine, not a curl per column
        await waitFor(() => expect(seen).toEqual({ picture: false, text: true }))
        await waitFor(() => expect(shown().querySelector('[data-turn-state]')).toBeNull(), { timeout: 4000 })
        await waitFor(() => expect(canvasElement.querySelector('[data-text-turn]')).toBeNull(), { timeout: 4000 })
        await expect(shown().querySelector('canvas')!.width).toBeGreaterThan(0)
        await expect(editorOf(shown())).not.toBeNull()
        await userEvent.click(c.getByRole('button', { name: 'previous page' }))
        await waitFor(() => expect(shown()).toBe(first))
        await expect(text.scrollTop).toBe(0)
    },
}

/** The page keys move side by side a page at a time, scrolling the column to the next page. */
export const SideBySideKeys: Story = {
    name: 'Side by side keys',
    beforeEach: () => withText(3),
    render: () => textBook(3, 'side', 1000),
    play: async ({ canvasElement }) => {
        await sideReady(canvasElement, 3)
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain('p. 1 / 3'))
        await userEvent.keyboard('{ArrowRight}')
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain('p. 2 / 3'))
        const scroller = canvasElement.querySelector<HTMLElement>('[data-side-by-side]')!
        const second = canvasElement.querySelectorAll<HTMLElement>('[data-row-key]')[1]
        await waitFor(() => expect(Math.abs(second.getBoundingClientRect().top - scroller.getBoundingClientRect().top)).toBeLessThan(40))
        await userEvent.keyboard('{ArrowLeft}')
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain('p. 1 / 3'))
    },
}

/** Text read a page at a time: one page's text, turned by the arrows under it or the page keys. */
export const TextFlip: Story = {
    name: 'Text flip',
    beforeEach: () => withText(3),
    render: () => <Harness w={900} rows={images(3)} view={bookView({ bookMode: 'text', bookFlow: 'flip' })} transcription={fk.controller()} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await waitFor(() => expect(sections(canvasElement).length).toBe(1), { timeout: 8000 })
        await waitFor(() => expect(editorOf(sections(canvasElement)[0])?.textContent).toContain('Page 1'), { timeout: 8000 })
        await expect(await readState(canvasElement, 'scroll or flip')).toBe('flip')
        await expect(c.getByRole('button', { name: 'previous page' })).toBeDisabled()
        const seen = watchTurn(canvasElement)
        await userEvent.click(c.getByRole('button', { name: 'next page' }))
        await waitFor(() => expect(editorOf(sections(canvasElement)[0])?.textContent).toContain('Page 2'), { timeout: 8000 })
        await waitFor(() => expect(seen.text).toBe(true))
        await userEvent.keyboard('{ArrowRight}')
        await waitFor(() => expect(editorOf(sections(canvasElement)[0])?.textContent).toContain('Page 3'), { timeout: 8000 })
        await expect(sections(canvasElement).length).toBe(1)
        await expect(c.getByRole('button', { name: 'next page' })).toBeDisabled()
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain('p. 3 / 3'))
    },
}

/** Side by side a page at a time: one page beside its text; switching to scroll keeps the page. */
export const SideBySideFlip: Story = {
    name: 'Side by side flip',
    beforeEach: () => withText(3),
    render: () => <Harness w={1000} rows={images(3)} view={bookView({ bookMode: 'side', bookFlow: 'flip' })} transcription={fk.controller()} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await waitFor(() => expect(canvasElement.querySelectorAll('[data-side-by-side] [data-row-key]').length).toBe(1), { timeout: 8000 })
        await userEvent.click(c.getByRole('button', { name: 'next page' }))
        await waitFor(() => expect(editorOf(canvasElement.querySelector<HTMLElement>('[data-row-key]')!)?.textContent).toContain('Page 2'), { timeout: 8000 })
        await pickRead(canvasElement, 'scroll or flip', 'scroll')
        await sideReady(canvasElement, 3)
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain('p. 2 / 3'))
        await expect(c.queryByRole('button', { name: 'next page' })).toBeNull()
    },
}

/** Selecting text in a section boxes its lines on that page's picture, and clears when the selection empties. */
export const LocateFromText: Story = {
    name: 'Locate from text',
    beforeEach: () => withText(2),
    render: () => textBook(2, 'side', 1000),
    play: async ({ canvasElement }) => {
        await sideReady(canvasElement, 2)
        const row = canvasElement.querySelector<HTMLElement>('[data-row-key]')!
        await selectFirstLine(row)
        await waitFor(() => expect(row.querySelectorAll('[data-locate-box]').length).toBeGreaterThan(0), { timeout: 8000 })
        await userEvent.keyboard('{ArrowRight}')
        await waitFor(() => expect(row.querySelectorAll('[data-locate-box]').length).toBe(0), { timeout: 8000 })
    },
}

/** Clicking a line on the picture puts the caret at the start of that line's text and tints it. */
export const LocateFromPage: Story = {
    name: 'Locate from page',
    beforeEach: () => withText(2),
    render: () => textBook(2, 'side', 1000),
    play: async ({ canvasElement }) => {
        await sideReady(canvasElement, 2)
        const row = canvasElement.querySelector<HTMLElement>('[data-row-key]')!
        clickLayer(row, 0.3, 0.22)
        await waitFor(() => expect(row.querySelector('.cm-tr-flash')?.textContent).toContain('I went to the woods'), { timeout: 8000 })
        await waitFor(() => expect(row.querySelector('.cm-tr-flash')).toBeNull(), { timeout: 4000 })
    },
}

/** In text mode, right-click with a selection offers `show on page` first; it opens side by side at that page with the boxes drawn. */
export const ShowOnPage: Story = {
    name: 'Show on page',
    beforeEach: () => withText(3),
    render: () => textBook(3, 'text'),
    play: async ({ canvasElement }) => {
        await textReady(canvasElement, 3)
        await selectFirstLine(sections(canvasElement)[0])
        rightClick(editorOf(sections(canvasElement)[0])!)
        const show = await bodyText().findByText('show on page')
        await expect(show.compareDocumentPosition(await bodyText().findByText('read again on-device')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        await userEvent.click(show)
        await sideReady(canvasElement, 3)
        await waitFor(() => expect(canvasElement.querySelectorAll('[data-locate-box]').length).toBeGreaterThan(0), { timeout: 8000 })
    },
}

/** With a selection the bar's highlight button wraps it in `==…==`; saved on the page. */
export const HighlightSelection: Story = {
    name: 'Highlight selection',
    beforeEach: () => withText(2),
    render: () => textBook(2, 'text'),
    play: async ({ canvasElement }) => {
        await textReady(canvasElement, 2)
        await selectFirstLine(sections(canvasElement)[0])
        await userEvent.click(barText(canvasElement).getByRole('button', { name: 'highlight' }))
        await waitFor(() => expect(fk.saves.at(-1)).toMatchObject({ file: imagePath(1), page: 1 }), { timeout: 8000 })
        await expect(fk.saves.at(-1)!.text).toContain('==Page 1==')
        await expect(fk.saves.every(s => s.file === imagePath(1))).toBe(true)
    },
}

/** Flipped, the highlight button marks the page in view, not a hidden neighbour still holding a selection. */
export const SideBySideFlipHighlight: Story = {
    name: 'Side by side flip highlight',
    beforeEach: () => withText(3),
    render: () => <Harness w={1000} rows={images(3)} view={bookView({ bookMode: 'side', bookFlow: 'flip' })} transcription={fk.controller()} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const shownRow = () => canvasElement.querySelector<HTMLElement>('[data-row-key]')!
        await waitFor(() => expect(editorOf(shownRow())?.textContent).toContain('Page 1'), { timeout: 8000 })
        await selectFirstLine(shownRow())
        await userEvent.click(c.getByRole('button', { name: 'next page' }))
        await waitFor(() => expect(editorOf(shownRow())?.textContent).toContain('Page 2'), { timeout: 8000 })
        await selectFirstLine(shownRow())
        await userEvent.click(barText(canvasElement).getByRole('button', { name: 'highlight' }))
        await waitFor(() => expect(fk.saves.at(-1)?.text).toContain('==Page 2=='), { timeout: 8000 })
        await expect(fk.saves.some(s => s.text.includes('==Page 1=='))).toBe(false)
    },
}

class FakeEventSource {
    onopen: (() => void) | null = null
    onmessage: ((e: { data: string }) => void) | null = null
    onerror: ((e: unknown) => void) | null = null
    close() {}
    emit(payload: unknown) {
        this.onmessage?.({ data: JSON.stringify(payload) })
    }
}

/** Text changed from outside reaches the open page; a page with typing not yet saved keeps the typing. */
export const OutsideChange: Story = {
    name: 'Outside change',
    beforeEach: () => withText(2),
    render: () => textBook(2, 'text'),
    play: async ({ canvasElement }) => {
        await textReady(canvasElement, 2)
        let source: FakeEventSource | undefined
        startServerVersion({
            eventSourceFactory: () => (source = new FakeEventSource()) as unknown as EventSource,
            fetchVersion: async () => ({ version: 0 }),
            setIntervalFn: () => 0 as unknown as ReturnType<typeof setInterval>,
            clearIntervalFn: () => {},
        })
        await expect(source).toBeDefined()
        const changed = (version: number) => source!.emit({ version, paths: [`${imagePath(1)}.md`], dirty: { graph: false, tree: false } })
        fk.texts.set(`${imagePath(1)}#1`, 'Rewritten by an agent')
        changed(2)
        await waitFor(() => expect(editorOf(sections(canvasElement)[0])?.textContent).toContain('Rewritten by an agent'), { timeout: 4000 })
        await userEvent.click(sections(canvasElement)[0].querySelector<HTMLElement>('.cm-line')!)
        await userEvent.keyboard('{End}TYPED')
        fk.texts.set(`${imagePath(1)}#1`, 'Rewritten again')
        changed(3)
        await new Promise(r => setTimeout(r, 200))
        await expect(editorOf(sections(canvasElement)[0])?.textContent).toContain('TYPED')
    },
}

/** text -> pages -> side by side -> text keeps the page. */
export const SwitchKeepsPlace: Story = {
    name: 'Switch keeps place',
    beforeEach: () => withText(6),
    render: () => textBook(6, 'text'),
    play: async ({ canvasElement }) => {
        await textReady(canvasElement, 6)
        // the column settles after mounting, and sections measure as they mount: scroll until it holds
        await new Promise(r => setTimeout(r, 400))
        let at = 0
        await waitFor(() => {
            scrollToSection(canvasElement, 3, 60)
            at = Number(/p\. (\d+) \/ 6/.exec(barNode(canvasElement).textContent ?? '')?.[1])
            expect(at).toBeGreaterThan(2)
        })
        await pickRead(canvasElement, 'read as', 'pages')
        await waitFor(() => {
            const m = /pp?\. (\d+)(?:–(\d+))? \/ 6/.exec(barNode(canvasElement).textContent ?? '')
            expect(Number(m?.[1])).toBeLessThanOrEqual(at)
            expect(Number(m?.[2] ?? m?.[1])).toBeGreaterThanOrEqual(at)
        }, { timeout: 8000 })
        await pickRead(canvasElement, 'read as', 'side by side')
        await sideReady(canvasElement, 6)
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain(`p. ${at} / 6`), { timeout: 8000 })
        await pickRead(canvasElement, 'read as', 'text')
        await textReady(canvasElement, 6)
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain(`p. ${at} / 6`), { timeout: 8000 })
    },
}

/** Until a page has text, and while nothing is transcribing, `text` and `side by side` are disabled and say why. */
export const TextDisabledWithoutTranscripts: Story = {
    name: 'Text disabled without transcripts',
    beforeEach: () => startFake({ count: 3 }),
    render: () => textBook(3, 'pages'),
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 3')
        for (const name of ['text', 'side by side']) {
            const row = await readRow(canvasElement, name)
            await expect(row.disabled).toBe(true)
            await expect(row.text).toContain('no page is transcribed yet')
        }
    },
}

/** Dark pages turn the side-by-side pictures dark; text mode keeps the pane's own background. */
export const DarkText: Story = {
    name: 'Dark text',
    beforeEach: () => withText(2),
    render: () => (
        <Harness w={1000} rows={images(2)} view={bookView({ bookMode: 'side', bookDark: true })} transcription={fk.controller()} />
    ),
    play: async ({ canvasElement }) => {
        await sideReady(canvasElement, 2)
        const canvas = canvasElement.querySelector<HTMLCanvasElement>('[data-row-key] canvas')!
        // a blank canvas is 300x150 and transparent: wait until the page is really drawn, then read its paper
        await waitFor(
            () => {
                const px = canvas.getContext('2d')!.getImageData(4, 4, 1, 1).data
                expect(px[3]).toBeGreaterThan(0)
                // the fixture's paper is the pane background; dark pages draw it through the PDF viewer's transform
                const paper = bookPage(1).getContext('2d')!.getImageData(4, 4, 1, 1).data
                const want = darkRgb(paper[0], paper[1], paper[2])
                expect(Math.abs(px[0] - want[0]) + Math.abs(px[1] - want[1]) + Math.abs(px[2] - want[2])).toBeLessThanOrEqual(6)
                expect([px[0], px[1], px[2]]).not.toEqual([paper[0], paper[1], paper[2]])
            },
            { timeout: 4000 },
        )
        // text mode keeps the pane's own background
        await pickRead(canvasElement, 'read as', 'text')
        await textReady(canvasElement, 2)
        await expect(canvasElement.querySelector('[data-text-page]')).toBeNull()
    },
}

/** Pages mode with dark pages: a PDF's white paper is drawn near-black. */
export const DarkPages: Story = {
    name: 'Dark pages',
    beforeEach: () => serveFixtures(0),
    render: () => <Harness w={1100} h={720} rows={[row(PDF_PATH)]} view={bookView({ bookDark: true })} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(readout(canvasElement)).toMatch(/^p\. 1 \/ \d+$/), { timeout: 8000 })
        await waitFor(() => expect(host(canvasElement).hasAttribute('data-book-prefetched')).toBe(true), { timeout: 8000 })
        const canvas = canvasElement.querySelector<HTMLCanvasElement>('[data-book-page="right"] canvas')!
        await waitFor(() => expect(canvas.width).toBeGreaterThan(10), { timeout: 8000 })
        // a corner of the page is paper: dark once the page is turned dark
        const px = canvas.getContext('2d')!.getImageData(4, 4, 1, 1).data
        await expect((px[0] + px[1] + px[2]) / 3).toBeLessThan(60)
    },
}

/** Dark pages keep photos as they are: an article's page turns near-black, its photo keeps its
 *  own colours (a blue sky stays blue), and its chart on white turns dark with the paper. */
export const DarkPagesKeepPhotos: Story = {
    name: 'Dark pages keep photos',
    beforeEach: () => {
        const url = URL.createObjectURL(new Blob([buildArticlePdf()], { type: 'application/pdf' }))
        const original = api.assetUrl
        api.assetUrl = (target: string) => (target === ARTICLE_PATH ? url : original(target))
        return () => {
            api.assetUrl = original
            URL.revokeObjectURL(url)
        }
    },
    render: () => <Harness w={1100} h={720} rows={[row(ARTICLE_PATH)]} view={bookView({ bookDark: true })} />,
    play: async ({ canvasElement }) => {
        const canvas = () => canvasElement.querySelector<HTMLCanvasElement>('[data-book-page="right"] canvas')
        await waitFor(() => expect(canvas()?.width ?? 0).toBeGreaterThan(10), { timeout: 8000 })
        const at = (x: number, y: number) => {
            const c = canvas()!
            return Array.from(c.getContext('2d')!.getImageData(Math.round((x / 612) * c.width), Math.round((y / 792) * c.height), 1, 1).data)
        }
        await waitFor(() => {
            const [r, , b] = at(ARTICLE_PHOTO.x + ARTICLE_PHOTO.w / 2, ARTICLE_PHOTO.y + 20) // the sky
            expect(b).toBeGreaterThan(r)
            expect(b).toBeLessThan(160) // as printed: a deep blue, not its light inverse
        }, { timeout: 8000 })
        const paper = at(ARTICLE_CHART.x + ARTICLE_CHART.w - 10, ARTICLE_CHART.y + 10) // the chart's white
        await expect((paper[0] + paper[1] + paper[2]) / 3).toBeLessThan(60)
    },
}

/** The display panel still sets text mode's size: a larger step grows the section's type. */
export const ProseFace: Story = {
    name: 'Prose face',
    beforeEach: () => withText(2),
    render: () => textBook(2, 'text'),
    play: async ({ canvasElement }) => {
        await textReady(canvasElement, 2)
        const size = () => parseFloat(getComputedStyle(editorOf(sections(canvasElement)[0])!.closest('.cm-scroller')!).fontSize)
        const before = size()
        await userEvent.click(barText(canvasElement).getByRole('button', { name: 'display' }))
        await userEvent.click(await bodyText().findByRole('button', { name: 'larger text' }))
        await waitFor(() => expect(size()).toBeGreaterThan(before))
    },
}

/** A 300 page book opens at once, mounts only the sections near the view, and saves one page when one page is edited. */
export const TextMode300Pages: Story = {
    name: 'Text mode 300 pages',
    beforeEach: () => startFake({ count: 3, have: Array.from({ length: 300 }, (_, i) => i + 1) }),
    render: () => textBook(300, 'text'),
    play: async ({ canvasElement }) => {
        await textReady(canvasElement, 300)
        await expect(canvasElement.querySelectorAll('[data-page-key] .cm-content').length).toBeLessThan(30)
        await new Promise(r => setTimeout(r, 400))
        const scroller = sections(canvasElement)[0].parentElement!.parentElement!
        await waitFor(() => {
            scroller.scrollTop = scroller.scrollHeight
            expect(editorOf(sections(canvasElement)[299])?.textContent ?? '').toContain('Page 300')
        })
        await waitFor(() => {
            scrollToSection(canvasElement, 279)
            expect(editorOf(sections(canvasElement)[279])?.textContent ?? '').toContain('Page 280')
        })
        await userEvent.click(sections(canvasElement)[279].querySelector<HTMLElement>('.cm-line')!)
        await userEvent.keyboard('edited ')
        await waitFor(() => expect(fk.saves.length).toBe(1), { timeout: 4000 })
        await expect(fk.saves[0]).toMatchObject({ file: imagePath(280), page: 1 })
    },
}

/** Inside a pane, the page's rows join the pane's own menu rather than replacing it. */
export const PageRowsJoinPaneMenu: Story = {
    name: 'Page rows join the pane menu',
    beforeEach: () => withText(4),
    render: () => (
        <div
            data-pane-leaf="leaf-1"
            onContextMenu={e => {
                e.preventDefault()
                const rows = withPaneItems(paneMenuItemsOf(e), [{ label: 'Split right' }, { label: 'Close pane' }])
                document.body.dataset.paneMenu = rows.map(r => r.label).join('|')
            }}
        >
            {textBook(4, 'pages', 1100)}
        </div>
    ),
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 4')
        delete document.body.dataset.paneMenu
        rightClick(canvasElement.querySelector<HTMLElement>('[data-book-page="right"]')!)
        await waitFor(() =>
            expect(document.body.dataset.paneMenu).toBe(
                'read again on-device|read again with the math reader|read again with ai|Split right|Close pane',
            ),
        )
        await expect(within(document.body).queryByRole('menu')).toBeNull()
    },
}

let rowWrites: string[] = []
/** A base's sorter: remove page 2 (and undo puts it back), remove it again, save: one row delete. */
export const EditPages: Story = {
    name: 'Edit pages',
    beforeEach: () => {
        const restore = serveFixtures(5)
        rowWrites = []
        const original = { del: api.rowDelete, move: api.rowReorder }
        api.rowDelete = async (file: string, index: number) => {
            rowWrites.push(`delete ${file} ${index}`)
            return { ok: true } as never
        }
        api.rowReorder = async (file: string, from: number, to: number) => {
            rowWrites.push(`move ${file} ${from} ${to}`)
            return { ok: true } as never
        }
        return () => {
            restore()
            api.rowDelete = original.del
            api.rowReorder = original.move
        }
    },
    render: () => (
        <Harness w={1100} h={720} basePath="notebook.base.jsonl" rows={images(5).map((r, i) => ({ ...r, index: i }))} />
    ),
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 5')
        await userEvent.click(within(canvasElement).getByRole('button', { name: 'edit pages' }))
        // the settings for reading are away while the sorter is up: no mode reads as chosen behind it
        await waitFor(() => expect(within(canvasElement).queryByRole('button', { name: 'display' })).toBeNull())
        const tiles = () => canvasElement.querySelectorAll('[data-book-edit-tile]')
        await waitFor(() => expect(tiles().length).toBe(5))
        await waitFor(() => expect(canvasElement.querySelectorAll('[data-book-edit-tile] canvas').length).toBe(5), { timeout: 8000 })
        const remove = () => within(tiles()[1] as HTMLElement).getByRole('button', { name: 'remove page' })
        // the [x] shows on hover; a synthetic pointer does not hover, so press it directly
        remove().click()
        await waitFor(() => expect(tiles().length).toBe(4))
        const toast = await waitFor(() => {
            const t = toasts().find(x => x.message === 'removed page 2')
            expect(t?.action?.label).toBe('undo')
            return t!
        })
        toast.action!.onClick()
        await waitFor(() => expect(tiles().length).toBe(5))
        remove().click()
        await userEvent.click(within(canvasElement).getByRole('button', { name: 'save' }))
        await waitFor(() => expect(canvasElement.querySelector('[data-book-page-editor]')).toBeNull(), { timeout: 8000 })
        await expect(rowWrites).toEqual(['delete notebook.base.jsonl 1'])
    },
}

let pdfOrders: unknown[] = []
/** A PDF read on its own: its sorter has one tile per PDF page and `+ blank page`; adding a blank
 *  page, removing page 1 and saving rewrites the PDF as the rest of its pages and the blank one. */
export const PdfEditPages: Story = {
    name: 'PDF edit pages',
    beforeEach: () => {
        const restore = serveFixtures(0)
        pdfOrders = []
        const original = api.pdfPages
        api.pdfPages = async (_file: string, order: unknown[]) => {
            pdfOrders.push(order)
            return { pages: order.length }
        }
        return () => {
            restore()
            api.pdfPages = original
        }
    },
    render: () => {
        const [slots, setSlots] = createSignal<ViewBarSlots | undefined>()
        return (
            <div style={{ width: '1100px', height: '720px', display: 'flex', 'flex-direction': 'column' }}>
                <div data-testid="book-bar">
                    <ViewBar identity={<Crumb icon="FileText">lecture.pdf</Crumb>} readouts={slots()?.readouts} config={slots()?.config} actions={slots()?.actions} />
                </div>
                <div style={{ flex: 1, 'min-height': 0 }}>
                    <BookView rows={[]} files={[PDF_PATH]} view={bookView()} ownsRows={false} onChange={() => {}} onBarSlots={setSlots} />
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await waitFor(() => expect(readout(canvasElement)).toMatch(/^p\. 1 \/ \d+$/), { timeout: 8000 })
        const pages = Number(readout(canvasElement)!.match(/\/ (\d+)$/)![1])
        await userEvent.click(c.getByRole('button', { name: 'edit pages' }))
        await waitFor(() => expect(canvasElement.querySelectorAll('[data-book-edit-tile]').length).toBe(pages))
        await userEvent.click(c.getByRole('button', { name: '+ blank page' }))
        within(canvasElement.querySelectorAll<HTMLElement>('[data-book-edit-tile]')[0]).getByRole('button', { name: 'remove page' }).click()
        await userEvent.click(c.getByRole('button', { name: 'save' }))
        await waitFor(() => expect(pdfOrders.length).toBe(1), { timeout: 8000 })
        await expect(pdfOrders[0]).toEqual([...Array.from({ length: pages - 1 }, (_, i) => ({ page: i + 2 })), { blank: true }])
    },
}

/** Four quick presses while the first page turns: none cuts the one before short, all four land,
 *  and every turn of the burst runs on the one turn layer (one WebGL context, not four). */
export const BurstTurns: Story = {
    name: 'Burst of turns',
    beforeEach: () => serveFixtures(12),
    render: () => <Harness w={1100} h={720} rows={images(12)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 12')
        const layers = new Set<Element>()
        const watch = new MutationObserver(() => {
            const l = canvasElement.querySelector('[data-book] [data-turn-state] canvas')
            if (l) layers.add(l)
        })
        watch.observe(canvasElement, { subtree: true, childList: true, attributes: true })
        for (let i = 0; i < 4; i++) {
            await userEvent.keyboard('{ArrowRight}')
            await new Promise(r => setTimeout(r, 40))
        }
        await waitFor(() => expect(readout(canvasElement)).toBe('pp. 8–9 / 12'), { timeout: 8000 })
        await waitFor(() => expect(host(canvasElement).dataset.turnState).toBe('settled'), { timeout: 8000 })
        watch.disconnect()
        await expect(layers.size).toBe(1)
    },
}


// ── restored and added reader stories (fix round 2d) ──
const pagesBook = (n: number, w = 1100) => <Harness w={w} h={720} rows={images(n)} transcription={fk.controller()} />
const transcribeBtn = (root: HTMLElement, name: string) => barText(root).findByRole('button', { name })
const transcribeRe = /^transcribe \d+ pages?$/
const GARBLED = ['Limit', "Sn't S= (1) doint converge", 'lim s n', 'n5-6 =nsa', 'IN#6NnZN 1351-515'].join('\n')

/** Pages 4 to 6 have no text and nothing runs: the bar's `transcribe 3 pages` starts one run per file, and the button goes when they end. */
export const TranscribeButton: Story = {
    name: 'Transcribe button',
    beforeEach: () => startFake({ count: 6, have: [1, 2, 3] }),
    render: () => pagesBook(6),
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 6')
        const button = await transcribeBtn(canvasElement, 'transcribe 3 pages')
        await expect(fk.calls.length).toBe(0)
        await userEvent.click(button)
        await waitFor(() => expect(readout(canvasElement)).toContain('transcribing 1 of 3'), { timeout: 8000 })
        await expect(barText(canvasElement).queryByRole('button', { name: transcribeRe })).toBeNull()
        // grouped per file: one request each for pages 4 to 6, no engine chosen
        await waitFor(() => expect(fk.calls.map(c => c.file).sort()).toEqual([imagePath(4), imagePath(5), imagePath(6)]))
        await expect(fk.calls.every(c => !c.engine)).toBe(true)
        await fk.tick(8)
        await waitFor(() => expect(readout(canvasElement)).toBe('p. 1 / 6'), { timeout: 8000 })
        await expect(barText(canvasElement).queryByRole('button', { name: transcribeRe })).toBeNull()
    },
}

/** One page without text says `transcribe 1 page`. */
export const TranscribeOnePage: Story = {
    name: 'Transcribe one page',
    beforeEach: () => startFake({ count: 4, have: [1, 2, 3] }),
    render: () => pagesBook(4, 900),
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 4')
        await transcribeBtn(canvasElement, 'transcribe 1 page')
    },
}

/** `transcription.auto` on: opening a book with untranscribed pages transcribes them with no click. */
export const AutoTranscribes: Story = {
    name: 'Auto transcribes',
    beforeEach: () => startFake({ count: 4, have: [1], auto: true }),
    render: () => pagesBook(4, 900),
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(readout(canvasElement)).toContain('transcribing 1 of 3'), { timeout: 8000 })
        await expect(barText(canvasElement).queryByRole('button', { name: transcribeRe })).toBeNull()
        await expect(fk.calls.length).toBe(3)
        await expect(fk.calls.every(c => !c.engine)).toBe(true)
        await fk.tick(8)
        await waitFor(() => expect(readout(canvasElement)).toBe('p. 1 / 4'), { timeout: 8000 })
    },
}

/** `transcription.auto` off: nothing runs on open; the button is the only way to start. */
export const AutoOff: Story = {
    name: 'Auto off',
    beforeEach: () => startFake({ count: 4 }),
    render: () => pagesBook(4, 900),
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 4')
        const button = await transcribeBtn(canvasElement, 'transcribe 4 pages')
        await expect(fk.calls.length).toBe(0)
        await expect((await readRow(canvasElement, 'text')).disabled).toBe(true)
        await userEvent.click(button)
        await waitFor(() => expect(fk.calls.length).toBe(4), { timeout: 8000 })
    },
}

/** A page whose stored text looks like math (read on-device before math was looked for): opening the book asks once, and `read it properly` re-reads only that page carefully. */
export const StoredMathAsks: Story = {
    name: 'Stored math asks',
    beforeEach: () => {
        const undo = startFake({ count: 2, have: [1, 2], auto: true })
        fk.texts.set(`${imagePath(1)}#1`, GARBLED)
        return undo
    },
    render: () => pagesBook(2, 900),
    play: async () => {
        const body = within(document.body)
        await expect(await body.findByText('this page has math', undefined, { timeout: 8000 })).toBeInTheDocument()
        await userEvent.click(body.getByRole('button', { name: /read it properly/ }))
        await waitFor(() => expect(fk.calls.map(c => [c.file, c.pages, c.math])).toEqual([[imagePath(1), [1], 'careful']]), { timeout: 8000 })
    },
}

/** The math reader is missing: the prompt says it downloads itself, and `read it properly` installs it before the choice reaches the run. */
export const MathPromptInstallsReader: Story = {
    name: 'Math prompt installs the reader',
    beforeEach: () => startFake({ count: 3, auto: true, markerInstalled: false, mathKeys: [`${imagePath(1)}#1`] }),
    render: () => textBook(3, 'text'),
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain('transcribing'), { timeout: 8000 })
        await fk.tick(1)
        const body = within(document.body)
        await expect(await body.findByText(/the math reader downloads itself/, undefined, { timeout: 8000 })).toBeInTheDocument()
        await userEvent.click(body.getByRole('button', { name: /read it properly/ }))
        // install first, then a careful decide for each running file
        await waitFor(() => expect(fk.events.filter(e => e.startsWith('decide')).length).toBeGreaterThan(0), { timeout: 8000 })
        const files = [...new Set(fk.calls.map(c => c.file))]
        await expect(fk.events).toEqual(['install', ...files.map(() => 'decide:careful')])
    },
}

/** The prompt's count grows while the run goes on, and one choice answers every file waiting on it. */
export const MathCountGrows: Story = {
    name: 'Math count grows',
    beforeEach: () => startFake({ count: 6, auto: true, mathKeys: [2, 3].map(n => `${imagePath(n)}#1`) }),
    render: () => textBook(6, 'text'),
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain('transcribing'), { timeout: 8000 })
        const body = within(document.body)
        // the files start in whatever order their transcripts load: tick until the prompt shows
        for (let i = 0; i < 14 && !body.queryByText('this page has math'); i++) await fk.tick()
        await body.findByText('this page has math')
        for (let i = 0; i < 14 && !body.queryByText('2 pages have math'); i++) await fk.tick()
        await body.findByText('2 pages have math')
        await userEvent.click(body.getByRole('button', { name: 'go fast' }))
        await waitFor(() => expect(body.queryByText('2 pages have math')).toBeNull())
        await fk.tick(12)
        await waitFor(() => expect(shown(barNode(canvasElement))).not.toContain('transcribing'), { timeout: 8000 })
        await expect(body.queryByText(/have math|has math/)).toBeNull()
        await expect(fk.decisions.length).toBeGreaterThan(0)
        await expect(fk.decisions.every(d => d === 'fast')).toBe(true)
    },
}

/** Text mode with page 2 untranscribed: its section is empty and says `not transcribed`, the neighbours hold their text. */
export const PlaceholderPage: Story = {
    name: 'Placeholder page',
    beforeEach: () => startFake({ count: 4, have: [1, 3, 4] }),
    render: () => textBook(4, 'text'),
    play: async ({ canvasElement }) => {
        await textReady(canvasElement, 4)
        await waitFor(() => expect(statusOf(sections(canvasElement)[1])).toBe('not transcribedtranscribe'))
        await expect(editorOf(sections(canvasElement)[2])?.textContent).toContain('Page 3')
        await expect(editorOf(sections(canvasElement)[1])?.textContent ?? '').not.toContain('Page 2')
    },
}

/** Math in a transcript is typeset in text mode. */
export const MathText: Story = {
    name: 'Math text',
    beforeEach: () => {
        const undo = startFake({ count: 2 })
        for (const n of [1, 2]) fk.texts.set(`${imagePath(n)}#1`, `Page ${n}\n\nwith $a^2 + b^2 = c^2$ inline\n\n$$\\lim_{n \\to \\infty} \\frac{1}{n^2} = 0$$`)
        return undo
    },
    render: () => textBook(2, 'text'),
    play: async ({ canvasElement }) => {
        await textReady(canvasElement, 2)
        await waitFor(() => expect(canvasElement.querySelectorAll('.katex').length).toBeGreaterThan(1), { timeout: 8000 })
    },
}

/** A page that fails shows `failed // <reason>` and `[ retry ]`, and retry asks for just that page again. */
export const FailedPageRetry: Story = {
    name: 'Failed page retry',
    beforeEach: () => startFake({ count: 3, auto: true, failKeys: [`${imagePath(2)}#1`] }),
    render: () => textBook(3, 'text'),
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(shown(barNode(canvasElement))).toContain('transcribing'), { timeout: 8000 })
        await fk.tick(8)
        await waitFor(() => expect(statusOf(sections(canvasElement)[1])).toContain('failed // the reader returned nothing for this page'), { timeout: 8000 })
        const before = fk.calls.length
        await userEvent.click(within(sections(canvasElement)[1]).getByRole('button', { name: 'retry' }))
        await waitFor(() => expect(fk.calls.length).toBe(before + 1))
        await expect(fk.calls.at(-1)).toMatchObject({ file: imagePath(2), pages: [1] })
    },
}

/** With the selection inside a mark, the bar's highlight button unwraps it. */
export const HighlightUnwraps: Story = {
    name: 'Highlight unwraps',
    beforeEach: () => {
        const undo = startFake({ count: 2, have: [1, 2] })
        fk.texts.set(`${imagePath(1)}#1`, '==Page 1==\nthe rest of the page')
        return undo
    },
    render: () => textBook(2, 'text'),
    play: async ({ canvasElement }) => {
        await textReady(canvasElement, 2)
        await waitFor(() => expect(sections(canvasElement)[0].querySelector('.cm-tr-mark')).not.toBeNull())
        await selectFirstLine(sections(canvasElement)[0])
        await userEvent.click(barText(canvasElement).getByRole('button', { name: 'highlight' }))
        await waitFor(() => expect(fk.saves.at(-1)).toMatchObject({ file: imagePath(1), page: 1 }), { timeout: 8000 })
        await expect(fk.saves.at(-1)!.text).not.toContain('==')
        await waitFor(() => expect(sections(canvasElement)[0].querySelector('.cm-tr-mark')).toBeNull())
    },
}

/** A book of images and one PDF: text mode labels the PDF's pages `<file name> // page N`, the images show no divider. */
export const MixedBookText: Story = {
    name: 'Mixed book text',
    beforeEach: () => {
        const undo = startFake({ count: 3, have: [1, 2, 3] })
        fk.texts.set(`${PDF_PATH}#1`, 'Page 1 of the lecture')
        return undo
    },
    render: () => <Harness w={900} rows={[row(imagePath(1)), row(PDF_PATH), row(imagePath(2)), row(imagePath(3))]} view={bookView({ bookMode: 'text' })} transcription={fk.controller()} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(sections(canvasElement).length).toBeGreaterThanOrEqual(4), { timeout: 8000 })
        await waitFor(() => expect(canvasElement.textContent).toContain('lecture.pdf // page 1'), { timeout: 8000 })
        await expect(sections(canvasElement)[0].textContent).not.toMatch(/^page \d|page-1\.png \/\/ page/)
    },
}

/** The same mixed book side by side: each row carries its `<file name> // page N` label beside its picture. */
export const MixedBookSideBySide: Story = {
    name: 'Mixed book side by side',
    beforeEach: () => {
        const undo = startFake({ count: 3, have: [1, 2, 3] })
        fk.texts.set(`${PDF_PATH}#1`, 'Page 1 of the lecture')
        return undo
    },
    render: () => <Harness w={1000} rows={[row(imagePath(1)), row(PDF_PATH), row(imagePath(2)), row(imagePath(3))]} view={bookView({ bookMode: 'side' })} transcription={fk.controller()} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelectorAll('[data-side-by-side] [data-row-key]').length).toBeGreaterThanOrEqual(4), { timeout: 8000 })
        await waitFor(() => expect(canvasElement.textContent).toContain('lecture.pdf // page 1'), { timeout: 8000 })
    },
}

const [remountOn, setRemountOn] = createSignal(true)
/** Unmount the reader mid-run and mount it again with a fresh controller: the running jobs are picked up, so progress and `[ cancel ]` work. */
export const RemountMidRun: Story = {
    name: 'Remount mid run',
    beforeEach: () => {
        setRemountOn(true)
        return startFake({ count: 6 })
    },
    render: () => {
        const first = fk.controller()
        let mounts = 0
        const Mount = () => {
            const ctl = mounts++ === 0 ? first : fk.controller()
            return <Harness w={1100} h={720} rows={images(6)} transcription={ctl} />
        }
        return <Show when={remountOn()}><Mount /></Show>
    },
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 6')
        await userEvent.click(await transcribeBtn(canvasElement, 'transcribe 6 pages'))
        await waitFor(() => expect(readout(canvasElement)).toContain('transcribing 1 of 6'), { timeout: 8000 })
        await fk.tick(4)
        // pages done so far, whatever order the files started in
        const mid = /transcribing \d+ of 6/.exec(readout(canvasElement) ?? '')![0]
        await expect(mid).not.toBe('transcribing 1 of 6')
        const callsBefore = fk.calls.length
        setRemountOn(false)
        await waitFor(() => expect(canvasElement.querySelector('[data-book]')).toBeNull())
        setRemountOn(true)
        // nothing was posted again: the new controller found the running jobs itself
        // finished jobs started with the running ones stay in the count
        await waitFor(() => expect(readout(canvasElement)).toMatch(/transcribing \d+ of 6\b/), { timeout: 8000 })
        await expect(fk.calls.length).toBe(callsBefore)
        await userEvent.click(barText(canvasElement).getByRole('button', { name: 'cancel' }))
        await waitFor(() => expect(toasts().some(t => t.message.startsWith('stopped transcribing'))).toBe(true))
        await waitFor(() => expect(readout(canvasElement)).not.toMatch(/transcribing/))
    },
}

let bumpRows!: () => void
/** The parent rerenders with fresh `rows` and `view` objects: the focused section's editor is the same DOM node. */
export const RerenderKeepsEditor: Story = {
    name: 'Rerender keeps the editor',
    beforeEach: () => withText(3),
    render: () => {
        const [rows, setRows] = createSignal(images(3))
        const [view, setView] = createSignal(bookView({ bookMode: 'text' }))
        bumpRows = () => {
            setRows(images(3))
            setView(bookView({ bookMode: 'text' }))
        }
        return <Harness w={900} rows={rows()} view={view()} transcription={fk.controller()} />
    },
    play: async ({ canvasElement }) => {
        await textReady(canvasElement, 3)
        const node = editorOf(sections(canvasElement)[0])!
        await userEvent.click(node)
        await expect(node.contains(document.activeElement)).toBe(true)
        bumpRows()
        await expect(editorOf(sections(canvasElement)[0])).toBe(node)
        await expect(node.isConnected).toBe(true)
        await expect(node.contains(document.activeElement)).toBe(true)
    },
}

/** Inside a pane: a right-click bubbles up to PaneLeaf, which opens the pane's own menu, and only
 *  one menu is open at a time (activeMenu.ts). The stand-in does what PaneLeaf + App do — a real
 *  ContextMenu with the pane's rows — so the `highlight` button has to claim its right-click for
 *  the colour menu to stay up. Picking a colour arms the highlighter in it. */
export const HighlightColorsInPane: Story = {
    name: 'Highlight colours in a pane',
    beforeEach: () => serveFixtures(8),
    render: () => {
        const [paneMenu, setPaneMenu] = createSignal<{ x: number; y: number } | null>(null)
        return (
            <div
                data-pane-leaf="leaf-1"
                onContextMenu={e => {
                    e.preventDefault()
                    setPaneMenu({ x: e.clientX, y: e.clientY })
                }}
            >
                <Harness w={900} rows={images(8)} />
                <Show when={paneMenu()}>
                    {m => (
                        <ContextMenu
                            x={m().x}
                            y={m().y}
                            items={[{ label: 'Split right' }, { label: 'Close pane' }]}
                            onClose={() => setPaneMenu(null)}
                        />
                    )}
                </Show>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'p. 1 / 8')
        const btn = within(canvasElement).getByRole('button', { name: 'highlight' })
        const rows = () =>
            Array.from(document.querySelectorAll<HTMLElement>('[data-popover-row]')).map(r => r.textContent ?? '')
        rightClick(btn)
        await waitFor(() => expect(rows().some(t => t.includes('green'))).toBe(true))
        await expect(rows().some(t => t.includes('Split right'))).toBe(false)
        const green = Array.from(document.querySelectorAll<HTMLElement>('[data-popover-row]')).find(r =>
            r.textContent?.includes('green'),
        )!
        await userEvent.click(green)
        await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('true'))
        await waitFor(() => expect(rows()).toEqual([]))

        // a right-click on the page is still the pane's
        rightClick(canvasElement.querySelector<HTMLElement>('[data-book-page="right"]')!)
        await waitFor(() => expect(rows()).toEqual(['Split right', 'Close pane']))
        // left at rest: the menu closes
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(rows()).toEqual([]))
    },
}

// ── review checks: lines a reader may have misread ──

const UNSURE_LINE = 'and see if I could not learn what it had to teech'
const GARBLED_LINE = 'to frnot only the esentail facts of lfie'
const checkedText = (n: number) => `Page ${n}\n${LINE_TWO}\n${GARBLED_LINE}\n${UNSURE_LINE}`
/** Three pages: page 1 has an unsure and a garbled line, page 2 came back empty from the reader,
 *  page 3 reads clean. Line boxes put each flagged line on the page, so the popup shows its strip. */
function withChecks() {
    const restore = startFake({
        count: 3,
        lines: () => [
            { text: 'Page 1', x: 0.1, y: 0.06, w: 0.2, h: 0.04 },
            { text: LINE_TWO, x: 0.1, y: 0.12, w: 0.8, h: 0.04 },
            { text: GARBLED_LINE, x: 0.1, y: 0.17, w: 0.8, h: 0.04 },
            { text: UNSURE_LINE, x: 0.1, y: 0.22, w: 0.8, h: 0.04 },
        ],
    })
    fk.texts.set(`${imagePath(1)}#1`, checkedText(1))
    fk.checks.set(`${imagePath(1)}#1`, [
        { line: GARBLED_LINE, level: 'garbled' },
        { line: UNSURE_LINE, level: 'unsure' },
    ])
    fk.texts.set(`${imagePath(2)}#1`, '')
    fk.checks.set(`${imagePath(2)}#1`, [{ line: '', level: 'garbled' }])
    fk.texts.set(`${imagePath(3)}#1`, pageText(3))
    return restore
}
const glyphs = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('[data-transcript-check]'))
const popover = () => document.querySelector<HTMLElement>('[data-check-popover]')
const pressGlyph = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))

/** Text mode with review checks: a yellow glyph after an unsure line, a red one after a garbled
 *  line, a red one in the divider of a page read as nothing. Press a glyph: the popup shows the
 *  strip of the page the line came from, `[ looks right ]` and `[ retype ]`. */
export const ReviewChecks: Story = {
    name: 'Review checks',
    beforeEach: withChecks,
    render: () => textBook(3, 'text'),
    play: async ({ canvasElement }) => {
        await textReady(canvasElement, 3)
        await waitFor(() => expect(glyphs(canvasElement).map(g => g.dataset.transcriptCheck)).toEqual(['garbled', 'unsure']))
        const [garbled, unsure] = glyphs(canvasElement)
        await expect(getComputedStyle(garbled).color).not.toBe(getComputedStyle(unsure).color)
        // the glyph sits after its line's text, on the same row
        const line = garbled.closest('.cm-line')!
        await expect(line.textContent).toContain(GARBLED_LINE)
        // the empty page shows its red glyph and no `not transcribed`
        const second = sections(canvasElement)[1]
        await expect(second.querySelector('[data-page-check="garbled"]')).not.toBeNull()
        await expect(statusOf(second)).not.toContain('not transcribed')
    },
}

/** Press the unsure glyph, then `[ looks right ]`: the glyph goes and the approval is written. */
export const ReviewCheckApprove: Story = {
    name: 'Review check approve',
    beforeEach: withChecks,
    render: () => textBook(3, 'text'),
    play: async ({ canvasElement }) => {
        await textReady(canvasElement, 3)
        await waitFor(() => expect(glyphs(canvasElement).length).toBe(2))
        pressGlyph(glyphs(canvasElement)[1])
        await waitFor(() => expect(popover()).not.toBeNull())
        await expect(popover()!.textContent).toContain(UNSURE_LINE)
        await expect(popover()!.textContent).toContain('not sure of this line')
        await waitFor(() => expect(popover()!.querySelector('[data-check-crop]')?.getAttribute('data-check-crop')).toBe('ready'), { timeout: 8000 })
        await userEvent.click(popover()!.querySelector<HTMLElement>('[data-check-approve]')!)
        await waitFor(() => expect(glyphs(canvasElement).map(g => g.dataset.transcriptCheck)).toEqual(['garbled']))
        await expect(fk.approvals).toEqual([`${imagePath(1)}#1:${UNSURE_LINE}`])
        await expect(popover()).toBeNull()
    },
}

/** Press the garbled glyph, then `[ retype ]`: the line is selected, and typing over it clears the
 *  glyph with no approval at all. */
export const ReviewCheckRetype: Story = {
    name: 'Review check retype',
    beforeEach: withChecks,
    render: () => textBook(3, 'text'),
    play: async ({ canvasElement }) => {
        await textReady(canvasElement, 3)
        await waitFor(() => expect(glyphs(canvasElement).length).toBe(2))
        pressGlyph(glyphs(canvasElement)[0])
        await waitFor(() => expect(popover()).not.toBeNull())
        await expect(popover()!.textContent).toContain('this line read badly')
        await userEvent.click(popover()!.querySelector<HTMLElement>('[data-check-retype]')!)
        await waitFor(() => expect(window.getSelection()?.toString()).toBe(GARBLED_LINE))
        await userEvent.keyboard('to front only the essential facts of life')
        await waitFor(() => expect(glyphs(canvasElement).map(g => g.dataset.transcriptCheck)).toEqual(['unsure']))
        await expect(fk.approvals).toEqual([])
        await waitFor(() => expect(fk.saves.at(-1)?.text).toContain('to front only the essential facts of life'), { timeout: 3000 })
    },
}

/** Side by side carries the same glyphs beside the page, and the popup opens over the text column. */
export const ReviewChecksSideBySide: Story = {
    name: 'Review checks side by side',
    beforeEach: withChecks,
    render: () => textBook(3, 'side', 1000),
    play: async ({ canvasElement }) => {
        await sideReady(canvasElement, 3)
        await waitFor(() => expect(glyphs(canvasElement).length).toBe(2))
        await waitFor(() => expect(canvasElement.querySelector('[data-page-check="garbled"]')).not.toBeNull())
    },
}

/** Rests with the garbled line's popup open over text mode, the scan strip drawn. */
export const ReviewCheckOpen: Story = {
    name: 'Review check open',
    beforeEach: withChecks,
    render: () => textBook(3, 'text'),
    play: async ({ canvasElement }) => {
        await textReady(canvasElement, 3)
        await waitFor(() => expect(glyphs(canvasElement).length).toBe(2))
        pressGlyph(glyphs(canvasElement)[0])
        await waitFor(() => expect(popover()?.querySelector('[data-check-crop]')?.getAttribute('data-check-crop')).toBe('ready'), { timeout: 8000 })
    },
}
