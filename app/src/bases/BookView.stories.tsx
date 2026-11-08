// Visual spec for <BookView> — the book base's pane. Page images are canvases drawn here and served
// through a patched `api.assetUrl` as data URLs, so a story needs no files; the PDF is a repo
// fixture. The bar slots the view pushes up are drawn in a ViewBar above the pane, as BaseView
// does. `data-turn-state` on the view's root is the settled seam.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
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
import { bookPageUrl } from './_bookPages'
import { ARTICLE_CHART, ARTICLE_PHOTO, buildArticlePdf } from '../preview/_articlePdf'
import { paneMenuItemsOf, withPaneItems } from '../paneMenuExtras'

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
function Harness(props: { w: number; h?: number; basePath?: string; rows: Row[]; view?: ViewConfig; transcribing?: { done: number; total: number }; onOuterMenu?: () => void }) {
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
                    transcribing={props.transcribing}
                />
            </div>
        </div>
    )
}

const readout = (root: HTMLElement) =>
    within(root.querySelector<HTMLElement>('[data-testid="book-bar"]')!).queryByText(/^pages? \d/)?.textContent

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
    play: async ({ canvasElement }) => ready(canvasElement, 'page 1 // 6'),
}

export const Spread: Story = {
    beforeEach: () => serveFixtures(8),
    render: () => <Harness w={900} rows={images(8)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'page 1 // 8')
        await pressNext(canvasElement, 1, 'pages 2–3 // 8')
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
        await waitFor(() => expect(readout(canvasElement)).toBe('page 1 // 6'), { timeout: 8000 })
        const col = canvasElement.querySelector<HTMLElement>('[data-book-scroll]')!
        const third = canvasElement.querySelector<HTMLElement>('[data-book-scroll-page="2"]')!
        col.scrollTop = third.offsetTop - col.offsetTop + 4
        col.dispatchEvent(new Event('scroll'))
        await waitFor(() => expect(readout(canvasElement)).toBe('page 3 // 6'), { timeout: 8000 })
        await expect(within(canvasElement).getByRole('button', { name: 'scroll' })).toHaveAttribute('aria-pressed', 'true')
        await userEvent.click(within(canvasElement).getByRole('button', { name: 'pages' }))
        await waitFor(() => expect(readout(canvasElement)).toBe('pages 2–3 // 6'), { timeout: 8000 })
        await expect(canvasElement.querySelector('[data-book-scroll]')).toBeNull()
    },
}

/** 4:3 landscape photos: the pages take the photos' aspect, not a portrait slab. */
export const LandscapePages: Story = {
    name: 'Landscape pages',
    beforeEach: () => serveFixtures(8, true),
    render: () => <Harness w={1100} rows={images(8)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'page 1 // 8')
        await pressNext(canvasElement, 1, 'pages 2–3 // 8')
        const r = canvasElement.querySelector('[data-book-page="right"]')!.getBoundingClientRect()
        await expect(r.width / r.height).toBeCloseTo(4 / 3, 1)
    },
}

export const Single: Story = {
    beforeEach: () => serveFixtures(8),
    render: () => <Harness w={900} rows={images(8)} view={bookView({ bookLayout: 'single' })} />,
    play: async ({ canvasElement }) => ready(canvasElement, 'page 1 // 8'),
}

export const NarrowPane: Story = {
    beforeEach: () => serveFixtures(8),
    render: () => <Harness w={480} rows={images(8)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'page 1 // 8')
        expect(canvasElement.querySelector('[data-book-page="left"]')).toBeNull()
        // the bar drops its controls into [≡] before it squeezes the crumb to `n…`
        const title = canvasElement.querySelector<HTMLElement>('[data-bar-title]')!
        await waitFor(() => expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth), { timeout: 8000 })
    },
}

/** The bar holds the `pages | text` switch and icons; the layout is a row of the `Aa` display
 *  panel. Choosing `single` there turns a wide pane's spreads into one page at a time. */
export const DisplayPanel: Story = {
    name: 'Display panel',
    beforeEach: () => serveFixtures(8),
    render: () => <Harness w={900} rows={images(8)} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await ready(canvasElement, 'page 1 // 8')
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
        await pressNext(canvasElement, 1, 'page 2 // 8')
    },
}

export const OddCountEnd: Story = {
    beforeEach: () => serveFixtures(5),
    render: () => <Harness w={900} rows={images(5)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'page 1 // 5')
        await pressNext(canvasElement, 2, 'pages 4–5 // 5')
    },
}

export const EvenCountEnd: Story = {
    beforeEach: () => serveFixtures(6),
    render: () => <Harness w={900} rows={images(6)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'page 1 // 6')
        await pressNext(canvasElement, 3, 'page 6 // 6')
    },
}

/** The cover file is gone: a paper placeholder names it. */
export const MissingPage: Story = {
    beforeEach: () => serveFixtures(4),
    render: () => <Harness w={900} rows={[row('pages/lost scan.png'), ...images(4)]} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'page 1 // 5')
        await expect(within(canvasElement).getByText('missing: lost scan.png')).toBeInTheDocument()
    },
}

/** A missing page does not stop the book turning. */
export const MissingPageStillTurns: Story = {
    beforeEach: () => serveFixtures(4),
    render: () => <Harness w={900} rows={[row('pages/lost scan.png'), ...images(4)]} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'page 1 // 5')
        await pressNext(canvasElement, 1, 'pages 2–3 // 5')
    },
}

