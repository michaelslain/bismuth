// Category colours can be either a THEME TOKEN (one of the palette vars) or any
// custom CSS colour (a hex from the picker). Storing the bare token — not the
// resolved hex — means a category recolours itself automatically when the theme
// changes, because it renders through `var(--token)`.

import { PALETTE_TOKENS, type PaletteTokenName } from '../ui/palette'

/** Palette tokens a category colour may reference. Each maps to a `--<token>` CSS var. */
export const THEME_SWATCHES = PALETTE_TOKENS
export type ThemeSwatch = PaletteTokenName

export function isThemeToken(color: string | undefined): color is ThemeSwatch {
    return !!color && (THEME_SWATCHES as readonly string[]).includes(color)
}

/**
 * A stored category colour → a CSS colour value usable in `background`/`color`.
 * Theme tokens become `var(--token)` (so they track the active theme); anything
 * else (hex, rgb(), named) passes through unchanged. Undefined falls back to accent.
 */
export function resolveCategoryColor(color: string | undefined): string {
    if (!color) return 'var(--accent)'
    return isThemeToken(color) ? `var(--${color})` : color
}

// ── Multi-category support ────────────────────────────────────────────────────
// An event may belong to several categories. `categories` (array) is authoritative
// when present; otherwise the legacy single `category` field is used. This keeps
// old single-category events working unchanged.

interface CategoryLike {
    name: string
    color: string
}
interface EventLike {
    category?: string
    categories?: string[]
}

/** The ordered list of category NAMES an event belongs to (prefers the array). */
export function eventCategoryNames(event: EventLike): string[] {
    if (event.categories && event.categories.length) return event.categories
    return event.category ? [event.category] : []
}

/**
 * The ordered list of resolved CSS colours for an event's categories — one per
 * category that resolves to a known category definition (unknown names dropped).
 */
export function eventCategoryColors(
    event: EventLike,
    categories: CategoryLike[],
): string[] {
    return eventCategoryNames(event)
        .map(name => categories.find(c => c.name === name)?.color)
        .filter((c): c is string => c != null)
        .map(resolveCategoryColor)
}

/** How many bands a chip shows before it stops adding them and counts instead. Three is the point
 *  where a band is still wide enough to read at the narrowest chip the month grid produces; a
 *  fourth turns the chip into stripes. `categoryOverflow()` renders the remainder as "+n". */
export const MAX_BANDS = 3

/**
 * Turn an ordered list of resolved category colours into a CSS `background` value:
 *  - 0 colours → `undefined` (caller renders an outline-only ghost)
 *  - 1 colour  → a solid tint (85% mix, matching the historical single-category look)
 *  - 2+ colours → HARD-EDGED BANDS, one per category, capped at MAX_BANDS
 *
 * WHY BANDS RATHER THAN A BLEND (visual-unification audit §9.6). This used to return a
 * `linear-gradient(135deg, …)` with evenly spaced stops, which BLENDS the colours into each other.
 * Two problems. Visually, a soft gradient is off-register for a flat, hairline, square-cornered
 * design — it was one of only two gradients left in the app. Practically, it destroyed the
 * information it was supposed to carry: at the width of a chip in the month grid, a blend of three
 * tints is a single muddy colour that names none of its categories.
 *
 * Coincident stops (`c1 0%, c1 33.3%, c2 33.3%, c2 66.6%, …`) produce FLAT bands with hard edges —
 * still one `linear-gradient`, so nothing about how the caller applies it changes, but with no
 * transition anywhere in it. Each category keeps a solid, identifiable block of colour.
 */
export function categoryFill(colors: string[]): string | undefined {
    if (colors.length === 0) return undefined
    const tint = (c: string) => `color-mix(in srgb, ${c} 85%, transparent)`
    if (colors.length === 1) return tint(colors[0])

    const shown = colors.slice(0, MAX_BANDS)
    const width = 100 / shown.length
    // Two stops per colour at the SAME pair of offsets — that coincidence is what makes the edge
    // hard. A single stop per colour would interpolate between them, which is the old behaviour.
    // Rounded, because 100/3 stringifies as 33.333333333333336 and the raw float would appear
    // verbatim in the emitted CSS. Both stops of an edge round identically, so the edge stays
    // exactly coincident — which is the one property that must not be lost to rounding.
    const at = (n: number) => `${Math.round(n * width * 1e4) / 1e4}%`
    const stops = shown.flatMap((c, i) => [
        `${tint(c)} ${at(i)}`,
        `${tint(c)} ${at(i + 1)}`,
    ])
    return `linear-gradient(90deg, ${stops.join(', ')})`
}

/** How many categories a chip could not show as a band, for the caller's "+n" affordance.
 *  Returns 0 when everything fits, so a caller can render nothing without a special case. */
export function categoryOverflow(colors: string[]): number {
    return Math.max(0, colors.length - MAX_BANDS)
}

/** Convenience: resolve an event straight to its `background` fill (or undefined). */
export function eventCategoryFill(
    event: EventLike,
    categories: CategoryLike[],
): string | undefined {
    return categoryFill(eventCategoryColors(event, categories))
}
