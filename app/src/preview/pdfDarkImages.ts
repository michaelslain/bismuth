// app/src/preview/pdfDarkImages.ts
// PDF dark mode keeps photos as they are. The page raster still turns dark through the canvas's
// CSS filter (`invert(1) hue-rotate(180deg)`, PdfPageCanvas.module.css); a second, unfiltered
// canvas above it repaints the page's photos from the same raster, so a portrait or a map reads in
// its own colours on the dark page. An image that is part of the paper (a scanned page, a chart or
// a line drawing on white) stays dark with the page: its dominant colour is the paper's.
//
// Where the images are comes from pdf.js itself: `render({ recordImages: true })` leaves
// `page.imageCoordinates`, three corners per drawn image as fractions of the canvas (top-left,
// bottom-left, top-right of the image, clipped to its clip box).
import { darkHex } from '../bases/darkPage'

/** A point in canvas pixels. */
export type Pt = { x: number; y: number }
/** An image's parallelogram on the canvas: `a` top-left, `b` bottom-left, `c` top-right. */
export type Quad = { a: Pt; b: Pt; c: Pt }

/** pdf.js's `imageCoordinates` (6 numbers per image, fractions of the canvas) as pixel quads. */
export function imageQuads(coords: ArrayLike<number> | null | undefined, w: number, h: number): Quad[] {
    const out: Quad[] = []
    if (!coords) return out
    for (let i = 0; i + 5 < coords.length; i += 6) {
        out.push({
            a: { x: coords[i] * w, y: coords[i + 1] * h },
            b: { x: coords[i + 2] * w, y: coords[i + 3] * h },
            c: { x: coords[i + 4] * w, y: coords[i + 5] * h },
        })
    }
    return out
}

/** The quad's fourth corner (bottom-right). */
const fourth = (q: Quad): Pt => ({ x: q.b.x + q.c.x - q.a.x, y: q.b.y + q.c.y - q.a.y })

/** The quad's axis-aligned pixel box, clamped to a `w`×`h` canvas; null when it is empty there. */
export function quadBox(q: Quad, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
    const d = fourth(q)
    const xs = [q.a.x, q.b.x, q.c.x, d.x]
    const ys = [q.a.y, q.b.y, q.c.y, d.y]
    const x0 = Math.max(0, Math.floor(Math.min(...xs)))
    const y0 = Math.max(0, Math.floor(Math.min(...ys)))
    const x1 = Math.min(w, Math.ceil(Math.max(...xs)))
    const y1 = Math.min(h, Math.ceil(Math.max(...ys)))
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

type Box = { x: number; y: number; w: number; h: number }

/** Images whose boxes touch or overlap, chained, as one region each. A chart drawn as many small
 *  image tiles is judged whole, with the white around its marks, instead of tile by tile. */
export function imageRegions(quads: Quad[], w: number, h: number): { box: Box; quads: Quad[] }[] {
    const items: { box: Box; quad: Quad }[] = []
    for (const quad of quads) {
        const box = quadBox(quad, w, h)
        if (box) items.push({ box, quad })
    }
    const parent = items.map((_, i) => i)
    const root = (i: number): number => {
        while (parent[i] !== i) i = parent[i] = parent[parent[i]]
        return i
    }
    const touch = (a: Box, b: Box) =>
        a.x <= b.x + b.w + 1 && b.x <= a.x + a.w + 1 && a.y <= b.y + b.h + 1 && b.y <= a.y + a.h + 1
    for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
            if (touch(items[i].box, items[j].box)) parent[root(j)] = root(i)
        }
    }
    const byRoot = new Map<number, { box: Box; quads: Quad[] }>()
    items.forEach((it, i) => {
        const r = root(i)
        const cur = byRoot.get(r)
        if (!cur) return void byRoot.set(r, { box: { ...it.box }, quads: [it.quad] })
        const x = Math.min(cur.box.x, it.box.x)
        const y = Math.min(cur.box.y, it.box.y)
        cur.box = {
            x,
            y,
            w: Math.max(cur.box.x + cur.box.w, it.box.x + it.box.w) - x,
            h: Math.max(cur.box.y + cur.box.h, it.box.y + it.box.h) - y,
        }
        cur.quads.push(it.quad)
    })
    return [...byRoot.values()]
}

/** Mean luminance (Rec. 709, 0..1) of RGBA pixels, read from at most `samples` of them. */
export function meanLuminance(data: ArrayLike<number>, samples = 20000): number {
    const n = Math.floor(data.length / 4)
    if (n === 0) return 1
    const step = Math.max(1, Math.floor(n / samples))
    let sum = 0
    let count = 0
    for (let i = 0; i < n; i += step) {
        sum += 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]
        count++
    }
    return sum / count / 255
}

/** A region darker on average than this is a photo and keeps its colours; a lighter one is paper
 *  (a scan, a chart or a drawing on white) and turns dark with the page. Fit on 496 hand-labelled
 *  images from 217 real PDFs (articles, scans, lecture notes, flyers): the lowest cutoff that keeps
 *  every photo it can light, then leaves the fewest paper images light. Photos topped out at 0.664,
 *  the next paper image sat at 0.674. */