export const TurnForwardByKey: Story = {
    beforeEach: () => serveFixtures(6),
    render: () => <Harness w={900} rows={images(6)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'page 1 // 6')
        await pressNext(canvasElement, 1, 'pages 2–3 // 6')
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
        await ready(canvasElement, 'page 1 // 6')
        await dragFromRightEdge(canvasElement, [0.9, 0.8, 0.65, 0.5, 0.42])
        await waitFor(() => expect(readout(canvasElement)).toBe('pages 2–3 // 6'), { timeout: 8000 })
    },
}

export const DragFallBack: Story = {
    beforeEach: () => serveFixtures(6),
    render: () => <Harness w={900} rows={images(6)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'page 1 // 6')
        await dragFromRightEdge(canvasElement, [0.9, 0.8, 0.7, 0.66])
        await waitFor(() => expect(host(canvasElement).dataset.turnState).toBe('settled'), { timeout: 8000 })
        await expect(readout(canvasElement)).toBe('page 1 // 6')
    },
}

export const MixedImagesAndPdf: Story = {
    beforeEach: () => serveFixtures(3),
    render: () => <Harness w={900} rows={[row(imagePath(1)), row(PDF_PATH), row(imagePath(2)), row(imagePath(3))]} />,
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                const m = readout(canvasElement)?.match(/^page 1 \/\/ (\d+)$/)
                expect(m && Number(m[1])).toBeGreaterThanOrEqual(4)
            },
            { timeout: 8000 },
        )
    },
}

export const Transcribing: Story = {
    beforeEach: () => serveFixtures(6),
    render: () => <Harness w={900} rows={images(6)} transcribing={{ done: 3, total: 12 }} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(readout(canvasElement)).toBe('page 1 // 6 // transcribing 3 of 12'), { timeout: 8000 })
    },
}

