// app/src/preview/ScratchNotes.stories.tsx
// End-to-end spec for scratch notes wired into the real <PreviewView> — click-to-place blocks
// beside a PDF/image page, persisted through the ONE companion store shared with the tags strip
// (createCompanionStore.ts). Kept OUT of PreviewView.stories.tsx (title 'App/PreviewView') because
// that file's ViewBar section (`modeToggles`/`togglesWrapped`/`fitToggles`, the `PdfViewBarNarrow`/
// `PdfViewBarLayout` stories) is owned elsewhere and must not gain a new dependent here.
//
// Every other layer already has its own focused spec: preview/scratchGeometry.test.ts (pure
// geometry), preview/ScratchTextLayer.stories.tsx + ScratchBlock.stories.tsx (the layer in
// isolation), preview/createCompanionStore.stories.tsx (persistence), preview/ScratchPaper.stories.tsx
// (the strip surface). This file proves the WIRING: the real store PreviewView builds, the real
// ScratchTextLayer it mounts over PdfPages/the image body, and the real onKey gate — against
// fakeTransport, no mocks of PreviewView's own code.
import { createSignal, Show } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, userEvent, waitFor } from 'storybook/test'
import { jsPDF } from 'jspdf'
import { PreviewView } from '../PreviewView'
import { api, setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import type { NoteCandidate } from '../editor/wikilink'
import { companionPathFor, inkSidecarFor } from '../../../core/src/fileKinds'
import {
    emptyDoc,
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

/** Same fixture MarkdownField.stories.tsx's `WikilinkCompletion` story uses — a vault note name
 *  the completion popup should offer once `noteNames` reaches the scratch note's editor. */
const NOTE_NAMES: NoteCandidate[] = [{ label: 'Lecture 7', path: 'Lecture 7.md' }]

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

/** A blank-paper sidecar with SCRATCH already on: the annotation store loads this margin off
 *  disk directly, with no ViewBar button involved — the SCRATCH toggle lives in the ViewBar
 *  section this file's own header says not to depend on. */
const marginOnlyDoc = (): DrawingDoc => {
    const d = emptyDoc()
    d.paper.bg = 'blank'
    d.margin = { right: DEFAULT_MARGIN_RATIO }
    return d
}

/** Tall + narrow by default (`height` unset) so every one of the 4-page book's pages renders with
 *  no scrolling needed — the stories that only care about a HIT AREA existing (hit areas render
 *  for every page regardless of scroll position; only the block editors themselves are windowed,
 *  ScratchTextLayer.tsx's `visibleRange`) use this so they never need to drive a real scroll. A
 *  story proving the WINDOWING itself passes a realistic `height` instead — see
 *  `PdfTypeBesidePage3` and the scroll stories below. */
function PdfStage(props: {
    path: string
    load: () => Promise<ArrayBuffer>
    height?: string
    noteNames?: () => NoteCandidate[]
}) {
    return (
        <div style={{ width: '480px', height: props.height ?? '3000px' }}>
            <PreviewView
                path={props.path}
                tagNames={NO_TAGS}
                pdfLoad={props.load}
                noteNames={props.noteNames}
            />
        </div>
    )
}

/** Drives the ViewBar's `p. N / M` readout (`PageReadout.tsx`) the way a person would: click it,
 *  type a 1-based page number, Enter — which calls the real `PdfPagesController.scrollToPage`,
 *  the same path a bookmark click uses. A REAL scroll (final review, finding 2: no more relying
 *  on an unrealistically tall stage to put a page in the DOM without ever scrolling to it). */
async function scrollToPageViaReadout(root: HTMLElement, page1Based: number) {
    const button = await waitFor(() => {
        const el = root.querySelector<HTMLButtonElement>(
            '[data-testid="page-readout"] button',
        )
        expect(el).not.toBeNull()
        return el!
    })
    fireEvent.click(button)
    const input = await waitFor(() => {
        const el = root.querySelector<HTMLInputElement>(
            '[data-testid="page-readout"] input',
        )
        expect(el).not.toBeNull()
        return el!
    })
    input.focus()
    input.value = String(page1Based)
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
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
        // A realistic pane height — page 3 is NOT already sitting in view the moment the pages
        // settle, unlike the tall default `PdfStage` the other stories below use. Reaching it
        // takes a real scroll (see `scrollToPageViaReadout`).
        return <PdfStage path={PDF_PATH} load={bookLoad} height="700px" />
    },
    play: async ({ canvasElement }) => {
        await waitForPages(canvasElement, 4)
        await scrollToPageViaReadout(canvasElement, 3)
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-testid="page-readout"] button')
                    ?.textContent,
            ).toContain('p. 3 / 4'),
        )
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

