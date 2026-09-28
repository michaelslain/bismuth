// The HeatmapDayEditor's parse, pulled out so it is unit-testable: the committed text of the
// day field becomes a number, `undefined` meaning "clear this day", or `null` meaning "not a
// number — commit nothing". No framework imports.

/** `''` and whitespace read as a clear (`undefined`); anything that is not a finite number is
 *  `null`, so a typo can never delete a stored value. */
export function parseDayValue(text: string): number | undefined | null {
    const trimmed = text.trim()
    if (trimmed === '') return undefined
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
}
