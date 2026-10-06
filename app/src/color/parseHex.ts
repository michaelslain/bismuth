// app/src/color/parseHex.ts
//
// Shared colour parsers, factored out of near-identical hand-rolled copies
// (graph/AsciiGraphRenderer.ts and graph/clusterVisual.ts's CSS-colour parsers, now parseCssColor below;
// graph/bloomColor.ts's parseHexColor, export/pageGeometry.ts's parseRgbColor). Pure — no
// framework imports — so it is unit-testable on its own.
//
// This covers exactly the part all four agreed on: `#rgb` or `#rrggbb` (case-insensitive,
// optional surrounding whitespace, '#' REQUIRED, exactly 3 or exactly 6 hex digits — nothing
// shorter, longer, or missing the '#') parsed into 0..255 integer channels. Anything else
// (missing '#', 4/5/7+ digit hex, non-hex characters, rgb()/rgba(), named colours) returns null.
//
// What is deliberately NOT here, and why: every call site's extra behaviour beyond this core stays
// local, because the four sites do not agree on it —
//   - AsciiGraphRenderer.ts / clusterVisual.ts additionally accept an rgb()/rgba() string, and
//     additionally accept hex longer than 6 digits by truncating to the first 6 (a loose legacy
//     branch this module does not reproduce — see the comment at their call sites).
//   - bloomColor.ts's parseHexColor returns null for anything this module also returns null for —
//     no extra branch, a straight passthrough.
//   - pageGeometry.ts's parseRgbColor additionally accepts rgb()/rgba() (its primary case) and
//     falls back to white ([255,255,255]) instead of null when nothing matches.
// For the SAME malformed input the three "extra branch" sites disagree with each other (e.g. a
// 7-digit hex string parses to a truncated triple in AsciiGraphRenderer/clusterVisual, null in
// bloomColor, and white in pageGeometry) — each site's own wrapper preserves its own prior answer
// rather than this module silently picking one.

export type Rgb = readonly [number, number, number]

export function parseHex(value: string): Rgb | null {
    const s = value.trim()
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
    if (short) {
        const [, r, g, b] = short
        return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)]
    }
    const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s)
    if (long) {
        return [
            parseInt(long[1], 16),
            parseInt(long[2], 16),
            parseInt(long[3], 16),
        ]
    }
    return null
}

/** `#rgb`/`#rrggbb` hex (via parseHex), a longer `#…` hex truncated to its first 6 digits, or
 *  `rgb()`/`rgba()` → 0..255 channels (rgb() channels are not rounded or clamped). Null on anything else. */
export function parseCssColor(css: string): [number, number, number] | null {
    const s = css.trim()
    if (s[0] === '#') {
        const hex = parseHex(s)
        if (hex) return [hex[0], hex[1], hex[2]]
        const h = s.slice(1)
        if (h.length >= 6) {
            const r = parseInt(h.slice(0, 2), 16),
                g = parseInt(h.slice(2, 4), 16),
                b = parseInt(h.slice(4, 6), 16)
            return Number.isFinite(r) &&
                Number.isFinite(g) &&
                Number.isFinite(b)
                ? [r, g, b]
                : null
        }
        return null
    }
    const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
    return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : null
}
