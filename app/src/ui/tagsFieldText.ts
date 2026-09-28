// app/src/ui/tagsFieldText.ts
// Pure text logic behind ui/TagsField — the single-line field a `tags` (or declared `multiselect`)
// property is edited in, the way a note's frontmatter `tags:` line is typed. The field holds the
// values as plain text; this module turns a value list into that text, finds the token the caret
// is on (what the completion popup completes), ranks suggestions for it, and parses the text back
// into a list on commit. No framework imports, so `bun test` runs it.
//
// Two spellings, one per mode:
//   - `hash` (tags): `#alpha #beta ` — the same text the read-only cell shows. Tags never contain
//     whitespace, so whitespace or commas separate tokens and a leading `#` is optional to type.
//   - plain (declared multiselect): `In progress, Done, ` — options may contain spaces, so only a
//     comma separates tokens.

/** The field's text for a value list. `trailing` (the focused field) ends with a separator so
 *  the caret sits ready for the next token; an unfocused field shows none — `frontend,` with a
 *  dangling comma reads unfinished. Empty list → empty text. */
export function tagsToText(
    values: ReadonlyArray<string>,
    hash: boolean,
    trailing = true,
): string {
    if (values.length === 0) return ''
    const text = hash
        ? values.map(v => `#${v.replace(/^#/, '')}`).join(' ')
        : values.join(', ')
    return trailing ? text + separator(hash) : text
}

/** The separator typed after a token in each mode. */
export function separator(hash: boolean): string {
    return hash ? ' ' : ', '
}

/** `text` ending in the mode's separator (what focusing the field does), unless it is empty or
 *  already ends in one. */
export function withTrailingSeparator(text: string, hash: boolean): string {
    if (!text.trim()) return text
    const end = hash ? /[\s,]$/ : /,\s*$/
    return end.test(text) ? text : text + separator(hash)
}

/** The field's text back into a value list: split on the mode's separators, strip a leading `#`
 *  (hash mode), trim, drop empties, de-duplicate, keep first-seen order. */
export function textToTags(text: string, hash: boolean): string[] {
    const parts = hash ? text.split(/[\s,]+/) : text.split(',')
    const out: string[] = []
    for (const p of parts) {
        const v = (hash ? p.replace(/^#+/, '') : p).trim()
        if (v && !out.includes(v)) out.push(v)
    }
    return out
}

/** The token the caret is completing: `from` = where it starts in `textBefore` (INCLUDING a
 *  typed `#` in hash mode, so accepting replaces it too), `query` = the text typed so far without
 *  the `#`. Null when the caret sits right after a separator in plain mode's leading space. */
export function tokenAtCaret(
    textBefore: string,
    hash: boolean,
): { from: number; query: string } {
    if (hash) {
        const m = textBefore.match(/#?[^\s,#]*$/)!
        const tok = m[0]
        return { from: textBefore.length - tok.length, query: tok.replace(/^#/, '') }
    }
    const lastComma = textBefore.lastIndexOf(',')
    const seg = textBefore.slice(lastComma + 1)
    const lead = seg.length - seg.replace(/^\s+/, '').length
    return { from: lastComma + 1 + lead, query: seg.slice(lead) }
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

/** What accepting suggestion `value` inserts over the token: the value plus its separator. */
export function completionInsert(value: string, hash: boolean): string {
    return hash ? `#${value} ` : `${value}, `
}