// ── PdfScratchNoteCompletionAndClickOut ──────────────────────────────────────────────────────

/** Proves `noteNames` actually threads all the way through the composed stack —
 *  PreviewView → ScratchTextLayer → ScratchBlock → MarkdownField — into the scratch note's OWN
 *  CodeMirror instance: typing the `[[wikilink` trigger opens the same completion popup
 *  MarkdownField.stories.tsx's `WikilinkCompletion` story proves in isolation, but here through
 *  the real preview a person actually uses. Also proves task 4's click-out behaviour end to end:
 *  Escape closes the popup without ending the edit, then a click elsewhere on the strip ends the
 *  edit — exactly one block remains and it is no longer focused. */
export const PdfScratchNoteCompletionAndClickOut: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: { [PDF_SIDECAR]: serializeDoc(marginOnlyDoc()) },
            }),
        )
        return (
            <PdfStage
                path={PDF_PATH}
                load={bookLoad}
                noteNames={() => NOTE_NAMES}
            />
        )
    },
    play: async ({ canvasElement }) => {
        await waitForPages(canvasElement, 4)
        await waitForHit(canvasElement, 0)

        clickHit(canvasElement, 0, 15, 30)
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(1))
        const block = blocksIn(canvasElement)[0]!
        await waitFor(() =>
            expect(block.contains(document.activeElement)).toBe(true),
        )

        const field = block.querySelector('.cm-content') as HTMLElement
        await userEvent.click(field)
        // user-event's `type()` treats `[` as the start of a special-key escape, so a literal
        // `[` is written `[[` — typing the wikilink trigger `[[Lec` means passing `[[[[Lec`
        // (MarkdownField.stories.tsx's `WikilinkCompletion` story, same idiom).
        await userEvent.type(field, '[[[[Lec')

        // CodeMirror mounts its completion tooltip on `document.body`, a sibling of the story
        // root — not a descendant of `canvasElement` — so the popup search goes through the
        // owner document (same reach `completionDisplay.ts`'s theme selectors assume).
        const doc = canvasElement.ownerDocument
        const tooltip = await waitFor(() => {
            const el = doc.querySelector('.cm-tooltip-autocomplete')
            expect(el).not.toBeNull()
            return el!
        })
        await expect(tooltip.textContent).toContain('Lecture 7')

        fireEvent.keyDown(field, { key: 'Escape', code: 'Escape' })
        await waitFor(() =>
            expect(doc.querySelector('.cm-tooltip-autocomplete')).toBeNull(),
        )
        // Escape closed the POPUP, not the edit — the block is still focused and alone.
        await expect(block.contains(document.activeElement)).toBe(true)
        await expect(blocksIn(canvasElement).length).toBe(1)

        // A click elsewhere on the same strip, while still focused, ends the edit without
        // placing a second block (task 4's click-out fix).
        clickHit(canvasElement, 0, 15, 400)
        await waitFor(() => {
            const layer = canvasElement.querySelector('[data-scratch-text]')!
            expect(layer.contains(document.activeElement)).toBe(false)
        })
        await expect(blocksIn(canvasElement).length).toBe(1)
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

const SEEDED_BLOCK: ScratchBlock = {
    id: 'seed',
    page: 0,
    x: 846,
    y: 120,
    w: 280,
    text: 'hello',
}

/** Fraction of pixels carrying ink (alpha above a faint threshold) — the same idiom
 *  PageInk.stories.tsx uses to prove a stroke actually painted, without touching disk: the
 *  committed canvas repaints reactively off the annotation store's own live `doc()` signal
 *  (PageInk.tsx), so sampling it proves what the LIVE doc holds, not what was last saved. */
