// app/src/daemon/takeoverMotion.ts
// The geometry behind an opened daemon-page section growing out of its box (DaemonPage.tsx): an
// empty frame is animated from the clicked box's rect to the opened view's, and back on close,
// while the view and the box only fade in place. Pure — the component measures, this turns rects into keyframes.

export type Box = { left: number; top: number; width: number; height: number }

/** `r` re-expressed relative to `origin`'s top-left — viewport rects into the coordinates of the
 *  absolutely positioned overlay's containing block. */
export function relativeBox(r: Box, origin: Pick<Box, 'left' | 'top'>): Box {
    return {
        left: r.left - origin.left,
        top: r.top - origin.top,
        width: r.width,
        height: r.height,
    }
}

const px = (b: Box) => ({
    left: `${b.left}px`,
    top: `${b.top}px`,
    width: `${b.width}px`,
    height: `${b.height}px`,
})

/** Two keyframes: the source box, then the opened view's own resting rect, both relative to
 *  `origin`. Reverse the array to shrink back into the box. */
export function growKeyframes(
    from: Box,
    to: Box,
    origin: Pick<Box, 'left' | 'top'>,
): Keyframe[] {
    return [px(relativeBox(from, origin)), px(relativeBox(to, origin))]
}

/** The opened view and the box it opens from do not look alike (the opened heading carries
 *  `[x close]`, its rows use the full layout), so neither may MOVE while the other shows — any
 *  overlap of the two reads as doubled, shuddering text. What moves is an empty FRAME (a bare
 *  quiet Card); the view and the real box only fade in place. Run both with linear easing — the
 *  offsets are the timing.
 *
 *  The frame: opening, it fades in over the box during the first 30% and then grows; closing, it
 *  shrinks onto the box and fades out over the last 30%, revealing the real box beneath it. */
export function frameFade(shrink: boolean): Keyframe[] {
    return shrink
        ? [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }]
        : [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1 }]
}

/** The opened view, in place at full size: opening, it fades in over the last 30%, as the frame
 *  arrives; closing, it fades out over the first 35%, before the frame has moved far. */
export function viewFade(shrink: boolean): Keyframe[] {
    return shrink
        ? [{ opacity: 1 }, { opacity: 0, offset: 0.35 }, { opacity: 0 }]
        : [{ opacity: 0 }, { opacity: 0, offset: 0.7 }, { opacity: 1 }]
}

/** A CSS duration token's value in ms (`200ms`, `0.2s`); `fallback` when it is empty or unreadable. */
export function parseDuration(value: string, fallback: number): number {
    const m = /^\s*([\d.]+)\s*(ms|s)\s*$/.exec(value)
    if (!m) return fallback
    const n = parseFloat(m[1])
    if (Number.isNaN(n)) return fallback
    return m[2] === 's' ? n * 1000 : n
}
