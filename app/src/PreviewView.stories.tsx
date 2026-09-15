// Visual spec for <PreviewView> — the read-only preview tab for non-note files (images, PDFs,
// code/text, and unrenderable binaries), routed from PaneContent by `previewKind()`.
//
// FIXTURE SEAM: `code` kind fetches its body via `api.read(path)` (GET /file), so a `Code`
// story must layer `setTransport(fakeTransport({ files: {...} }))` (app/src/ui/_fakeTransport.ts)
// on top of the Storybook-wide transport, same pattern as FileTree.stories.tsx — each story
// below sets its own so none depends on another story having run first in the session.
//
// IMAGE / PDF ARE HONEST FAILURES HERE, NOT A GAP: `assetUrl()` builds `${apiBase()}/asset?path=…`,
// and the fake transport's `base()` returns `"fake://storybook"` — an <img src> or a `fetch()`
// pointed at that URL genuinely cannot load, exactly like a moved/unresolved asset in the real
// app. The `Image` story below exercises PreviewView's OWN handling of that (`onError` ->
// `imgFailed` -> the "Couldn't load image" EmptyState); `Pdf` exercises PdfPages' equivalent —
// its `load()` seam calls `fetch(assetUrl())`, which rejects against the unfetchable
// `fake://storybook` scheme, so PdfPages' own "Couldn't load PDF" EmptyState is what renders.
// Real PDF rendering is covered by Preview/PdfPages.stories.tsx, which feeds PdfPages a real
// in-browser-generated PDF through the same `load()` seam instead — and, at THIS level, by the
// stories below that pass one through PreviewView's own `pdfLoad` seam (parent churn, and the
// highlights / margin / bookmarks wiring over the real annotation store).
//
// `isTauri()` is false in a Storybook browser tab, so "OPEN IN DEFAULT APP" / "REVEAL" never
// render here — an accurate state (the web build has no Tauri shell either), not a gap to patch.
import { createSignal, For, onCleanup, Show } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import { jsPDF } from 'jspdf'
import { PreviewView } from './PreviewView'
import { setTransport, type Transport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { inkSidecarFor } from '../../core/src/fileKinds'
import {
    emptyDoc,
    parseDoc,
    serializeDoc,
    type DrawingDoc,
    type Stroke,
} from '../../core/src/drawing/model'
import {
    containRect,
    fitImage,
    logicalToScreen,
    pageBoxFor,
} from '../../core/src/drawing/pageInk'
import { DEFAULT_MARGIN_RATIO } from '../../core/src/drawing/pageMargin'
import {
    addHighlight,
    mergeLineRects,
} from '../../core/src/drawing/pageHighlights'
import { PDF_PAGE_PAPER } from '../../core/src/theme/tokens'
import styles from './PreviewView.module.css'
import pdfPagesStyles from './preview/PdfPages.module.css'
import PdfPages from './preview/PdfPages'
import { rectsToPages } from './preview/selectionRects'

const meta = {
    title: 'App/PreviewView',
    component: PreviewView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PreviewView>

export default meta
type Story = StoryObj<typeof meta>

// PreviewView's `tagNames` (companion-note tag autocomplete, not exercised by any story here —
// see Preview/CompanionFrontmatter.stories.tsx) — a fixed empty candidate list is enough to
// satisfy the prop.
const NO_TAGS = () => [] as string[]

const CODE_PATH = 'src/example.ts'
const CODE_CONTENT = `export function greet(name: string): string {
    // return a friendly, capitalized greeting
    return \`Hello, \${name}!\`
}

export function farewell(name: string): string {
    return \`Goodbye, \${name}.\`
}
`

/** A code/text file, found via extension (\`.ts\` -> CODE_EXT). Shows the read-only monospace
 *  body with no find bar open (PreviewView's rest state). */
export const Code: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [CODE_PATH]: CODE_CONTENT } }))
        return <PreviewView path={CODE_PATH} tagNames={NO_TAGS} />
    },
}

/** Interactive: Cmd/Ctrl+F opens the real find bar (settings.keybindings.find defaults to
 *  "Mod+F"), typing "return" highlights all THREE occurrences, and Next/Previous step the
 *  active match — driving the actual find pipeline (findMatches/segmentText), not a canned
 *  highlighted render.
 *
 *  THREE, NOT TWO, AND THE FIRST ONE IS INSIDE A COMMENT. This story asserted `1/2` for a while,
 *  on the reading that the `// return a friendly, capitalized greeting` line was not a "real"
 *  occurrence. There is no such distinction to make: `preview/findMatches.ts` is a literal
 *  `hay.indexOf(needle)` substring scan over the raw file text, with no lexer and no notion of a
 *  comment — the same contract as the browser's own Cmd+F, which is the whole point of a find bar
 *  over a read-only code preview. Counting 3 is the component being correct, so the expectation
 *  moved rather than the implementation, and the comment hit is asserted BY POSITION below so a
 *  future change that starts skipping comments fails here instead of quietly editing 3 back to 2. */
export const CodeFind: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [CODE_PATH]: CODE_CONTENT } }))
        return <PreviewView path={CODE_PATH} tagNames={NO_TAGS} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const root = canvasElement.querySelector(
            `.${styles['preview-app']}`,
        ) as HTMLElement
        // Wait for the code body to load before opening find, matching how a user would.
        await canvas.findByText(/export function greet/)
        fireEvent.keyDown(root, { key: 'f', ctrlKey: true })

        const input = await canvas.findByPlaceholderText('Find')
        await fireEvent.input(input, { target: { value: 'return' } })

        await waitFor(() => expect(canvas.getByText('1/3')).toBeInTheDocument())
        const marks = canvasElement.querySelectorAll(
            `.${styles['preview-find-match']}`,
        )
        await expect(marks.length).toBe(3)
        await expect(marks[0]).toHaveClass(styles['is-active'])
        // Match #1 is the one in the `// return a friendly…` comment — the text run immediately
        // before it ends in the comment opener. Pinned here so "find stops matching in comments"
        // can only ever show up as a failure, never as a quietly-decremented count.
        await expect(marks[0]?.previousSibling?.textContent).toContain('//')

        await fireEvent.click(canvas.getByLabelText('Next match (Enter)'))
        await waitFor(() => expect(canvas.getByText('2/3')).toBeInTheDocument())
        await expect(marks[1]).toHaveClass(styles['is-active'])
    },
}

/** A search with no hits — the "No results" count label instead of an N/M count, and the
 *  Previous/Next steppers disabled since there is nothing to step through. */
export const CodeFindNoResults: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [CODE_PATH]: CODE_CONTENT } }))
        return <PreviewView path={CODE_PATH} tagNames={NO_TAGS} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const root = canvasElement.querySelector(
            `.${styles['preview-app']}`,
        ) as HTMLElement
        await canvas.findByText(/export function greet/)
        fireEvent.keyDown(root, { key: 'f', ctrlKey: true })
        const input = await canvas.findByPlaceholderText('Find')
        await fireEvent.input(input, { target: { value: 'zzz-nomatch' } })
        await waitFor(() =>
            expect(canvas.getByText('No results')).toBeInTheDocument(),
        )
        await expect(canvas.getByLabelText('Next match (Enter)')).toBeDisabled()
    },
}

/** An image path (`.png`) — see the file-level note: this genuinely fails to load against the
 *  fake transport's `fake://storybook` base, so PreviewView's own `onError` -> "Couldn't load
 *  image" EmptyState is what renders, not a canned broken-image story. */
export const Image: Story = {
    render: () => {
        setTransport(fakeTransport({}))
        return <PreviewView path="assets/diagram.png" tagNames={NO_TAGS} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() =>
            expect(canvas.getByText("Couldn't load image")).toBeInTheDocument(),
        )
        // The ANNOTATE hand-off is retired: ink is drawn in place, so no button for it.
        await expect(canvas.queryByText('ANNOTATE')).not.toBeInTheDocument()
        // Companion tags strip (Task 2): image is an "inkable" kind, so the frontmatter strip
        // mounts under the ViewBar independently of whether the PICTURE itself loaded — a fresh
        // companion shows the EMPTY_FRONTMATTER template. See Preview/CompanionFrontmatter for
        // the strip's own dedicated coverage (load/edit/write).
        await waitFor(() => {
            const strip = canvasElement.querySelector(
                '[data-companion-frontmatter]',
            )
            expect(strip?.textContent).toContain('tags')
        })
        // Flush with the body (final review): the strip's left/right edges must equal
        // `.preview-body`'s, not sit inset from it.
        await waitFor(() => {
            const strip = canvasElement.querySelector(
                '[data-companion-frontmatter]',
            ) as HTMLElement
            const body = canvasElement.querySelector(
                `.${styles['preview-body']}`,
            ) as HTMLElement
            const s = strip.getBoundingClientRect()
            const b = body.getBoundingClientRect()
            expect(Math.abs(s.left - b.left)).toBeLessThanOrEqual(1)
            expect(Math.abs(s.right - b.right)).toBeLessThanOrEqual(1)
        })
    },
}

/** A PDF path — the ViewBar zoom controls plus PdfPages' own load failure (see the header). No
 *  ANNOTATE button: ink on a PDF is drawn in place with the toggle-draw-mode key. */