export const FullBook: Story = {
    name: 'Full book',
    beforeEach: () => withText(6),
    render: () => <Harness w={1100} h={720} rows={images(6)} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await ready(canvasElement, 'page 1 // 6')
        await pressNext(canvasElement, 2, 'pages 4–5 // 6')
        // every page has text: no transcript icon, no panel, no transcribe button
        await expect(c.queryByRole('button', { name: 'transcript' })).toBeNull()
        await expect(c.queryByText(/^text \/\//)).toBeNull()
        await expect(c.queryByText(/^transcribe \d+ pages?$/)).toBeNull()
        await expect(modeButton(canvasElement, 'text')).not.toBeDisabled()
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
    await waitFor(() => expect(readout(root)).toMatch(/^page 1 \/\/ \d+$/), { timeout: 8000 })
    await waitFor(() => expect(host(root).hasAttribute('data-book-prefetched')).toBe(true), { timeout: 8000 })
    await pressNext(root, 1, readout(root)!.replace(/^page 1/, 'pages 2–3'))
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
        await ready(canvasElement, 'page 1 // 6')
        await userEvent.click(c.getByRole('button', { name: 'bookmarks' }))
        await waitFor(() => expect(canvasElement.querySelector('[data-book-bookmarks]')).not.toBeNull())
        await annotationsReady(canvasElement)
        await userEvent.click(c.getByRole('button', { name: 'Bookmark this page' }))
        await waitFor(() => expect(c.getByText('Page 1')).toBeInTheDocument())
        await pressNext(canvasElement, 2, 'pages 4–5 // 6')
        await userEvent.click(c.getByText('Page 1'))
        await waitFor(() => expect(readout(canvasElement)).toBe('page 1 // 6'), { timeout: 8000 })
    },
}

export const RegionHighlight: Story = {
    name: 'Region highlight',
    beforeEach: () => serveFixtures(6),
    render: () => <Harness w={1100} h={720} rows={images(6)} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await ready(canvasElement, 'page 1 // 6')
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

const WORDS = `I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived. I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary. I wanted to live deep and suck out all the marrow of life, to live so sturdily and Spartan-like as to put to rout all that was not life, to cut a broad swath and shave close, to drive life into a corner, and reduce it to its lowest terms.`

/** One transcript per page file, each a paragraph that starts with its own number. */
const TRANSCRIPTS = new Map<string, string>()
const marked: { file: string; page?: number; add?: string[]; remove?: string[] }[] = []

/** Serves transcripts for the fixture pages (`texts`, or numbered prose) and a `markTranscript` that
 *  rewrites them, as the route would. */
function serveTranscripts(count: number, texts?: string[], engine: 'on-device' | 'marker' = 'on-device') {
    TRANSCRIPTS.clear()
    marked.length = 0
    for (let n = 1; n <= count; n++) TRANSCRIPTS.set(imagePath(n), texts?.[n - 1] ?? `Page ${n}. ${WORDS}`)
    const original = { transcript: api.storedTranscript, mark: api.markTranscript }
    api.storedTranscript = async (file: string) => ({
        engine,
        at: '2026-10-31T00:00:00.000Z',
        pages: TRANSCRIPTS.has(file) ? [{ page: 1, text: TRANSCRIPTS.get(file)! }] : [],
    })
    api.markTranscript = async req => {
        marked.push(req)
        let text = TRANSCRIPTS.get(req.file) ?? ''
        for (const q of req.add ?? []) text = text.replace(q, `==${q}==`)
        for (const q of req.remove ?? []) text = text.replace(`==${q}==`, q)
        TRANSCRIPTS.set(req.file, text)
        return { ok: true, companion: `${req.file}.md`, marks: [] }
    }
    return () => {
        api.storedTranscript = original.transcript
        api.markTranscript = original.mark
    }
}

const withText = (n: number) => {
    const a = serveFixtures(n)
    const b = serveTranscripts(n)
    return () => {
        a()
        b()
    }
}

const textSpread = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-text-spread]')
const textLines = (root: HTMLElement, side: 'left' | 'right') =>
    Array.from(root.querySelectorAll<HTMLElement>(`[data-text-page="${side}"] [data-text-line]`))
const readyText = async (root: HTMLElement) => {
    await waitFor(() => expect(textSpread(root)).not.toBeNull(), { timeout: 8000 })
    await waitFor(() => expect(host(root).hasAttribute('data-book-prefetched')).toBe(true), { timeout: 8000 })
}
const modeButton = (root: HTMLElement, name: 'pages' | 'text') => within(root).getByRole('button', { name })

/** Lecture notes as Marker transcribed them from a handwritten notebook: headings, inline and
 *  display math, short lines. */
const MATH_NOTES = [
    String.raw`## Polynomials Applied to Operators

$$\alpha : \mathcal{P}(\mathbb{F}) \rightarrow \mathcal{L}(V), \quad p \mapsto p(t)$$

plug in the operator into the polynomials

Nul $\alpha$ = set of multiples of same m: minimal polynomial

minimal polynomial is unique

degree of minimal polynomial is $\leq \dim V$

dim 2 example

$$A = \begin{bmatrix} a & b \\ c & d \end{bmatrix}$$

$$z^2 - (a+d)z = (ad-bc) \quad \leftarrow \text{characteristic polynomial}$$`,
    String.raw`Claim

$$\lim_{n \rightarrow \infty} \frac{1}{n^2} = 0$$

proof

Let $\epsilon > 0$

$$\text{define } N = \frac{1}{\sqrt{\epsilon}}$$

$$\left| \frac{1}{n^2} \right| = \frac{1}{n^2} \quad (\forall n > N)$$

Assume $\lim_{n \rightarrow \infty} s_n = a \in \mathbb{R} \rightarrow$ for $\epsilon = 1$ exists $N > 0$ such that $|(-1)^n - a| < 1 \quad \forall n > N$

Therefore $s_n$ cannot have a limit $\square$`,
]

const withMathText = () => {
    const a = serveFixtures(2)
    const b = serveTranscripts(2, MATH_NOTES, 'marker')
    return () => {
        a()
        b()
    }
}

/** Handwritten lecture notes in text mode: headings set bold, formulas set by KaTeX, display math
 *  centred on its own line; `+` on the display panel's text size sets the type larger and the pages reflow. */
export const MathText: Story = {
    name: 'Math text',
    beforeEach: withMathText,
    render: () => <Harness w={1100} h={720} rows={images(2)} view={bookView({ bookMode: 'text' })} />,
    play: async ({ canvasElement }) => {
        setSettings('reader', 'textScale', 1)
        await readyText(canvasElement)
        const spread = () => textSpread(canvasElement)!
        await waitFor(() => expect(spread().querySelectorAll('[data-text-math] .katex').length).toBeGreaterThan(3), { timeout: 8000 })
        const display = spread().querySelector<HTMLElement>('[data-text-math="display"]')!
        await expect(display.dataset.source).toMatch(/^\$\$/)
        await expect(spread().querySelector('[data-text-line] [data-text-run]')!.textContent).toBe('Polynomials Applied to Operators')
        const size = () => parseFloat(getComputedStyle(spread()).fontSize)
        const pagesNow = () => Number(readout(canvasElement)!.match(/\/\/ (\d+)$/)![1])
        const [px, count] = [size(), pagesNow()]
        await userEvent.click(within(canvasElement).getByRole('button', { name: 'display' }))
        await userEvent.click(await within(document.body).findByRole('button', { name: 'larger text' }))
        await waitFor(() => expect(settings.reader.textScale).toBeGreaterThan(1))
        // the type grows and the pages reflow to it
        await waitFor(() => expect(size()).toBeGreaterThan(px), { timeout: 8000 })
        await expect(pagesNow()).toBeGreaterThanOrEqual(count)
        setSettings('reader', 'textScale', 1)
    },
}

/** The transcripts set as a book: serif lines, a cover page, then spreads, with the page number under it. */
export const TextMode: Story = {
    name: 'Text mode',
    beforeEach: () => withText(6),
    render: () => <Harness w={1100} h={720} rows={images(6)} view={bookView({ bookMode: 'text' })} />,
    play: async ({ canvasElement }) => {
        await readyText(canvasElement)
        await waitFor(() => expect(readout(canvasElement)).toMatch(/^page 1 \/\/ \d+$/), { timeout: 8000 })
        await expect(textLines(canvasElement, 'right').length).toBeGreaterThan(5)
        const count = Number(readout(canvasElement)!.match(/\/\/ (\d+)$/)![1])
        await pressNext(canvasElement, 1, `pages 2–3 // ${count}`)
        await expect(within(canvasElement).getByText(`2–3 of ${count}`)).toBeInTheDocument()
        // the pages sit on the pane: no page edges
        await expect(getComputedStyle(canvasElement.querySelector('[data-text-page="right"]')!).borderTopWidth).toBe('0px')
    },
}

/** Pages to text and back keeps the reader on the same words. */
export const SwitchKeepsPlace: Story = {
    name: 'Switch keeps place',
    beforeEach: () => withText(6),
    render: () => <Harness w={1100} h={720} rows={images(6)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'page 1 // 6')
        await pressNext(canvasElement, 2, 'pages 4–5 // 6')
        await userEvent.click(modeButton(canvasElement, 'text'))
        await readyText(canvasElement)
        await waitFor(() => expect(readout(canvasElement)).toMatch(/^pages \d+–\d+ \/\/ \d+$/), { timeout: 8000 })
        const left = textLines(canvasElement, 'left')
        const leaves = [...left, ...textLines(canvasElement, 'right')].map(l => Number(l.dataset.leaf))
        // the notebook page being read (4, leaf 3) is on screen, and the left page began at or before it
        await expect(leaves).toContain(3)
        const leftFirst = Number(left[0].dataset.leaf)
        await expect(leftFirst).toBeLessThanOrEqual(3)
        await userEvent.click(modeButton(canvasElement, 'pages'))
        // straight back, no page turned: exactly the spread the reader left, every round trip
        await waitFor(() => expect(readout(canvasElement)).toBe('pages 4–5 // 6'), { timeout: 8000 })
        await expect(host(canvasElement).querySelector('[data-text-spread]')).toBeNull()
        for (let i = 0; i < 2; i++) {
            await userEvent.click(modeButton(canvasElement, 'text'))
            await readyText(canvasElement)
            await userEvent.click(modeButton(canvasElement, 'pages'))
            await waitFor(() => expect(readout(canvasElement)).toBe('pages 4–5 // 6'), { timeout: 8000 })
        }
        // from the last page too
        await pressNext(canvasElement, 1, 'page 6 // 6')
        await userEvent.click(modeButton(canvasElement, 'text'))
        await readyText(canvasElement)
        await userEvent.click(modeButton(canvasElement, 'pages'))
        await waitFor(() => expect(readout(canvasElement)).toBe('page 6 // 6'), { timeout: 8000 })
        // after turning in text mode: the notebook page whose text begins on the text spread shown
        await userEvent.click(modeButton(canvasElement, 'text'))
        await readyText(canvasElement)
        await userEvent.keyboard('{ArrowLeft}')
        await waitFor(() => expect(host(canvasElement).dataset.turnState).toBe('settled'), { timeout: 8000 })
        const shown = [...textLines(canvasElement, 'left'), ...textLines(canvasElement, 'right')]
        const begins = shown.find(l => l.dataset.start === '0') ?? shown[0]
        const leaf = Number(begins.dataset.leaf)
        await userEvent.click(modeButton(canvasElement, 'pages'))
        const expected = leaf === 0 ? 'page 1 // 6' : leaf === 5 ? 'page 6 // 6' : `pages ${leaf % 2 === 1 ? leaf + 1 : leaf}–${leaf % 2 === 1 ? leaf + 2 : leaf + 1} // 6`
        await waitFor(() => expect(readout(canvasElement)).toBe(expected), { timeout: 8000 })
    },
}

