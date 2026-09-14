// core/src/drawing/pageInk.ts
// Pure geometry for IN-PLACE ink on an image or PDF preview (app/src/preview/PageInk.tsx).
//
// THE COORDINATE CONTRACT. The ink lives in the file's sidecar `<file>.draw` — an ordinary
// DrawingDoc — so it shares that format's 816x1056 logical page space. Sidecar page `i` is
// source page `i` (an image has exactly one). The source page occupies a BOX inside that space:
//
//   - a legacy sidecar written by the retired ANNOTATE surface carries the source as
//     `pages[i].images[0]`, and THAT stored box is authoritative (it is what the strokes were
//     drawn against);
//   - otherwise the box is `fitImage(natW, natH)` — centred, scale = min(816/natW, 1056/natH) —
//     which is exactly what that seeder computed, so both kinds of sidecar agree.
//
// Screen mapping, with `rendered` the page's on-screen rect:
//   logical = box.xy + (screen - rendered.xy) * (box.w / rendered.w)
// One scale for both axes: the page renders at its own aspect ratio, and so does the box.
//
// No DOM, no framework — the component measures, this module maps.
import { PAGE_W, PAGE_H, type DrawingDoc } from './model'

export type LogicalBox = { x: number; y: number; w: number; h: number }
export type ScreenRect = { left: number; top: number; w: number; h: number }
export type Point = { x: number; y: number }

/** Centre a natural-size source on the 816x1056 page, preserving aspect ratio. `maxScale` caps
 *  upscaling: an IMPORT into a drawing never blows a small image up past 1x; a page background
 *  (the default, Infinity) fills the page. Moved verbatim from app/src/drawing/DrawingPage.tsx. */
export function fitImage(
    natW: number,
    natH: number,
    maxScale = Infinity,
): LogicalBox {
    const scale = Math.min(PAGE_W / natW, PAGE_H / natH, maxScale)
    const w = natW * scale,
        h = natH * scale
    return { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, w, h }
}

/** The logical box source page `pageIndex` occupies: a legacy stored `images[0]` box when the
 *  sidecar has a usable one, else the computed fit. */
export function pageBoxFor(
    doc: DrawingDoc,
    pageIndex: number,
    natW: number,
    natH: number,
): LogicalBox {
    const im = doc.pages[pageIndex]?.images?.[0]
    if (im && im.w > 0 && im.h > 0) {
        return { x: im.x, y: im.y, w: im.w, h: im.h }
    }
    return fitImage(natW, natH)
}

/** Screen px per logical unit for a page rendered `rendered.w` wide. */
export function logicalToScreenScale(
    rendered: { w: number },
    box: { w: number },
): number {
    return rendered.w / box.w
}

/** A point in the same space as `rendered` (host px, or client px when `rendered` is a client
 *  rect) → the sidecar's logical page space. */
export function screenToLogical(
    pt: Point,
    rendered: ScreenRect,
    box: LogicalBox,
): Point {
    const k = box.w / rendered.w
    return {
        x: box.x + (pt.x - rendered.left) * k,
        y: box.y + (pt.y - rendered.top) * k,
    }
}

/** The inverse of {@link screenToLogical}. */
export function logicalToScreen(
    pt: Point,
    rendered: ScreenRect,
    box: LogicalBox,
): Point {
    const k = logicalToScreenScale(rendered, box)
    return {
        x: rendered.left + (pt.x - box.x) * k,
        y: rendered.top + (pt.y - box.y) * k,
    }
}

/** `doc` with at least `count` pages, padding with empty ones. Never truncates — a sidecar that
 *  outlived pages removed from its PDF keeps their ink. Returns `doc` itself when nothing needs
 *  adding, a copy otherwise. */
export function ensurePages(doc: DrawingDoc, count: number): DrawingDoc {
    if (doc.pages.length >= count) return doc
    const pages = doc.pages.slice()
    while (pages.length < count) pages.push({ strokes: [] })
    return { ...doc, pages }
}

/** Where a replaced element with `object-fit: contain` actually paints its source inside its
 *  content box: the largest rect of the source's aspect ratio, centred. */
export function containRect(
    content: ScreenRect,
    natW: number,
    natH: number,
): ScreenRect {
    if (!(natW > 0 && natH > 0) || !(content.w > 0 && content.h > 0)) {
        return content
    }
    const scale = Math.min(content.w / natW, content.h / natH)
    const w = natW * scale,
        h = natH * scale
    return {
        left: content.left + (content.w - w) / 2,
        top: content.top + (content.h - h) / 2,
        w,
        h,
    }
}
