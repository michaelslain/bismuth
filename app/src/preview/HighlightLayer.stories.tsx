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
// WHAT `compositedPixelDiffersFromWhite` ACTUALLY CHECKS (corrected, chunk-1 review — the
// previous header claimed this samples "a real pixel", which it does not): a highlight rect is
// a plain DOM div (position + background-color + CSS opacity). This helper PARSES the rect's
// resolved `background-color`/`opacity` from `getComputedStyle` and composites those PARSED
// NUMBERS onto a 1x1 canvas it creates itself, with the same `globalAlpha` + `fillRect` math the
// browser uses — it is arithmetic on CSS values, not a sample of anything the browser actually
// painted to the screen. That means it CANNOT catch a rect painted under the page canvas
// (z-order), clipped by an ancestor, hidden by `visibility`/a zero-opacity ancestor, or sitting
// off the page entirely — the PreSeeded play() below adds real checks for those: each rect's own
// `getBoundingClientRect()` against the page's, and `document.elementsFromPoint` at a rect's
// centre to prove it paints ABOVE the page canvas (see PreSeeded's own comment: `elementsFromPoint`
// is ALSO filtered by `pointer-events: none`, same as singular `elementFromPoint` — which is why
// that play() toggles the rect to `pointer-events: auto` for the one read, then restores it).
import { createSignal, onCleanup } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { jsPDF } from 'jspdf'
import HighlightLayer from './HighlightLayer'
import PdfPages from './PdfPages'
import type { PageInkPage } from './PageInk'
import { emptyDoc, type DrawingDoc } from '../../../core/src/drawing/model'
import { pageBoxFor } from '../../../core/src/drawing/pageInk'
import { addHighlight, mergeLineRects } from '../../../core/src/drawing/pageHighlights'
import { rectsToPages } from './selectionRects'
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

/** Parses a `getComputedStyle(...).backgroundColor` string (`rgb(...)`/`rgba(...)`) into
 *  channels, falling back to opaque black for anything unparseable. */
function parseRgb(color: string): [number, number, number] {
    const m = color.match(/rgba?\(([^)]+)\)/)
    if (!m) return [0, 0, 0]
    const parts = m[1]!.split(',').map(s => parseFloat(s.trim()))
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

/** `base` (the page pixel) multiplied by `fill` (the highlight's own colour) per channel — the
 *  same math `mix-blend-mode: multiply` performs, and the reason a highlight leaves black text
 *  black (anything * black = black) while turning white paper the highlight's own colour
 *  (anything * white = itself unchanged). */
function compositeMultiply(
    base: [number, number, number],
    fill: [number, number, number],
): [number, number, number] {
    return [0, 1, 2].map(i => (base[i]! * fill[i]!) / 255) as [
        number,
        number,
        number,
    ]
}

/** Samples a grid of points inside `rectClient` (a highlight rect's own bounding box, viewport
 *  px) against `canvas`'s actual painted pixels, returning the darkest sample (approximating a
 *  black glyph stroke under the highlight) and the lightest (approximating bare white page
 *  background under it). Real pixels off the real canvas, not an assumption that "white" means
 *  (255,255,255) or "text" means pure black. */
function sampleUnderlyingExtremes(
    canvas: HTMLCanvasElement,
    rectClient: { left: number; top: number; width: number; height: number },
): { darkest: [number, number, number]; lightest: [number, number, number] } {
    const canvasRect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / canvasRect.width
    const scaleY = canvas.height / canvasRect.height
    const ctx = canvas.getContext('2d')!
    let darkest: [number, number, number] = [255, 255, 255]
    let darkestLum = Infinity
    let lightest: [number, number, number] = [0, 0, 0]
    let lightestLum = -Infinity
    const steps = 8
    for (let iy = 0; iy < steps; iy++) {
        for (let ix = 0; ix < steps; ix++) {
            const cx = rectClient.left + (rectClient.width * (ix + 0.5)) / steps
            const cy = rectClient.top + (rectClient.height * (iy + 0.5)) / steps
            const px = Math.round((cx - canvasRect.left) * scaleX)
            const py = Math.round((cy - canvasRect.top) * scaleY)
            if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height)
                continue
            const d = ctx.getImageData(px, py, 1, 1).data
            const rgb: [number, number, number] = [
                d[0] ?? 255,
                d[1] ?? 255,
                d[2] ?? 255,
            ]
            const lum = rgb[0] + rgb[1] + rgb[2]
            if (lum < darkestLum) {
                darkestLum = lum
                darkest = rgb
            }
            if (lum > lightestLum) {
                lightestLum = lum
                lightest = rgb
            }
        }
    }
    return { darkest, lightest }
}

