type Box = { x: number; y: number; w: number; h: number }

/** A logical-page rect as fractions of the page image (0..1, origin top-left), given the box the
 *  image occupies inside the logical page. Clamped, so a rect spilling past the image stays inside. */
export function regionInImage(rect: Box, image: Box): Box {
    const c = (v: number) => Math.min(Math.max(v, 0), 1)
    const x0 = c((rect.x - image.x) / image.w)
    const y0 = c((rect.y - image.y) / image.h)
    const x1 = c((rect.x + rect.w - image.x) / image.w)
    const y1 = c((rect.y + rect.h - image.y) / image.h)
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