/** A selection of words, then `highlight`, saves one quote and the run renders marked. */
export const HighlightSelection: Story = {
    name: 'Highlight selection',
    beforeEach: () => withText(6),
    render: () => <Harness w={1100} h={720} rows={images(6)} view={bookView({ bookMode: 'text' })} />,
    play: async ({ canvasElement }) => {
        await readyText(canvasElement)
        await waitFor(() => expect(textLines(canvasElement, 'right').length).toBeGreaterThan(3), { timeout: 8000 })
        const line = textLines(canvasElement, 'right')[2]
        const node = line.firstChild!.firstChild as Text
        const from = 0
        const to = node.data.indexOf(' ', 12)
        const range = document.createRange()
        range.setStart(node, from)
        range.setEnd(node, to)
        const sel = window.getSelection()!
        sel.removeAllRanges()
        sel.addRange(range)
        const quote = node.data.slice(from, to).trim()
        // a plain click: user-event would move the selection with the press
        within(canvasElement).getByRole('button', { name: 'highlight' }).click()
        await waitFor(() => expect(marked.length).toBe(1), { timeout: 8000 })
        await expect(marked[0]).toMatchObject({ file: line.dataset.file, page: 1, add: [quote] })
        await waitFor(() => expect(canvasElement.querySelector('[data-text-mark]')?.textContent).toContain(quote.split(' ')[0]), { timeout: 8000 })
    },
}

/** Text mode: the pointer over a highlight turns into an X and a click unmarks the words in the
 *  transcript; the toast's `undo` marks them again. Click the tinted words to try it. */
export const TextHighlightClickRemoves: Story = {
    name: 'Text highlight click removes',
    beforeEach: () => withText(6),
    render: () => (
        <>
            <Harness w={1100} h={720} rows={images(6)} view={bookView({ bookMode: 'text' })} />
            <ToastHost />
        </>
    ),
    play: async (ctx) => {
        await HighlightSelection.play!(ctx)
        const { canvasElement } = ctx
        window.getSelection()?.removeAllRanges()
        const mark = canvasElement.querySelector<HTMLElement>('[data-text-mark]')!
        const quote = marked[0]!.add![0]!
        hoverOver(mark)
        await waitFor(() => expect(cursorIsX()).toBe(true))
        clickOn(mark)
        await waitFor(() => expect(marked.at(-1)).toMatchObject({ remove: [quote] }), { timeout: 8000 })
        await waitFor(() => expect(canvasElement.querySelector('[data-text-mark]')).toBeNull(), { timeout: 8000 })
        await userEvent.click(await undoButton())
        await waitFor(() => expect(marked.at(-1)).toMatchObject({ add: [quote] }), { timeout: 8000 })
        await waitFor(() => expect(canvasElement.querySelector('[data-text-mark]')).not.toBeNull(), { timeout: 8000 })
    },
}