function inkedPct(canvas: HTMLCanvasElement): number {
    const ctx = canvas.getContext('2d')
    if (!ctx || !canvas.width || !canvas.height) return 0
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let inked = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 16) inked++
    return inked / (data.length / 4)
}
const committedCanvas = (root: HTMLElement, page: number) =>
    root.querySelector<HTMLCanvasElement>(
        `[data-testid="ink-page-${page}"] [data-testid="ink-canvas-committed"]`,
    )
const liveCanvas = (root: HTMLElement, page: number) =>
    root.querySelector<HTMLCanvasElement>(
        `[data-testid="ink-page-${page}"] [data-testid="ink-canvas-live"]`,
    )

/** A real pointer-drawn stroke on page 0's OWN area (left of the strip, well inside a 320px-ish
 *  rendered page width at this stage's zoom) — mirrors PageInk.stories.tsx's `drawOnPage`. Used
 *  instead of a stroke loaded from disk: `createAnnotationStore.ts` calls `resetHistory()` on
 *  every sidecar load, so a stroke seeded in the fixture file is never on the undo stack and
 *  `store.undo()` would be a no-op regardless of whether `onKey`'s gate does its job — the exact
 *  hole the final review found (finding 1). Drawing it live pushes a real undo entry. */
function drawOnPageZero(root: HTMLElement) {
    const canvas = liveCanvas(root, 0)!
    const rect = canvas.getBoundingClientRect()
    const dy = 300
    const send = (type: string, dx: number) =>
        canvas.dispatchEvent(
            new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                clientX: rect.left + dx,
                clientY: rect.top + dy,
                pointerId: 3,
                pointerType: 'pen',
                isPrimary: true,
                pressure: 0.6,
            }),
        )
    send('pointerdown', 40)
    for (let x = 50; x <= 140; x += 10) send('pointermove', x)
    send('pointerup', 140)
}

/** Two things the final review found this story could not actually prove: (1) the seeded stroke
 *  was loaded from disk, so the undo stack was always empty and `store.undo()` a no-op regardless
 *  of `onKey`'s gate; (2) there was no case for the OTHER key `onKey` gates inside a block, the
 *  toggle-draw-mode combo. Fixed: draw a real stroke first (pushes a real undo entry), assert
 *  Mod+Z with focus inside the block reverts the block's OWN typing and leaves that stroke alone
 *  — read off the live, reactively-repainted canvas, never a disk read — then assert the
 *  toggle-draw-mode combo, sent the same way, never flips DRAW back on. */
export const PdfModZInBlockUndoesText: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: {
                    [PDF_SIDECAR]: serializeDoc(marginOnlyDoc()),
                    [PDF_COMPANION]: `---\ntags: []\n---\n${serializeScratch('', [SEEDED_BLOCK])}`,
                },
            }),
        )
        return <PdfStage path={PDF_PATH} load={bookLoad} />
    },
    play: async ({ canvasElement }) => {
        await waitForPages(canvasElement, 4)
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(1))

        const drawBtn = canvasElement.querySelector<HTMLButtonElement>(
            'button[aria-label="Draw"]',
        )!
        await waitFor(() => expect(drawBtn.disabled).toBe(false))
        fireEvent.click(drawBtn)
        await waitFor(() =>
            expect(drawBtn.getAttribute('aria-pressed')).toBe('true'),
        )
        await waitFor(() => expect(liveCanvas(canvasElement, 0)).not.toBeNull())

        drawOnPageZero(canvasElement)
        await waitFor(() =>
            expect(inkedPct(committedCanvas(canvasElement, 0)!)).toBeGreaterThan(0),
        )

        fireEvent.click(drawBtn)
        await waitFor(() =>
            expect(drawBtn.getAttribute('aria-pressed')).toBe('false'),
        )

        const field = blocksIn(canvasElement)[0]!.querySelector(
            '.cm-content',
        ) as HTMLElement
        field.focus()
        await waitFor(() =>
            expect(field.contains(document.activeElement) || field === document.activeElement).toBe(
                true,
            ),
        )
        // A marker with no overlap with 'hello', so the assertions below don't depend on WHERE
        // in the existing text the caret happened to land after a plain `.focus()` (CodeMirror
        // does not promise end-of-doc there).
        typeInto(field, 'ZQMK')
        await waitFor(() => expect(field.textContent).toContain('ZQMK'))

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
        // CodeMirror's own undo reverted the TYPING …
        await waitFor(() => expect(field.textContent).not.toContain('ZQMK'))
        await expect(field.textContent).toContain('hello')
        // … and the stroke is UNTOUCHED — an annotation-store undo would have popped it, and
        // this reads the LIVE doc (the committed canvas's own reactive repaint), not a disk save.
        await expect(inkedPct(committedCanvas(canvasElement, 0)!)).toBeGreaterThan(0)

        // The OTHER key `onKey` gates inside a block: toggle-draw-mode, sent with focus still in
        // the field, must type/edit, never flip DRAW back on.
        field.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'i',
                code: 'KeyI',
                metaKey: true,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            }),
        )
        await new Promise(r => setTimeout(r, 150))
        await expect(drawBtn.getAttribute('aria-pressed')).toBe('false')
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
            '[data-testid="preview-body"]',
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

