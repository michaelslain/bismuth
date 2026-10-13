// app/src/ui/table/codeBreaks.ts — pure: where a code token inside a table cell may break. A cell's
// column is never narrower than its longest unbreakable run, so one long path
// (`app/src/chat/ChatTextBubble.module.css`) would otherwise claim the whole table and squeeze every
// other column to a letter. Breaking at the path's own joints keeps each piece readable: after a
// `/` `\` `-` `_` `=` `&` `?` `,`, and before a `.`, but only between two word characters, so
// `--since`, `http://` and a leading `.env` stay whole.

const AFTER = new Set(['/', '\\', '-', '_', '=', '&', '?', ','])
const word = (c: string | undefined) => c != null && /[\p{L}\p{N}]/u.test(c)

/** Split `text` into the pieces between its break opportunities; joined, they are `text`. */
export function codeBreaks(text: string): string[] {
    const pieces: string[] = []
    let start = 0
    for (let i = 1; i < text.length; i++) {
        const c = text[i]
        const prev = text[i - 1]
        const breakBefore =
            (c === '.' && word(prev) && word(text[i + 1])) ||
            (AFTER.has(prev) && word(c) && word(text[i - 2]))
        if (breakBefore) {
            pieces.push(text.slice(start, i))
            start = i
        }
    }
    pieces.push(text.slice(start))
    return pieces
}
