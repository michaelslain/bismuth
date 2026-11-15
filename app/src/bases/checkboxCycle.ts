// The click order of a checkbox cell: checked <-> unchecked. A blank value draws as an unchecked
// box (PropertyDisplay), so it is unchecked here too and a click checks it; unchecking writes
// `false`. Clearing back to blank would look like a click that did nothing.

/** The value a click commits. Any stored value that is not `true` (blank, `false`, a string, a
 *  number) counts as unchecked, so the click checks it. */
export function nextCheckboxValue(current: unknown): boolean {
    return current !== true
}
