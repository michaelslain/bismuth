// app/src/color/parseHex.ts
//
// Shared hex-colour parser, factored out of four near-identical hand-rolled copies
// (graph/AsciiGraphRenderer.ts's parseColorToRGB, graph/clusterVisual.ts's parseCssColorToRgb,
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
