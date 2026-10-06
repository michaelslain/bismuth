// app/src/preview/createPreviewZoom.ts
// A preview surface's zoom level, wired to zoomGesture.ts: pinch / ctrl+wheel apply at once,
// anchored at the pointer; the − / + / fit controls glide there (`animateZoom`) and keep the
// surface's own centre anchor. Shared by the PDF tab and the image tab (PreviewView) and the
// in-note PDF embed (editor/PdfEmbed), so all three zoom identically.
//
// ANCHORING is the surface's job, not this module's: `anchor(apply, x, y)` must run `apply()` (which
// writes the zoom signal, so the surface re-lays out synchronously) and then scroll so whatever sat
// under client point (x, y) is still there. `x`/`y` are undefined for a button/fit glide — the
// surface keeps its centre steady instead.
import { createSignal, onCleanup, type Accessor } from 'solid-js'
import { animateZoom, attachZoomGestures, clampZoom } from './zoomGesture'

export type PreviewZoomOptions = {
    min: number
    max: number
    anchor?: (apply: () => void, x?: number, y?: number) => void
}

export type PreviewZoom = {
    zoom: Accessor<number>
    /** Jump straight to `z` (a restore / reset) — no glide, no anchor. */
    set: (z: number) => void
    /** Glide by `factor` — the − / + buttons. */
    stepBy: (factor: number) => void
    /** Glide back to 1. */
    fit: () => void
    /** Apply one pinch frame's `factor` at client point (`x`, `y`), stopping any glide. */
    pinch: (factor: number, x: number, y: number) => void
    /** Ref callback for the element pinches and ctrl/cmd+wheel land on. */
    attach: (el: HTMLElement) => void
}

export default function createPreviewZoom(opts: PreviewZoomOptions): PreviewZoom {
    const [zoom, setZoom] = createSignal(1)
    // Where a running glide is headed, so a second click while it runs steps on from there rather
    // than from wherever the glide happened to be.
    let target: number | undefined
    let cancelGlide = () => {}

    const anchored = (z: number, x?: number, y?: number) => {
        const next = clampZoom(z, opts.min, opts.max)
        if (next === zoom()) return
        const apply = () => setZoom(next)
        if (opts.anchor) opts.anchor(apply, x, y)
        else apply()
    }
    const glideTo = (z: number) => {
        cancelGlide()
        const to = clampZoom(z, opts.min, opts.max)
        target = to
        cancelGlide = animateZoom(zoom(), to, v => {
            anchored(v)
            if (v === to) target = undefined
        })
    }
    const stop = () => {
        cancelGlide()
        cancelGlide = () => {}
        target = undefined
    }
    onCleanup(stop)
    const pinch = (factor: number, x: number, y: number) => {
        stop()
        anchored(zoom() * factor, x, y)
    }

    return {
        zoom,
        set: z => {
            stop()
            setZoom(clampZoom(z, opts.min, opts.max))
        },
        stepBy: factor => glideTo((target ?? zoom()) * factor),
        fit: () => glideTo(1),
        pinch,
        attach: el => onCleanup(attachZoomGestures(el, pinch)),
    }
}
