import type { Stroke } from './model'

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)))

// Which band a y coordinate falls in: band 0 is above seams[0], band seams.length is below
// the last seam.
const bandOf = (y: number, seams: number[]) => {
    let band = 0
    while (band < seams.length && y >= seams[band]) band++
    return band
}

/** Splits a stroke into one piece per block it passes through, cutting exactly on each seam
 *  it crosses so the pieces meet. Pieces come back in draw order; a piece left with fewer
 *  than two points (a stroke that only grazes a seam) is dropped.
 *  `seams` MUST be ascending and distinct — `bandOf` walks it by index assuming that order.
 *  Given an unsorted or duplicated list this returns nonsense (misbanded pieces, or a
 *  degenerate piece at a repeated seam) rather than throwing. */
export function splitStrokeAtSeams(
    stroke: Stroke,
    seams: number[],
): { band: number; stroke: Stroke }[] {
    const { pts } = stroke
    const pointCount = pts.length / 3
    const out: { band: number; stroke: Stroke }[] = []

    if (pointCount === 0) return out

    let currentBand = bandOf(pts[1], seams)
    let currentPts: number[] = [pts[0], pts[1], pts[2]]

    const flush = (band: number) => {
        if (currentPts.length >= 6) {
            out.push({ band, stroke: { ...stroke, pts: currentPts } })
        }
    }

    for (let i = 1; i < pointCount; i++) {
        const [x0, y0, p0] = [pts[(i - 1) * 3], pts[(i - 1) * 3 + 1], pts[(i - 1) * 3 + 2]]
        const [x1, y1, p1] = [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]]
        const nextBand = bandOf(y1, seams)

        if (nextBand === currentBand) {
            currentPts.push(x1, y1, p1)
            continue
        }

        // Walk every seam crossed between y0 and y1, in the order the pen crosses them.
        const step = nextBand > currentBand ? 1 : -1
        let band = currentBand
        let fromX = x0
        let fromY = y0
        let fromP = p0
        while (band !== nextBand) {
            const seamIdx = step > 0 ? band : band - 1
            const seamY = seams[seamIdx]
            const t = (seamY - fromY) / (y1 - fromY === 0 ? 1 : y1 - fromY)
            const seamX = fromX + (x1 - fromX) * t
            const seamP = fromP + (p1 - fromP) * t
            const roundedX = Math.round(seamX)
            const roundedY = Math.round(seamY)
            const roundedP = clampByte(seamP)

            currentPts.push(roundedX, roundedY, roundedP)
            flush(band)

            band += step
            currentPts = [roundedX, roundedY, roundedP]
            fromX = roundedX
            fromY = roundedY
            fromP = roundedP
        }

        // If the walk's last seam crossing landed exactly on the real vertex (the stroke
        // touches the seam precisely rather than merely crossing it), don't push it a second
        // time — that would duplicate the point within this one piece.
        const roundedP1 = clampByte(p1)
        const isDuplicate = fromX === Math.round(x1) && fromY === y1 && fromP === roundedP1
        if (!isDuplicate) currentPts.push(x1, y1, p1)
        currentBand = nextBand
    }

    flush(currentBand)

    return out
}
