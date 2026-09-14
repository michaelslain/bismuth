// app/src/preview/PdfPageCanvas.tsx
// One stacked PDF page: a raster canvas (at devicePixelRatio) plus pdf.js's text layer for
// selection. Extracted from PdfPages.tsx (chunk-1 review: one component per PascalCase file,
// with a colocated module imported only by that component) — PdfPages.tsx is its only importer.
// Mounted/unmounted by PdfPages' `<Show>` as the page enters/leaves `visiblePageRange`, which is
// what makes an in-flight render/text-layer task get cancelled on scroll — and on zoom,
// `layoutPages` returns a fresh `boxes` array so `<For>` recreates every row (and this component)
// at the new scale.
import { onCleanup, onMount } from 'solid-js'
import type { PageBox } from './pageLayout'
import styles from './PdfPageCanvas.module.css'

type PdfjsModule = typeof import('pdfjs-dist')
type PDFPageProxy = import('pdfjs-dist').PDFPageProxy

export type PdfPageCanvasProps = {
    index: number
    box: PageBox
    getPage: (i: number) => PDFPageProxy
    pdfjs: () => PdfjsModule | undefined
}

function PdfPageCanvas(props: PdfPageCanvasProps) {
    let canvasRef: HTMLCanvasElement | undefined
    let textRef: HTMLDivElement | undefined
    let cancelled = false
    let renderTask: ReturnType<PDFPageProxy['render']> | undefined
    let textLayer: InstanceType<PdfjsModule['TextLayer']> | undefined

    async function run() {
        const mod = props.pdfjs()
        if (!mod || !canvasRef) return
        const page = props.getPage(props.index)
        const dpr = window.devicePixelRatio || 1
        const natural = page.getViewport({ scale: 1 })
        const cssScale = natural.width > 0 ? props.box.w / natural.width : 1

        const renderViewport = page.getViewport({ scale: cssScale * dpr })
        canvasRef.width = Math.max(1, Math.round(renderViewport.width))
        canvasRef.height = Math.max(1, Math.round(renderViewport.height))
        canvasRef.style.width = `${props.box.w}px`
        canvasRef.style.height = `${props.box.h}px`

        const task = page.render({
            canvas: canvasRef,
            viewport: renderViewport,
        })
        renderTask = task
        try {
            await task.promise
        } catch {
            // A cancelled render (page scrolled away mid-paint, `renderTask.cancel()` in
            // onCleanup) is expected, not a failure. Any other per-page render error is likewise
            // just skipped — leave this one page's canvas blank rather than throwing and taking
            // down the whole stack over one bad page.
            return
        } finally {
            if (renderTask === task) renderTask = undefined
        }
        if (cancelled || !textRef) return

        // Best-effort text layer for selection/copy — a failure here must never blank the raster
        // that already rendered above it.
        try {
            const textViewport = page.getViewport({ scale: cssScale })
            textLayer = new mod.TextLayer({
                textContentSource: page.streamTextContent(),
                container: textRef,
                viewport: textViewport,
            })
            // pdf.js's own layer sizes itself via CSS custom properties (`--total-scale-factor`
            // + a `round()` expression tied to viewer-only vars we don't set up here); override
            // with the page's real CSS box directly so glyph positioning still tracks it.
            textRef.style.setProperty('--total-scale-factor', String(cssScale))
            textRef.style.setProperty('--scale-factor', String(cssScale))
            textRef.style.width = `${props.box.w}px`
            textRef.style.height = `${props.box.h}px`
            await textLayer.render()
        } catch {
            /* selection is a nice-to-have; the rendered page stands on its own without it */
        }
    }

    onMount(() => void run())
    onCleanup(() => {
        cancelled = true
        renderTask?.cancel()
        textLayer?.cancel()
    })

    return (
        <>
            <canvas class={styles['pdf-canvas']} ref={canvasRef} />
            <div class={styles['pdf-text-layer']} ref={textRef} />
        </>
    )
}

export default PdfPageCanvas