export const Pdf: Story = {
    render: () => {
        setTransport(fakeTransport({}))
        return <PreviewView path="docs/handbook.pdf" tagNames={NO_TAGS} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // The ViewBar zoom controls (config region) only render for the pdf kind; the retired
        // ANNOTATE hand-off is gone.
        await expect(canvas.queryByText('ANNOTATE')).not.toBeInTheDocument()
        await expect(canvas.getByLabelText('Zoom in')).toBeInTheDocument()
        await expect(canvas.getByLabelText('Zoom out')).toBeInTheDocument()
        await expect(canvas.getByText('FIT')).toBeInTheDocument()
        // PdfPages' own load() seam (fetch(assetUrl())) genuinely fails against the fake
        // transport's unfetchable base — see the file header — so its "Couldn't load PDF"
        // EmptyState is what should render here, not a blank pane.
        await waitFor(() =>
            expect(canvas.getByText("Couldn't load PDF")).toBeInTheDocument(),
        )
        // Companion tags strip (Task 2): pdf is the other "inkable" kind — mounts under the
        // ViewBar the same as Image, independent of PdfPages' own load failure.
        await waitFor(() => {
            const strip = canvasElement.querySelector(
                '[data-companion-frontmatter]',
            )
            expect(strip?.textContent).toContain('tags')
        })
        // Flush with the body (final review): same edge-alignment check as the Image story above,
        // for the PDF kind.
        await waitFor(() => {
            const strip = canvasElement.querySelector(
                '[data-companion-frontmatter]',
            ) as HTMLElement
            const body = canvasElement.querySelector(
                `.${styles['preview-body']}`,
            ) as HTMLElement
            const s = strip.getBoundingClientRect()
            const b = body.getBoundingClientRect()
            expect(Math.abs(s.left - b.left)).toBeLessThanOrEqual(1)
            expect(Math.abs(s.right - b.right)).toBeLessThanOrEqual(1)
        })
    },
}

/** An unrenderable binary (`.psd`) — the "Preview not available" EmptyState naming the
 *  extension. */
export const External: Story = {
    render: () => {
        setTransport(fakeTransport({}))
        return <PreviewView path="design/mockup.psd" tagNames={NO_TAGS} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(/This \.PSD file/)).toBeInTheDocument()
        await expect(canvas.queryByText('ANNOTATE')).not.toBeInTheDocument()
        // `.psd` is `external`, not `inkable` — no companion tags strip for it (unrenderable
        // binaries other than images/PDFs are out of scope for Task 2 per the plan's rulings).
        await expect(
            canvasElement.querySelector('[data-companion-frontmatter]'),
        ).not.toBeInTheDocument()
    },
}

// ── Image ink lands at the REAL measured rect (chunk-1 review) ─────────────────────────────────
// `measureImage` (PreviewView.tsx) is the ONLY production code that turns a real `<img>` into
// `imagePages` — padding/border subtraction, `containRect` letterboxing, body scroll/clientLeft.
// No other story exercises it: Preview/PageInk's own image stories hand-place a KNOWN rect and
// pass it straight to PageInk's `pages` prop, bypassing measureImage entirely. This story uses
// the `imageSrc` data seam (above `PreviewView`'s props) to load a REAL image inside a real
// `.preview-image` (real `padding: var(--sp-6)`, real `max-width/max-height:100%` auto-sizing),
// then re-derives the SAME geometry from the SAME live DOM (not a hand-placed rect) and checks a
// seeded stroke paints within 2px of that.
//
// MEASURED, NOT ASSUMED: Chrome auto-sizes an unconstrained `<img>` with `object-fit: contain`
// so its CONTENT box (inside the padding) already matches the natural aspect ratio — so
// `containRect` rarely needs to shrink further here, and this story does NOT assert that it
// does. What it DOES prove is the PADDING OFFSET: `.preview-image`'s real padding measured
// ~16px a side (well over the 2px tolerance below), so a `measureImage` that forgot to add
// `padL`/`padT` into `content.left`/`.top` — or read the wrong element, or a stale/pre-load
// rect — would place the stroke ~16px off and fail this story, which is exactly the "off-by-
// padding" risk the review named.
const MEASURED_IMG_W = 200
const MEASURED_IMG_H = 150
let measuredPngUrl: string | undefined
function measuredPhotoPng(): string {
    if (measuredPngUrl) return measuredPngUrl
    const c = document.createElement('canvas')
    c.width = MEASURED_IMG_W
    c.height = MEASURED_IMG_H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#3a6ea5'
    ctx.fillRect(0, 0, MEASURED_IMG_W, MEASURED_IMG_H)
    ctx.fillStyle = '#d9a441'
    ctx.fillRect(0, MEASURED_IMG_H / 2, MEASURED_IMG_W, MEASURED_IMG_H / 2)
    measuredPngUrl = c.toDataURL('image/png')
    return measuredPngUrl
}

const MEASURED_IMAGE_PATH = 'assets/measured.png'
// A strokes-only (new-shape) sidecar — one short horizontal stroke at a known logical point.
const MEASURED_STROKE: Stroke = {
    t: 'pen',
    c: 'fg',
    w: 8,
    pts: [260, 420, 200, 420, 420, 200],
}
function measuredImageDoc(): DrawingDoc {
    const d = emptyDoc()
    d.paper.bg = 'blank'
    d.pages = [{ strokes: [MEASURED_STROKE] }]
    return d
}

/** True if any pixel within `tol` CSS px of (cssX, cssY) — in the canvas's OWN client rect —
 *  carries ink (alpha above PageInk's own faint threshold). Mirrors Preview/PageInk.stories.tsx's
 *  inkedPct/inkCentre alpha check, converting CSS px to device px via `canvas.width/clientWidth`. */
function inkedNear(
    canvas: HTMLCanvasElement,
    cssX: number,
    cssY: number,
    tol = 2,
): boolean {
    if (!canvas.clientWidth || !canvas.clientHeight) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    const sx = canvas.width / canvas.clientWidth
    const sy = canvas.height / canvas.clientHeight
    const cx = Math.round(cssX * sx)
    const cy = Math.round(cssY * sy)
    const rx = Math.max(1, Math.ceil(tol * sx))
    const ry = Math.max(1, Math.ceil(tol * sy))
    const x0 = Math.max(0, cx - rx)
    const y0 = Math.max(0, cy - ry)
    const x1 = Math.min(canvas.width, cx + rx + 1)
    const y1 = Math.min(canvas.height, cy + ry + 1)
    if (x1 <= x0 || y1 <= y0) return false
    const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0)
    for (let i = 3; i < data.length; i += 4)
        if ((data[i] ?? 0) > 16) return true
    return false
}

export const ImageInkLandsAtRealMeasuredRect: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: {
                    [inkSidecarFor(MEASURED_IMAGE_PATH)]:
                        serializeDoc(measuredImageDoc()),
                },
            }),
        )
        // A small wrapper — the 200x150 image must scale DOWN to fit (max-width/max-height:100%
        // actually constrains it), exercising the auto-sizing path a full-bleed container would
        // skip.
        return (
            <div style={{ width: '900px', height: '260px' }}>
                <PreviewView
                    path={MEASURED_IMAGE_PATH}
                    tagNames={NO_TAGS}
                    imageSrc={measuredPhotoPng}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const img = (await canvas.findByAltText(
            'measured.png',
        )) as HTMLImageElement

        // Wait for the ink canvas to actually paint — proves measureImage ran (imagePages > 0)
        // and PageInk mounted, not just that the <img> itself loaded.
        let committed: HTMLCanvasElement | null = null
        await waitFor(
            () => {
                committed = canvasElement.querySelector<HTMLCanvasElement>(
                    '[data-testid="ink-page-0"] [data-testid="ink-canvas-committed"]',
                )
                expect(committed).not.toBeNull()
            },
            { timeout: 5000 },
        )

        // Recompute the SAME geometry measureImage computes, from the SAME live DOM — NOT a
        // hand-placed rect. If measureImage forgot the padding subtraction, read the wrong
        // element, or never remeasured, this predicted rect (and the assertion below) would not
        // match where the component actually painted the stroke.
        const body = canvasElement.querySelector(
            `.${styles['preview-body']}`,
        ) as HTMLElement
        const br = body.getBoundingClientRect()
        const ir = img.getBoundingClientRect()
        const cs = getComputedStyle(img)
        const px = (v: string) => parseFloat(v) || 0
        const padL = px(cs.borderLeftWidth) + px(cs.paddingLeft)
        const padT = px(cs.borderTopWidth) + px(cs.paddingTop)
        const padR = px(cs.borderRightWidth) + px(cs.paddingRight)
        const padB = px(cs.borderBottomWidth) + px(cs.paddingBottom)
        const content = {
            left: ir.left - br.left - body.clientLeft + body.scrollLeft + padL,
            top: ir.top - br.top - body.clientTop + body.scrollTop + padT,
            w: ir.width - padL - padR,
            h: ir.height - padT - padB,
        }
        const rendered = containRect(content, MEASURED_IMG_W, MEASURED_IMG_H)
        // Padding is genuinely being measured, not a no-op — `.preview-image`'s real
        // `padding: var(--sp-6)` came back well over the 2px tolerance the ink check uses below,
        // so a `measureImage` that forgot to fold padL/padT into `content.left`/`.top` would miss
        // by more than that tolerance, not by a rounding error.
        await expect(padL).toBeGreaterThan(4)
        await expect(padT).toBeGreaterThan(4)

        const box = fitImage(MEASURED_IMG_W, MEASURED_IMG_H)
        const want = logicalToScreen(
            { x: MEASURED_STROKE.pts[0]!, y: MEASURED_STROKE.pts[1]! },
            rendered,
            box,
        )
        // `want` is body-relative (same space `rendered` was computed in); the canvas itself is
        // positioned at `rendered.left/top` within that same body-relative host (PageInk's host
        // is `inset: 0` over `.preview-body`), so the canvas-LOCAL point is the difference.
        const localX = want.x - rendered.left
        const localY = want.y - rendered.top
        if (!inkedNear(committed!, localX, localY)) {
            const cr = committed!.getBoundingClientRect()
            throw new Error(
                `ink not near: want=${JSON.stringify(want)} rendered=${JSON.stringify(rendered)} local=${localX},${localY} canvasClientRect=${JSON.stringify(cr)} canvasWH=${committed!.width}x${committed!.height}`,
            )
        }
    },
}

