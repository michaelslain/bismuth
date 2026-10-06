// app/src/preview/imageZoomLayout.ts
// Where a ZOOMED image (and its scratch strip) sits in the preview body: the image tab's analogue
// of `layoutPages`' zoom. Zoom 1 is the fit — `imageScratchLayout`'s own result, never upscaled
// past the image's natural size — and any other zoom scales picture + strip as one unit about that
// fit. While the unit fits the body it stays centred; once it outgrows the body it starts at the
// gutter and the `stage` (the scroll content) grows to hold it plus a gutter on the far side, so
// the body scrolls to pan.
//
// No DOM, no framework.
import type { ScreenRect } from '../../../core/src/drawing/pageInk'
import { imageScratchLayout } from './imageScratchLayout'

export function imageZoomLayout(
    body: { w: number; h: number },
    gutter: number,
    natW: number,
    natH: number,
    ratio: number,
    zoom: number,
): { rendered: ScreenRect; marginW: number; stage: { w: number; h: number } } {
    const area = {
        left: gutter,
        top: gutter,
        w: Math.max(0, body.w - 2 * gutter),
        h: Math.max(0, body.h - 2 * gutter),
    }
    // The fit, never upscaled — like the CSS path's `max-width`/`max-height` (imageScratchLayout's
    // own ratio-0 branch returns the uncapped containRect, so it is not used for that case).
    let fitW: number
    let fitH: number
    let fitMarginW = 0
    if (ratio > 0) {
        const fit = imageScratchLayout(area, natW, natH, ratio)
        fitW = fit.rendered.w
        fitH = fit.rendered.h
        fitMarginW = fit.marginW
    } else {
        const scale =
            natW > 0 && natH > 0 ? Math.min(area.w / natW, area.h / natH, 1) : 0
        fitW = natW * scale
        fitH = natH * scale
    }
    const w = fitW * zoom
    const h = fitH * zoom
    const marginW = fitMarginW * zoom
    const unitW = w + marginW
    const left = Math.max(gutter, (body.w - unitW) / 2)
    const top = Math.max(gutter, (body.h - h) / 2)
    return {
        rendered: { left, top, w, h },
        marginW,
        stage: {
            w: Math.max(body.w, left + unitW + gutter),
            h: Math.max(body.h, top + h + gutter),
        },
    }
}
