// app/src/bases/darkPage.ts
// The book reader's dark pages: the same transform as the PDF viewer's dark mode, CSS
// `invert(1) hue-rotate(180deg)` (PdfPageCanvas.module.css), done on pixels and colours so the page
// curl's faces, the still spread and the text pages all match the scroll viewer. White paper turns
// near-black and dark ink near-white, while every colour keeps its hue.

/** `hue-rotate(180deg)` from the CSS filter spec (cos = -1, sin = 0), applied after `invert(1)`. */
const M = [
    [-0.574, 1.43, 0.144],
    [0.426, 0.43, 0.144],
    [0.426, 1.43, -0.856],
] as const

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

/** One colour through the dark transform, as [r, g, b] in 0..255. */
export function darkRgb(r: number, g: number, b: number): [number, number, number] {
    const ir = 255 - r
    const ig = 255 - g
    const ib = 255 - b
    return [
        clamp(M[0][0] * ir + M[0][1] * ig + M[0][2] * ib),
        clamp(M[1][0] * ir + M[1][1] * ig + M[1][2] * ib),
        clamp(M[2][0] * ir + M[2][1] * ig + M[2][2] * ib),
    ]
}

const parseHex = (hex: string): [number, number, number] | null => {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
}

const toHex = (c: [number, number, number]) => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase()

/** A `#RRGGBB` colour through the dark transform; anything else comes back unchanged. */
export function darkHex(hex: string): string {
    const c = parseHex(hex)
    return c ? toHex(darkRgb(...c)) : hex
}

/** An `rgba(r, g, b, a)` tint built from `#RRGGBB`, optionally through the dark transform. */
export function tintOf(hex: string, alpha: number, dark = false): string {
    const c = parseHex(hex)
    if (!c) return hex
    const [r, g, b] = dark ? darkRgb(...c) : c
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** RGBA pixels through the dark transform, in place; alpha is kept. */
export function darkenPixels(data: Uint8ClampedArray): void {
    for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = darkRgb(data[i], data[i + 1], data[i + 2])
        data[i] = r
        data[i + 1] = g
        data[i + 2] = b
    }
}
