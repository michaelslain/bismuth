// app/src/ui/table/longRuns.ts — pure: which runs of a table cell's text are too long to keep whole.
// A cell's column is never narrower than its longest unbreakable run, and cells keep whole words
// (global.css's "Markdown tables"), so one bare URL, link label or 45-letter word would set its column
// wider than the note and run the table past its frame. A run longer than any prose word is marked
// so it may break anywhere: it stops setting its column's minimum width and wraps at the cell's edge,
// while every ordinary word still wraps only between words.

/** Longer than this many characters without whitespace is a run, not a word. The longest English
 *  words in ordinary prose (`internationalization`, `counterrevolutionary`) are 20. */
export const LONG_RUN = 20

/** Split `text` into pieces, each marked `long` when it is a run over `min` characters; joined, the
 *  pieces are `text`. */
export function longRuns(
    text: string,
    min = LONG_RUN,
): { text: string; long: boolean }[] {
    const pieces: { text: string; long: boolean }[] = []
    let start = 0
    for (const m of text.matchAll(new RegExp(`\\S{${min + 1},}`, 'gu'))) {
        if (m.index! > start)
            pieces.push({ text: text.slice(start, m.index), long: false })
        pieces.push({ text: m[0], long: true })
        start = m.index! + m[0].length
    }
    if (start < text.length || !pieces.length)
        pieces.push({ text: text.slice(start), long: false })
    return pieces
}