/** Nothing selected: `highlight` arms, the next selection is highlighted, a click on a highlight removes it. */
export const HighlightArmed: Story = {
    name: 'Highlight armed',
    beforeEach: () => withText(6),
    render: () => <Harness w={1100} h={720} rows={images(6)} view={bookView({ bookMode: 'text' })} />,
    play: async ({ canvasElement }) => {
        await readyText(canvasElement)
        await waitFor(() => expect(textLines(canvasElement, 'right').length).toBeGreaterThan(3), { timeout: 8000 })
        const button = within(canvasElement).getByRole('button', { name: 'highlight' })
        button.click()
        const line = textLines(canvasElement, 'right')[1]
        const node = line.firstChild!.firstChild as Text
        const range = document.createRange()
        range.setStart(node, 0)
        range.setEnd(node, node.data.indexOf(' ', 8))
        const sel = window.getSelection()!
        sel.removeAllRanges()
        sel.addRange(range)
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
        await waitFor(() => expect(marked.filter(m => m.add).length).toBe(1), { timeout: 8000 })
        await waitFor(() => expect(canvasElement.querySelector('[data-text-mark]')).not.toBeNull(), { timeout: 8000 })
        // armed again, a click on the highlight removes it
        button.click()
        canvasElement.querySelector<HTMLElement>('[data-text-mark]')!.click()
        await waitFor(() => expect(marked.filter(m => m.remove).length).toBe(1), { timeout: 8000 })
        await waitFor(() => expect(canvasElement.querySelector('[data-text-mark]')).toBeNull(), { timeout: 8000 })
    },
}

/** No page has a transcript: `text` is disabled and says why. */
export const TextDisabledWithoutTranscripts: Story = {
    name: 'Text disabled without transcripts',
    beforeEach: () => serveFixtures(4),
    render: () => <Harness w={900} rows={images(4)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'page 1 // 4')
        const text = modeButton(canvasElement, 'text')
        await expect(text).toBeDisabled()
        await expect(text.getAttribute('title')).toBe('no page is transcribed yet')
    },
}

// ── transcription ──

/** The transcription a story drives. `api.transcribe` waits until the story calls `finish()` (or fails
 *  with `failWith`), so every state in between is observable without a timer. */
const seam = {
    calls: [] as Parameters<typeof api.transcribe>[0][],
    waiting: [] as (() => void)[],
    open: false,
    failWith: undefined as string | undefined,
    /** Page files whose fast read looks like math: a `math: 'fast'` run reports page 1 back. */
    mathFiles: new Set<string>(),
    finish() {
        this.open = true
        for (const r of this.waiting.splice(0)) r()
    },
}

/** Pages `have` start with text; the rest get it when a run finishes. Auto-transcription is `auto`. */
function serveTranscription(count: number, have: number[], auto: boolean) {
    seam.calls = []
    seam.waiting = []
    seam.open = false
    seam.failWith = undefined
    seam.mathFiles = new Set()
    TRANSCRIPTS.clear()
    for (const n of have) TRANSCRIPTS.set(imagePath(n), `Page ${n}. ${WORDS}`)
    const original = { transcript: api.storedTranscript, transcribe: api.transcribe }
    api.storedTranscript = async (file: string) => ({
        engine: 'on-device' as const,
        at: '2026-10-31T00:00:00.000Z',
        pages: TRANSCRIPTS.has(file) ? [{ page: 1, text: TRANSCRIPTS.get(file)! }] : [],
    })
    api.transcribe = async body => {
        seam.calls.push(body)
        if (!seam.open) await new Promise<void>(r => seam.waiting.push(r))
        if (seam.failWith) throw new Error(seam.failWith)
        TRANSCRIPTS.set(body.file, `Page ${body.file.match(/(\d+)/)![1]}. ${WORDS}`)
        const math = body.math === 'fast' && seam.mathFiles.has(body.file) ? { math: [1] } : {}
        return { ok: true, companion: `${body.file}.md`, engine: body.engine === 'ai' ? 'ai' : 'on-device', pages: [{ page: 1, chars: 10 }], ...math }
    }
    const prior = (settings as { transcription?: unknown }).transcription
    ;(setSettings as (k: string, v: unknown) => void)('transcription', { auto, engine: 'auto', math: 'ask', provider: 'auto', model: '' })
    const fixtures = serveFixtures(count)
    return () => {
        fixtures()
        api.storedTranscript = original.transcript
        api.transcribe = original.transcribe
        ;(setSettings as (k: string, v: unknown) => void)('transcription', prior)
    }
}

const barText = (root: HTMLElement) => within(root.querySelector<HTMLElement>('[data-testid="book-bar"]')!)
const transcribeButton = (root: HTMLElement, name: string) => barText(root).findByRole('button', { name })