export const PHOTO_MAX_LUMINANCE = 0.67

/** True when a region's pixels read as a photo rather than as paper. */
export const isPhoto = (data: ArrayLike<number>): boolean => meanLuminance(data) < PHOTO_MAX_LUMINANCE

/** The photos among the images pdf.js recorded on `source`, each as the outlines of the images
 *  that make it up, in fractions of the canvas, so they fit the same page at any size. */
export function findPhotos(source: HTMLCanvasElement, coords: ArrayLike<number>): Quad[][] {
    const w = source.width
    const h = source.height
    const g = source.getContext('2d', { willReadFrequently: true })
    const photos: Quad[][] = []
    if (!g) return photos
    for (const r of imageRegions(imageQuads(coords, w, h), w, h)) {
        const px = g.getImageData(r.box.x, r.box.y, r.box.w, r.box.h).data
        if (isPhoto(px)) photos.push(r.quads.map(q => scaleQuad(q, 1 / w, 1 / h)))
    }
    return photos
}

/** Draw `source`'s photos onto `g`, a `w`x`h` surface showing the same page darkened: each photo
 *  as printed, over a one-pixel ring of the dark paper colour. The photo's outermost pixels are
 *  blended with the white paper; shown as printed they are a light hairline, and darkened they are
 *  the photo inverted, light again, so the ring takes them and the photo is drawn a pixel inside. */
export function drawPhotos(
    g: CanvasRenderingContext2D,
    source: CanvasImageSource,
    photos: Quad[][],
    w: number,
    h: number,
): void {
    if (photos.length === 0) return
    const trace = (grow: number) => {
        g.beginPath()
        for (const region of photos) {
            for (const unit of region) {
                const q = insetQuad(scaleQuad(unit, w, h), -grow)
                if (!q) continue
                const d = fourth(q)
                g.moveTo(q.a.x, q.a.y)
                g.lineTo(q.c.x, q.c.y)
                g.lineTo(d.x, d.y)
                g.lineTo(q.b.x, q.b.y)
                g.closePath()
            }
        }
    }
    g.save()
    trace(1)
    g.fillStyle = DARK_PAPER
    g.fill('nonzero')
    trace(-1)
    g.clip('nonzero')
    g.drawImage(source, 0, 0, w, h)
    g.restore()
}

// The photos of a page, judged once per pdf.js page.
const photosOfPage = new WeakMap<object, Quad[][]>()

/** Paint `source`'s photos onto `target` (sized to match), and nothing else. `page` carries
 *  pdf.js's `imageCoordinates` from a `recordImages` render. */
export function paintPhotos(
    target: HTMLCanvasElement,
    source: HTMLCanvasElement,
    page: { imageCoordinates?: ArrayLike<number> | null },
): void {
    let photos = photosOfPage.get(page)
    if (!photos) {
        if (!page.imageCoordinates) {
            target.width = 0
            target.height = 0
            return
        }
        photos = findPhotos(source, page.imageCoordinates)
        photosOfPage.set(page, photos)
    }
    target.width = source.width
    target.height = source.height
    const g = target.getContext('2d')
    if (g) drawPhotos(g, source, photos, target.width, target.height)
}

// The photos of a rasterised page picture (the book reader's faces), keyed by the picture.
const photosOfPicture = new WeakMap<object, Quad[][]>()

/** Remember which parts of a page picture are photos, for when it is darkened later. */
export const markPhotos = (picture: object, photos: Quad[][]): void => void photosOfPicture.set(picture, photos)

/** The photos remembered for a page picture; none for an image or a picture never marked. */
export const photosIn = (picture: object): Quad[][] => photosOfPicture.get(picture) ?? []

/** White paper through the dark filter, the colour the page around a photo shows. */
const DARK_PAPER = darkHex('#FFFFFF')

const scaleQuad = (q: Quad, sx: number, sy: number): Quad => ({
    a: { x: q.a.x * sx, y: q.a.y * sy },
    b: { x: q.b.x * sx, y: q.b.y * sy },
    c: { x: q.c.x * sx, y: q.c.y * sy },
})

/** The quad pulled in by `px` on every side (pushed out when `px` is negative), or null when
 *  nothing is left. */
export function insetQuad(q: Quad, px: number): Quad | null {
    const ux = q.c.x - q.a.x
    const uy = q.c.y - q.a.y
    const vx = q.b.x - q.a.x
    const vy = q.b.y - q.a.y
    const ul = Math.hypot(ux, uy)
    const vl = Math.hypot(vx, vy)
    if (ul <= 2 * px || vl <= 2 * px) return null
    const du = { x: (ux / ul) * px, y: (uy / ul) * px }
    const dv = { x: (vx / vl) * px, y: (vy / vl) * px }
    const a = { x: q.a.x + du.x + dv.x, y: q.a.y + du.y + dv.y }
    return {
        a,
        b: { x: q.b.x + du.x - dv.x, y: q.b.y + du.y - dv.y },
        c: { x: q.c.x - du.x + dv.x, y: q.c.y - du.y + dv.y },
    }
}
