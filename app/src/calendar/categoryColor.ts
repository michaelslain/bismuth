// Category colours can be either a THEME TOKEN (one of the palette vars) or any
// custom CSS colour (a hex from the picker). Storing the bare token — not the
// resolved hex — means a category recolours itself automatically when the theme
// changes, because it renders through `var(--token)`.

import {
    PALETTE_TOKENS,
    isPaletteToken,
    resolvePaletteColor,
    type PaletteTokenName,
} from '../ui/palette'

/** Palette tokens a category colour may reference. Each maps to a `--<token>` CSS var. */
export const THEME_SWATCHES = PALETTE_TOKENS
export type ThemeSwatch = PaletteTokenName

/** Palette tokens used for AUTO-assigned category colours only — never for the picker's
 *  choices, which stay the full `THEME_SWATCHES` above (so `accent` remains pickable, and any
 *  event category already stored as `accent` still highlights the right swatch). Excludes
 *  `accent` because it is the app's own selection colour (the today pill, the `DONE` outline),
 *  so a band an AUTO-assignment paints in it would read as "selected" rather than
 *  "categorised" — a user may still choose it deliberately via the picker. */
export const AUTO_CATEGORY_TOKENS = PALETTE_TOKENS.filter(t => t !== 'accent')

export function isThemeToken(color: string | undefined): color is ThemeSwatch {
    return isPaletteToken(color)
}

/**
 * A stored category colour → a CSS colour value usable in `background`/`color`.
 * Theme tokens become `var(--token)` (so they track the active theme); anything
 * else (hex, rgb(), named) passes through unchanged. Undefined falls back to accent.
 */
export function resolveCategoryColor(color: string | undefined): string {
    return color ? resolvePaletteColor(color) : 'var(--accent)'
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

/** How many categories a chip names (a frame band + a dot each) before it stops adding them and
 *  counts instead. Three is the point where a band is still wide enough to read at the narrowest
 *  chip the month grid produces; a fourth turns the frame into stripes. `categoryOverflow()` is the
 *  remainder, which the chip shows as "+n". */
export const MAX_BANDS = 3

/**
 * Full-strength hard-edged bands, one per category (capped at MAX_BANDS), as a `linear-gradient`
 * image — an event chip's frame (`border-image`) and the drag ghost's, so a two-category event's
 * rule is visibly split into its categories while its wash stays one colour (one event).
 *
 * WHY HARD BANDS, NEVER A BLEND: coincident stops (`c1 0%, c1 50%, c2 50%, …`) give flat bands
 * with hard edges; evenly spaced single stops would blend, and a blend of two tints names neither
 * category.
 * `angle` 180deg stacks the bands top-to-bottom (a left edge), 90deg lays them left-to-right (a
 * top cap). Always an IMAGE, even for one colour, so a caller can size it as a background layer.
 * 0 colours → `undefined`.
 */
export function categoryBands(colors: string[], angle: 90 | 180): string | undefined {
    if (colors.length === 0) return undefined
    const shown = colors.slice(0, MAX_BANDS)
    const width = 100 / shown.length
    const at = (n: number) => `${Math.round(n * width * 1e4) / 1e4}%`
    const stops = shown.flatMap((c, i) => [`${c} ${at(i)}`, `${c} ${at(i + 1)}`])
    return `linear-gradient(${angle}deg, ${stops.join(', ')})`
}

/** How many categories a chip could not show as a band, for the caller's "+n" affordance.
 *  Returns 0 when everything fits, so a caller can render nothing without a special case. */
export function categoryOverflow(colors: string[]): number {
    return Math.max(0, colors.length - MAX_BANDS)
}