/** The toggle-draw-mode keybinding on a PDF/image preview, as a real keydown on the preview root.
 *  PreviewView catches it in the CAPTURE phase and CONSUMES it for the ink kinds — that is what
 *  keeps the key from reaching App.tsx's window handler and the browser. A code preview has no
 *  ink, so the same key must pass through untouched. (The ink layer itself cannot mount here:
 *  the page never loads against the fake transport. Preview/PageInk proves the drawing.)
 *  Never a hardcoded combo in the component — the settings store is the source of truth; this
 *  story sends the default `Mod+Shift+I` the way Editor.stories.tsx does. */
const toggleDrawKey = (target: HTMLElement): boolean =>
    target.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: 'I',
            code: 'KeyI',
            metaKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        }),
    )

/** Mod+Z / Mod+Shift+Z on the preview root — PreviewView's capture-phase `onKey`, the OUTSIDE-
 *  draw-mode half of undo/redo (PageInk's own `onHostKey` binds the same keys while draw mode is
 *  ON). `dispatchEvent`'s return is `false` once `preventDefault()` runs, same convention as
 *  `toggleDrawKey`. */
const undoKey = (target: HTMLElement): boolean =>
    target.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: 'z',
            code: 'KeyZ',
            metaKey: true,
            bubbles: true,
            cancelable: true,
        }),
    )
const redoKey = (target: HTMLElement): boolean =>
    target.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: 'z',
            code: 'KeyZ',
            metaKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        }),
    )

export const DrawModeKeyOnlyOnInkKinds: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [CODE_PATH]: CODE_CONTENT } }))
        return (
            <div style={{ display: 'flex', height: '100%' }}>
                <div style={{ flex: '1' }} data-testid="pdf-preview">
                    <PreviewView path="docs/handbook.pdf" tagNames={NO_TAGS} />
                </div>
                <div style={{ flex: '1' }} data-testid="code-preview">
                    <PreviewView path={CODE_PATH} tagNames={NO_TAGS} />
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const rootIn = (id: string) =>
            canvasElement.querySelector(
                `[data-testid="${id}"] .${styles['preview-app']}`,
            ) as HTMLElement
        await waitFor(() => expect(rootIn('pdf-preview')).not.toBeNull())
        await waitFor(() => expect(rootIn('code-preview')).not.toBeNull())
        // dispatchEvent returns FALSE when a listener called preventDefault.
        await expect(toggleDrawKey(rootIn('pdf-preview'))).toBe(false)
        await expect(toggleDrawKey(rootIn('code-preview'))).toBe(true)
    },
}

// ── A click that only refocuses the pane must not reboot the PDF (Task 1) ──────────────────────
// Reproduces the exact bug: App.tsx's PaneTree `onFocus` rebuilds the ACTIVE TAB object on every
// pane mousedown, even when the clicked pane is already focused (`updateActiveTab(tab => ({
// ...tab, focusId }))` with no equality check). `path={...}` reaches PreviewView through a JSX
// getter chain exactly like the real one (App -> PaneTree -> PaneContent -> PreviewView), so a
// parent-level object churn with the SAME path string looks — to any naive `props.path` read
// inside PreviewView — indistinguishable from switching files. `state` below stands in for that
// active-tab object; the play() step below rebuilds it into a brand-new object holding the
// identical path, mirroring the mousedown rebuild.
function buildChurnTestPdf(): ArrayBuffer {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    for (let i = 0; i < 6; i++) {
        if (i > 0) pdf.addPage('letter')
        pdf.setFontSize(32)
        pdf.text(`Page ${i + 1}`, 72, 100)
    }
    return pdf.output('arraybuffer')
}
let churnPdfBytes: ArrayBuffer | undefined
let churnLoadCalls = 0
async function countingChurnLoad(): Promise<ArrayBuffer> {
    churnLoadCalls++
    churnPdfBytes ??= buildChurnTestPdf()
    return churnPdfBytes.slice(0)
}

const CHURN_PDF_PATH = 'docs/churn.pdf'
type ParentState = { root: { content: string } }
let setParentState: ((fn: (s: ParentState) => ParentState) => void) | undefined

