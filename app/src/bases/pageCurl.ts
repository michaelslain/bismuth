// Pure page-curl geometry (no framework imports). Everything is expressed in the turning leaf's
// own frame: x runs from the spine (0) out to the free edge (page.w), y from the top (0) to the
// bottom (page.h). The renderer mirrors the frame for a back turn.
//
// The leaf bends around a cylinder whose axis crosses (axisX, h/2) and is tilted `angle` radians
// from vertical. Paper past the axis wraps over the cylinder (a half circle of length pi * radius)
// and lies flat on its back beyond that. progress 0 = flat, 0.5 = free edge at the spine,
// 1 = fully turned.

export type Direction = 'forward' | 'back'
export type PageSize = { w: number; h: number }
export type CurlInput = { pointer: { x: number; y: number }; page: PageSize; direction: Direction }
export type CurlState = { progress: number; angle: number; radius: number; axisX: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const MAX_TILT = 0.45

/** Radius of the bend: tight at the very start and end, fullest mid-turn. */
function radiusAt(progress: number, w: number): number {
    return 0.16 * w * Math.sin(Math.PI * clamp(progress, 0, 1))
}

/** Axis position that lands the free edge exactly where the pointer (or the path) puts it. */
function stateFor(progress: number, angle: number, w: number): CurlState {
    const p = clamp(progress, 0, 1)
    const radius = radiusAt(p, w)
    return { progress: p, angle, radius, axisX: w - w * p - (Math.PI * radius) / 2 }
}

/** The curl for a pointer in page-local px. A forward turn measures x from the spine (the outer
 *  edge is x = w, the far side of the spine x = -w); a back turn measures x from the page's outer
 *  edge (x = 0) towards the spine (x = w) and beyond (x = 2w). */
export function curlFromPointer(i: CurlInput): CurlState {
    const { w, h } = i.page
    const xf = i.direction === 'forward' ? i.pointer.x : w - i.pointer.x
    const progress = clamp((w - xf) / (2 * w), 0, 1)
    const angle = clamp((i.pointer.y - h / 2) / h, -0.5, 0.5) * 2 * MAX_TILT
    return stateFor(progress, angle, w)
}

/** The animated path: a gentle tilt that eases off as the leaf lands. */
export function curlAt(progress: number, page: PageSize, _direction: Direction): CurlState {
    const p = clamp(progress, 0, 1)
    return stateFor(p, 0.2 * Math.sin(Math.PI * p), page.w)
}

export type Deformed = { x: number; y: number; z: number; back: boolean }

/** Signed distance of a leaf point from the fold axis, along the axis normal. */
export function axisDistance(x: number, y: number, s: CurlState, page: PageSize): number {
    return (x - s.axisX) * Math.cos(s.angle) + (y - page.h / 2) * Math.sin(s.angle)
}

/** Where a flat leaf point ends up: unmoved behind the axis, wrapped over the cylinder past it
 *  (z lifts, `back` once past the quarter turn), laid flat on its back beyond the half circle. */
export function deform(x: number, y: number, s: CurlState, page: PageSize): Deformed {
    const d = axisDistance(x, y, s, page)
    if (d <= 0) return { x, y, z: 0, back: false }
    const r = Math.max(s.radius, 1e-6)
    let nd: number
    let z: number
    let back: boolean
    if (d <= Math.PI * r) {
        const theta = d / r
        nd = r * Math.sin(theta)
        z = r * (1 - Math.cos(theta))
        back = theta > Math.PI / 2
    } else {
        nd = -(d - Math.PI * r)
        z = 2 * r
        back = true
    }
    const shift = nd - d
    return { x: x + shift * Math.cos(s.angle), y: y + shift * Math.sin(s.angle), z, back }
}

/** A CSS-style cubic-bezier easing from (0,0) to (1,1) through control points (x1,y1), (x2,y2):
 *  the curve's x is solved for t by Newton steps, then its y is the eased value. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
    const bx = (u: number) => 3 * x1 * u * (1 - u) ** 2 + 3 * x2 * u * u * (1 - u) + u ** 3
    const by = (u: number) => 3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u * u * (1 - u) + u ** 3
    const dx = (u: number) => 3 * x1 * (1 - u) ** 2 + 6 * (x2 - x1) * u * (1 - u) + 3 * (1 - x2) * u * u
    return t => {
        if (t <= 0) return 0
        if (t >= 1) return 1
        let u = t
        for (let i = 0; i < 8; i++) {
            const d = dx(u)
            if (Math.abs(d) < 1e-6) break
            u = clamp(u - (bx(u) - t) / d, 0, 1)
        }
        return by(u)
    }
}

/** A turn's motion: the page lifts softly, glides, and lands with a long, gentle settle, rather
 *  than leaving at full speed and stopping dead. */
export const turnEase = cubicBezier(0.3, 0.05, 0.12, 1)

/** Where a released page goes: past the spine it commits to the turn, otherwise it falls back. */
export function settle(progress: number): { commit: boolean; target: 0 | 1 } {
    const commit = progress >= 0.5
    return { commit, target: commit ? 1 : 0 }
}
