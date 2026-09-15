// app/src/preview/ScratchNotes.stories.tsx
// End-to-end spec for scratch notes wired into the real <PreviewView> — click-to-place blocks
// beside a PDF/image page, persisted through the ONE companion store shared with the tags strip
// (createCompanionStore.ts). Kept OUT of PreviewView.stories.tsx (title 'App/PreviewView') because
// a concurrent run is rewriting that file's ViewBar section — see this task's brief.
//
// Every other layer already has its own focused spec: preview/scratchGeometry.test.ts (pure
// geometry), preview/ScratchTextLayer.stories.tsx + ScratchBlock.stories.tsx (the layer in
// isolation, task 2), preview/createCompanionStore.stories.tsx (persistence, task 1),
// preview/ScratchPaper.stories.tsx (the strip surface, task 3). This file proves the WIRING: the
// real store PreviewView builds, the real ScratchTextLayer it mounts over PdfPages/the image body,
// and the real onKey gate — against fakeTransport, no mocks of PreviewView's own code.
import { createSignal, Show } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, waitFor } from 'storybook/test'
import { jsPDF } from 'jspdf'
import { PreviewView } from '../PreviewView'
import { api, setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { companionPathFor, inkSidecarFor } from '../../../core/src/fileKinds'
import {
    emptyDoc,
    parseDoc,
    serializeDoc,
    type DrawingDoc,
} from '../../../core/src/drawing/model'
import { DEFAULT_MARGIN_RATIO } from '../../../core/src/drawing/pageMargin'
import { serializeScratch } from '../../../core/src/scratchNotes'
import type { ScratchBlock } from '../../../core/src/scratchTypes'

const meta = {
    title: 'Preview/ScratchNotes',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const NO_TAGS = () => [] as string[]

// ── A 4-page PDF, built once and reused (jsPDF's own bytes are immutable, slice(0) per load) ────

let bookBytes: ArrayBuffer | undefined
function buildBookPdf(): ArrayBuffer {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    for (let i = 0; i < 4; i++) {
        if (i > 0) pdf.addPage('letter')
        pdf.setFontSize(24)
        pdf.text(`Page ${i + 1}`, 72, 100)
    }
    return pdf.output('arraybuffer')
}
async function bookLoad(): Promise<ArrayBuffer> {
    bookBytes ??= buildBookPdf()
    return bookBytes.slice(0)
}

const PDF_PATH = 'book.pdf'
const PDF_SIDECAR = inkSidecarFor(PDF_PATH)
const PDF_COMPANION = companionPathFor(PDF_PATH)

/** A blank-paper sidecar with SCRATCH already on ("turn scratch on via the store" — the brief's
 *  own phrasing: the annotation store loads this margin off disk, no ViewBar button involved,
 *  since that button lives in the region this task must not touch). */
const marginOnlyDoc = (): DrawingDoc => {
    const d = emptyDoc()
    d.paper.bg = 'blank'
    d.margin = { right: DEFAULT_MARGIN_RATIO }
    return d
}

/** Tall + narrow enough that all 4 pages render inside PdfPages' own viewport + one-page overscan
 *  with no scrolling needed — page 3 (index 2) is already there the moment the pages settle. */
function PdfStage(props: { path: string; load: () => Promise<ArrayBuffer> }) {
    return (
        <div style={{ width: '480px', height: '3000px' }}>
            <PreviewView
                path={props.path}
                tagNames={NO_TAGS}
                pdfLoad={props.load}
            />
        </div>
    )
}

const waitForPages = (root: HTMLElement, n: number) =>
    waitFor(
        () => {
            expect(root.querySelectorAll('[data-pdf-page]').length).toBe(n)
        },
        { timeout: 8000 },
    )

/** Page `i`'s strip hit area, once ScratchTextLayer has actually mounted it (the sidecar's margin
 *  has to load off disk first — see createAnnotationStore.ts — so it is never there on the very
 *  first render). */
const waitForHit = (root: HTMLElement, i: number) =>
    waitFor(() => {
        const el = root.querySelector<HTMLElement>(`[data-scratch-hit="${i}"]`)
        expect(el).not.toBeNull()
        return el!
    })

/** Primary-button pointerdown at a point inside page `i`'s strip hit area. */
function clickHit(root: HTMLElement, i: number, dx = 10, dy = 20) {
    const hit = root.querySelector<HTMLElement>(`[data-scratch-hit="${i}"]`)!
    const r = hit.getBoundingClientRect()
    fireEvent.pointerDown(hit, {
        button: 0,
        pointerId: 1,
        clientX: r.left + dx,
        clientY: r.top + dy,
    })
}

const blocksIn = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-scratch-block]'))

/** Types `text` into a focused CodeMirror field the way a real keystroke does — MarkdownField's
 *  own extensions read `beforeinput`, so a plain value assignment would never reach them (see
 *  ScratchTextLayer.stories.tsx, the same idiom). */
const typeInto = (field: HTMLElement, text: string) => {
    field.focus()
    document.execCommand('insertText', false, text)
}

// ── PdfTypeBesidePage3 ────────────────────────────────────────────────────────────────────────

/** Click page 3's strip, type into the block that starts there, and see it land in the companion
 *  note's body as a `p=3` region — the tags frontmatter (still the untouched template, never
 *  edited in this story) stays intact alongside it. */
export const PdfTypeBesidePage3: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: { [PDF_SIDECAR]: serializeDoc(marginOnlyDoc()) },
            }),
        )
        return <PdfStage path={PDF_PATH} load={bookLoad} />
    },
    play: async ({ canvasElement }) => {
        await waitForPages(canvasElement, 4)
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-scratch-hit="2"]'),
            ).not.toBeNull(),
        )

        clickHit(canvasElement, 2)
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(1))
        const block = blocksIn(canvasElement)[0]!
        await waitFor(() =>
            expect(block.contains(document.activeElement)).toBe(true),
        )

        typeInto(
            block.querySelector('.cm-content')!,
            '**why?** see [[Lecture 7]]',
        )
        await waitFor(() => expect(block.textContent).toContain('why?'))

        await waitFor(
            async () => {
                const written = await api.read(PDF_COMPANION)
                expect(written).toContain('<!-- scratch id=')
                expect(written).toContain('p=3 ')
                expect(written).toContain('why?')
                expect(written).toContain('[[Lecture 7]]')
                expect(written.startsWith('---\ntags: []\n---\n')).toBe(true)
            },
            { timeout: 4000 },
        )
    },
}

