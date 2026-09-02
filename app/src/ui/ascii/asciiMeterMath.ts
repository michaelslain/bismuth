// Pure helpers behind <AsciiMeter> + <AsciiChart> (app/src/ui/ascii/AsciiMeter.tsx).
// Named asciiMeterMath (not asciiMeter) to avoid a case-only filename collision
// with AsciiMeter.tsx on case-insensitive filesystems (macOS/Windows).
// Ported from bismuth-design/ascii/design-system/components/ascii/AsciiMeter.jsx — kept as
// plain functions so they're unit-testable without a DOM (repo convention, see
// app/src/ui/buttonClass.ts).

/**
 * Filled cell count for a meter of the given `width`: `value * width`, rounded,
 * then clamped to `[0, width]`. `value` itself is NOT clamped to 0–1 first — a
 * caller passing 1.4 still lands on a full bar, and a negative value on an empty
 * one, matching the reference implementation.
 */
export function meterFill(value: number, width: number): number {
    return Math.max(0, Math.min(width, Math.round(value * width)))
}

/**
 * The scale a chart's bars are measured against: the largest series value, or 1
 * if every value is <= 1 (including an empty series) — keeps a single small or
 * all-zero series from dividing by zero.
 */
export function chartMax(series: { value: number }[]): number {
    if (series.length === 0) return 1
    return Math.max(...series.map(s => s.value), 1)
}

/** Label column width: the longest series label (0 for an empty series). */
export function chartLabelPad(series: { label: string }[]): number {
    if (series.length === 0) return 0
    return Math.max(...series.map(s => s.label.length))
}

/** Filled cell count for one chart bar, scaled against the series' `max`. */
export function chartFill(value: number, max: number, width: number): number {
    return Math.round((value / max) * width)
}

/**
 * Cells that fit in `availablePx` at `chPx` per character, given the 2 bracket glyphs the
 * meter always draws (`[`/`]`) plus `extraPx` of non-meter content sharing the same line.
 * Clamped to `[min, max]` so a collapsing pane degrades to a short meter rather than to a
 * negative repeat count — `'#'.repeat()` throws on a negative argument, which would take
 * the whole view down. Also guards non-finite/non-positive `chPx` (a probe measured before
 * layout, or before a web font swapped in) by returning `min` rather than dividing by zero.
 */
export function fitMeterWidth(
    availablePx: number,
    chPx: number,
    { max = 30, min = 6, extraPx = 0 }: { max?: number; min?: number; extraPx?: number } = {},
): number {
    if (!Number.isFinite(availablePx) || !Number.isFinite(chPx) || chPx <= 0) return min
    const cells = Math.floor((availablePx - extraPx) / chPx) - 2 // '[' and ']'
    return Math.max(min, Math.min(max, cells))
}
