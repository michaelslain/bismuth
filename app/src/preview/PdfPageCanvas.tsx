// app/src/preview/PdfPageCanvas.tsx
// One stacked PDF page: a raster canvas (at devicePixelRatio) plus pdf.js's text layer for
// selection. Extracted from PdfPages.tsx (chunk-1 review: one component per PascalCase file,
// with a colocated module imported only by that component) — PdfPages.tsx is its only importer.
// Mounted/unmounted by PdfPages' `<Show>` as the page enters/leaves `visiblePageRange`, which is
// what makes an in-flight render/text-layer task get cancelled on scroll.
//
// NO BLANK FLASH ON RE-LAYOUT: a zoom, margin or pane-width change resizes the page's box but does
// NOT remount this component (PdfPages' `<Index>` keeps the row). Instead the box's size is
// watched here: the canvas's CSS size follows its row at once (`.pdf-canvas` is 100% of the row
// PdfPages sizes to the box, so the raster already on it just stretches), the page is re-rendered into an OFFSCREEN canvas at the new scale, and only when that
// render lands is it blitted onto the visible canvas — resizing the canvas bitmap and drawing into
// it in the same task, so no frame ever paints it empty. A newer size change cancels the older
// in-flight render, and its result is dropped.
import { createEffect, createMemo, on, onCleanup } from 'solid-js'
import type { PageBox } from './pageLayout'
import styles from './PdfPageCanvas.module.css'

type PdfjsModule = typeof import('pdfjs-dist')
type PDFPageProxy = import('pdfjs-dist').PDFPageProxy

export type PdfPageCanvasProps = {
    index: number
    box: PageBox
    getPage: (i: number) => PDFPageProxy
    pdfjs: () => PdfjsModule | undefined
    /** Last-frame rasters that outlive this component. On mount, a stashed canvas for this page
     *  at this width is painted at once and the pdf.js raster render is skipped; on cleanup the
     *  visible canvas is stashed if it holds a completed render at the current width. */
    stash?: {
        get: (index: number, w: number) => HTMLCanvasElement | undefined
        put: (index: number, w: number, canvas: HTMLCanvasElement) => void
    }
}

