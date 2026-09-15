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
//
// MARGIN PAPER: `marginRatio > 0` adds drawable paper to the right of every page, `marginW =
// w * marginRatio` wide. Page + margin TOGETHER take the `containerW * zoom` width (so turning the
// margin on shrinks the page rather than overflowing the pane), and `left` centres them as one
// unit. `marginRatio = 0` is exactly the no-margin layout.
//
// PAGE FRAME: `pad` reserves a gutter of `pad` px on every side of the page STACK — left/right
// come out of the width available to `zoom`/`marginRatio` (`total = (containerW - 2*pad) * zoom`,
// so fit-width, `zoom: 1`, fills exactly `containerW - 2*pad`), and top/bottom come out of
// `contentH` (the stack starts at `top: pad` and `contentH` adds a matching `pad` after the last
// page). Centering still happens WITHIN the padded band, and — like the unpadded case — a page
// that renders at or beyond that band's width never sits left of `pad` (only zoom > 1 pushes it
// past the band, which is what makes the container scroll horizontally).

export type PageSize = { w: number; h: number } // natural size, PDF points or image px
/** CSS px in the scroll content. `w`/`h` are the PAGE; its margin paper sits at `left + w`,
 *  `marginW` wide and `h` tall (0 when there is no margin). */
export type PageBox = {
    top: number
    left: number
    w: number
    h: number
    marginW: number
}

/** Stack `sizes` top to bottom, each (page + margin) at width `(containerW - 2*pad) * zoom`,
 *  height scaled to preserve that page's own aspect ratio, separated by `gap` px, inset `pad` px
 *  from every side of the container (0 = the old edge-to-edge layout). `left` centers a page
 *  that renders narrower than the padded band (zoom < 1) within that band; it never goes below
 *  `pad` — a page at or beyond the band's width starts flush at `pad` and the container scrolls
 *  horizontally. */
export function layoutPages(
    sizes: PageSize[],
    containerW: number,
    zoom: number,
    gap: number,
    marginRatio = 0,
    pad = 0,
): { boxes: PageBox[]; contentH: number } {
    const boxes: PageBox[] = []
    const ratio = marginRatio > 0 ? marginRatio : 0
    const bandW = containerW - 2 * pad
    const total = bandW * zoom
    const w = total / (1 + ratio)
    const marginW = w * ratio
    const left = pad + Math.max(0, (bandW - total) / 2)
    let top = pad
    for (const size of sizes) {
        const h = size.w > 0 ? size.h * (w / size.w) : 0
        boxes.push({ top, left, w, h, marginW })
        top += h + gap
    }
    const contentH = boxes.length ? top - gap + pad : 0
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

/** Index of the page the reader is "on": the one covering the point one third of the way down
 *  the viewport. A point in the gap between two pages belongs to the page above it; a point
 *  above the first page or below the last clamps to it. An empty `boxes` returns 0. */
export function currentPageIndex(
    boxes: PageBox[],
    scrollTop: number,
    viewportH: number,
): number {
    const probe = scrollTop + viewportH / 3
    let index = 0
    for (let i = 0; i < boxes.length; i++) {
        if (boxes[i]!.top > probe) break
        index = i
    }
    return index
}

/** The `scrollTop` that puts page `index` (clamped to the array) at the top of the viewport,
 *  offset `yFraction` (clamped to 0..1) of the way into the page. An empty `boxes` returns 0.
 *  The browser clamps the result to the scroll range, so the last page may not reach the top. */
export function scrollTopForPage(
    boxes: PageBox[],
    index: number,
    yFraction = 0,
): number {
    if (boxes.length === 0) return 0
    const box =
        boxes[Math.min(boxes.length - 1, Math.max(0, Math.floor(index)))]!
    const f = Math.min(1, Math.max(0, yFraction))
    return box.top + box.h * f
}
