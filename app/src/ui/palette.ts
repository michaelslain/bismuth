// app/src/ui/palette.ts
// The canonical theme color-token list. Each token maps to a `--<token>` CSS var set
// at runtime by settingsCssVars from the active theme. This is the single source of
// truth shared by Chip tones, calendar category swatches, and the export palette.
export const PALETTE_TOKENS = [
    'accent',
    'teal',
    'blue',
    'violet',
    'green',
    'gold',
    'rose',
] as const
export type PaletteTokenName = (typeof PALETTE_TOKENS)[number]

/** True when `color` is one of the palette token names (not a raw CSS colour). */
export function isPaletteToken(
    color: string | undefined,
): color is PaletteTokenName {
    return !!color && (PALETTE_TOKENS as readonly string[]).includes(color)
}

/** A stored colour to a CSS value: a token becomes `var(--<token>)` so it tracks the theme,
 *  anything else (hex, rgb(), a raw `var(--graph-2)`) passes through. Undefined stays `''`. */
export function resolvePaletteColor(color: string | undefined): string {
    if (!color) return ''
    return isPaletteToken(color) ? `var(--${color})` : color
}
