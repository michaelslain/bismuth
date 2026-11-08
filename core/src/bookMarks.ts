// core/src/bookMarks.ts
// Highlights inside a page's transcript: a marked span is `==text==` in the companion note's
// transcript block, so search and notes see it. Pure string work, no node imports (the iPad's
// in-process core loads this file).
import type { TextLine } from './visionOcr'

const START = '<!-- bismuth:transcript:start -->'
const END = '<!-- bismuth:transcript:end -->'
const HEADING = /^### Page (\d+)[ \t]*$/gm
// A delimiter needs a non-space, non-`=` character just inside it, so a stray `a == b` is no mark.
const SPAN = /==(?![=\s])([^\n]*?[^\s=])==/g
const norm = (t: string): string => t.trim().replace(/\s+/g, ' ')

type Range = { from: number; to: number }

/** Where one page's text sits in the companion: inside the transcript block only. */
function pageRange(md: string, page: number): Range | null {
    const s = md.indexOf(START)
    if (s < 0) return null
    let from = s + START.length
    // The block's checks line (transcript.ts) is no page's text.
    const checks = md.slice(from).match(/^\n<!-- bismuth:transcript:checks .*? -->[ \t]*/)
    if (checks) from += checks[0].length
    const to = md.indexOf(END, from)
    if (to < 0) return null
    const inner = md.slice(from, to)
    const heads = [...inner.matchAll(HEADING)]
    if (heads.length === 0) return page === 1 ? { from, to } : null
    for (let i = 0; i < heads.length; i++) {
        if (Number(heads[i][1]) !== page) continue
        const a = from + heads[i].index! + heads[i][0].length
        const b = i + 1 < heads.length ? from + heads[i + 1].index! : to
        return { from: a, to: b }
    }
    return null
}

function spansOf(text: string): { from: number; to: number; inner: string }[] {
    return [...text.matchAll(SPAN)].map(m => ({ from: m.index!, to: m.index! + m[0].length, inner: m[1] }))
}

/** The `==marked==` spans in that page's transcript, in order. */
export function marksOnPage(companionText: string, page: number): string[] {
    const r = pageRange(companionText, page)
    if (!r) return []
    return spansOf(companionText.slice(r.from, r.to)).map(s => s.inner)
}

/** The text with every `==…==` span unwrapped, its words kept. */
export function stripMarks(text: string): string {
    return text.replace(SPAN, (_m, inner: string) => inner)
}

/** Marks as the reader made them: consecutive spans separated only by whitespace (one mark
 *  `addMarks` split per line) are joined into one quote, single-spaced. */
function joinedQuotes(text: string): string[] {
    const out: string[] = []
    let prevTo = -1
    for (const s of spansOf(text)) {
        if (out.length && /^\s+$/.test(text.slice(prevTo, s.from))) out[out.length - 1] += ` ${s.inner}`
        else out.push(s.inner)
        prevTo = s.to
    }
    return out
}

/** `marksOnPage` with split-per-line spans joined back into the quote that made them. */
export function markQuotesOnPage(companionText: string, page: number): string[] {
    const r = pageRange(companionText, page)
    return r ? joinedQuotes(companionText.slice(r.from, r.to)) : []
}

/** `marksIn` with split-per-line spans joined back into the quote that made them. */
export const markQuotesIn = (text: string): string[] => joinedQuotes(text)

/** The `==marked==` spans inside a bare piece of text, in order. */
export function marksIn(text: string): string[] {
    return spansOf(text).map(s => s.inner)
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Wrap the first unmarked occurrence of each quote in `==…==`; a quote not found is skipped.
 *  Whitespace in the quote matches any whitespace run (text mode lays a lone newline out as a
 *  space); a match crossing lines is wrapped per line, since a span cannot cross one. */
export function addMarks(companionText: string, page: number, quotes: string[]): string {
    const r = pageRange(companionText, page)
    if (!r) return companionText
    let text = companionText.slice(r.from, r.to)
    for (const quote of quotes) {
        const words = quote.trim().split(/\s+/).filter(Boolean)
        if (words.length === 0) continue
        const spans = spansOf(text)
        const re = new RegExp(words.map(escapeRe).join('\\s+'), 'g')
        let hit: { at: number; len: number } | null = null
        for (let m = re.exec(text); m; m = re.exec(text)) {
            const at = m.index
            const len = m[0].length
            if (!spans.some(s => at < s.to && at + len > s.from)) {
                hit = { at, len }
                break
            }
            re.lastIndex = at + 1
        }
        if (!hit) continue
        const found = text.slice(hit.at, hit.at + hit.len)
        const wrapped = found
            .split(/(\s*\n\s*)/)
            .map((part, i) => (i % 2 === 1 || !part ? part : `==${part}==`))
            .join('')
        text = text.slice(0, hit.at) + wrapped + text.slice(hit.at + hit.len)
    }
    return companionText.slice(0, r.from) + text + companionText.slice(r.to)
}

/** Unwrap those spans; every other byte is kept. A quote also matches consecutive spans whose
 *  inner texts, joined by single spaces, equal it. */
export function removeMarks(companionText: string, page: number, quotes: string[]): string {
    const r = pageRange(companionText, page)
    if (!r) return companionText
    let text = companionText.slice(r.from, r.to)
    for (const quote of quotes) {
        const spans = spansOf(text)
        let run: typeof spans | null = null
        const want = norm(quote)
        const single = spans.find(s => norm(s.inner) === want)
        if (single) run = [single]
        else {
            for (let i = 0; i < spans.length && !run; i++) {
                let acc = norm(spans[i].inner)
                for (let j = i + 1; j < spans.length; j++) {
                    if (!/^\s+$/.test(text.slice(spans[j - 1].to, spans[j].from))) break
                    acc += ` ${norm(spans[j].inner)}`
                    if (acc === want) {
                        run = spans.slice(i, j + 1)
                        break
                    }
                }
            }
        }
        if (!run) continue
        for (const s of [...run].reverse()) text = text.slice(0, s.from) + s.inner + text.slice(s.to)
    }
    return companionText.slice(0, r.from) + text + companionText.slice(r.to)
}

/** Lines whose box overlaps the region by at least 30% of the line's height (and touches it
 *  sideways), top to bottom. */
export function linesInRegion(
    lines: TextLine[],
    region: { x: number; y: number; w: number; h: number },
): string[] {
    return lines
        .filter(l => {
            const dy = Math.min(l.y + l.h, region.y + region.h) - Math.max(l.y, region.y)
            const dx = Math.min(l.x + l.w, region.x + region.w) - Math.max(l.x, region.x)
            return dx > 0 && dy >= 0.3 * l.h
        })
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map(l => l.text)
}
