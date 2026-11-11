// app/src/preview/highlightColor.ts
// The PDF highlighter's current colour, one for the whole app: picking green in one PDF keeps green
// for the next highlight in any PDF or book, and the next launch starts on the last colour picked
// (remembered in this window's localStorage; a fresh profile starts on yellow). The value is a
// `PDF_HIGHLIGHT_COLORS` entry's `c` (core/src/theme/tokens.ts), which is what `addHighlight` stores.
import { createSignal } from 'solid-js'
import { PDF_HIGHLIGHT_COLORS } from '../../../core/src/theme/tokens'

const KEY = 'bismuth.highlightColor'

/** The stored colour when it is still one of the palette's, else yellow. */
export function initialHighlightColor(stored: string | null): string {
    const known = PDF_HIGHLIGHT_COLORS.find(h => h.c === stored)
    return (known ?? PDF_HIGHLIGHT_COLORS[0]!).c
}

function read(): string | null {
    try {
        return localStorage.getItem(KEY)
    } catch {
        return null
    }
}

const [highlightColor, setColor] = createSignal(initialHighlightColor(read()))

function setHighlightColor(c: string): void {
    setColor(c)
    try {
        localStorage.setItem(KEY, c)
    } catch {
        // storage off (a private window, a test runner): the colour still holds for this session
    }
}

/** The glyph colour for the highlighter button: the highlight colour itself, pulled a quarter of the
 *  way toward the foreground so the pale swatches keep their contrast on a light theme. */
export function highlightTint(c: string): string {
    const hex = (PDF_HIGHLIGHT_COLORS.find(h => h.c === c) ?? PDF_HIGHLIGHT_COLORS[0]!).hex
    return `color-mix(in srgb, ${hex} 75%, var(--fg))`
}

export { highlightColor, setHighlightColor }
