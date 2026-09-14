// app/src/preview/pageLayout.ts
// Pure page-stack layout math for PdfPages (and, per the plan, Task 5's ink overlay measuring
// its pages off the same boxes). No pdf.js, no DOM — a page-stack renderer is a vertical list
// of boxes at a fit-width scale, and that arithmetic is exactly what's worth unit-testing in
// isolation from a real PDF or a real canvas.
//
// FIT-WIDTH CONTRACT: every page renders at the SAME width — `containerW * zoom` — regardless of
// its own natural aspect ratio, and its height is derived from that width to preserve the page's
// own proportions. `zoom === 1` means "as wide as the container" (not "100% of PDF points"), so
// a caller wanting fit-width literally passes `zoom: 1`.

export type PageSize = { w: number; h: number } // natural size, PDF points or image px
export type PageBox = { top: number; left: number; w: number; h: number } // CSS px in the scroll content

/** Stack `sizes` top to bottom, each at width `containerW * zoom`, height scaled to preserve
 *  that page's own aspect ratio, separated by `gap` px. `left` centers a page that renders
 *  narrower than the container (zoom < 1); it never goes negative — a page at or beyond the
 *  container's width starts flush at the left edge and the container scrolls horizontally. */
export function layoutPages(
    sizes: PageSize[],
    containerW: number,
    zoom: number,
    gap: number,
): { boxes: PageBox[]; contentH: number } {
    const boxes: PageBox[] = []
    let top = 0
    for (const size of sizes) {
        const w = containerW * zoom
        const h = size.w > 0 ? size.h * (w / size.w) : 0
        const left = Math.max(0, (containerW - w) / 2)
        boxes.push({ top, left, w, h })
        top += h + gap
    }
    const contentH = boxes.length ? top - gap : 0
    return { boxes, contentH }
}

/** Inclusive `[first, last]` index range of pages that intersect the scrolled viewport
 *  (`scrollTop` .. `scrollTop + viewportH`), padded by `overscan` pages on each side and clamped
 *  to the array. An empty `boxes` returns `[0, -1]` — an empty inclusive range, so a caller
 *  looping `for (let i = first; i <= last; i++)` naturally does nothing. */
export function visiblePageRange(
    boxes: PageBox[],
    scrollTop: number,
    viewportH: number,
    overscan: number,
): [number, number] {
    if (boxes.length === 0) return [0, -1]
    const viewBottom = scrollTop + viewportH

    let first = boxes.findIndex(b => b.top + b.h >= scrollTop)
    if (first === -1) first = boxes.length - 1 // scrolled past everything — pin to the last page

    let last = first
    for (let i = first; i < boxes.length; i++) {
        if (boxes[i]!.top > viewBottom) break
        last = i
    }

    first = Math.max(0, first - overscan)
    last = Math.min(boxes.length - 1, last + overscan)
    return [first, last]
}
