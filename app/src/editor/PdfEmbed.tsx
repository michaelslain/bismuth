// app/src/editor/PdfEmbed.tsx
// The rendered face of a `![[file.pdf]]` / `![](file.pdf)` embed in a note (editor/embedBlock.ts):
// the SAME pdf.js page stack the PDF preview tab uses (preview/PdfPages), inside a card whose
// header names the file and carries the preview tab's zoom group `− 100% + fit` (preview/PdfZoom,
// plus pinch and ctrl/cmd+wheel over the pages, anchored at the pointer — preview/createPreviewZoom)
// and the `p. N / M` readout (preview/PageReadout — click to jump).
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
import createPreviewZoom from '../preview/createPreviewZoom'
import Band from '../ui/Band'
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
    let controller: PdfPagesController | undefined
    // Same bounds and gestures as the preview tab (PreviewView); 1 = fit width. Transient: an
    // embed's zoom is not written back into the note.
    const zoom = createPreviewZoom({
        min: ZOOM_MIN,
        max: ZOOM_MAX,
        anchor: (apply, x, y) =>
            controller ? controller.zoomAt(apply, x, y) : apply(),
    })
    const start = pageIndexFromFragment(props.page)

    return (
        <div class={`${styles['pdf-embed']} ${props.class ?? ''}`}>
            {/* THE SAME BAND the preview tab's own header is: --h-band tall, --sp-5 side padding,
                one --rule-soft hairline (ui/Band, which PreviewBar's ViewBar also renders through).
                It used to be a hand-built ~24px strip with its own padding and border, so an embed
                and the full-page preview of the same PDF sat on two different axes at two
                different heights. The control ORDER follows PreviewBar too: the page readout
                (which page am I on) reads before the zoom group (how big is it), i.e. ViewBar's
                `readouts` slot before its `config` slot. */}
            <Band class={styles['pdf-embed-head']}>
                <Label fill tone="muted" class={styles['pdf-embed-name']}>
                    {props.name}
                </Label>
                <div class={styles['pdf-embed-controls']} data-embed-own-click>
                    <PageReadout
                        current={current}
                        count={count}
                        onGo={i => controller?.scrollToPage(i)}
                    />
                    <PdfZoom
                        zoom={zoom.zoom}
                        onZoomBy={zoom.stepBy}
                        onFit={zoom.fit}
                    />
                </div>
            </Band>
            <div
                class={styles['pdf-embed-body']}
                data-embed-own-click
                ref={zoom.attach}
            >
                <PdfPages
                    load={props.load}
                    zoom={zoom.zoom()}
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