// ── A 12-page PDF, one seeded block per page (final review, finding 2) ──────────────────────────

const LONG_PAGE_COUNT = 12
let longBookBytes: ArrayBuffer | undefined
function buildLongBookPdf(): ArrayBuffer {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    for (let i = 0; i < LONG_PAGE_COUNT; i++) {
        if (i > 0) pdf.addPage('letter')
        pdf.setFontSize(24)
        pdf.text(`Page ${i + 1}`, 72, 100)
    }
    return pdf.output('arraybuffer')
}
async function longBookLoad(): Promise<ArrayBuffer> {
    longBookBytes ??= buildLongBookPdf()
    return longBookBytes.slice(0)
}
const LONG_PATH = 'long-book.pdf'
const LONG_SIDECAR = inkSidecarFor(LONG_PATH)
const LONG_COMPANION = companionPathFor(LONG_PATH)
/** One block per page, ids `p0`..`p${LONG_PAGE_COUNT - 1}` — `ScratchBlock.tsx` writes the id
 *  straight onto `data-scratch-block`, so a query by id is exact, unlike a text-content search
 *  (`p1` would also match inside `p11`'s block). */
const LONG_BLOCKS: ScratchBlock[] = Array.from(
    { length: LONG_PAGE_COUNT },
    (_, i) => ({ id: `p${i}`, page: i, x: 846, y: 100, w: 200, text: `note ${i}` }),
)
const hasBlock = (root: HTMLElement, id: string) =>
    root.querySelector(`[data-scratch-block="${id}"]`) !== null

// ── PdfScratchBlocksFollowScroll ─────────────────────────────────────────────────────────────

/** A long PDF at a normal pane size: only the blocks near the viewport are mounted (not all 12 at
 *  once), and scrolling changes WHICH ones — dropping the pages that scroll out, mounting the
 *  ones that scroll in. Proves `scratchVisibleRange` tracks the REAL scrolled viewport
 *  (`pageLayout.ts`'s `visiblePageRange`), not PdfPages' own notion of "current page" ± a fixed
 *  window (final review, finding 2). */
export const PdfScratchBlocksFollowScroll: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: {
                    [LONG_SIDECAR]: serializeDoc(marginOnlyDoc()),
                    [LONG_COMPANION]: `---\ntags: []\n---\n${serializeScratch('', LONG_BLOCKS)}`,
                },
            }),
        )
        return (
            <div style={{ width: '480px', height: '700px' }}>
                <PreviewView
                    path={LONG_PATH}
                    tagNames={NO_TAGS}
                    pdfLoad={longBookLoad}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitForPages(canvasElement, LONG_PAGE_COUNT)

        // Settled at the top: page 0's block is mounted, the far page 11's is not, and NOT every
        // page's block is mounted at once (the windowing is actually doing something).
        await waitFor(() => expect(hasBlock(canvasElement, 'p0')).toBe(true))
        await waitFor(() =>
            expect(blocksIn(canvasElement).length).toBeLessThan(LONG_PAGE_COUNT),
        )
        await expect(hasBlock(canvasElement, 'p11')).toBe(false)

        // Scroll to the last page: its block mounts, page 0's (now far away) drops.
        await scrollToPageViaReadout(canvasElement, LONG_PAGE_COUNT)
        await waitFor(() => expect(hasBlock(canvasElement, 'p11')).toBe(true))
        await waitFor(() => expect(hasBlock(canvasElement, 'p0')).toBe(false))

        // Scroll back to the top: page 0's block comes back, page 11's drops again.
        await scrollToPageViaReadout(canvasElement, 1)
        await waitFor(() => expect(hasBlock(canvasElement, 'p0')).toBe(true))
        await waitFor(() => expect(hasBlock(canvasElement, 'p11')).toBe(false))
    },
}

