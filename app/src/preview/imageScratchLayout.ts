// app/src/preview/imageScratchLayout.ts
// Lays an image out beside its scratch-note strip as ONE centred unit inside the preview body's
// content box — the single-image analogue of PdfPages' own page+margin layout
// (core/src/drawing/pageMargin.ts / layoutPages). `ratio` is the strip's width as a fraction of
// the image's OWN rendered width (matching PageMargin's `right` — a fraction of the page's
// rendered width, never the combined unit's).
//
// `ratio <= 0` must reduce to EXACTLY today's `containRect(area, natW, natH)` result: PreviewView
// only takes this code path at all when `marginRatio() > 0`, but the geometry itself is written to
// degrade to the old single-image fit so a caller can pass a live ratio signal straight through
// without a branch of its own, and so `ImageInkLandsAtRealMeasuredRect` (PreviewView.stories.tsx),
// which recomputes its expected rect via `containRect` directly, stays true at ratio 0.
//
// No DOM, no framework.
import { containRect, type ScreenRect } from '../../../core/src/drawing/pageInk'

/** Fit an image of natural size (natW, natH) plus a strip of `ratio * imageW` into the content box
 *  `area` (host px), centred as one unit, aspect preserved. ratio 0 = today's containRect result. */
export function imageScratchLayout(
    area: ScreenRect,
    natW: number,
    natH: number,
    ratio: number,
): { rendered: ScreenRect; marginW: number } {
    if (!(ratio > 0)) {
        return { rendered: containRect(area, natW, natH), marginW: 0 }
    }
    if (!(natW > 0 && natH > 0) || !(area.w > 0 && area.h > 0)) {
        return { rendered: area, marginW: 0 }
    }
    // Same shape as containRect's own scale pick, just with the strip's width folded into the
    // horizontal budget: the unit is `imageW * (1 + ratio)` wide, `imageH` tall.
    const scale = Math.min(area.w / (natW * (1 + ratio)), area.h / natH)
    const w = natW * scale
    const h = natH * scale
    const marginW = ratio * w
    const totalW = w + marginW
    return {
        rendered: {
            left: area.left + (area.w - totalW) / 2,
            top: area.top + (area.h - h) / 2,
            w,
            h,
        },
        marginW,
    }
}
