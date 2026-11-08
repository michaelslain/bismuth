// app/src/bases/transcriptLocate.ts
// Where a piece of a page's text sits on the page image: pure matching between a quote typed or
// selected in the transcript and the OCR lines (page fractions) that produced it.
import type { TextLine } from '../../../core/src/visionOcr'
import type { LocateBox } from './LocateLayer'

// Markdown and math punctuation the transcript adds around words: never part of what the page shows.
const NOISE = /[$=*_`#>~\\{}]/g
const norm = (t: string): string => t.replace(NOISE, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

/** The line boxes a quote covers on one page (whitespace-, case- and markdown-insensitive match; the first occurrence wins). */
export function boxesForQuote(lines: TextLine[], quote: string): LocateBox[] {
    const q = norm(quote)
    if (!q) return []
    const ordered = [...lines].sort((a, b) => a.y - b.y || a.x - b.x)
    let hay = ''
    const owner: number[] = []
    ordered.forEach((l, i) => {
        const n = norm(l.text)
        if (!n) return
        if (hay) {
            hay += ' '
            owner.push(-1)
        }
        for (let k = 0; k < n.length; k++) owner.push(i)
        hay += n
    })
    const at = hay.indexOf(q)
    if (at < 0) return []
    const hit = new Set<number>()
    for (let k = at; k < at + q.length; k++) if (owner[k] >= 0) hit.add(owner[k])
    return [...hit].sort((a, b) => a - b).map(i => ({ x: ordered[i].x, y: ordered[i].y, w: ordered[i].w, h: ordered[i].h }))
}

/** The line under a point (page fractions), or undefined. */
export function lineAtPoint(lines: TextLine[], x: number, y: number): TextLine | undefined {
    return lines.find(l => x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h)
}
