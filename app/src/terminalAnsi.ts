// app/src/terminalAnsi.ts
// Pure colour maths for the terminal's derived ANSI palette (Terminal.tsx's buildTerminalTheme) — no
// framework or DOM imports, so it is unit-tested directly (terminalAnsi.test.ts).
//
// WHY THIS EXISTS. ANSI "black" used to be the `--rail` token verbatim. In ink and cathode `--rail`
// IS the terminal ground (`--term-bg` is the same hex), so black text measured 1.00:1 against its own
// background and was invisible (the `xterm-fg-0` flag was real, app-terminal--ansi-palette). The
// bright eight were already derived by mixing toward a lighter ink; black is derived the same way,
// except the mix stops at the first step that clears a contrast floor instead of at a fixed 70%.

export type Rgb = [number, number, number]

/** Parse `#rgb`, `#rrggbb`, `rgb(r, g, b)` or `rgba(r, g, b, a)` into 0-255 channels. Anything else
 *  (a named colour, `transparent`, a `var()`) returns null — callers keep the colour unchanged. */
export function parseColor(input: string): Rgb | null {
    const c = input.trim().toLowerCase()
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c)
    if (hex) {
        const h =
            hex[1].length === 3
                ? hex[1]
                      .split('')
                      .map(x => x + x)
                      .join('')
                : hex[1]
        const n = parseInt(h, 16)
        return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
    }
    const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(c)
    if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])]
    return null
}

function channel(v: number): number {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance. */
export function luminance([r, g, b]: Rgb): number {
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio between two colours, 1..21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
    const la = luminance(a)
    const lb = luminance(b)
    const hi = Math.max(la, lb)
    const lo = Math.min(la, lb)
    return (hi + 0.05) / (lo + 0.05)
}

const toHex = ([r, g, b]: Rgb): string =>
    '#' +
    ((Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b))
        .toString(16)
        .padStart(6, '0')

/** The text-legibility floor the palette's black is held to (WCAG AA for body text). */
export const MIN_ANSI_CONTRAST = 4.5

/**
 * `color`, mixed toward `toward` in 1% steps until it reaches `min`:1 against `bg`; returned
 * unchanged when it already clears the floor, and also unchanged when any of the three colours is
 * not a parseable literal (a derived palette must never throw on a token it cannot read). When even
 * a full mix cannot reach the floor, the full mix is returned — the best this pair can do.
 */
export function ensureContrast(
    color: string,
    toward: string,
    bg: string,
    min = MIN_ANSI_CONTRAST,
): string {
    const from = parseColor(color)
    const to = parseColor(toward)
    const ground = parseColor(bg)
    if (!from || !to || !ground) return color
    if (contrastRatio(from, ground) >= min) return color
    let best: Rgb = to
    for (let pct = 1; pct <= 100; pct++) {
        const t = pct / 100
        const mixed: Rgb = [
            from[0] + (to[0] - from[0]) * t,
            from[1] + (to[1] - from[1]) * t,
            from[2] + (to[2] - from[2]) * t,
        ]
        if (contrastRatio(mixed, ground) >= min) {
            best = mixed
            break
        }
    }
    return toHex(best)
}
