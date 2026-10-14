// app/src/preview/AnnotationStoreSidecarMode.stories.tsx
// Spec for createAnnotationStore on a PDF Bismuth cannot rewrite. The server side (the fake
// transport's PDF routes) holds the AES-encrypted fixture, so every route answers not-writable and
// the store falls back to the sidecar; pdf.js is handed `pdfkit-highlights.pdf` through `pdfLoad`,
// a file that carries seven highlights another app wrote. The two byte sources are separate on
// purpose: the story needs a document with foreign highlights that the server still refuses to
// rewrite, which no single fixture is. The encrypted fixture itself carries no highlights.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import { PreviewView } from '../PreviewView'
import { setTransport, type Transport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { inkSidecarFor } from '../../../core/src/fileKinds'
import {
    emptyDoc,
    parseDoc,
    serializeDoc,
    type DrawingDoc,
} from '../../../core/src/drawing/model'
import encryptedFixtureUrl from '../../../core/test/drawing/fixtures/encrypted.pdf?url'
import pdfkitFixtureUrl from '../../../core/test/drawing/fixtures/pdfkit-highlights.pdf?url'
import pdfPagesStyles from './PdfPages.module.css'

const meta = {
    title: 'Preview/AnnotationStoreSidecarMode',
    component: PreviewView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PreviewView>

export default meta
type Story = StoryObj<typeof meta>

const PATH = 'docs/locked.pdf'
const SIDECAR = inkSidecarFor(PATH)
const NO_TAGS = () => [] as string[]

let encryptedBytes: Uint8Array | undefined
let pdfkitBytes: ArrayBuffer | undefined
let sidecarPuts: DrawingDoc[] = []

const pdfkitLoad = async (): Promise<ArrayBuffer> => pdfkitBytes!.slice(0)

/** The fake transport with every sidecar write recorded, parsed, in order. */
function recordingTransport(files: Record<string, string>): Transport {
    const t = fakeTransport({ files, binaries: { [PATH]: encryptedBytes! } })
    return {
        ...t,
        put: async (path, body) => {
            const b = body as { path?: string; contents?: string }
            if (path === '/file' && b.path === SIDECAR && b.contents)
                sidecarPuts.push(parseDoc(b.contents))
            return t.put(path, body)
        },
    }
}

/** A sidecar with one highlight of Bismuth's own, off to the side of the foreign ones. */
const ownHighlightDoc = (): DrawingDoc => {
    const d = emptyDoc()
    d.paper.bg = 'blank'
    d.pages = [
        {
            strokes: [],
            highlights: [
                {
                    id: 'hl-own',
                    c: 'hl',
                    rects: [{ x: 90, y: 100, w: 420, h: 40 }],
                },
            ],
        },
    ]
    return d
}

/** The highlight layer once the store has taken in the document's highlight report. */
const settledLayer = (root: HTMLElement) =>
    root.querySelector('[data-testid="highlight-layer"][data-highlights-settled]')
const hlRects = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-testid="highlight-rect"]'))
const scrollElOf = (root: HTMLElement) =>
    root.querySelector(`.${pdfPagesStyles['pdf-scroll']}`) as HTMLElement | null

/** Highlights another app embedded in a PDF Bismuth cannot rewrite show next to the sidecar's own
 *  (pdf.js hides every /Highlight, so Bismuth paints them; annotations with identical geometry
 *  paint as stacked rects, as Preview shows them), and they never reach the sidecar: removing one
 *  of them saves a sidecar that still holds only the highlight Bismuth made. A highlight's id is
 *  its geometry (pdfHighlightId hashes no colour), so a click removes every foreign annotation
 *  stacked at that geometry — five of the fixture's seven share the topmost one's. */
export const ForeignHighlightsShowAndStayOutOfSidecar: Story = {
    render: () => {
        sidecarPuts = []
        setTransport(recordingTransport({ [SIDECAR]: serializeDoc(ownHighlightDoc()) }))
        return (
            <div style={{ height: '100vh', width: '900px' }}>
                <PreviewView path={PATH} tagNames={NO_TAGS} pdfLoad={pdfkitLoad} />
            </div>
        )
    },
    loaders: [
        async () => {
            encryptedBytes ??= new Uint8Array(
                await (await fetch(encryptedFixtureUrl)).arrayBuffer(),
            )
            pdfkitBytes ??= await (await fetch(pdfkitFixtureUrl)).arrayBuffer()
        },
    ],
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const { readPdfHighlights } = await import(
            '../../../core/src/drawing/pdfHighlights'
        )
        const foreign = (await readPdfHighlights(new Uint8Array(pdfkitBytes!.slice(0))))
            .pages[0]!
        await expect(foreign.length).toBe(7)
        // Settled = the sidecar loaded and the document's report was taken in.
        await waitFor(() => expect(settledLayer(canvasElement)).not.toBeNull(), {
            timeout: 8000,
        })
        // The sidecar's own highlight plus the seven the PDF carries, duplicates included.
        const rects = hlRects(canvasElement)
        await expect(rects.length).toBe(1 + foreign.length)
        for (const r of rects) await expect(r.getBoundingClientRect().width).toBeGreaterThan(0)
        const hlBtn = canvas.getByLabelText('Highlight text') as HTMLButtonElement
        await waitFor(() => expect(hlBtn.disabled).toBe(false))
        await fireEvent.click(hlBtn)
        // The last foreign highlight is topmost where the single-line ones overlap.
        const box = hlRects(canvasElement).at(-1)!.getBoundingClientRect()
        window.getSelection()?.removeAllRanges()
        scrollElOf(canvasElement)!.dispatchEvent(
            new PointerEvent('pointerup', {
                bubbles: true,
                clientX: box.left + box.width / 2,
                clientY: box.top + box.height / 2,
            }),
        )
        // Every foreign annotation sharing the clicked one's geometry id goes; the rest stay.
        const clicked = foreign.at(-1)!.id
        const left = 1 + foreign.filter(h => h.id !== clicked).length
        await expect(left).toBe(3)
        await waitFor(() => expect(hlRects(canvasElement).length).toBe(left))
        await waitFor(() => expect(sidecarPuts.length).toBeGreaterThan(0), {
            timeout: 5000,
        })
        for (const put of sidecarPuts) {
            const ids = put.pages.flatMap(p => (p.highlights ?? []).map(h => h.id))
            expect(ids).toEqual(['hl-own'])
        }
    },
}
