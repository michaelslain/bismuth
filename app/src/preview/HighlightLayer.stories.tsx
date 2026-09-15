// app/src/preview/HighlightLayer.stories.tsx
// Visual + behavioural spec for <HighlightLayer> — in-place PDF text highlights, mounted inside
// PdfPages' `overlay` the same way PdfPages.stories.tsx mounts things: a real, in-browser jsPDF
// document (so pdf.js has real glyphs to lay a real, selectable text layer over), never `/asset`.
//
// STUB STORE: createAnnotationStore.ts (Task 2, built in a parallel worktree) is not present
// here — only the AnnotationStore TYPE (annotationTypes.ts, pre-registered on the branch base).
// `makeStubStore` below implements that contract with plain signals, per the global constraints'
// "a story that needs an AnnotationStore may use a small in-story stub".
//
// WHY THE PIXEL CHECK USES A CANVAS, NOT JUST GETCOMPUTEDSTYLE: a highlight rect is a plain DOM
// div (position + background-color + CSS opacity), not a canvas raster like PdfPages' own pages
// — there is no bitmap to call getImageData on directly. `compositedPixelDiffersFromWhite` fills
// a 1x1 canvas white (the PDF page's own background), then paints the rect's OWN resolved
// background colour through its OWN resolved opacity on top with the same `globalAlpha` +
// `fillRect` compositing the browser itself performs, and samples the result — a real pixel
// sample of what the highlight would look like over the page, not an arithmetic stand-in for
// one. This is the DOM analogue of PdfPages.stories.tsx's `inkedPct`, which samples a real
// `<canvas>` because ink/pdf content IS one.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { jsPDF } from 'jspdf'
import HighlightLayer from './HighlightLayer'
import PdfPages from './PdfPages'
import type { PageInkPage } from './PageInk'
import { emptyDoc, type DrawingDoc } from '../../../core/src/drawing/model'
import type { AnnotationLoadState, AnnotationStore } from './annotationTypes'

const meta = {
    title: 'Preview/HighlightLayer',
    component: HighlightLayer,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof HighlightLayer>

export default meta
type Story = StoryObj<typeof meta>

/** A minimal in-story stand-in for createAnnotationStore.ts (see the file header). `edit` applies
 *  the update to the current doc, or a fresh blank one when none exists yet — the same documented
 *  behaviour the real store gives. Undo/redo/flush are no-ops: HighlightLayer never calls them. */
function makeStubStore(initial: DrawingDoc | null): AnnotationStore {
    const [doc, setDoc] = createSignal<DrawingDoc | null>(initial)
    const [loadState] = createSignal<AnnotationLoadState>('ready')
    return {
        doc,
        loadState,
        edit: fn => setDoc(d => fn(d ?? emptyDoc())),
        undo: () => {},
        redo: () => {},
        resetHistory: () => {},
        flush: () => Promise.resolve(),
    }
}

/** One US-Letter page with two real text lines, built in-browser — real glyphs for pdf.js's text
 *  layer, real Letter dimensions (612x792pt) so the 816x1056 logical page maps onto it with NO
 *  letterboxing (fitImage's scale is exactly 816/612 = 1056/792 for Letter — see pageHighlights'
 *  own header), which is what keeps the PreSeeded story's hand-picked logical rects landing
 *  predictably over the page. */
function buildTestPdf(): ArrayBuffer {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    pdf.setFontSize(24)
    pdf.text('Highlight test line one', 72, 100)
    pdf.text('Highlight test line two', 72, 140)
    return pdf.output('arraybuffer')
}

let pdfBytes: ArrayBuffer | undefined
async function load(): Promise<ArrayBuffer> {
    pdfBytes ??= buildTestPdf()
    return pdfBytes.slice(0)
}

/** A real pixel sample of `el` composited over a white page background — see the file header for
 *  why a canvas, not arithmetic on the parsed CSS values. `true` when the sampled pixel visibly
 *  differs from plain white. */
function compositedPixelDiffersFromWhite(el: HTMLElement): boolean {
    const cs = getComputedStyle(el)
    const match = cs.backgroundColor.match(/rgba?\(([^)]+)\)/)
    if (!match) return false
    const parts = match[1]!.split(',').map(s => parseFloat(s.trim()))
    const [r, g, b] = parts
    if (r === undefined || g === undefined || b === undefined) return false
    const opacity = parseFloat(cs.opacity || '1')

    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 1, 1)
    ctx.globalAlpha = opacity
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
    ctx.fillRect(0, 0, 1, 1)
    const [pr, pg, pb] = ctx.getImageData(0, 0, 1, 1).data
    const diff = Math.abs((pr ?? 255) - 255) + Math.abs((pg ?? 255) - 255) + Math.abs((pb ?? 255) - 255)
    return diff > 15
}

/** Rest state: two pre-seeded highlights on page 0 paint as two rects, each a real, visible
 *  colour over the white page — not just present in the DOM (chunk-1 review lesson from
 *  PdfPages.stories.tsx applies here too: a rect can exist with zero size or a fully-transparent
 *  fill and still pass a bare element-count check). */