// ── PdfBlocksSurviveReload ────────────────────────────────────────────────────────────────────

/** A block typed into page 1's strip is still there — same text, same page — after the preview
 *  fully unmounts and a fresh one opens the same file: the round trip through the companion note
 *  on disk, not merely in-memory state. */
export const PdfBlocksSurviveReload: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: { [PDF_SIDECAR]: serializeDoc(marginOnlyDoc()) },
            }),
        )
        const [mounted, setMounted] = createSignal(true)
        return (
            <div data-testid="reload-stage">
                <Show when={mounted()}>
                    <PdfStage path={PDF_PATH} load={bookLoad} />
                </Show>
                <button
                    type="button"
                    data-testid="reload"
                    onClick={() => {
                        setMounted(false)
                        queueMicrotask(() => setMounted(true))
                    }}
                >
                    reload
                </button>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitForPages(canvasElement, 4)
        await waitForHit(canvasElement, 0)
        clickHit(canvasElement, 0, 15, 30)
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(1))
        typeInto(
            blocksIn(canvasElement)[0]!.querySelector('.cm-content')!,
            'reload me',
        )
        await waitFor(async () => {
            expect(await api.read(PDF_COMPANION)).toContain('reload me')
        })

        ;(
            canvasElement.querySelector(
                '[data-testid="reload"]',
            ) as HTMLButtonElement
        ).click()

        await waitForPages(canvasElement, 4)
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(1))
        await expect(blocksIn(canvasElement)[0]!.textContent).toContain(
            'reload me',
        )
    },
}

