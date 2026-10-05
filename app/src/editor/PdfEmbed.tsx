// app/src/editor/PdfEmbed.tsx
// The rendered face of a `![[file.pdf]]` / `![](file.pdf)` embed in a note (editor/embedBlock.ts):
// the SAME pdf.js page stack the PDF preview tab uses (preview/PdfPages), inside a card whose
// header names the file and carries the preview tab's zoom group `− 100% + fit` (preview/PdfZoom,
// plus ctrl/cmd+wheel over the pages) and the `p. N / M` readout (preview/PageReadout — click to
// jump).
//
// It replaces a bare `<iframe src=…pdf>`, which handed the PDF to the webview's NATIVE viewer:
// WKWebView ignores the `#toolbar=0` open-parameter and floats its own grey zoom/open/download
// pill over the page, in system colours and icons that belong to no Bismuth theme.
//
// `load` is a DATA SEAM (mirrors PdfPages.load): the widget passes `fetch(src).arrayBuffer()`, a
// story hands over bytes built in-browser, since the fake transport's `/asset` never serves one.
//
// CLICK OWNERSHIP: embedBlock's click-to-reveal drops the caret onto the embed's source on any
// mousedown in its chrome, which would collapse the card mid text-selection or mid page-jump. The
// page stack and the header controls carry `data-embed-own-click`, so only the header's file name reveals
// the source — the same affordance a note transclusion's title gives.
import { createSignal } from 'solid-js'
import PdfPages from '../preview/PdfPages'
import PageReadout from '../preview/PageReadout'
import PdfZoom from '../preview/PdfZoom'
import Label from '../ui/Label'
import type { PdfPagesController } from '../preview/annotationTypes'
import { pageIndexFromFragment } from './embedSpec'
import styles from './PdfEmbed.module.css'

export type PdfEmbedProps = {
    /** The PDF's bytes — the widget passes `fetch(src).arrayBuffer()`. */
    load: () => Promise<ArrayBuffer>
    /** Shown in the header: the embed's target as written (`papers/handbook.pdf`). */
    name: string
    /** The embed's `#page=N` fragment (1-based, as written), or undefined to open at the top. */
    page?: string
    /** Session cache key (the asset URL), so a widget CodeMirror re-creates on scroll repaints at
     *  once instead of re-fetching and re-parsing. */
    cacheKey?: string
    class?: string
}

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4

function PdfEmbed(props: PdfEmbedProps) {
    const [current, setCurrent] = createSignal(0)
    const [count, setCount] = createSignal(0)
    // Same bounds and wheel step as the preview tab (PreviewView); 1 = fit width. Transient: an
    // embed's zoom is not written back into the note.
    const [zoom, setZoom] = createSignal(1)
    const zoomBy = (factor: number) =>
        setZoom(z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor)))
    let controller: PdfPagesController | undefined
    const start = pageIndexFromFragment(props.page)

    return (
        <div class={`${styles['pdf-embed']} ${props.class ?? ''}`}>
            <div class={styles['pdf-embed-head']}>
                <Label fill tone="muted" class={styles['pdf-embed-name']}>
                    {props.name}
                </Label>
                <div class={styles['pdf-embed-controls']} data-embed-own-click>
                    <PdfZoom zoom={zoom} onZoomBy={zoomBy} onFit={() => setZoom(1)} />
                    <PageReadout
                        current={current}
                        count={count}
                        onGo={i => controller?.scrollToPage(i)}
                    />
                </div>
            </div>
            <div
                class={styles['pdf-embed-body']}
                data-embed-own-click
                onWheel={e => {
                    if (!(e.ctrlKey || e.metaKey)) return
                    e.preventDefault()
                    zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08)
                }}
            >
                <PdfPages
                    load={props.load}
                    zoom={zoom()}
                    cacheKey={props.cacheKey}
                    initialPosition={
                        start === undefined
                            ? undefined
                            : { index: start, yFraction: 0, xFraction: 0 }
                    }
                    onCurrentPage={setCurrent}
                    onPageCount={setCount}
                    controller={c => (controller = c)}
                />
            </div>
        </div>
    )
}

export default PdfEmbed