/** Pages 4 to 6 have no text and nothing runs: the bar's first action is `transcribe 3 pages`. A click starts the run, and when it ends nothing replaces the button. */
export const TranscribeButton: Story = {
    name: 'Transcribe button',
    beforeEach: () => serveTranscription(6, [1, 2, 3], false),
    render: () => <Harness w={1100} h={720} rows={images(6)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'page 1 // 6')
        const button = await transcribeButton(canvasElement, 'transcribe 3 pages')
        const buttons = within(canvasElement.querySelector<HTMLElement>('[data-testid="book-bar"]')!).getAllByRole('button')
        await expect(buttons.indexOf(button)).toBeLessThan(buttons.indexOf(barText(canvasElement).getByRole('button', { name: 'highlight' })))
        await expect(seam.calls.length).toBe(0)
        await userEvent.click(button)
        await waitFor(() => expect(readout(canvasElement)).toBe('page 1 // 6 // transcribing 1 of 3'), { timeout: 8000 })
        await expect(barText(canvasElement).queryByRole('button', { name: /^transcribe \d+ pages?$/ })).toBeNull()
        // the button's run sends no engine and fills only the gaps
        await waitFor(() => expect(seam.calls.length).toBe(1), { timeout: 8000 })
        await expect(seam.calls[0]).toMatchObject({ file: 'pages/page-4.png', pages: [1], onlyMissing: false })
        await expect('engine' in seam.calls[0]).toBe(false)
        seam.finish()
        await waitFor(() => expect(readout(canvasElement)).toBe('page 1 // 6'), { timeout: 8000 })
        await expect(seam.calls.length).toBe(3)
        await expect(barText(canvasElement).queryByRole('button', { name: /^transcribe \d+ pages?$/ })).toBeNull()
    },
}

/** One page without text says `transcribe 1 page`. */
export const TranscribeOnePage: Story = {
    name: 'Transcribe one page',
    beforeEach: () => serveTranscription(4, [1, 2, 3], false),
    render: () => <Harness w={900} rows={images(4)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'page 1 // 4')
        await transcribeButton(canvasElement, 'transcribe 1 page')
    },
}

/** `transcription.auto` on: opening a book with untranscribed pages transcribes them with no click. */
export const AutoTranscribes: Story = {
    name: 'Auto transcribes',
    beforeEach: () => serveTranscription(4, [1], true),
    render: () => <Harness w={900} rows={images(4)} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(readout(canvasElement)).toBe('page 1 // 4 // transcribing 1 of 3'), { timeout: 8000 })
        await expect(barText(canvasElement).queryByRole('button', { name: /^transcribe \d+ pages?$/ })).toBeNull()
        seam.finish()
        await waitFor(() => expect(readout(canvasElement)).toBe('page 1 // 4'), { timeout: 8000 })
        await expect(seam.calls.length).toBe(3)
        await expect(seam.calls.every(c => !('engine' in c))).toBe(true)
    },
}

/** Two of three pages read as math on the fast pass, with `transcription.math` at `ask`: once the run
 *  ends one prompt asks about both. `read it properly` re-reads only those pages, carefully. */
export const MathPromptAfterRun: Story = {
    name: 'Math prompt after a run',
    beforeEach: () => {
        const undo = serveTranscription(3, [], true)
        seam.mathFiles = new Set([imagePath(2), imagePath(3)])
        return undo
    },
    render: () => <Harness w={900} rows={images(3)} />,
    play: async () => {
        await waitFor(() => expect(seam.calls.length).toBe(1), { timeout: 8000 })
        await expect(seam.calls[0].math).toBe('fast')
        seam.finish()
        const body = within(document.body)
        await expect(await body.findByText('2 pages have math', undefined, { timeout: 8000 })).toBeInTheDocument()
        await expect(seam.calls.length).toBe(3)
        await userEvent.click(body.getByRole('button', { name: /read it properly/ }))
        await waitFor(() => expect(seam.calls.length).toBe(5), { timeout: 8000 })
        await expect(seam.calls.slice(3).map(c => [c.file, c.pages, c.math])).toEqual([
            [imagePath(2), [1], 'careful'],
            [imagePath(3), [1], 'careful'],
        ])
        await waitFor(() => expect(body.queryByText('2 pages have math')).toBeNull())
    },
}

/** The math reader is not installed: the prompt says it downloads, `read it properly` starts the
 *  install, the readout says so while it runs, and the careful re-reads follow when it is done. */
export const MathPromptInstallsReader: Story = {
    name: 'Math prompt installs the reader',
    beforeEach: () => {
        const undo = serveTranscription(2, [], true)
        seam.mathFiles = new Set([imagePath(1)])
        const original = { status: api.markerSetup, start: api.startMarkerSetup }
        let polls = 0
        api.markerSetup = async () => ({
            installed: polls > 1,
            missing: polls > 1 ? [] : ['marker_single'],
            job: polls++ > 1 ? { state: 'done', startedAt: 0, endedAt: 1 } : { state: 'running', step: 'marker', startedAt: 0 },
        })
        api.startMarkerSetup = async () => ({ state: 'running', step: 'uv', startedAt: 0 })
        return () => {
            undo()
            api.markerSetup = original.status
            api.startMarkerSetup = original.start
        }
    },
    render: () => <Harness w={900} rows={images(2)} />,
    play: async ({ canvasElement }) => {
        seam.finish()
        const body = within(document.body)
        await expect(await body.findByText(/the math reader downloads itself/, undefined, { timeout: 8000 })).toBeInTheDocument()
        await userEvent.click(body.getByRole('button', { name: /read it properly/ }))
        await waitFor(() => expect(readout(canvasElement)).toMatch(/\/\/ setting up the math reader$/), { timeout: 8000 })
        await waitFor(() => expect(seam.calls.some(c => c.math === 'careful' && c.file === imagePath(1))).toBe(true), { timeout: 12000 })
        await waitFor(() => expect(readout(canvasElement)).not.toMatch(/setting up/), { timeout: 8000 })
    },
}

