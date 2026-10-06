// app/src/preview/zoomGesture.ts
// The ONE zoom input path for every preview surface — the PDF tab, the in-note PDF embed and the
// image tab — so a pinch feels the same on all three. Plain TS, no framework imports: the pure
// half (`wheelZoomFactor`, `easeZoom`) is unit-tested, the DOM half (`attachZoomGestures`,
// `animateZoom`) is a thin listener/rAF shell around it.
//
// SMOOTH, NOT STEPPED: a trackpad pinch arrives as dozens of small ctrl+wheel events a second
// (Chrome, WebView2, WebKitGTK). Multiplying by a fixed 8% per EVENT — what the surfaces used to
// do — made a gentle pinch race and a fast one jump. Here the factor is `exp(-deltaY * k)`, so the
// zoom follows the fingers proportionally, and a mouse wheel's large per-notch delta is clamped
// to one comfortable step.
//
// WKWEBVIEW SENDS NO CTRL+WHEEL FOR A PINCH: Safari/WKWebView (the macOS app's engine) reports a
// trackpad pinch as `gesturestart`/`gesturechange`/`gestureend` with a cumulative `scale`. Both are
// handled; while a gesture is live, ctrl+wheel is ignored so an engine that sends both never
// double-zooms.
//
// ONE UPDATE PER FRAME: factors arriving inside one frame are multiplied together and handed over
// once, from `requestAnimationFrame`, with the latest pointer position — so a burst of events costs
// one re-layout, not one per event.

import { clamp, clamp01 } from '../math'

/** `exp(-deltaY * k)`: ~1% per pixel of wheel delta — a pinch's small deltas track the fingers. */
const WHEEL_K = 0.01
/** A mouse wheel notch reports ~100px; clamp so one notch is ~1.3×, not ~2.7×. */
const WHEEL_DELTA_CLAMP = 28

/** The zoom factor one ctrl/cmd+wheel event asks for (`> 1` zooms in). `deltaMode` 1 = lines,
 *  2 = pages, normalized to px first. */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
    const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
    const d = clamp(px, -WHEEL_DELTA_CLAMP, WHEEL_DELTA_CLAMP)
    return Math.exp(-d * WHEEL_K)
}

/** Ease-out cubic between two zoom levels, interpolated in LOG space so a 1→4 tween spends as long
 *  on 1→2 as on 2→4 (perceived size is multiplicative). `t` is 0..1. */
export function easeZoom(from: number, to: number, t: number): number {
    const k = 1 - Math.pow(1 - clamp01(t), 3)
    return Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * k)
}

/** Clamp `z` into `[min, max]`. */
export function clampZoom(z: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, z))
}

/** Safari's `GestureEvent` — not in the DOM lib types. */
type GestureLike = Event & { scale: number; clientX: number; clientY: number }

/** Listen for pinch / ctrl+wheel / cmd+wheel on `el` and report each frame's combined factor at
 *  the pointer. `enabled` (default: always) is read per event; while it is false the events are
 *  left alone entirely, default behaviour included. Returns the detach function. */
export function attachZoomGestures(
    el: HTMLElement,
    onZoom: (factor: number, clientX: number, clientY: number) => void,
    enabled: () => boolean = () => true,
): () => void {
    let pending = 1
    let x = 0
    let y = 0
    let raf: number | undefined
    let gestureScale: number | undefined

    const queue = (factor: number, cx: number, cy: number) => {
        pending *= factor
        x = cx
        y = cy
        if (raf !== undefined) return
        raf = requestAnimationFrame(() => {
            raf = undefined
            const f = pending
            pending = 1
            if (f !== 1) onZoom(f, x, y)
        })
    }

    const onWheel = (e: WheelEvent) => {
        if (!(e.ctrlKey || e.metaKey) || !enabled()) return
        e.preventDefault()
        if (gestureScale !== undefined) return
        queue(wheelZoomFactor(e.deltaY, e.deltaMode), e.clientX, e.clientY)
    }
    const onGestureStart = (e: Event) => {
        if (!enabled()) return
        e.preventDefault()
        gestureScale = 1
    }
    const onGestureChange = (e: Event) => {
        if (gestureScale === undefined) return
        e.preventDefault()
        const g = e as GestureLike
        if (!(g.scale > 0)) return
        const prev = gestureScale ?? 1
        gestureScale = g.scale
        queue(g.scale / prev, g.clientX, g.clientY)
    }
    const onGestureEnd = (e: Event) => {
        if (gestureScale === undefined) return
        e.preventDefault()
        gestureScale = undefined
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    el.addEventListener('gestureend', onGestureEnd)
    return () => {
        el.removeEventListener('wheel', onWheel)
        el.removeEventListener('gesturestart', onGestureStart)
        el.removeEventListener('gesturechange', onGestureChange)
        el.removeEventListener('gestureend', onGestureEnd)
        if (raf !== undefined) cancelAnimationFrame(raf)
    }
}

/** How long a button / fit zoom glides. */
export const ZOOM_TWEEN_MS = 160

/** Glide from `from` to `to`, calling `apply` once per frame. Returns a cancel function — call it
 *  when a pinch starts so the gesture takes over from wherever the glide got to. */
export function animateZoom(
    from: number,
    to: number,
    apply: (z: number) => void,
    ms = ZOOM_TWEEN_MS,
): () => void {
    if (from === to || ms <= 0) {
        apply(to)
        return () => {}
    }
    const start = performance.now()
    let raf: number | undefined
    const tick = (now: number) => {
        const t = (now - start) / ms
        apply(t >= 1 ? to : easeZoom(from, to, t))
        raf = t >= 1 ? undefined : requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
        if (raf !== undefined) cancelAnimationFrame(raf)
        raf = undefined
    }
}
