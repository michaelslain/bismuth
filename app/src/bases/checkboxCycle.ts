// The click order of a checkbox cell. A column TYPED as a checkbox (declared in the base, or in
// the vault's property registry) cycles unanswered -> checked -> unchecked -> unanswered.
// `null` is the answer "clear": the row write deletes the property, because an absent property
// means unanswered and is not the same as `false`. An untyped column is a checkbox only while it
// holds a boolean, so clearing it would turn the next click into a text edit: it toggles
// checked <-> unchecked instead.

/** The value a click commits. Any stored value that is not a boolean (a string, a number) counts
 *  as unanswered, so the click checks it. */
export function nextCheckboxValue(current: unknown, typed = true): true | false | null {
    if (current === true) return false
    if (current === false) return typed ? null : true
    return true
}