/** A page the built-in reader transcribed before math was looked for: its stored text looks like
 *  math, so opening the book asks once, and `read it properly` re-reads only that page carefully. */
export const StoredMathAsks: Story = {
    name: 'Stored math asks',
    beforeEach: () => {
        const undo = serveTranscription(2, [1, 2], true)
        TRANSCRIPTS.set(imagePath(1), ['Limit', "Sn't S= (1) doint converge", 'lim s n', 'n5-6 =nsa', 'IN#6NnZN 1351-515'].join('\n'))
        return undo
    },
    render: () => <Harness w={900} rows={images(2)} />,
    play: async () => {
        const body = within(document.body)
        await expect(await body.findByText('this page has math', undefined, { timeout: 8000 })).toBeInTheDocument()
        await userEvent.click(body.getByRole('button', { name: /read it properly/ }))
        seam.finish()
        await waitFor(() => expect(seam.calls.map(c => [c.file, c.pages, c.math])).toEqual([[imagePath(1), [1], 'careful']]), { timeout: 8000 })
    },
}

/** `transcription.auto` off: nothing runs on open; the button is the only way to start. */
export const AutoOff: Story = {
    name: 'Auto off',
    beforeEach: () => serveTranscription(4, [], false),
    render: () => <Harness w={900} rows={images(4)} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'page 1 // 4')
        const button = await transcribeButton(canvasElement, 'transcribe 4 pages')
        await expect(seam.calls.length).toBe(0)
        await expect(modeButton(canvasElement, 'text')).toBeDisabled()
        await userEvent.click(button)
        await waitFor(() => expect(seam.calls.length).toBe(1), { timeout: 8000 })
    },
}

/** Text mode with page 2 untranscribed: its text page holds one muted line, and the neighbours'
 *  pages hold their text; each notebook page starts its own text page. */
export const PlaceholderPage: Story = {
    name: 'Placeholder page',
    beforeEach: () => serveTranscription(4, [1, 3, 4], false),
    render: () => <Harness w={1100} h={720} rows={images(4)} view={bookView({ bookMode: 'text' })} />,
    play: async ({ canvasElement }) => {
        await readyText(canvasElement)
        // page 1's text is the cover; page 2's begins the next spread
        await waitFor(() => expect(readout(canvasElement)).toMatch(/^page 1 \/\/ \d+$/), { timeout: 8000 })
        await userEvent.keyboard('{ArrowRight}')
        await waitFor(() => expect(host(canvasElement).dataset.turnState).toBe('settled'), { timeout: 8000 })
        await waitFor(() => expect(canvasElement.querySelector('[data-text-placeholder]')).not.toBeNull(), { timeout: 8000 })
        const held = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-text-placeholder]'))
        await expect(held.map(l => l.textContent).join(' ')).toBe("page 2 isn't transcribed yet")
        const real = canvasElement.querySelector<HTMLElement>('[data-text-line]:not([data-text-placeholder])')!
        await expect(getComputedStyle(held[0]).color).not.toBe(getComputedStyle(real).color)
        await transcribeButton(canvasElement, 'transcribe 1 page')
    },
}

const rightClick = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    el.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }),
    )
}

/** Counts contextmenu events that reach past the book to an ancestor (the pane's own menu listens there). */
let outerMenus = 0

/** Right-click a page: one row, `transcribe again with ai`. It redoes that page only; a failure toasts the server's message. */
export const RedoWithAiMenu: Story = {
    name: 'Redo with ai menu',
    beforeEach: () => serveTranscription(6, [1, 2, 3, 4, 5, 6], false),
    render: () => <Harness w={1100} h={720} rows={images(6)} onOuterMenu={() => outerMenus++} />,
    play: async ({ canvasElement }) => {
        await ready(canvasElement, 'page 1 // 6')
        outerMenus = 0
        rightClick(canvasElement.querySelector<HTMLElement>('[data-book-page="right"]')!)
        const row = await within(document.body).findByText('transcribe again with ai')
        // the book's menu claims the event: the pane menu behind it never opens
        await expect(outerMenus).toBe(0)
        await expect(document.body.textContent?.toLowerCase()).not.toContain('claude')
        seam.failWith = 'ai transcription needs a backend that reads images: opencode does not'
        await userEvent.click(row)
        await waitFor(() => expect(seam.calls.length).toBe(1), { timeout: 8000 })
        await expect(seam.calls[0]).toMatchObject({ file: 'pages/page-1.png', engine: 'ai', pages: [1], onlyMissing: false })
        seam.finish()
        await waitFor(() => expect(toasts().some(t => t.message === seam.failWith)).toBe(true), { timeout: 8000 })
    },
}

/** In text mode the menu acts on the notebook page whose text was under the pointer. */
export const RedoWithAiInText: Story = {
    name: 'Redo with ai in text',
    beforeEach: () => serveTranscription(4, [1, 2, 3, 4], false),
    render: () => <Harness w={1100} h={720} rows={images(4)} view={bookView({ bookMode: 'text' })} onOuterMenu={() => outerMenus++} />,
    play: async ({ canvasElement }) => {
        await readyText(canvasElement)
        outerMenus = 0
        await waitFor(() => expect(textLines(canvasElement, 'right').length).toBeGreaterThan(3), { timeout: 8000 })
        const line = textLines(canvasElement, 'right')[1]
        rightClick(line)
        const row = await within(document.body).findByText('transcribe again with ai')
        await expect(outerMenus).toBe(0)
        seam.finish()
        await userEvent.click(row)
        await waitFor(() => expect(seam.calls.length).toBe(1), { timeout: 8000 })
        await expect(seam.calls[0]).toMatchObject({ file: line.dataset.file, engine: 'ai', pages: [1] })
    },
}

