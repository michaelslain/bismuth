// core/src/transcriptChecks.ts
// Which lines of a fresh transcript a person should look at: `unsure` (yellow) lines may hold a
// wrong word, `garbled` (red) lines are mostly wrong or unread. Each engine says it differently:
// on-device lines carry Apple Vision's confidence and a spell-check count, the ai reader marks its own
// guesses and unreadable words, and the math reader says nothing per line. Pure string work, no node
// imports.
import type { TranscriptCheck } from './transcript'

/** A line as checks compare it: `==marks==` and surrounding or repeated spaces do not count. */
export const checkKey = (line: string): string => line.replaceAll('==', '').trim().replace(/\s+/g, ' ')

/** The checks that still apply to `text`: a line check while a line with its text is there, a
 *  whole-page check while the page has no text. Anything else was fixed or retyped. */
export function liveChecks(text: string, checks: TranscriptCheck[] | undefined): TranscriptCheck[] {
    if (!checks?.length) return []
    const lines = new Set(text.split('\n').map(checkKey).filter(Boolean))
    const blank = text.trim() === ''
    return checks.filter(c => (c.line === '' ? blank : lines.has(checkKey(c.line))))
}

/** Which line of `lines` (0-based) each line check sits on: the first line with its text that no
 *  earlier check took. A check whose text is on no line is left out; so is a whole-page check. */
export function placeChecks(lines: string[], checks: TranscriptCheck[] | undefined): { index: number; check: TranscriptCheck }[] {
    const keys = lines.map(checkKey)
    const taken = new Set<number>()
    const out: { index: number; check: TranscriptCheck }[] = []
    for (const check of checks ?? []) {
        if (check.line === '') continue
        const key = checkKey(check.line)
        const index = keys.findIndex((k, i) => k === key && !taken.has(i))
        if (index < 0) continue
        taken.add(index)
        out.push({ index, check })
    }
    return out.sort((a, b) => a.index - b.index)
}

/** One on-device line as the vision helper reports it. */
export type ScoredLine = { text: string; confidence?: number; misspelled?: number }

// The on-device rule, fit 2026-11-07 on 2,379 lines from a real vault: 946 handwritten notebook lines
// (reference: the notebook's ai transcript) and 1,433 printed lines from lecture slides, a numerical
// analysis textbook and homework sheets (reference: each pdf's own text layer). A line counts as
// wrong when one of its words is not in the reference, garbled when half or more are not. Each
// cut-off was picked from a grid by F1 on the training pages and checked on held-out pages (later
// notebook pages, later decks and chapters): flagging `unsure` scored F1 0.76 against 0.57 for
// confidence alone; held-out `garbled` lines were 84% garbled, lines left unflagged 23%.
// Vision reports only three confidences on these pages (0.3, 0.5, 1), so the confidence cut sits
// between 0.5 and 1.
/** At or below this confidence a line is garbled. */
export const GARBLED_CONFIDENCE = 0.5
/** This many misspelled words make a line garbled. */
export const GARBLED_MISSPELLED = 3
/** This share of misspelled words makes a line garbled. */
export const GARBLED_MISSPELLED_SHARE = 0.2
/** This many misspelled words make a line unsure. */
export const UNSURE_MISSPELLED = 1

/** The words of a line as the rule counts them: letters and digits, case and accents folded. */
export const wordsOf = (t: string): string[] =>
    t
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\[\?\]/g, ' ')
        .replace(/'/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)

/** The level the fitted rule gives one on-device line, or undefined when it reads as fine. */
export function onDeviceLevel(line: ScoredLine): TranscriptCheck['level'] | undefined {
    const n = wordsOf(line.text).length
    if (n === 0) return undefined
    const bad = line.misspelled ?? 0
    if (line.confidence !== undefined && line.confidence <= GARBLED_CONFIDENCE) return 'garbled'
    if (bad >= GARBLED_MISSPELLED || bad / n >= GARBLED_MISSPELLED_SHARE) return 'garbled'
    if (bad >= UNSURE_MISSPELLED) return 'unsure'
    return undefined
}

/** The checks for an on-device page, one per flagged line, in line order. */
export function onDeviceChecks(lines: ScoredLine[] | undefined): TranscriptCheck[] {
    const out: TranscriptCheck[] = []
    for (const l of lines ?? []) {
        const level = onDeviceLevel(l)
        if (level && l.text.trim()) out.push({ line: l.text.trim(), level })
    }
    return out
}

/** `[?]` alone is a word the ai reader could not read; `word[?]` is a word it guessed. */
const UNREAD = /(^|\s)\[\?\]/
const GUESS = /(\S)\[\?\]/g

/** The ai reader's page with its guess marks taken out, and a check per line that had one: garbled
 *  where a word could not be read at all (its `[?]` stays in the text), unsure where it guessed. */
export function aiChecks(text: string): { text: string; checks: TranscriptCheck[] } {
    const checks: TranscriptCheck[] = []
    const lines = text.split('\n').map(line => {
        const unread = UNREAD.test(line)
        const guessed = /\S\[\?\]/.test(line)
        const clean = line.replace(GUESS, '$1')
        if (clean.trim() && (unread || guessed)) checks.push({ line: clean.trim(), level: unread ? 'garbled' : 'unsure' })
        return clean
    })
    return { text: lines.join('\n'), checks }
}

/** The math reader's page: a whole-page garbled check when it returned nothing for a page the
 *  on-device reader found lines on. */
export function emptyPageChecks(text: string, onDeviceLines: number): TranscriptCheck[] {
    return text.trim() === '' && onDeviceLines > 0 ? [{ line: '', level: 'garbled' }] : []
}
