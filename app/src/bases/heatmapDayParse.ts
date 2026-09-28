// The HeatmapDayEditor's parse, pulled out so it is unit-testable: the committed text of the
// day field becomes a number, or `undefined` meaning "clear this day". No framework imports.

/** `''`, whitespace and anything that is not a finite number all read as a clear. */
export function parseDayValue(text: string): number | undefined {
    const trimmed = text.trim()
    if (trimmed === '') return undefined
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : undefined
}
