// Reading a rendered page back, pixel by pixel — the half of a page-render golden that a
// byte-count assertion cannot do. Not a test file (no `.test.` in the name, so the runner
// ignores it): a helper, kept HERE rather than beside its caller because `@napi-rs/canvas`
// resolves out of core's node_modules and nothing else in the repo can import it.
//
// Used by cli/test/notePageInk.test.ts, which renders a note carrying ink and then has to
// answer two questions no length check can: is there ink at all, and is it on the right words.
import { createCanvas, loadImage } from '@napi-rs/canvas'

/** An inclusive run of rows. */
export interface Band {
    from: number
    to: number
}

export interface Page {
    width: number
    height: number
    /** Per row: does this row hold any ink / any text pixel. */
    inkRows: boolean[]
    textRows: boolean[]
    /** Per pixel index (y * width + x), 1 when the pixel is of that class. */
    ink: Uint8Array
    text: Uint8Array
}

/**
 * Classify every pixel of a rendered page PNG as INK (chromatic), TEXT (dark and neutral), or
 * neither.
 *
 * CHROMA, not darkness, is what separates the two, and that is load-bearing: an exported page's
 * paper and its words are both near-neutral (the "paper" theme is #2E2C29 on #E9E6E0), so a
 * "dark pixel" test cannot tell a stroke from a letter. The caller therefore draws its fixture
 * ink in a saturated colour and everything downstream follows from this one distinction.
 */
export async function readPage(png: Uint8Array): Promise<Page> {
    const img = await loadImage(Buffer.from(png))
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const width = img.width
    const height = img.height
    const d = ctx.getImageData(0, 0, width, height).data
    const ink = new Uint8Array(width * height)
    const text = new Uint8Array(width * height)
    const inkRows = new Array<boolean>(height).fill(false)
    const textRows = new Array<boolean>(height).fill(false)
    for (let i = 0; i < width * height; i++) {
        const r = d[i * 4]
        const g = d[i * 4 + 1]
        const b = d[i * 4 + 2]
        const chroma = Math.max(r, g, b) - Math.min(r, g, b)
        const y = (i / width) | 0
        if (chroma > 60) {
            ink[i] = 1
            inkRows[y] = true
        } else if ((r + g + b) / 3 < 140) {
            text[i] = 1
            textRows[y] = true
        }
    }
    return { width, height, ink, text, inkRows, textRows }
}

/** Contiguous row bands, merging any two separated by fewer than `gap` empty rows — otherwise
 *  the antialiased gaps between glyph stems shatter one paragraph into a dozen bands. */
export function bands(rows: boolean[], gap: number): Band[] {
    const out: Band[] = []
    let start = -1
    let last = -1
    rows.forEach((on, y) => {
        if (!on) return
        if (start === -1) start = y
        else if (y - last > gap) {
            out.push({ from: start, to: last })
            start = y
        }
        last = y
    })
    if (start !== -1) out.push({ from: start, to: last })
    return out
}

/** The horizontal extent and pixel count of one mask inside a row band. `x0`/`x1` are Infinity
 *  / -Infinity when the band holds none of that class. */
export function extent(
    page: Page,
    mask: Uint8Array,
    band: Band,
): { x0: number; x1: number; count: number } {
    let x0 = Infinity
    let x1 = -Infinity
    let count = 0
    for (let y = band.from; y <= band.to; y++) {
        for (let x = 0; x < page.width; x++) {
            if (!mask[y * page.width + x]) continue
            count++
            if (x < x0) x0 = x
            if (x > x1) x1 = x
        }
    }
    return { x0, x1, count }
}

/** How many pixels of a class the whole page holds. */
export function total(mask: Uint8Array): number {
    let n = 0
    for (const v of mask) n += v
    return n
}