export const PdfSurvivesParentChurn: Story = {
    render: () => {
        setTransport(fakeTransport({}))
        churnLoadCalls = 0
        const [state, setState] = createSignal<ParentState>({
            root: { content: CHURN_PDF_PATH },
        })
        setParentState = setState
        return (
            <div style={{ height: '100vh' }}>
                <PreviewView
                    path={state().root.content}
                    tagNames={NO_TAGS}
                    pdfLoad={countingChurnLoad}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(
            () =>
                expect(
                    canvasElement.querySelectorAll('[data-pdf-page]').length,
                ).toBe(6),
            { timeout: 5000 },
        )
        await expect(churnLoadCalls).toBe(1)

        const scrollEl = canvasElement.querySelector(
            `.${pdfPagesStyles['pdf-scroll']}`,
        ) as HTMLElement
        await expect(scrollEl).not.toBeNull()
        // The page boxes render at width/height 0 for one tick until PdfPages' ResizeObserver
        // reports the scroll container's real width (fit-width layout depends on it) — wait for
        // the content to actually become taller than the viewport before trusting scrollTop.
        await waitFor(
            () =>
                expect(scrollEl.scrollHeight).toBeGreaterThan(
                    scrollEl.clientHeight + 200,
                ),
            { timeout: 5000 },
        )
        // Put every path-reset piece of state AWAY from its default first — otherwise a churn
        // that wrongly resets it lands back on the value it started with and nothing can fail:
        // zoom off fit-width (one Zoom in = 120%), draw mode on, the bookmarks panel open.
        const root = canvasElement.querySelector(
            `.${styles['preview-app']}`,
        ) as HTMLElement
        await fireEvent.click(canvas.getByLabelText('Zoom in'))
        await expect(canvas.getByText('120%')).toBeInTheDocument()
        await fireEvent.click(bookmarksBtn(canvasElement))
        await expect(pressedOf(bookmarksBtn(canvasElement))).toBe('true')
        const liveCanvas = () =>
            canvasElement.querySelector('[data-testid="ink-canvas-live"]')
        await expect(toggleDrawKey(root)).toBe(false)
        await waitFor(() => expect(liveCanvas()).not.toBeNull(), {
            timeout: 3000,
        })
        scrollEl.scrollTop = 400
        await fireEvent.scroll(scrollEl)
        await waitFor(() => expect(scrollEl.scrollTop).toBe(400))

        const assertSurvived = async () => {
            await expect(churnLoadCalls).toBe(1)
            await expect(scrollEl.scrollTop).toBe(400)
            await expect(scrollElOf(canvasElement)).toBe(scrollEl)
            await expect(canvas.getByText('120%')).toBeInTheDocument()
            await expect(pressedOf(bookmarksBtn(canvasElement))).toBe('true')
        }
        // The churn: a NEW parent object, the SAME path string — exactly what App.tsx's
        // `onFocus` produces today on a mousedown of the already-focused pane.
        const churn = async () => {
            setParentState!(s => ({ root: { content: s.root.content } }))
            await new Promise<void>(r => requestAnimationFrame(() => r()))
        }

        await churn()
        await assertSurvived()
        await expect(liveCanvas()).not.toBeNull()

        // Draw and an armed highlight exclude each other, so arming gets its own churn (no text
        // is selected, so the press ARMS rather than highlighting on the spot).
        const hlBtn = canvas.getByLabelText(
            'Highlight text',
        ) as HTMLButtonElement
        await waitFor(() => expect(hlBtn.disabled).toBe(false))
        await fireEvent.click(hlBtn)
        await expect(pressedOf(hlBtn)).toBe('true')
        await churn()
        await assertSurvived()
        await expect(pressedOf(hlBtn)).toBe('true')
    },
}

// ── Highlights, margin and bookmarks, wired through the REAL annotation store (Task 6) ─────────
// Every story below seeds the sidecar through the fake transport's GET /file and watches the
// store's writes on PUT /file, so what runs is PreviewView's own `createAnnotationStore` — the
// debounce, the load gate and the serializer — not an in-story stub.

/** Four US-Letter pages, real text on page 1 (for the text layer) and a real embedded outline
 *  (jspdf's outline plugin writes page-ref destinations, the shape real PDFs use). */
function buildAnnotatedPdf(): ArrayBuffer {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    ;['Part one', 'Part two', 'Results', 'Section four'].forEach((label, i) => {
        if (i > 0) pdf.addPage('letter')
        pdf.setFontSize(24)
        pdf.text(`${label}: highlight test line`, 72, 100)
        pdf.text('A second line of body text', 72, 140)
    })
    const part = pdf.outline.add(null, 'Part one', { pageNumber: 1 })
    pdf.outline.add(part, 'Section four', { pageNumber: 4 })
    pdf.outline.add(null, 'Part two', { pageNumber: 2 })
    return pdf.output('arraybuffer')
}
let annotatedBytes: ArrayBuffer | undefined
async function annotatedLoad(): Promise<ArrayBuffer> {
    annotatedBytes ??= buildAnnotatedPdf()
    return annotatedBytes.slice(0)
}

const ANNOT_PDF_PATH = 'docs/annotated.pdf'
const ANNOT_SIDECAR = inkSidecarFor(ANNOT_PDF_PATH)

/** Every sidecar write the store makes, parsed, in order. */
let sidecarPuts: DrawingDoc[] = []
/** The fake transport, with PUT /file observed on the way through (it still stores the file). */
function recordingTransport(files: Record<string, string>): Transport {
    const t = fakeTransport({ files })
    const put = t.put
    return {
        ...t,
        put: async (path, body) => {
            const b = body as { path?: string; contents?: string }
            if (path === '/file' && b.path === ANNOT_SIDECAR && b.contents) {
                sidecarPuts.push(parseDoc(b.contents))
            }
            return put(path, body)
        },
    }
}

const scrollElOf = (root: HTMLElement) =>
    root.querySelector(`.${pdfPagesStyles['pdf-scroll']}`) as HTMLElement | null
const pressedOf = (el: HTMLElement) => el.getAttribute('aria-pressed')
/** The bar's BOOKMARKS toggle — by role, since the open panel's own section is also labelled
 *  "Bookmarks". */
const bookmarksBtn = (root: HTMLElement) =>
    root.querySelector('button[aria-label="Bookmarks"]') as HTMLButtonElement

/** WCAG relative luminance of an sRGB colour. */
function luminance(r: number, g: number, b: number): number {
    const f = (c: number) => {
        const v = c / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrastRatio = (a: number, b: number) =>
    (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
const rgbOf = (css: string): [number, number, number] => {
    const m = css.match(/rgba?\(([^)]+)\)/)
    const [r, g, b] = (m?.[1] ?? '').split(',').map(v => parseFloat(v))
    return [r ?? NaN, g ?? NaN, b ?? NaN]
}
const hexToRgb = (hex: string): [number, number, number] => {
    const n = parseInt(hex.replace('#', ''), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Mean colour of the opaque-ish ink pixels of `canvas` inside a horizontal CSS-px band, and how
 *  many there were. */
function inkInBand(
    canvas: HTMLCanvasElement,
    x0Css: number,
    x1Css: number,
): { n: number; rgb: [number, number, number] } {
    const ctx = canvas.getContext('2d')
    if (!ctx || !canvas.width || !canvas.clientWidth)
        return { n: 0, rgb: [0, 0, 0] }
    const s = canvas.width / canvas.clientWidth
    const x0 = Math.max(0, Math.round(x0Css * s))
    const x1 = Math.min(canvas.width, Math.round(x1Css * s))
    if (x1 <= x0) return { n: 0, rgb: [0, 0, 0] }
    const { data } = ctx.getImageData(x0, 0, x1 - x0, canvas.height)
    let n = 0
    let r = 0
    let g = 0
    let b = 0
    for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 3] ?? 0) < 200) continue
        n++
        r += data[i]!
        g += data[i + 1]!
        b += data[i + 2]!
    }
    return n ? { n, rgb: [r / n, g / n, b / n] } : { n: 0, rgb: [0, 0, 0] }
}

/** The seeded sidecar: a highlight over page 1's first line, the scratch paper on, a pen stroke
 *  drawn entirely IN the margin, and a bookmark on page 3. At DEFAULT_MARGIN_RATIO (0.4) the
 *  scratch paper spans logical x 816..816+816×0.4 ≈ 1142 beside the 816-wide page box, so the
 *  stroke stays well inside that (880..1070 — it was authored for the old 0.6 ratio and ran off
 *  the paper's right edge). `firstLine` replaces the hand-typed highlight rects with ones measured off the real text
 *  layer (see `SeededAnnotatedPreview`) — a hand-typed rect overhung the line in the critique. */
function annotatedDoc(firstLine?: DrawingDoc): DrawingDoc {
    const d = emptyDoc()
    d.paper.bg = 'blank'
    d.pages = [
        {
            strokes: [
                {
                    t: 'pen',
                    c: 'fg',
                    w: 10,
                    pts: [880, 300, 220, 1060, 300, 220, 1060, 420, 220],
                },
            ],
            highlights: [
                {
                    id: 'hl-seed',
                    c: 'hl',
                    rects: [{ x: 90, y: 100, w: 420, h: 40 }],
                    text: 'Part one: highlight test line',
                },
            ],
        },
    ]
    d.margin = { right: DEFAULT_MARGIN_RATIO }
    d.bookmarks = [{ id: 'bm-seed', page: 2, label: 'Results' }]
    const measured = firstLine?.pages[0]?.highlights
    if (measured?.length) d.pages[0]!.highlights = measured
    return d
}

/** The first text-layer span of page 0, as a highlight in LOGICAL page space — measured, not typed.
 *  Renders the same PDF in an invisible PdfPages, waits for pdf.js's text layer, selects the span
 *  (`range.selectNodeContents`, what a drag-select produces) and runs its client rects through
 *  `rectsToPages` + `mergeLineRects`, the exact pipeline HighlightLayer uses for a live selection.
 *  Logical space is width-independent, so the measuring stack's width does not have to match the
 *  preview's. Calls `done` once with a doc holding just that highlight. */
function MeasureFirstLine(props: { done: (doc: DrawingDoc) => void }) {
    let sizes: { w: number; h: number }[] = []
    let boxes: { left: number; top: number; w: number; h: number }[] = []
    let finished = false
    const tick = () => {
        if (finished) return
        const pageEl = document.querySelector<HTMLElement>(
            '[data-testid="measure-first-line"] [data-pdf-page="0"]',
        )
        const span = pageEl?.querySelector<HTMLElement>('span')
        const box = boxes[0]
        if (!pageEl || !span || !box || !span.getBoundingClientRect().width)
            return
        finished = true
        const pr = pageEl.getBoundingClientRect()
        const hostOrigin = { left: pr.left - box.left, top: pr.top - box.top }
        const pages = boxes.map((b, i) => ({
            rendered: { left: b.left, top: b.top, w: b.w, h: b.h },
            nat: sizes[i] ?? { w: b.w, h: b.h },
        }))
        const range = document.createRange()
        range.selectNodeContents(span)
        const byPage = rectsToPages(
            Array.from(range.getClientRects()),
            hostOrigin,
            pages,
            i => pageBoxFor(emptyDoc(), i, pages[i]!.nat.w, pages[i]!.nat.h),
        )
        let doc = emptyDoc()
        for (const [page, rects] of byPage) {
            doc = addHighlight(doc, page, mergeLineRects(rects), {
                id: 'hl-seed',
                text: span.textContent ?? undefined,
            })
        }
        props.done(doc)
    }
    const timer = setInterval(tick, 50)
    onCleanup(() => clearInterval(timer))
    return (
        <div
            data-testid="measure-first-line"
            style={{
                position: 'absolute',
                left: '0',
                top: '0',
                width: '800px',
                height: '600px',
                visibility: 'hidden',
                'pointer-events': 'none',
            }}
        >
            <PdfPages
                load={annotatedLoad}
                zoom={1}
                onLayout={l => {
                    boxes = l.boxes
                    sizes = l.sizes
                }}
            />
        </div>
    )
}

/** Mounts PreviewView over the annotated PDF once its seeded highlight has been MEASURED (see
 *  MeasureFirstLine) — the fake transport is installed only then, so the store's first GET /file
 *  already sees the measured sidecar. */
function SeededAnnotatedPreview(props: { width: string }) {
    const [seeded, setSeeded] = createSignal(false)
    return (
        <>
            <Show when={!seeded()}>
                <MeasureFirstLine
                    done={line => {
                        seededLine = line
                        setTransport(
                            recordingTransport({
                                [ANNOT_SIDECAR]: serializeDoc(annotatedDoc(line)),
                            }),
                        )
                        setSeeded(true)
                    }}
                />
            </Show>
            <Show when={seeded()}>
                <div style={{ height: '100vh', width: props.width }}>
                    <PreviewView
                        path={ANNOT_PDF_PATH}
                        tagNames={NO_TAGS}
                        pdfLoad={annotatedLoad}
                    />
                </div>
            </Show>
        </>
    )
}
/** The measured first-line highlight the last SeededAnnotatedPreview seeded. */
let seededLine: DrawingDoc | undefined

/** A PDF with a pre-seeded sidecar, end to end: the highlight is painted, the margin is paper
 *  with ink in it that actually CONTRASTS (the margin must be light paper, not the app's dark
 *  ground), the pages rasterize, and the bookmarks panel lists the bookmark above the PDF's own
 *  outline — clicking either scrolls the page stack to that page. */
export const PdfHighlightMarginBookmarks: Story = {
    render: () => {
        sidecarPuts = []
        seededLine = undefined
        setTransport(recordingTransport({}))
        return <SeededAnnotatedPreview width="1000px" />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // The measuring stack (SeededAnnotatedPreview) renders the same 4-page PDF first — wait
        // for it to be gone and the PREVIEW's own pages to be up, so nothing below measures it.
        await waitFor(
            () => {
                expect(
                    canvasElement.querySelector('[data-testid="measure-first-line"]'),
                ).toBeNull()
                expect(
                    canvasElement.querySelectorAll(
                        `.${styles['preview-body']} [data-pdf-page]`,
                    ).length,
                ).toBe(4)
            },
            { timeout: 8000 },
        )

        // Full-height story frame (final review — this story used to sit in a fixed 700px div
        // inside Storybook's fullscreen canvas, leaving a dark band below it): the preview body's
        // own bottom edge reaches the viewport bottom, matching the app's `.preview-body` (flex:1
        // inside a 100%-height column, no fixed height anywhere in the PDF path).
        const bodyEl = canvasElement.querySelector(
            `.${styles['preview-body']}`,
        ) as HTMLElement
        await expect(
            Math.abs(bodyEl.getBoundingClientRect().bottom - window.innerHeight),
        ).toBeLessThanOrEqual(1)

        // The toggles reflect the loaded sidecar: scratch paper on, nothing else.
        const marginBtn = canvas.getByLabelText(
            'Scratch paper',
        ) as HTMLButtonElement
        await waitFor(() => expect(pressedOf(marginBtn)).toBe('true'), {
            timeout: 5000,
        })
        await expect(marginBtn.disabled).toBe(false)
        await expect(pressedOf(canvas.getByLabelText('Highlight text'))).toBe(
            'false',
        )

        // Pre-seeded highlight painted, and it covers page 1's first line EXACTLY — the seed was
        // measured off the text layer (SeededAnnotatedPreview), so the painted rect must sit on
        // the live span edge to edge, not overhang it the way the old hand-typed rect did.
        await expect(seededLine?.pages[0]?.highlights?.length).toBe(1)
        await waitFor(
            () => {
                const rects = canvasElement.querySelectorAll<HTMLElement>(
                    '[data-testid="highlight-rect"]',
                )
                expect(rects.length).toBe(1)
                const r = rects[0]!.getBoundingClientRect()
                const span = canvasElement.querySelector<HTMLElement>(
                    '[data-pdf-page="0"] span',
                )
                expect(span).not.toBeNull()
                const sr = span!.getBoundingClientRect()
                expect(sr.width).toBeGreaterThan(50)
                expect(Math.abs(r.left - sr.left)).toBeLessThan(3)
                expect(Math.abs(r.right - sr.right)).toBeLessThan(3)
                expect(r.top).toBeLessThanOrEqual(sr.top + 0.5)
                expect(r.bottom).toBeGreaterThanOrEqual(sr.bottom - 0.5)
            },
            { timeout: 5000 },
        )

        // Scratch paper on every page, the PDF page's own white (PDF_PAGE_PAPER) — never the app
        // ground, and never a theme paper that would not match the page beside it.
        await expect(
            canvasElement.querySelectorAll('[data-pdf-margin]').length,
        ).toBe(4)
        const marginEl = canvasElement.querySelector(
            '[data-pdf-margin="0"]',
        ) as HTMLElement
        await expect(rgbOf(getComputedStyle(marginEl).backgroundColor)).toEqual(
            hexToRgb(PDF_PAGE_PAPER),
        )

        // The page itself rasterized (pdf.js canvas, not the ink overlay).
        await waitFor(
            () => {
                const c = canvasElement.querySelector<HTMLCanvasElement>(
                    '[data-pdf-page="0"] canvas',
                )
                expect(c).not.toBeNull()
                const { data } = c!
                    .getContext('2d')!
                    .getImageData(0, 0, c!.width, c!.height)
                let text = 0
                for (let i = 0; i < data.length; i += 16) {
                    // painted AND not page-white: real glyphs, not an unrendered transparent canvas
                    if (data[i + 3]! > 0 && data[i]! < 128) text++
                }
                expect(text).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )

        // Margin ink: painted in the margin band of page 0's ink canvas, and legible against the
        // margin's own painted ground (WCAG contrast of the mean ink colour vs the paper).
        const pageEl = canvasElement.querySelector(
            '[data-pdf-page="0"]',
        ) as HTMLElement
        let band = { n: 0, rgb: [0, 0, 0] as [number, number, number] }
        await waitFor(
            () => {
                const c = canvasElement.querySelector<HTMLCanvasElement>(
                    '[data-testid="ink-page-0"] [data-testid="ink-canvas-committed"]',
                )
                expect(c).not.toBeNull()
                const pageW = pageEl.getBoundingClientRect().width
                const marginW = marginEl.getBoundingClientRect().width
                band = inkInBand(c!, pageW + 2, pageW + marginW - 2)
                expect(band.n).toBeGreaterThan(20)
                // and it is ALL on the paper: nothing in the paper's last 15%, so no part
                // of the stroke can be running off its right edge (the seed used to be clipped
                // there, authored for the old 0.6 ratio).
                expect(
                    inkInBand(c!, pageW + marginW * 0.85, pageW + marginW + 40).n,
                ).toBe(0)
                // and none of it spilled onto the page's own width
                expect(inkInBand(c!, 0, pageW - 2).n).toBe(0)
            },
            { timeout: 5000 },
        )
        const ground = rgbOf(getComputedStyle(marginEl).backgroundColor)
        const ratio = contrastRatio(
            luminance(...band.rgb),
            luminance(...ground),
        )
        await expect(ratio).toBeGreaterThan(4.5)

        // Bookmarks panel: closed by default, opens from the bar, lists the bookmark + outline.
        await expect(
            canvasElement.querySelector('[data-bookmark-id]'),
        ).toBeNull()
        await fireEvent.click(bookmarksBtn(canvasElement))

        // Adjacent-toggle gap (final review — two SELECTED toggles' accent borders were touching,
        // reading as one double-bordered box): SCRATCH (selected from the fixture) and BOOKMARKS
        // (just selected above) now sit side by side — assert real daylight between them.
        await waitFor(() => {
            const margin = canvas.getByLabelText(
                'Scratch paper',
            ) as HTMLButtonElement
            const bookmarks = bookmarksBtn(canvasElement)
            expect(pressedOf(margin)).toBe('true')
            expect(pressedOf(bookmarks)).toBe('true')
            const gap =
                bookmarks.getBoundingClientRect().left -
                margin.getBoundingClientRect().right
            expect(gap).toBeGreaterThan(4)
        })

        const row = (await waitFor(() => {
            const el = canvasElement.querySelector(
                '[data-bookmark-id="bm-seed"]',
            )
            expect(el?.textContent).toContain('Results')
            return el
        })) as HTMLElement
        const outlineRow = (title: string) =>
            Array.from(
                canvasElement.querySelectorAll<HTMLElement>(
                    '[role="treeitem"]',
                ),
            ).find(r => r.textContent?.includes(title))
        await waitFor(
            () => {
                expect(outlineRow('Part one')).toBeTruthy()
                expect(outlineRow('Section four')).toBeTruthy()
                expect(outlineRow('Part two')).toBeTruthy()
            },
            { timeout: 5000 },
        )

        const scrollEl = scrollElOf(canvasElement)!
        // Fix 3 finding 5: a jump lands `pad` px ABOVE a page's own top (PdfPages' page-frame
        // gutter, the resolved `--sp-6`), so the gutter stays visible instead of being scrolled
        // out of view — `expectedTop` mirrors `scrollTopForPage`'s own clamping.
        const pad = parseFloat(
            getComputedStyle(scrollEl).getPropertyValue('--sp-6'),
        )
        await expect(pad).toBeGreaterThan(0)
        const expectedTop = (page: number) => {
            const el = canvasElement.querySelector(
                `[data-pdf-page="${page}"]`,
            ) as HTMLElement
            return Math.max(
                0,
                Math.min(
                    el.offsetTop - pad,
                    scrollEl.scrollHeight - scrollEl.clientHeight,
                ),
            )
        }
        await waitFor(() => expect(scrollEl.scrollTop).toBe(0))

        // Clicking the bookmark scrolls to its page (index 2)…
        row.click()
        await waitFor(() => {
            expect(expectedTop(2)).toBeGreaterThan(100)
            expect(scrollEl.scrollTop).toBeCloseTo(expectedTop(2), 0)
        })
        // …and the outline jumps too: "Part two" is page index 1…
        outlineRow('Part two')!.click()
        await waitFor(() =>
            expect(scrollEl.scrollTop).toBeCloseTo(expectedTop(1), 0),
        )
        // …and back to "Part one" (index 0): page 0's own top IS `pad` (layoutPages starts the
        // stack there), so the pad-aware jump lands exactly at scrollTop 0 — flush, with the
        // gutter visible above the page because the page's CSS top already sits `pad` into the
        // scroll content.
        outlineRow('Part one')!.click()
        await waitFor(() =>
            expect(scrollEl.scrollTop).toBeCloseTo(expectedTop(0), 0),
        )

        // Back at the very top (scrollTop 0), which also leaves the story's shot on the page that
        // carries the measured highlight, the scratch paper and its ink: the first page sits `pad`
        // below the scroll box's top and `pad` in from its left — the desk shows above it rather
        // than the page butting against the frontmatter strip.
        scrollEl.scrollTop = 0
        await fireEvent.scroll(scrollEl)
        await waitFor(() => {
            expect(scrollEl.scrollTop).toBe(0)
            const pr = pageEl.getBoundingClientRect()
            const sr = scrollEl.getBoundingClientRect()
            expect(Math.abs(pr.top - sr.top - pad)).toBeLessThanOrEqual(1)
            expect(Math.abs(pr.left - sr.left - pad)).toBeLessThanOrEqual(1)
        })

        // Nothing above edited the sidecar, so the store wrote nothing.
        await expect(sidecarPuts.length).toBe(0)
    },
}

/** The SCRATCH toggle (the sidecar's `margin`) edits through the store: on writes the sidecar with `margin`, off writes it
 *  WITHOUT the key (setMarginRatio removes it rather than storing a zero), and the margin paper
 *  appears and goes with it. */
export const PdfMarginToggleSaves: Story = {
    render: () => {
        sidecarPuts = []
        setTransport(recordingTransport({}))
        return (
            <div style={{ height: '100vh', width: '900px' }}>
                <PreviewView
                    path={ANNOT_PDF_PATH}
                    tagNames={NO_TAGS}
                    pdfLoad={annotatedLoad}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(
            () =>
                expect(
                    canvasElement.querySelectorAll('[data-pdf-page]').length,
                ).toBe(4),
            { timeout: 5000 },
        )
        const marginBtn = canvas.getByLabelText(
            'Scratch paper',
        ) as HTMLButtonElement
        await waitFor(() => expect(marginBtn.disabled).toBe(false))
        await expect(pressedOf(marginBtn)).toBe('false')
        await expect(
            canvasElement.querySelectorAll('[data-pdf-margin]').length,
        ).toBe(0)

        // Labelled toggle, visible on-state (final review — `variant="selected"` on the old icon
        // button was a faint opacity change with no readable on-state): the OFF computed style
        // must differ from ON in colour AND border, not just opacity.
        const offStyle = getComputedStyle(marginBtn)
        const offColor = offStyle.color
        const offBorderColor = offStyle.borderColor

        await fireEvent.click(marginBtn)
        await waitFor(() => expect(pressedOf(marginBtn)).toBe('true'))
        const onStyle = getComputedStyle(marginBtn)
        await expect(onStyle.color).not.toBe(offColor)
        await expect(onStyle.borderColor).not.toBe(offBorderColor)
        await waitFor(
            () =>
                expect(
                    canvasElement.querySelectorAll('[data-pdf-margin]').length,
                ).toBe(4),
            { timeout: 3000 },
        )
        await waitFor(
            () => {
                expect(sidecarPuts.length).toBe(1)
                expect(sidecarPuts[0]!.margin).toEqual({
                    right: DEFAULT_MARGIN_RATIO,
                })
            },
            { timeout: 3000 },
        )

        await fireEvent.click(marginBtn)
        await waitFor(() => expect(pressedOf(marginBtn)).toBe('false'))
        await expect(
            canvasElement.querySelectorAll('[data-pdf-margin]').length,
        ).toBe(0)
        await waitFor(
            () => {
                expect(sidecarPuts.length).toBe(2)
                expect('margin' in sidecarPuts[1]!).toBe(false)
            },
            { timeout: 3000 },
        )
    },
}

/** Selects the whole text of `span` — the Selection a user's drag-select over it produces. */
function selectSpan(span: HTMLElement) {
    const range = document.createRange()
    range.selectNodeContents(span)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
}

/** HIGHLIGHT is ONE-SHOT, through PreviewView's own wiring (the user: "highlighting should not be a
 *  mode. just press a button and highlight, then it turns off waiting for the next button click"):
 *    1. text selected FIRST, then HIGHLIGHT → highlighted at once, selection cleared, button off;
 *    2. nothing selected → HIGHLIGHT arms (selected); the next selection + pointerup highlights and
 *       the button turns itself off; pressing it while armed disarms;
 *    3. DRAW is a visible toggle, and DRAW on ⇒ highlight unarmed, arming ⇒ draw off. */
export const PdfHighlightOneShot: Story = {
    render: () => {
        sidecarPuts = []
        setTransport(recordingTransport({}))
        return (
            <div style={{ height: '100vh', width: '900px' }}>
                <PreviewView
                    path={ANNOT_PDF_PATH}
                    tagNames={NO_TAGS}
                    pdfLoad={annotatedLoad}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(
            () => {
                const spans = canvasElement.querySelectorAll<HTMLElement>(
                    '[data-pdf-page="0"] span',
                )
                expect(spans.length).toBeGreaterThanOrEqual(2)
                expect(spans[1]!.getBoundingClientRect().width).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )
        const hlBtn = canvas.getByLabelText('Highlight text') as HTMLButtonElement
        const drawBtn = canvas.getByLabelText('Draw') as HTMLButtonElement
        await waitFor(() => expect(hlBtn.disabled).toBe(false))
        await expect(drawBtn.disabled).toBe(false)
        const rects = () =>
            Array.from(
                canvasElement.querySelectorAll<HTMLElement>(
                    '[data-testid="highlight-rect"]',
                ),
            )
        const [first, second] = Array.from(
            canvasElement.querySelectorAll<HTMLElement>('[data-pdf-page="0"] span'),
        ) as [HTMLElement, HTMLElement]

        // 1 — selection exists, then press: highlighted with the selection's rects, cleared, off.
        const firstRect = first.getBoundingClientRect()
        selectSpan(first)
        await fireEvent.click(hlBtn)
        await expect(pressedOf(hlBtn)).toBe('false')
        await expect(window.getSelection()?.isCollapsed).toBe(true)
        await waitFor(() => {
            expect(rects().length).toBe(1)
            const r = rects()[0]!.getBoundingClientRect()
            expect(Math.abs(r.left - firstRect.left)).toBeLessThan(3)
            expect(Math.abs(r.width - firstRect.width)).toBeLessThan(3)
        })
        await waitFor(
            () =>
                expect(sidecarPuts.at(-1)?.pages[0]?.highlights?.[0]?.text).toBe(
                    first.textContent,
                ),
            { timeout: 3000 },
        )

        // 2 — nothing selected: the press ARMS…
        window.getSelection()?.removeAllRanges()
        await fireEvent.click(hlBtn)
        await expect(pressedOf(hlBtn)).toBe('true')
        // …a click on bare paper (no selection, no highlight under it) leaves it armed…
        const scrollEl = scrollElOf(canvasElement)!
        const pageRect = canvasElement
            .querySelector('[data-pdf-page="0"]')!
            .getBoundingClientRect()
        scrollEl.dispatchEvent(
            new PointerEvent('pointerup', {
                bubbles: true,
                clientX: pageRect.left + pageRect.width / 2,
                clientY: pageRect.top + pageRect.height * 0.8,
            }),
        )
        await expect(pressedOf(hlBtn)).toBe('true')
        // …then select + pointerup highlights and the button turns itself off.
        const secondRect = second.getBoundingClientRect()
        selectSpan(second)
        scrollEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
        await waitFor(() => expect(rects().length).toBe(2))
        await waitFor(() => expect(pressedOf(hlBtn)).toBe('false'))
        const painted = rects()
            .map(el => el.getBoundingClientRect())
            .find(r => Math.abs(r.top - secondRect.top) < 20)
        await expect(painted).toBeTruthy()
        await expect(Math.abs(painted!.left - secondRect.left)).toBeLessThan(3)

        // Pressing while armed disarms, without touching the doc.
        await fireEvent.click(hlBtn)
        await expect(pressedOf(hlBtn)).toBe('true')
        await fireEvent.click(hlBtn)
        await expect(pressedOf(hlBtn)).toBe('false')
        await expect(rects().length).toBe(2)

        // 3 — DRAW is the draw mode: on shows the live ink canvas and the ink toolbar.
        const inDraw = () => canvas.queryByLabelText('Undo') !== null
        await fireEvent.click(hlBtn) // arm first, so DRAW has something to disarm
        await expect(pressedOf(hlBtn)).toBe('true')
        await fireEvent.click(drawBtn)
        await expect(pressedOf(drawBtn)).toBe('true')
        await expect(pressedOf(hlBtn)).toBe('false')
        await waitFor(() => expect(inDraw()).toBe(true), { timeout: 3000 })
        // Arming highlight exits draw.
        await fireEvent.click(hlBtn)
        await expect(pressedOf(hlBtn)).toBe('true')
        await expect(pressedOf(drawBtn)).toBe('false')
        await waitFor(() => expect(inDraw()).toBe(false))
        // DRAW off again from its own button.
        await fireEvent.click(drawBtn)
        await expect(pressedOf(drawBtn)).toBe('true')
        await fireEvent.click(drawBtn)
        await expect(pressedOf(drawBtn)).toBe('false')
        await waitFor(() => expect(inDraw()).toBe(false))
        // …and the keybinding still drives the same state the button shows.
        const root = canvasElement.querySelector(
            `.${styles['preview-app']}`,
        ) as HTMLElement
        await expect(toggleDrawKey(root)).toBe(false)
        await waitFor(() => expect(pressedOf(drawBtn)).toBe('true'))
    },
}

/** Undo/redo for a highlight removal reaches OUTSIDE draw mode (final review — before this fix,
 *  `store.undo`/`redo` were bound only inside PageInk's own draw-mode keydown, so a highlight
 *  deleted by a plain click in highlight mode had NO way back short of entering draw mode — and
 *  even THAT stopped working the moment draw mode exited again, because PageInk reset the shared
 *  undo stack on every exit). Proves both halves: Mod+Z on the preview root restores a highlight
 *  removed by a highlight-mode click, and an entire draw-mode enter/exit cycle in between does not
 *  wipe the history that undo needs. */
export const PdfHighlightUndoOutsideDrawMode: Story = {
    render: () => {
        sidecarPuts = []
        setTransport(
            recordingTransport({
                [ANNOT_SIDECAR]: serializeDoc(annotatedDoc()),
            }),
        )
        return (
            <div style={{ height: '100vh', width: '900px' }}>
                <PreviewView
                    path={ANNOT_PDF_PATH}
                    tagNames={NO_TAGS}
                    pdfLoad={annotatedLoad}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const root = canvasElement.querySelector(
            `.${styles['preview-app']}`,
        ) as HTMLElement
        const rectCount = () =>
            canvasElement.querySelectorAll('[data-testid="highlight-rect"]')
                .length

        // The pre-seeded highlight (annotatedDoc's `hl-seed`) is painted before anything happens.
        // Waiting on COUNT alone is not enough: the rect element exists (and count===1) the moment
        // `painted()` first computes, but at a real, nonzero SIZE only once PdfPages has actually
        // measured the page it sits on — check the geometry, not just the element's presence.
        await waitFor(
            () => {
                const el = canvasElement.querySelector<HTMLElement>(
                    '[data-testid="highlight-rect"]',
                )
                expect(el).not.toBeNull()
                expect(el!.getBoundingClientRect().width).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )

        // Arm HIGHLIGHT (nothing is selected, so the press arms), then click the painted rect to
        // remove it — the same one-click deletion HighlightLayer.tsx's `handleClick` performs (a
        // click landing on a highlight with a collapsed selection removes it).
        const hlBtn = canvas.getByLabelText(
            'Highlight text',
        ) as HTMLButtonElement
        await waitFor(() => expect(hlBtn.disabled).toBe(false))
        await fireEvent.click(hlBtn)
        await expect(pressedOf(hlBtn)).toBe('true')

        const rect = canvasElement.querySelector(
            '[data-testid="highlight-rect"]',
        ) as HTMLElement
        const r = rect.getBoundingClientRect()
        await expect(r.width).toBeGreaterThan(0)
        await expect(r.height).toBeGreaterThan(0)
        const scrollEl = scrollElOf(canvasElement)
        await expect(scrollEl).not.toBeNull()
        // A collapsed selection (or none) is what routes the pointerup to `handleClick` rather
        // than `handleSelection` — force it explicitly rather than relying on nothing having
        // selected text yet.
        window.getSelection()?.removeAllRanges()
        scrollEl!.dispatchEvent(
            new PointerEvent('pointerup', {
                bubbles: true,
                clientX: r.left + r.width / 2,
                clientY: r.top + r.height / 2,
            }),
        )
        await waitFor(() => expect(rectCount()).toBe(0), { timeout: 5000 })
        // One-shot: removing a highlight is the edit that disarms, same as creating one.
        await waitFor(() => expect(pressedOf(hlBtn)).toBe('false'))
        await waitFor(
            () =>
                expect(sidecarPuts.at(-1)?.pages[0]?.highlights ?? []).toEqual(
                    [],
                ),
            { timeout: 3000 },
        )

        // A full draw-mode enter/exit cycle in between must not wipe the undo entry the removal
        // just pushed (PageInk.tsx no longer resets shared history on exit — only a path change
        // does, in createAnnotationStore.ts). PageInk's own ink Toolbar (Undo/Redo buttons) is
        // gated purely on `active()` with no exception for pre-existing strokes — unlike the
        // ink-canvas-live element, which this fixture's seeded MARGIN STROKE keeps mounted on
        // page 0 even outside draw mode (PageInk.tsx's `hasInkOn` exception) — so the Toolbar is
        // the fixture-independent signal of draw mode's own on/off state here.
        await expect(toggleDrawKey(root)).toBe(false) // enter draw mode
        await waitFor(() => expect(canvas.queryByLabelText('Undo')).not.toBeNull(), {
            timeout: 3000,
        })
        await expect(toggleDrawKey(root)).toBe(false) // exit draw mode
        await waitFor(() => expect(canvas.queryByLabelText('Undo')).toBeNull())

        // Mod+Z on the preview root — NOT inside draw mode — brings the highlight back.
        await expect(undoKey(root)).toBe(false)
        await waitFor(() => expect(rectCount()).toBe(1), { timeout: 5000 })
        await waitFor(
            () =>
                expect(sidecarPuts.at(-1)?.pages[0]?.highlights?.[0]?.id).toBe(
                    'hl-seed',
                ),
            { timeout: 3000 },
        )

        // And Mod+Shift+Z redoes the removal, proving the same outside-draw-mode path both ways.
        await expect(redoKey(root)).toBe(false)
        await waitFor(() => expect(rectCount()).toBe(0), { timeout: 5000 })
    },
}

/** Pairwise overlap area of two rects (0 when they only touch). */
function overlapArea(a: DOMRectReadOnly, b: DOMRectReadOnly): number {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    return w > 0 && h > 0 ? w * h : 0
}
/** One `ch` of `el`'s own font, in px. */
function chPx(el: HTMLElement): number {
    const probe = document.createElement('span')
    probe.textContent = '0'
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'
    el.appendChild(probe)
    const w = probe.getBoundingClientRect().width
    probe.remove()
    return w
}
const inside = (r: DOMRectReadOnly, box: DOMRectReadOnly) =>
    r.left >= box.left - 0.5 &&
    r.right <= box.right + 0.5 &&
    r.top >= box.top - 0.5 &&
    r.bottom <= box.bottom + 0.5
/** Every painted control of a PDF bar — the crumb's title, each displayed trail button (the page
 *  readout included) and each toggle on the bar's second row when it has one — with the element
 *  that CLIPS it, if any ancestor up to the preview root clips overflow. */
function barControls(frame: HTMLElement) {
    const bar = frame.querySelector('[data-viewbar]') as HTMLElement
    const row2 = frame.querySelector('[data-testid="pdf-toggles-row"]') as HTMLElement | null
    const items: { name: string; el: HTMLElement; rect: DOMRect }[] = []
    const title = bar.querySelector('.crumb b') as HTMLElement
    items.push({ name: 'filename', el: title, rect: title.getBoundingClientRect() })
    const buttons = [
        ...Array.from(bar.querySelectorAll<HTMLElement>('.vb-trail button')),
        ...Array.from(row2?.querySelectorAll<HTMLElement>('button') ?? []),
    ]
    for (const el of buttons) {
        if (!el.getClientRects().length) continue // display: none (dropped by the ladder)
        items.push({
            name: el.textContent || el.getAttribute('aria-label') || el.tagName,
            el,
            rect: el.getBoundingClientRect(),
        })
    }
    return { bar, row2, items }
}
/** The nearest ancestor of `el` (below `stop`) that clips its overflow on the x axis. */
function clippingAncestor(el: HTMLElement, stop: HTMLElement): HTMLElement | null {
    for (let a = el.parentElement; a && a !== stop; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== 'visible') return a
    }
    return null
}

/** The PDF ViewBar at narrow panes, WITH the desktop app's native actions (`showNativeActions`).
 *  NEVER A PARTIALLY-VISIBLE CONTROL (fix 2 — the side-scrolling toggle group showed `SC` / `D`
 *  slices at the edge): every painted control lies whole inside the bar and inside any ancestor
 *  that clips, no two overlap, and none is narrower than its own content. When HIGHLIGHT DRAW
 *  SCRATCH do not fit beside the filename they move, full words and same frames, to a second row
 *  of the bar; the filename (≥ 6ch, ellipsized), FIT and BOOKMARKS stay on row 1. Only −, % and +
 *  drop (the ladder's 650px tier), with the native actions. Then the room-based switch is driven
 *  both ways by resizing one pane. The error state below shows its single action centred under the
 *  message. */
export const PdfViewBarNarrow: Story = {
    render: () => {
        setTransport(fakeTransport({}))
        return (
            <div
                style={{
                    display: 'flex',
                    'flex-direction': 'column',
                    gap: '12px',
                }}
            >
                <For each={[520, 380, 320]}>
                    {w => (
                        <div
                            // Tall enough for the load-failure block under a two-row bar, short
                            // enough that all three panes fit the story viewport unscrolled.
                            style={{ width: `${w}px`, height: '270px' }}
                            data-testid={`narrow-${w}`}
                        >
                            <PreviewView
                                path="docs/quarterly-reading-notes.pdf"
                                tagNames={NO_TAGS}
                                showNativeActions
                            />
                        </div>
                    )}
                </For>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const check = async (frame: HTMLElement, w: number, wrapped: boolean) => {
            await waitFor(() => expect(bookmarksBtn(frame)).toBeInTheDocument())
            await waitFor(() =>
                expect(
                    !!frame.querySelector('[data-testid="pdf-toggles-row"]'),
                    `${w}px: toggles on a second row`,
                ).toBe(wrapped),
            )
            const { bar, row2, items } = barControls(frame)
            const b = bar.getBoundingClientRect()
            expect(b.width).toBeCloseTo(w, 0)

            // The filename: ellipsizing, at least 6ch of it visible, on row 1.
            const title = bar.querySelector('.crumb b') as HTMLElement
            const tr = title.getBoundingClientRect()
            const ch = chPx(title)
            expect(
                tr.width,
                `${w}px: filename shows ${(tr.width / ch).toFixed(1)}ch, want ≥ 6`,
            ).toBeGreaterThanOrEqual(6 * ch)
            expect(getComputedStyle(title).textOverflow).toBe('ellipsis')

            // Dropped at the ladder's 650px tier (the bar's CONTENT box — 18px padding a side):
            // −, % and + (NOT FIT) and the two native actions. FIT shows at every width.
            const dropped = w - 36 <= 650
            const steps = bar.querySelector('[data-testid="pdf-zoom-steps"]') as HTMLElement
            expect(getComputedStyle(steps).display === 'none', `${w}px: zoom steps dropped`).toBe(dropped)
            const fit = within(bar).getByLabelText('Fit width')
            expect(fit.getClientRects().length, `${w}px: FIT visible`).toBeGreaterThan(0)
            for (const label of ['OPEN IN DEFAULT APP', 'REVEAL']) {
                const btn = Array.from(bar.querySelectorAll('button')).find(
                    x => x.textContent === label,
                ) as HTMLElement
                expect(getComputedStyle(btn).display === 'none', `${w}px: ${label} dropped`).toBe(dropped)
            }

            // Row 1 holds the filename, FIT and BOOKMARKS; the toggles are in row 1 or row 2.
            const toggles = frame.querySelector('[data-testid="pdf-mode-toggles"]') as HTMLElement
            for (const el of [title, fit, bookmarksBtn(frame)]) {
                expect(inside(el.getBoundingClientRect(), b), `${w}px: ${el.textContent} on row 1`).toBe(true)
            }
            expect(!!row2 && row2.contains(toggles)).toBe(wrapped)
            if (row2) {
                const r2 = row2.getBoundingClientRect()
                // Directly under the bar, the same width, and the toggles start at the filename's
                // own left inset.
                expect(Math.abs(r2.top - b.bottom)).toBeLessThanOrEqual(1)
                expect(Math.abs(r2.width - b.width)).toBeLessThanOrEqual(1)
                const crumbLeft = (bar.querySelector('.crumb') as HTMLElement).getBoundingClientRect().left
                expect(Math.abs(toggles.getBoundingClientRect().left - crumbLeft)).toBeLessThanOrEqual(1)
            }

            // Every painted control: whole inside the bar (row 1 or row 2), whole inside anything
            // that clips it, never narrower than its own content, and no pairwise overlap.
            const rows = [b, ...(row2 ? [row2.getBoundingClientRect()] : [])]
            const root = frame.firstElementChild as HTMLElement
            for (let i = 0; i < items.length; i++) {
                const a = items[i]!
                expect(
                    rows.some(r => inside(a.rect, r)),
                    `${w}px: ${a.name} whole inside the bar`,
                ).toBe(true)
                const clip = clippingAncestor(a.el, root)
                if (clip && a.name !== 'filename') {
                    expect(
                        inside(a.rect, clip.getBoundingClientRect()),
                        `${w}px: ${a.name} clipped by its container`,
                    ).toBe(true)
                }
                if (a.name !== 'filename') {
                    expect(
                        a.rect.width,
                        `${w}px: ${a.name} narrower than its content`,
                    ).toBeGreaterThanOrEqual(a.el.scrollWidth - 0.5)
                }
                for (let j = i + 1; j < items.length; j++) {
                    const c = items[j]!
                    expect(
                        overlapArea(a.rect, c.rect),
                        `${w}px: ${a.name} overlaps ${c.name}`,
                    ).toBeLessThanOrEqual(0.5)
                }
            }

            // Daylight between the filename and the first row-1 control after it.
            const row1After = items.filter(
                x => x.name !== 'filename' && inside(x.rect, b),
            )
            expect(
                Math.min(...row1After.map(x => x.rect.left)) - tr.right,
                `${w}px: gap between filename and the first control`,
            ).toBeGreaterThanOrEqual(8)

            // Full words.
            const words = Array.from(toggles.querySelectorAll('button')).map(x => x.textContent)
            expect(words).toEqual(['HIGHLIGHT', 'DRAW', 'SCRATCH'])
            await expect(bookmarksBtn(frame).textContent).toBe('BOOKMARKS')
        }

        const frames = Object.fromEntries(
            [520, 380, 320].map(w => [
                w,
                canvasElement.querySelector(`[data-testid="narrow-${w}"]`) as HTMLElement,
            ]),
        )
        await check(frames[520]!, 520, false)
        await check(frames[380]!, 380, true)
        await check(frames[320]!, 320, true)

        // Fix 3 finding 1 — HIGHLIGHT/DRAW/SCRATCH's `:focus-visible` ring (2px, 1px offset —
        // reaches 3px past the button's border box) must land inside the row-1 group's clip
        // boundary now that it uses `overflow: clip; overflow-clip-margin: 3px` instead of plain
        // `hidden`, which cropped the ring on every side even while the group fit whole. Only
        // meaningful in the 520px pane, where the group is unwrapped (`--in-bar`, the class the
        // clip lives on) — the 380/320 panes move it to its own unclipped second row.
        {
            const toggles520 = frames[520]!.querySelector(
                '[data-testid="pdf-mode-toggles"]',
            ) as HTMLElement
            const drawBtn = Array.from(
                toggles520.querySelectorAll('button'),
            ).find(b => b.textContent === 'DRAW') as HTMLElement
            drawBtn.focus()
            const cs = getComputedStyle(drawBtn)
            const ringWidth = parseFloat(cs.outlineWidth)
            const ringOffset = parseFloat(cs.outlineOffset)
            expect(ringWidth, 'DRAW: focus ring present').toBeGreaterThan(0)
            const reach = ringWidth + Math.max(0, ringOffset)
            const br = drawBtn.getBoundingClientRect()
            const ring = new DOMRect(
                br.left - reach,
                br.top - reach,
                br.width + 2 * reach,
                br.height + 2 * reach,
            )
            // The clip boundary: the group's own box (its `overflow` origin), grown by its own
            // 3px `overflow-clip-margin`.
            const groupBox = toggles520.getBoundingClientRect()
            const margin = 3
            const clipBox = new DOMRect(
                groupBox.left - margin,
                groupBox.top - margin,
                groupBox.width + 2 * margin,
                groupBox.height + 2 * margin,
            )
            expect(
                inside(ring, clipBox),
                'DRAW: focus ring inside the clip boundary',
            ).toBe(true)
            drawBtn.blur()
        }

        // Room-based, both ways, with no flip-flop: widen the 380 pane until everything fits on one
        // row, then narrow it again.
        const f = frames[380]!
        f.style.width = '900px'
        await check(f, 900, false)
        f.style.width = '380px'
        await check(f, 380, true)

        // The load-failure state under the bar: ONE "open in default app", centred under the
        // message (it used to render three times, one of them beside the sentence).
        for (const w of [520, 320]) {
            const frame = frames[w]!
            const actions = Array.from(
                frame.querySelectorAll<HTMLElement>(`.${styles['preview-body']} button`),
            ).filter(x => x.textContent?.includes('OPEN IN DEFAULT APP'))
            expect(actions.length, `${w}px: error actions`).toBe(1)
            const msg = frame.querySelector('.ui-empty') as HTMLElement
            const mr = msg.getBoundingClientRect()
            const ar = actions[0]!.getBoundingClientRect()
            expect(ar.top, `${w}px: action under the message`).toBeGreaterThanOrEqual(mr.bottom)
            expect(
                Math.abs((ar.left + ar.right) / 2 - (mr.left + mr.right) / 2),
            ).toBeLessThanOrEqual(1)
        }
        // Each PreviewView focuses its root on mount, which scrolls the story frame to the last
        // pane — put the view back at the top so the shot shows all three bars.
        window.scrollTo(0, 0)
    },
}

/** The full-width PDF bar, loaded: `p. N / M` · `[−] 100% [+] FIT` · `HIGHLIGHT DRAW SCRATCH` ·
 *  `BOOKMARKS` + native actions. Probes the hierarchy the critique asked for: FIT sits in the zoom
 *  cluster (no wider than the bar gap from Zoom in), BOOKMARKS is the right-most toggle before the
 *  native actions, and an unselected mode toggle has a frame distinct from BOTH the selected state
 *  and a plain label. Then the readout: scrolling to page 3 reads `p. 3 / 4`, and typing 2 + Enter
 *  in it scrolls back to page 2. */
export const PdfViewBarLayout: Story = {
    render: () => {
        sidecarPuts = []
        setTransport(recordingTransport({}))
        return (
            <div style={{ height: '100vh', width: '1100px' }}>
                <PreviewView
                    path={ANNOT_PDF_PATH}
                    tagNames={NO_TAGS}
                    pdfLoad={annotatedLoad}
                    showNativeActions
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const bar = canvasElement.querySelector('[data-viewbar]') as HTMLElement
        const readoutBtn = () =>
            canvasElement.querySelector(
                '[data-testid="page-readout"] button',
            ) as HTMLButtonElement | null
        await waitFor(() => expect(readoutBtn()?.textContent).toBe('p. 1 / 4'), {
            timeout: 5000,
        })
        const drawBtn = canvas.getByLabelText('Draw') as HTMLButtonElement
        await waitFor(() => expect(drawBtn.disabled).toBe(false))

        // FIT inside the zoom cluster.
        const zoomIn = canvas.getByLabelText('Zoom in').getBoundingClientRect()
        const fitBtn = canvas.getByLabelText('Fit width') as HTMLButtonElement
        const fit = fitBtn.getBoundingClientRect()
        const barGap = parseFloat(
            getComputedStyle(bar.querySelector('.vb-trail')!).columnGap,
        )
        await expect(fit.left - zoomIn.right).toBeGreaterThanOrEqual(0)
        await expect(fit.left - zoomIn.right).toBeLessThanOrEqual(barGap)
        await expect(pressedOf(fitBtn)).toBe('true') // zoom 1 = fit width

        // Order: readout < zoom cluster < HIGHLIGHT < DRAW < SCRATCH < BOOKMARKS < native actions.
        const order = [
            readoutBtn()!,
            canvas.getByLabelText('Zoom out'),
            fitBtn,
            canvas.getByLabelText('Highlight text'),
            drawBtn,
            canvas.getByLabelText('Scratch paper'),
            bookmarksBtn(canvasElement),
            ...Array.from(bar.querySelectorAll('button')).filter(x =>
                ['OPEN IN DEFAULT APP', 'REVEAL'].includes(x.textContent ?? ''),
            ),
        ].map(el => el.getBoundingClientRect())
        for (let i = 1; i < order.length; i++) {
            expect(order[i]!.left, `control ${i} after control ${i - 1}`).toBeGreaterThanOrEqual(
                order[i - 1]!.right,
            )
        }

        // Rest vs selected vs a plain label.
        const scratchBtn = canvas.getByLabelText('Scratch paper') as HTMLButtonElement
        const look = (el: Element) => {
            const cs = getComputedStyle(el)
            return `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor} | ${cs.backgroundColor}`
        }
        const barBg = getComputedStyle(bar).backgroundColor
        const rest = look(drawBtn)
        const restCs = getComputedStyle(drawBtn)
        // The frame is really drawn: a non-transparent border colour that is not the bar's ground.
        expect(restCs.borderTopWidth).toBe('1px')
        expect(restCs.borderTopColor).not.toBe('rgba(0, 0, 0, 0)')
        expect(restCs.borderTopColor).not.toBe(barBg)
        const zoomLabel = canvas.getByText('100%')
        const plain = look(zoomLabel)
        await fireEvent.click(scratchBtn)
        await waitFor(() => expect(pressedOf(scratchBtn)).toBe('true'))
        const selected = look(scratchBtn)
        expect(rest).not.toBe(selected)
        expect(rest).not.toBe(plain)
        expect(selected).not.toBe(plain)
        // put the fixture back (the store wrote a margin; turn it off again)
        await fireEvent.click(scratchBtn)
        await waitFor(() => expect(pressedOf(scratchBtn)).toBe('false'))

        // Readout: scroll to page 3 → p. 3 / 4.
        const scrollEl = scrollElOf(canvasElement)!
        await waitFor(() =>
            expect(scrollEl.scrollHeight).toBeGreaterThan(scrollEl.clientHeight + 200),
        )
        const page2 = canvasElement.querySelector('[data-pdf-page="2"]') as HTMLElement
        scrollEl.scrollTop = page2.offsetTop
        await fireEvent.scroll(scrollEl)
        await waitFor(() => expect(readoutBtn()?.textContent).toBe('p. 3 / 4'))
        // Click → input; 2 + Enter → page index 1 at the top, readout follows (onCurrentPage → 1).
        await fireEvent.click(readoutBtn()!)
        const input = (await canvas.findByLabelText('Go to page (1–4)')) as HTMLInputElement
        await expect(input.value).toBe('3')
        input.value = '2'
        await fireEvent.keyDown(input, { key: 'Enter' })
        const page1 = canvasElement.querySelector('[data-pdf-page="1"]') as HTMLElement
        // Fix 3 finding 5: the jump lands `pad` px above the page's own top (the page-frame
        // gutter, PdfPages' resolved `--sp-6`), not flush at its offsetTop.
        const pad = parseFloat(
            getComputedStyle(scrollEl).getPropertyValue('--sp-6'),
        )
        await expect(pad).toBeGreaterThan(0)
        await waitFor(() =>
            expect(scrollEl.scrollTop).toBeCloseTo(page1.offsetTop - pad, 0),
        )
        await waitFor(() => expect(readoutBtn()?.textContent).toBe('p. 2 / 4'))
    },
}