// ── dark pages, the prose face, editing text and pages, one right-click menu ──

/** The light-or-dark of a CSS colour: the mean of its channels, 0..255. */
const lightness = (css: string) => {
    const m = css.match(/\d+(\.\d+)?/g)?.map(Number) ?? [255, 255, 255]
    return (m[0] + m[1] + m[2]) / 3
}

/** Text mode with dark pages: near-black paper and light ink, the way the PDF viewer's dark mode turns a page. */
export const DarkText: Story = {
    name: 'Dark text',
    beforeEach: () => withText(6),
    render: () => <Harness w={1100} h={720} rows={images(6)} view={bookView({ bookMode: 'text', bookDark: true })} />,
    play: async ({ canvasElement }) => {
        await readyText(canvasElement)
        const page = canvasElement.querySelector<HTMLElement>('[data-text-page="right"]')!
        await expect(lightness(getComputedStyle(page).backgroundColor)).toBeLessThan(40)
        await expect(lightness(getComputedStyle(page).color)).toBeGreaterThan(200)
        await expect(within(canvasElement).getByRole('button', { name: 'dark pages' })).toHaveAttribute('aria-pressed', 'true')
    },
}

/** Pages mode with dark pages: a PDF's white paper is drawn near-black. */
export const DarkPages: Story = {
    name: 'Dark pages',
    beforeEach: () => serveFixtures(0),
    render: () => <Harness w={1100} h={720} rows={[row(PDF_PATH)]} view={bookView({ bookDark: true })} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(readout(canvasElement)).toMatch(/^page 1 \/\/ \d+$/), { timeout: 8000 })
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

/** Text mode sets the transcripts in the notes' prose face (`appearance.proseFont`), not a stock serif. */
export const ProseFace: Story = {
    name: 'Prose face',
    beforeEach: () => withText(4),
    render: () => <Harness w={1100} h={720} rows={images(4)} view={bookView({ bookMode: 'text' })} />,
    play: async ({ canvasElement }) => {
        await readyText(canvasElement)
        await expect(getComputedStyle(textSpread(canvasElement)!).fontFamily).toContain(settings.appearance.proseFont)
    },
}

/** Right-click a line, `edit text`, fix the words and save: the page's transcript is written and the
 *  page sets the new text. */
export const EditText: Story = {
    name: 'Edit text',
    beforeEach: () => {
        const restore = withText(4)
        const original = api.setTranscriptPage
        api.setTranscriptPage = async (file: string, _page: number, text: string) => {
            TRANSCRIPTS.set(file, text)
            return { ok: true }
        }
        return () => {
            restore()
            api.setTranscriptPage = original
        }
    },
    render: () => <Harness w={1100} h={720} rows={images(4)} view={bookView({ bookMode: 'text' })} />,
    play: async ({ canvasElement }) => {
        await readyText(canvasElement)
        await waitFor(() => expect(textLines(canvasElement, 'right').length).toBeGreaterThan(3), { timeout: 8000 })
        rightClick(textLines(canvasElement, 'right')[1])
        await userEvent.click(await within(document.body).findByText('edit text'))
        const editor = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>('[data-transcript-editor]')
            expect(el).not.toBeNull()
            return el!
        })
        await expect(within(editor).getByText('edit text // page 1')).toBeInTheDocument()
        const cm = editor.querySelector<HTMLElement>('.cm-content')!
        await waitFor(() => expect(cm.textContent).toContain('Page 1.'))
        cm.focus()
        await userEvent.keyboard('{Control>}a{/Control}{Meta>}a{/Meta}Fixed by hand.')
        await userEvent.click(within(editor).getByRole('button', { name: 'save' }))
        await waitFor(() => expect(canvasElement.querySelector('[data-transcript-editor]')).toBeNull(), { timeout: 8000 })
        await waitFor(() => expect(textSpread(canvasElement)!.textContent).toContain('Fixed by hand.'), { timeout: 8000 })
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
        await ready(canvasElement, 'page 1 // 5')
        await userEvent.click(within(canvasElement).getByRole('button', { name: 'edit pages' }))
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
            <Harness w={1100} h={720} rows={images(4)} view={bookView({ bookMode: 'text' })} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await readyText(canvasElement)
        await waitFor(() => expect(textLines(canvasElement, 'right').length).toBeGreaterThan(3), { timeout: 8000 })
        delete document.body.dataset.paneMenu
        rightClick(textLines(canvasElement, 'right')[1])
        await waitFor(() =>
            expect(document.body.dataset.paneMenu).toBe('edit text|transcribe again with ai|Split right|Close pane'),
        )
        // the book shows no menu of its own inside a pane
        await expect(within(document.body).queryByRole('menu')).toBeNull()
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
        await waitFor(() => expect(readout(canvasElement)).toMatch(/^page 1 \/\/ \d+$/), { timeout: 8000 })
        const pages = Number(readout(canvasElement)!.match(/\/\/ (\d+)$/)![1])
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
        await ready(canvasElement, 'page 1 // 12')
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
        await waitFor(() => expect(readout(canvasElement)).toBe('pages 8–9 // 12'), { timeout: 8000 })
        await waitFor(() => expect(host(canvasElement).dataset.turnState).toBe('settled'), { timeout: 8000 })
        watch.disconnect()
        await expect(layers.size).toBe(1)
    },
}