/** `true` if `el` would break `mix-blend-mode` on a descendant: an explicit stacking context
 *  (`z-index` other than `auto` on a positioned element) OR one of the CSS-spec isolation triggers
 *  (`isolation:isolate`, `opacity<1`, a non-normal `mix-blend-mode` of its OWN, `filter`). Any of
 *  these stops a descendant's blend-mode from reaching backdrop content painted OUTSIDE `el` — see
 *  PdfPages.module.css's comment on `.pdf-page`/`.pdf-overlay` for why this codebase specifically
 *  cannot have a z-indexed ancestor between a highlight rect and the page canvas it multiplies
 *  against. */
function isolatesBlending(el: Element): boolean {
    const cs = getComputedStyle(el)
    if (cs.position !== 'static' && cs.zIndex !== 'auto') return true
    if (cs.isolation === 'isolate') return true
    if (cs.opacity !== '' && parseFloat(cs.opacity) < 1) return true
    if (cs.mixBlendMode !== 'normal') return true
    if (cs.filter !== 'none') return true
    return false
}

/** The nearest shared ancestor of `a` and `b`. */
function commonAncestor(a: Element, b: Element): Element {
    const aPath = new Set<Element>()
    for (let e: Element | null = a; e; e = e.parentElement) aPath.add(e)
    for (let e: Element | null = b; e; e = e.parentElement) {
        if (aPath.has(e)) return e
    }
    return document.documentElement
}

/** Every element strictly between `el` and `stopAt` (exclusive of both), root-to-leaf order
 *  irrelevant since every one of them is checked independently. */
function ancestorsBetween(el: Element, stopAt: Element): Element[] {
    const out: Element[] = []
    for (let e = el.parentElement; e && e !== stopAt; e = e.parentElement) {
        out.push(e)
    }
    return out
}

/** THE STRUCTURAL precondition for acceptance 3's colour thresholds to mean anything: no ancestor
 *  between `rect` and `canvas` (their nearest common ancestor down to, but not including, each of
 *  them) isolates blending. This is what actually DISCRIMINATES the isolated-stacking-context bug
 *  (`.pdf-overlay` used to sit above every page behind an explicit `z-index`) from a real fix —
 *  page JS cannot read back the browser's own post-compositing screen pixels (there is no API for
 *  that), so a colour-math check alone would pass identically whether or not the blend mode ever
 *  actually reached the canvas. Proved red against the pre-fix structure (an explicit `z-index:2`
 *  on `.pdf-overlay` failed this exact assertion) before PdfPages.module.css removed it. */
function assertNoIsolatingAncestor(rect: Element, canvas: Element) {
    const common = commonAncestor(rect, canvas)
    for (const el of [
        ...ancestorsBetween(rect, common),
        ...ancestorsBetween(canvas, common),
    ]) {
        expect(
            isolatesBlending(el),
            `${el.tagName}.${(el as HTMLElement).className || '(no class)'} isolates blending — breaks mix-blend-mode between the highlight and the page`,
        ).toBe(false)
    }
}