// ── PdfScratchAtLowZoomMountsVisiblePages ────────────────────────────────────────────────────

/** Every page the pane actually shows a page of gets its block mounted, at the zoom that makes a
 *  pane show the most pages at once. Before finding 2's fix, `scratchVisibleRange` was "current
 *  page ± 2": at low zoom a wide pane shows 5+ pages at a time, so any visible page beyond
 *  current+2 got an empty strip where its note should be — reproduced here by zooming to the
 *  floor (0.25) in a pane wide/tall enough to show several pages of a 12-page document at once,
 *  then checking EVERY page whose own box actually intersects the scroll viewport. */
export const PdfScratchAtLowZoomMountsVisiblePages: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: {
                    [LONG_SIDECAR]: serializeDoc(marginOnlyDoc()),
                    [LONG_COMPANION]: `---\ntags: []\n---\n${serializeScratch('', LONG_BLOCKS)}`,
                },
            }),
        )
        return (
            <div style={{ width: '900px', height: '700px' }}>
                <PreviewView
                    path={LONG_PATH}
                    tagNames={NO_TAGS}
                    pdfLoad={longBookLoad}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitForPages(canvasElement, LONG_PAGE_COUNT)

        // Zoom all the way out — PDF_ZOOM_MIN clamps every click past the floor, so any number of
        // clicks past it settles at exactly 25%.
        const zoomOutBtn = canvasElement.querySelector<HTMLButtonElement>(
            'button[aria-label="Zoom out"]',
        )!
        for (let i = 0; i < 14; i++) fireEvent.click(zoomOutBtn)
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-testid="pdf-zoom-cluster"]')
                    ?.textContent,
            ).toContain('25%'),
        )
        // The label commits synchronously with the zoom signal, but the page boxes it drives
        // reflow a beat later (ResizeObserver + the layout memo) — two animation frames is enough
        // for that to settle before the geometry below is trusted.
        await new Promise<void>(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )

        // Which pages this pane's own scroll viewport (two DOM levels above any `[data-pdf-page]`
        // — its `.pdf-content` parent, and THAT element's own scrolling parent) actually shows —
        // walked by structure, not a class-name reach.
        const visiblePages = () => {
            const first = canvasElement.querySelector<HTMLElement>(
                '[data-pdf-page="0"]',
            )
            const scrollEl = first?.parentElement?.parentElement
            if (!first || !scrollEl) return []
            const view = scrollEl.getBoundingClientRect()
            const out: number[] = []
            for (let i = 0; i < LONG_PAGE_COUNT; i++) {
                const el = canvasElement.querySelector<HTMLElement>(
                    `[data-pdf-page="${i}"]`,
                )
                if (!el) continue
                const r = el.getBoundingClientRect()
                if (r.bottom > view.top && r.top < view.bottom) out.push(i)
            }
            return out
        }

        // Read twice, a frame apart, and require the SAME list — a snapshot taken mid-reflow
        // (e.g. between two of the rapid zoom-out clicks still settling) would otherwise pass
        // this `waitFor` on a transient page count that its own later assertions can't match.
        const visible = await waitFor(async () => {
            const v = visiblePages()
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
            expect(visiblePages()).toEqual(v)
            // Proves the low zoom genuinely put more than one page in view — the scenario the old
            // ± 2 window handled wrong.
            expect(v.length).toBeGreaterThan(2)
            return v
        })
        for (const i of visible) {
            await waitFor(() =>
                expect(hasBlock(canvasElement, `p${i}`)).toBe(true),
            )
        }
    },
}