function PdfPageCanvas(props: PdfPageCanvasProps) {
    let canvasRef: HTMLCanvasElement | undefined
    let textRef: HTMLDivElement | undefined
    let disposed = false
    // Bumped per run: a run whose number is no longer current lost to a newer size and must not
    // touch the visible canvas or the text layer.
    let generation = 0
    let renderTask: ReturnType<PDFPageProxy['render']> | undefined
    let textLayer: InstanceType<PdfjsModule['TextLayer']> | undefined
    let firstRun = true
    // The CSS width the visible canvas's CURRENT bitmap was actually rendered at — read on
    // cleanup to decide whether it's worth stashing (a bitmap mid-render at a stale width is not).
    let renderedW = 0

    /** Best-effort text layer for selection/copy — a failure here must never blank the raster
     *  that already rendered above it (from either path below). Rebuilt from empty at the new
     *  scale. */
    async function renderTextLayer(
        mod: PdfjsModule,
        page: PDFPageProxy,
        w: number,
        h: number,
        cssScale: number,
    ) {
        if (!textRef) return
        try {
            textRef.replaceChildren()
            const textViewport = page.getViewport({ scale: cssScale })
            const layer = new mod.TextLayer({
                textContentSource: page.streamTextContent(),
                container: textRef,
                viewport: textViewport,
            })
            textLayer = layer
            // pdf.js's own layer sizes itself via CSS custom properties (`--total-scale-factor`
            // + a `round()` expression tied to viewer-only vars we don't set up here); override
            // with the page's real CSS box directly so glyph positioning still tracks it.
            textRef.style.setProperty('--total-scale-factor', String(cssScale))
            textRef.style.setProperty('--scale-factor', String(cssScale))
            textRef.style.width = `${w}px`
            textRef.style.height = `${h}px`
            await layer.render()
        } catch {
            /* selection is a nice-to-have; the rendered page stands on its own without it */
        }
    }

    async function run(w: number, h: number) {
        const mine = ++generation
        renderTask?.cancel()
        renderTask = undefined
        textLayer?.cancel()
        textLayer = undefined

        const mod = props.pdfjs()
        if (!mod || !canvasRef || w <= 0) return
        // Consumed only once we know this run will actually proceed — a bailout above (width
        // not measured yet, e.g. right after a cache-hit remount whose ResizeObserver hasn't
        // reported yet) must NOT spend the one "first run" attempt at a stash hit; the real
        // first attempt is the first run that gets this far.
        const isFirstRun = firstRun
        firstRun = false
        const page = props.getPage(props.index)
        const natural = page.getViewport({ scale: 1 })
        const cssScale = natural.width > 0 ? w / natural.width : 1

        // A stashed last-frame raster for this exact page+width paints AT ONCE — no waiting on
        // pdf.js's render task at all — and only the (still worthwhile, still selectable) text
        // layer is rebuilt underneath it. Only tried on the FIRST run: a later size change (zoom,
        // margin, pane resize) always goes through a real render, since the stash is keyed on
        // ONE width and would otherwise paint a stretched/stale frame under the new size.
        if (isFirstRun) {
            const stashed = props.stash?.get(props.index, w)
            if (stashed) {
                canvasRef.width = stashed.width
                canvasRef.height = stashed.height
                canvasRef.getContext('2d')?.drawImage(stashed, 0, 0)
                renderedW = w
                await renderTextLayer(mod, page, w, h, cssScale)
                return
            }
        }

        const dpr = window.devicePixelRatio || 1
        const renderViewport = page.getViewport({ scale: cssScale * dpr })
        const offscreen = document.createElement('canvas')
        offscreen.width = Math.max(1, Math.round(renderViewport.width))
        offscreen.height = Math.max(1, Math.round(renderViewport.height))

        const task = page.render({
            canvas: offscreen,
            viewport: renderViewport,
        })
        renderTask = task
        try {
            await task.promise
        } catch {
            // A cancelled render (page scrolled away mid-paint, or superseded by a newer size) is
            // expected, not a failure. Any other per-page render error is likewise just skipped —
            // leave this one page's canvas as it was rather than taking down the whole stack.
            return
        } finally {
            if (renderTask === task) renderTask = undefined
        }
        if (disposed || mine !== generation || !canvasRef) return

        // Swap the new raster in within ONE task: assigning width/height clears the bitmap, and
        // the drawImage right after refills it before the browser can paint the cleared state.
        canvasRef.width = offscreen.width
        canvasRef.height = offscreen.height
        canvasRef.getContext('2d')?.drawImage(offscreen, 0, 0)
        renderedW = w
        await renderTextLayer(mod, page, w, h, cssScale)
    }

    // `props.box` is <Index>'s item signal, and PdfPages' layout memo hands back a BRAND NEW box
    // object on every recompute even when a page's own width/height haven't moved (e.g. only an
    // EARLIER page's height shifted this one's `top`). `on()` has no equality check of its own
    // (chunk-1 review) — it re-runs whenever the tracked accessor is notified, not when the
    // value it returns actually changes. Memoized here so a `top`-only layout change is filtered
    // out by plain number equality before it ever reaches `on`, instead of cancelling an
    // in-flight render and rebuilding the text layer (wiping any live selection) for nothing.
    const boxW = createMemo(() => props.box.w)
    const boxH = createMemo(() => props.box.h)

    // Runs once after mount (refs are assigned by then) and again whenever the box's SIZE changes;
    // a box that only moved (a `top` shift) keeps its raster as-is.
    createEffect(on([boxW, boxH], ([w, h]) => void run(w, h)))
    onCleanup(() => {
        disposed = true
        renderTask?.cancel()
        textLayer?.cancel()
        // Stash the visible canvas itself (not a copy) so the next mount at the same width can
        // blit it instantly — but only when it actually holds a completed render at the CURRENT
        // box width; a page that scrolled away mid-render, or whose box resized after the last
        // completed paint, would stash a stale or wrong-sized frame.
        if (props.stash && canvasRef && renderedW === boxW()) {
            props.stash.put(props.index, renderedW, canvasRef)
        }
    })

    return (
        <>
            <canvas class={styles['pdf-canvas']} ref={canvasRef} />
            {/* data-testid, not a class: bench/invariants.ts's FOREIGN exemption list (the same
                one that already skips CodeMirror/ProseMirror/xterm's own DOM) needs a selector
                that survives CSS-module hashing to know this subtree is pdf.js's own text-layer
                spans — legitimately sized off the app's type scale, at whatever font-size the
                PDF's own glyph metrics × the page's zoom demand (see PdfPageCanvas.module.css's
                `.pdf-text-layer` comment for the calc() that produces it). */}
            <div
                class={styles['pdf-text-layer']}
                data-testid="pdf-text-layer"
                ref={textRef}
            />
        </>
    )
}

export default PdfPageCanvas
