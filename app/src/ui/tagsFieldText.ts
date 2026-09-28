// app/src/ui/tagsFieldText.ts
// Pure text logic behind ui/TagsField — the single-line field a list property (tags, or a declared
// multiselect) is edited in, typed like a frontmatter list: `planning, docs`. The field holds the
// values as comma-separated text; this module turns a value list into that text, finds the value
// the caret is on (what the completion popup completes), ranks suggestions for it, and parses the
// text back into a list on commit. No framework imports, so `bun test` runs it.
//
// One spelling for every list: values are separated by commas, so a value may hold spaces
// (`In progress`, `Jane Doe`). For a tag list a leading `#` typed out of habit is dropped.

const SEPARATOR = ', '

/** The field's text for a value list. `trailing` (the focused field) ends with a separator so
 *  the caret sits ready for the next value; an unfocused field shows none — `frontend,` with a
 *  dangling comma reads unfinished. Empty list → empty text. */
export function tagsToText(values: ReadonlyArray<string>, trailing = true): string {
    if (values.length === 0) return ''
    const text = values.join(SEPARATOR)
    return trailing ? text + SEPARATOR : text
}

/** `text` ending in a separator (what focusing the field does), unless it is empty or already
 *  ends in one. */
export function withTrailingSeparator(text: string): string {
    if (!text.trim()) return text
    return /,\s*$/.test(text) ? text : text + SEPARATOR
}

/** The field's text back into a value list: split on commas, trim, drop a leading `#` when
 *  `stripHash` (a tag list), drop empties, de-duplicate, keep first-seen order. */
export function textToTags(text: string, stripHash = false): string[] {
    const out: string[] = []
    for (const part of text.split(',')) {
        const v = (stripHash ? part.trim().replace(/^#+/, '') : part).trim()
        if (v && !out.includes(v)) out.push(v)
    }
    return out
}

/** The value the caret is completing: `from` = where it starts in `textBefore` (after the last
 *  comma and any spaces), `query` = the text typed so far (a leading `#` dropped). */
export function tokenAtCaret(textBefore: string): { from: number; query: string } {
    const lastComma = textBefore.lastIndexOf(',')
    const seg = textBefore.slice(lastComma + 1)
    const lead = seg.length - seg.replace(/^\s+/, '').length
    return {
        from: lastComma + 1 + lead,
        query: seg.slice(lead).replace(/^#+/, ''),
    }
}

/** Suggestions for `query`: the options that START with it (case-insensitive) — the same rule as
 *  the note editor's frontmatter `tags:` completion (editor/autocomplete.ts's `tagListSource`) —
 *  in `options` order (the caller passes the column's own values first); values already in the
 *  field are left out. An empty query offers everything not yet used. */
export function rankSuggestions(
    options: ReadonlyArray<string>,
    query: string,
    used: ReadonlyArray<string>,
): string[] {
    const taken = new Set(used.map(u => u.toLowerCase()))
    const q = query.trim().toLowerCase()
    const out: string[] = []
    const seen = new Set<string>()
    for (const o of options) {
        const l = o.toLowerCase()
        if (!o || taken.has(l) || seen.has(l)) continue
        seen.add(l)
        if (l.startsWith(q)) out.push(o)
    }
    return out
}

/** What accepting suggestion `value` inserts over the value being typed: it plus a separator. */
export function completionInsert(value: string): string {
    return value + SEPARATOR
}