// ── PdfDrawModeDoesNotPlace ───────────────────────────────────────────────────────────────────

/** Entering draw mode (the Pencil toggle already in the bar) disarms the scratch layer: clicking a
 *  strip while drawing never creates a block. */
export const PdfDrawModeDoesNotPlace: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: { [PDF_SIDECAR]: serializeDoc(marginOnlyDoc()) },
            }),
        )
        return <PdfStage path={PDF_PATH} load={bookLoad} />
    },
    play: async ({ canvasElement }) => {
        await waitForPages(canvasElement, 4)
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-scratch-hit="0"]'),
            ).not.toBeNull(),
        )

        const drawBtn = canvasElement.querySelector<HTMLButtonElement>(
            'button[aria-label="Draw"]',
        )!
        await waitFor(() => expect(drawBtn.disabled).toBe(false))
        fireEvent.click(drawBtn)
        await waitFor(() =>
            expect(drawBtn.getAttribute('aria-pressed')).toBe('true'),
        )

        clickHit(canvasElement, 0)
        // Give any (wrongly-created) block a moment to mount before asserting its absence.
        await new Promise(r => setTimeout(r, 150))
        await expect(blocksIn(canvasElement).length).toBe(0)
    },
}

// ── PdfModZInBlockUndoesText ──────────────────────────────────────────────────────────────────

const STROKE_DOC = (): DrawingDoc => {
    const d = marginOnlyDoc()
    d.pages = [
        {
            strokes: [
                {
                    t: 'pen',
                    c: 'fg',
                    w: 5,
                    pts: [100, 100, 255, 200, 200, 255],
                },
            ],
        },
    ]
    return d
}
const strokeCount = async () =>
    parseDoc(await api.read(PDF_SIDECAR)).pages[0]?.strokes.length ?? 0

const SEEDED_BLOCK: ScratchBlock = {
    id: 'seed',
    page: 0,
    x: 846,
    y: 120,
    w: 280,
    text: 'hello',
}

/** Mod+Z with focus INSIDE a block must undo the TYPING (CodeMirror's own history), never reach
 *  the annotation store's shared undo stack and pop the ink stroke that has nothing to do with it
 *  — the `onKey` gate this task adds alongside the existing `data-companion-frontmatter` one. */
export const PdfModZInBlockUndoesText: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: {
                    [PDF_SIDECAR]: serializeDoc(STROKE_DOC()),
                    [PDF_COMPANION]: `---\ntags: []\n---\n${serializeScratch('', [SEEDED_BLOCK])}`,
                },
            }),
        )
        return <PdfStage path={PDF_PATH} load={bookLoad} />
    },
    play: async ({ canvasElement }) => {
        await waitForPages(canvasElement, 4)
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(1))
        await expect(await strokeCount()).toBe(1)

        const field = blocksIn(canvasElement)[0]!.querySelector(
            '.cm-content',
        ) as HTMLElement
        field.focus()
        await waitFor(() =>
            expect(field.contains(document.activeElement) || field === document.activeElement).toBe(
                true,
            ),
        )
        // Focus is inside the block (`[data-scratch-text]`'s descendant) — PreviewView's onKey
        // gate must return before ever reaching the annotation store's undo() below.
        field.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'z',
                code: 'KeyZ',
                metaKey: true,
                bubbles: true,
                cancelable: true,
            }),
        )
        await new Promise(r => setTimeout(r, 150))

        // The stroke is UNTOUCHED — an annotation-store undo would have popped it to 0.
        await expect(await strokeCount()).toBe(1)
    },
}

// ── ImageWithScratch ──────────────────────────────────────────────────────────────────────────