export const PreSeeded: Story = {
    render: () => {
        const [pages, setPages] = createSignal<PageInkPage[]>([])
        const seeded: DrawingDoc = {
            v: 1,
            kind: 'drawing',
            paper: { bg: 'blank' },
            pages: [
                {
                    strokes: [],
                    highlights: [
                        {
                            id: 'seed-1',
                            c: 'hl',
                            rects: [{ x: 90, y: 95, w: 280, h: 40 }],
                        },
                        {
                            id: 'seed-2',
                            c: 'hl',
                            rects: [{ x: 90, y: 150, w: 280, h: 40 }],
                        },
                    ],
                },
            ],
        }
        const store = makeStubStore(seeded)
        return (
            <div style={{ height: '640px' }}>
                <PdfPages
                    load={load}
                    zoom={1}
                    onLayout={l =>
                        setPages(
                            l.boxes.map((b, i) => ({
                                rendered: {
                                    left: b.left,
                                    top: b.top,
                                    w: b.w,
                                    h: b.h,
                                },
                                nat: l.sizes[i] ?? { w: b.w, h: b.h },
                            })),
                        )
                    }
                    overlay={
                        <HighlightLayer
                            store={store}
                            pages={pages}
                            active={() => false}
                            contentEl={() => undefined}
                        />
                    }
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        // One waitFor covering BOTH the element count and its laid-out size: a rect can exist in
        // the DOM for a tick before PdfPages' ResizeObserver reports a real containerW (chunk-1
        // review lesson — a present-but-zero-sized element is a different failure than a missing
        // one, and only re-polling both together avoids a race between "count hit 2" and
        // "layout settled" reporting a false negative on a still-collapsing page.
        await waitFor(
            () => {
                const els = Array.from(
                    canvasElement.querySelectorAll(
                        '[data-testid="highlight-rect"]',
                    ),
                ) as HTMLElement[]
                expect(els.length).toBe(2)
                for (const el of els) {
                    const box = el.getBoundingClientRect()
                    expect(box.width).toBeGreaterThan(0)
                    expect(box.height).toBeGreaterThan(0)
                }
            },
            { timeout: 5000 },
        )
        const rects = Array.from(
            canvasElement.querySelectorAll('[data-testid="highlight-rect"]'),
        ) as HTMLElement[]
        for (const r of rects) {
            expect(compositedPixelDiffersFromWhite(r)).toBe(true)
        }
    },
}

/** Selecting real text in the pdf.js text layer, then releasing the pointer, creates a highlight
 *  whose painted rect sits on that same span — the store→paint round trip, driven the way a user
 *  actually would (a real browser Selection over real text), not a synthetic prop. */
export const SelectionCreatesHighlight: Story = {
    render: () => {
        const [pages, setPages] = createSignal<PageInkPage[]>([])
        const [scrollEl, setScrollEl] = createSignal<HTMLElement>()
        const store = makeStubStore(null)
        storeForPlay = store
        return (
            <div style={{ height: '640px' }}>
                <PdfPages
                    load={load}
                    zoom={1}
                    onLayout={l => {
                        setPages(
                            l.boxes.map((b, i) => ({
                                rendered: {
                                    left: b.left,
                                    top: b.top,
                                    w: b.w,
                                    h: b.h,
                                },
                                nat: l.sizes[i] ?? { w: b.w, h: b.h },
                            })),
                        )
                        setScrollEl(l.scrollEl)
                        // play() dispatches directly on the real element — see the story's play()
                        // comment for why this needs to be the exact node the effect attached to,
                        // not a re-queried one.
                        scrollElForPlay = l.scrollEl
                    }}
                    overlay={
                        <HighlightLayer
                            store={store}
                            pages={pages}
                            active={() => true}
                            contentEl={scrollEl}
                        />
                    }
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                expect(
                    canvasElement.querySelector('[data-pdf-page="0"] span'),
                ).toBeTruthy()
            },
            { timeout: 5000 },
        )
        const span = canvasElement.querySelector(
            '[data-pdf-page="0"] span',
        ) as HTMLElement
        const spanRect = span.getBoundingClientRect()
        expect(spanRect.width).toBeGreaterThan(0)

        // Select the span's own text — the same gesture a user's drag-select performs — then
        // release the pointer on the exact element HighlightLayer's effect attached its listener
        // to (captured live off PdfPages' own onLayout, not re-queried from the DOM).
        const sel = window.getSelection()
        if (!sel) throw new Error('no Selection available')
        const range = document.createRange()
        range.selectNodeContents(span)
        sel.removeAllRanges()
        sel.addRange(range)
        expect(sel.isCollapsed).toBe(false)

        if (!scrollElForPlay) throw new Error('PdfPages never handed back a scrollEl')
        scrollElForPlay.dispatchEvent(
            new PointerEvent('pointerup', { bubbles: true }),
        )

        await waitFor(
            () => {
                expect(
                    canvasElement.querySelectorAll('[data-testid="highlight-rect"]')
                        .length,
                ).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )

        // Committing clears the selection (the interface's own contract).
        expect(window.getSelection()?.isCollapsed).toBe(true)

        if (!storeForPlay) throw new Error('store was never created')
        const doc = storeForPlay.doc()
        const highlights = doc?.pages[0]?.highlights ?? []
        expect(highlights.length).toBe(1)
        expect(highlights[0]!.text).toBe(span.textContent)

        // Both rects are now real, on-screen client rects — comparing them directly needs no
        // coordinate math in the test itself.
        const rectEl = canvasElement.querySelector(
            '[data-testid="highlight-rect"]',
        ) as HTMLElement
        const painted = rectEl.getBoundingClientRect()
        expect(Math.abs(painted.left - spanRect.left)).toBeLessThan(4)
        expect(Math.abs(painted.top - spanRect.top)).toBeLessThan(4)
        expect(Math.abs(painted.width - spanRect.width)).toBeLessThan(4)
    },
}

// Module-level (not component state), reset per render — the same pattern PdfPages.stories.tsx
// uses for `lastBoxes`/`overlayMounts` — so play() (which runs outside the component tree) can
// reach the live store/DOM node the render created.
let storeForPlay: AnnotationStore | undefined
let scrollElForPlay: HTMLElement | undefined
