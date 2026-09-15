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
// Real PDF rendering (real pages, real ink) is covered by Preview/PdfPages.stories.tsx, which
// feeds PdfPages a real in-browser-generated PDF through the same `load()` seam instead.
//
// `isTauri()` is false in a Storybook browser tab, so "OPEN IN DEFAULT APP" / "REVEAL" never
// render here — an accurate state (the web build has no Tauri shell either), not a gap to patch.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import { jsPDF } from 'jspdf'
import { PreviewView } from './PreviewView'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { inkSidecarFor } from '../../core/src/fileKinds'
import {
    emptyDoc,
    serializeDoc,
    type DrawingDoc,
    type Stroke,
} from '../../core/src/drawing/model'
import {
    containRect,
    fitImage,
    logicalToScreen,
} from '../../core/src/drawing/pageInk'
import styles from './PreviewView.module.css'
import pdfPagesStyles from './preview/PdfPages.module.css'

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
            <div style={{ height: '700px' }}>
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
        scrollEl.scrollTop = 400
        await fireEvent.scroll(scrollEl)
        await waitFor(() => expect(scrollEl.scrollTop).toBe(400))

        const zoomLabel = () => canvas.getByText('100%').textContent
        const zoomBefore = zoomLabel()

        // The churn: a NEW parent object, the SAME path string — exactly what App.tsx's
        // `onFocus` produces today on a mousedown of the already-focused pane.
        setParentState!(s => ({ root: { content: s.root.content } }))

        await expect(churnLoadCalls).toBe(1)
        await expect(scrollEl.scrollTop).toBe(400)
        await expect(
            canvasElement.querySelector(`.${pdfPagesStyles['pdf-scroll']}`),
        ).toBe(scrollEl)
        await expect(zoomLabel()).toBe(zoomBefore)
    },
}