/** Composites `el`'s resolved `background-color`/`opacity`, PARSED off `getComputedStyle`, onto
 *  a white page background — see the file header for what this can and can't catch. `true` when
 *  the result visibly differs from plain white; proves the rect isn't fully transparent or
 *  transparent-by-colour, nothing about where or whether it actually painted on screen. */
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
 *  fill and still pass a bare element-count check).
 *
 *  THE SEED IS DERIVED, NOT HAND-PICKED (controller review 2026-09-14, after the seeded rects'
 *  hardcoded numbers turned out short — "line o|ne", "tw|o" — stopping mid-word because a
 *  hand-typed width happened not to match the fixture PDF's real glyph metrics). Once the real
 *  text layer has rendered, this selects EACH line's whole span — `range.selectNodeContents`, the
 *  exact same call `SelectionCreatesHighlight` below makes by simulating a user's drag-select —
 *  and runs its `getClientRects()` through `rectsToPages`/`mergeLineRects`, the SAME pipeline
 *  HighlightLayer.tsx itself uses for a live selection. So this story can never again silently
 *  drift out of sync with the fixture: whatever the real text layer measures is what gets seeded. */
export const PreSeeded: Story = {
    render: () => {
        const [pages, setPages] = createSignal<PageInkPage[]>([])
        const store = makeStubStore(null)
        let seeded = false
        let timer: ReturnType<typeof setInterval> | undefined

        const trySeed = () => {
            if (seeded) return
            const pgs = pages()
            const host = document.querySelector(
                '[data-testid="highlight-layer"]',
            ) as HTMLElement | null
            const spans = document.querySelectorAll('[data-pdf-page="0"] span')
            if (!host || pgs.length === 0 || spans.length < 2) return
            const [first, second] = spans as unknown as [
                HTMLElement,
                HTMLElement,
            ]
            if (first.getBoundingClientRect().width === 0) return
            seeded = true
            clearInterval(timer)
            const hostOrigin = host.getBoundingClientRect()
            const boxOf = (i: number) =>
                pageBoxFor(emptyDoc(), i, pgs[i]!.nat.w, pgs[i]!.nat.h)
            let doc = emptyDoc()
            for (const span of [first, second]) {
                const range = document.createRange()
                range.selectNodeContents(span)
                const byPage = rectsToPages(
                    Array.from(range.getClientRects()),
                    hostOrigin,
                    pgs,
                    boxOf,
                )
                for (const [page, rects] of byPage) {
                    doc = addHighlight(doc, page, mergeLineRects(rects), {
                        id: `seed-${page}-${span.textContent}`,
                        text: span.textContent ?? undefined,
                    })
                }
            }
            store.edit(() => doc)
        }
        // Text-layer rendering (PdfPageCanvas.tsx) is async and decoupled from `onLayout` (which
        // only reports the LAYOUT boxes) — poll rather than guessing a single delay.
        timer = setInterval(trySeed, 50)
        onCleanup(() => clearInterval(timer))

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
                        trySeed()
                    }}
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

        // Real position + real paint order, neither of which `compositedPixelDiffersFromWhite`
        // (arithmetic on parsed CSS, see the file header) can see.
        const page = canvasElement.querySelector(
            '[data-pdf-page="0"]',
        ) as HTMLElement
        expect(page).not.toBeNull()
        const pageRect = page.getBoundingClientRect()
        const canvasEl = page.querySelector('canvas') as HTMLCanvasElement
        expect(canvasEl).not.toBeNull()

        for (const r of rects) {
            const box = r.getBoundingClientRect()
            // Each rect lies within the page it's supposed to highlight — catches it landing off
            // the page (a wrong page index, or a coordinate mapping bug) that a colour check
            // can't.
            expect(box.left).toBeGreaterThanOrEqual(pageRect.left - 1)
            expect(box.top).toBeGreaterThanOrEqual(pageRect.top - 1)
            expect(box.right).toBeLessThanOrEqual(pageRect.right + 1)
            expect(box.bottom).toBeLessThanOrEqual(pageRect.bottom + 1)

            // `elementsFromPoint` reports real DOM/paint (z-index) stacking order at a point —
            // proving the rect paints ABOVE the page canvas, not merely that its colour differs
            // from white. The rect inherits `pointer-events: none` from `.highlight-layer`
            // (it's paint-only, never a click target, by design), and Chrome's hit-testing
            // excludes `pointer-events: none` elements from `elementsFromPoint` too (confirmed
            // empirically — this is NOT purely a CSSOM-spec-plural-vs-singular distinction).
            // `pointer-events` affects only what counts as a HIT, never what paints where, so
            // toggling it to `auto` for the instant of this one read — restored immediately
            // after, nothing else about the element changes — makes it hit-testable without
            // altering anything visible.
            const cx = box.left + box.width / 2
            const cy = box.top + box.height / 2
            const prevPointerEvents = r.style.pointerEvents
            r.style.pointerEvents = 'auto'
            const stack = document.elementsFromPoint(cx, cy)
            r.style.pointerEvents = prevPointerEvents
            const rectIndex = stack.indexOf(r)
            const canvasIndex = stack.indexOf(canvasEl)
            expect(rectIndex).toBeGreaterThanOrEqual(0)
            expect(canvasIndex).toBeGreaterThanOrEqual(0)
            expect(rectIndex).toBeLessThan(canvasIndex)
        }

        // Acceptance 3 (page-surface polish task, tightened after controller review): a highlight
        // over a white area of the page multiplies to light yellow, and a black glyph under a
        // highlight stays black — text does NOT tint olive/brown. Two independent checks, because
        // page JS cannot read back the browser's own post-compositing screen pixels (see
        // `assertNoIsolatingAncestor`'s own comment):
        //   1. STRUCTURE — no ancestor between the rect and the page canvas isolates blending, so
        //      `mix-blend-mode: multiply` is actually reaching the canvas at all.
        //   2. COLOUR MATH — given that structure holds, the multiply arithmetic against REAL
        //      sampled canvas pixels satisfies the tightened thresholds.
        // Must wait for pdf.js's OWN render task to have actually painted the canvas first: the
        // highlight rects are positioned from layout boxes alone (no dependency on the raster), so
        // without this wait the canvas can still be its freshly-created, fully-transparent
        // (0,0,0,0) buffer — every sample reads (0,0,0), and "darkest"/"lightest" collapse to the
        // same black, indistinguishable from a real black glyph.
        await waitFor(() => {
            const probe = canvasEl.getContext('2d')!.getImageData(0, 0, 1, 1).data
            expect(probe[3], 'canvas painted (opaque)').toBeGreaterThan(0)
        }, { timeout: 5000 })

        for (const r of rects) {
            assertNoIsolatingAncestor(r, canvasEl)

            const cs = getComputedStyle(r)
            expect(cs.mixBlendMode, 'rect uses multiply blending').toBe(
                'multiply',
            )
            expect(
                cs.opacity === '' ? 1 : parseFloat(cs.opacity),
                'rect is fully opaque (multiply supplies the fade, not CSS opacity)',
            ).toBe(1)
            const fillRgb = parseRgb(cs.backgroundColor)
            const box = r.getBoundingClientRect()
            const { darkest, lightest } = sampleUnderlyingExtremes(
                canvasEl,
                box,
            )

            const overWhite = compositeMultiply(lightest, fillRgb)
            expect(overWhite[0], 'over white: R').toBeGreaterThanOrEqual(240)
            expect(overWhite[1], 'over white: G').toBeGreaterThanOrEqual(225)
            expect(overWhite[2], 'over white: B').toBeLessThanOrEqual(170)

            const overGlyph = compositeMultiply(darkest, fillRgb)
            expect(
                Math.max(...overGlyph),
                'over glyph: max channel (text must stay black, not olive/brown)',
            ).toBeLessThanOrEqual(45)
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
        // Left edge + full line width: the selection starts and ends exactly where the span does —
        // a real drag-select must cover the WHOLE word, left edge to right edge, never stopping
        // mid-word (the controller's exact complaint about the seeded rects — see PreSeeded above).
        expect(Math.abs(painted.left - spanRect.left)).toBeLessThan(4)
        expect(Math.abs(painted.width - spanRect.width)).toBeLessThan(4)
        // Vertical coverage: the highlight must fully CONTAIN the span's own box, not merely sit
        // close to its top — `Range.getClientRects()` on selected text reports the line-box
        // (leading included), taller than the glyph-only span box, which is exactly what makes a
        // highlight clear an ascender/descender (the 'g' in "Highlight" here) instead of clipping
        // it. A tight top<->top tolerance would reward a highlight that clips descenders as long as
        // it merely started close to the right place; containment is the property that actually
        // matters.
        expect(painted.top, 'highlight covers the span from above').toBeLessThanOrEqual(
            spanRect.top + 0.5,
        )
        expect(
            painted.bottom,
            'highlight covers the span (and its descenders) from below',
        ).toBeGreaterThanOrEqual(spanRect.bottom - 0.5)
    },
}

// Module-level (not component state), reset per render — the same pattern PdfPages.stories.tsx
// uses for `lastBoxes`/`overlayMounts` — so play() (which runs outside the component tree) can
// reach the live store/DOM node the render created.
let storeForPlay: AnnotationStore | undefined
let scrollElForPlay: HTMLElement | undefined
