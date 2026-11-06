// app/src/bases/bookSelection.ts
// Maps a selection over typeset text back to the notebook pages it covers. The DOM glue reads
// each line's source and plain text and the selection's two end points as (line, offset) pairs;
// everything here is string work, so it runs under Bun.

export type SelectionLine = {
    file: string
    /** The page within the file (a PDF's page; 1 for an image). */
    page: number
    /** The line's plain text, marks stripped. */
    text: string
    /** Each run's length and whether it is marked, in order; the lengths sum to `text.length`. */
    runs?: { length: number; mark: boolean }[]
}
export type SelectionPoint = { line: number; offset: number }
export type BookQuote = { file: string; page: number; quote: string }

const same = (a: SelectionLine, b: SelectionLine) => a.file === b.file && a.page === b.page

/** One quote per contiguous unmarked stretch of the selection, per notebook page, in reading order.
 *  A marked run ends the current quote (the transcript reads `==x==` there, so a quote spanning it
 *  would never match). A line break inside a stretch reads as a space. */
export function quotesFromSelection(lines: SelectionLine[], from: SelectionPoint, to: SelectionPoint): BookQuote[] {
    const [a, b] = from.line < to.line || (from.line === to.line && from.offset <= to.offset) ? [from, to] : [to, from]
    const out: BookQuote[] = []
    let open: BookQuote | null = null
    for (let i = Math.max(0, a.line); i <= Math.min(b.line, lines.length - 1); i++) {
        const line = lines[i]
        const lo = i === a.line ? a.offset : 0
        const hi = i === b.line ? b.offset : line.text.length
        if (open && (open.file !== line.file || open.page !== line.page)) open = null
        const runs = line.runs?.length ? line.runs : [{ length: line.text.length, mark: false }]
        let at = 0
        for (const run of runs) {
            const s = Math.max(lo, at)
            const e = Math.min(hi, at + run.length)
            at += run.length
            if (run.mark) {
                if (e > s) open = null
                continue
            }
            const part = e > s ? line.text.slice(s, e).trim() : ''
            if (!part) continue
            if (open) open.quote += ` ${part}`
            else {
                open = { file: line.file, page: line.page, quote: part }
                out.push(open)
            }
        }
    }
    return out
}

/** The whole marked span holding the character at `offset` on `line`, or null when that character
 *  is not marked. A span that wraps onto the next or previous typeset line of the same page is
 *  followed across the break. */
export function markSpanAt(lines: SelectionLine[], line: number, offset: number): BookQuote | null {
    const at = lines[line]
    if (!at?.runs) return null
    let start = 0
    let hit = -1
    for (let r = 0; r < at.runs.length; r++) {
        if (offset >= start && offset < start + at.runs[r].length) hit = r
        if (hit >= 0) break
        start += at.runs[r].length
    }
    if (hit < 0 || !at.runs[hit].mark) return null
    const pieces: string[] = []
    const take = (l: SelectionLine, r: number, from: number) =>
        l.text.slice(from, from + (l.runs as { length: number }[])[r].length).trim()
    pieces.push(take(at, hit, start))
    // forward: the run ending the line continues onto the next line when that begins marked
    let l = line
    let r = hit
    while (r === (lines[l].runs as unknown[]).length - 1) {
        const next = lines[l + 1]
        if (!next?.runs?.length || !same(lines[l], next) || !next.runs[0].mark) break
        l++
        r = 0
        pieces.push(take(next, 0, 0))
    }
    // backward: the run opening the line continues from the previous line when that ends marked
    l = line
    r = hit
    while (r === 0) {
        const prev = lines[l - 1]
        const n = prev?.runs?.length ?? 0
        if (!prev?.runs || n === 0 || !same(lines[l], prev) || !prev.runs[n - 1].mark) break
        l--
        r = n - 1
        const from = prev.runs.slice(0, r).reduce((s, x) => s + x.length, 0)
        pieces.unshift(take(prev, r, from))
    }
    return { file: at.file, page: at.page, quote: pieces.filter(Boolean).join(' ') }
}