const IMG_W = 200
const IMG_H = 150
function tinyPng(): string {
    const c = document.createElement('canvas')
    c.width = IMG_W
    c.height = IMG_H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#7788aa'
    ctx.fillRect(0, 0, IMG_W, IMG_H)
    return c.toDataURL('image/png')
}
const IMAGE_PATH = 'assets/scratch.png'
const IMAGE_SIDECAR = inkSidecarFor(IMAGE_PATH)
const IMAGE_COMPANION = companionPathFor(IMAGE_PATH)
// The image's logical box is fitImage(IMG_W, IMG_H) = {x:0, y:222, w:816, h:612} (a 200x150
// image centred in the 816x1056 logical page) — y must land inside that band or the block renders
// above/below the picture rather than beside it.
const IMAGE_BLOCK: ScratchBlock = {
    id: 'img1',
    page: 0,
    x: 850,
    y: 300,
    w: 200,
    text: 'a margin note',
}

/** An image whose sidecar already carries a margin and whose companion already carries a block:
 *  image + strip render side by side, centred as one unit, and the seeded block is visible on it —
 *  the ratio-> 0 path (imageScratchLayout.ts + PreviewView's measureImage) end to end. */
export const ImageWithScratch: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: {
                    [IMAGE_SIDECAR]: serializeDoc(marginOnlyDoc()),
                    [IMAGE_COMPANION]: `---\ntags: []\n---\n${serializeScratch('', [IMAGE_BLOCK])}`,
                },
            }),
        )
        return (
            <div style={{ width: '900px', height: '600px' }}>
                <PreviewView
                    path={IMAGE_PATH}
                    tagNames={NO_TAGS}
                    imageSrc={tinyPng}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const img = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLImageElement>(
                'img[alt="scratch.png"]',
            )
            expect(el).not.toBeNull()
            return el!
        })
        const strip = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>(
                '[data-pdf-margin="0"]',
            )
            expect(el).not.toBeNull()
            return el!
        })
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(1))
        await expect(blocksIn(canvasElement)[0]!.textContent).toContain(
            'a margin note',
        )

        // Image and strip sit flush against each other, side by side, and neither is clipped by
        // the body.
        const ir = img.getBoundingClientRect()
        const sr = strip.getBoundingClientRect()
        await expect(Math.abs(sr.left - ir.right)).toBeLessThan(1)
        await expect(Math.abs(sr.top - ir.top)).toBeLessThan(1)
        await expect(sr.width).toBeGreaterThan(0)

        // Centred as one unit: equal daylight left of the image and right of the strip.
        const body = canvasElement.querySelector(
            '.preview-body, [class*="preview-body"]',
        ) as HTMLElement
        const br = body.getBoundingClientRect()
        const leftGap = ir.left - br.left
        const rightGap = br.right - sr.right
        await expect(Math.abs(leftGap - rightGap)).toBeLessThan(2)
    },
}

// ── TagsAndBlocksShareOneFile ─────────────────────────────────────────────────────────────────

/** Editing the tags strip AND placing/typing a scratch block both land in ONE write to the
 *  companion note — proving PreviewView hands both CompanionFrontmatter and ScratchTextLayer the
 *  SAME store rather than two independent ones that could race and drop each other's edit. */
export const TagsAndBlocksShareOneFile: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: { [PDF_SIDECAR]: serializeDoc(marginOnlyDoc()) },
            }),
        )
        return <PdfStage path={PDF_PATH} load={bookLoad} />
    },
    play: async ({ canvasElement }) => {
        await waitForPages(canvasElement, 4)
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-companion-frontmatter]'),
            ).not.toBeNull(),
        )

        await waitForHit(canvasElement, 1)
        clickHit(canvasElement, 1, 12, 40)
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(1))
        typeInto(
            blocksIn(canvasElement)[0]!.querySelector('.cm-content')!,
            'shared file',
        )
        await waitFor(() =>
            expect(blocksIn(canvasElement)[0]!.textContent).toContain(
                'shared file',
            ),
        )

        const fmField = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>(
                '[data-companion-frontmatter] .cm-content',
            )
            expect(el).not.toBeNull()
            return el!
        })
        fmField.focus()
        document.execCommand('selectAll')
        document.execCommand('insertText', false, '---\ntags: [trip]\n---\n')

        await waitFor(
            async () => {
                const written = await api.read(PDF_COMPANION)
                expect(written).toContain('tags: [trip]')
                expect(written).toContain('shared file')
            },
            { timeout: 4000 },
        )
    },
}
