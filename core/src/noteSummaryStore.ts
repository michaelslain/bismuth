// core/src/noteSummaryStore.ts
// Reading the note summaries store (noteSummaries.ts writes it): one JSON line per vault note under
// `~/.bismuth/cache/summaries/<sha1(vault)>.jsonl`, the last line for a path winning. Kept apart from
// the writer so the embedder's chunk headers (vaultEmbed.ts) read it without pulling in a backend.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { bismuthHome } from './bismuthHome'

export type SummaryPoint = { text: string; line: number; quote: string }
export type NoteSummary = {
    path: string
    /** sha1 of the note's file text when it was summarised. */
    hash: string
    summary: string
    points: SummaryPoint[]
    /** The note was longer than one turn takes: the summary covers its first `TURN_CHARS` (noteSummaries.ts). */
    partial?: boolean
}

export const summariesFile = (vault: string, home: (...p: string[]) => string = bismuthHome): string =>
    home('cache', 'summaries', `${createHash('sha1').update(vault).digest('hex')}.jsonl`)

export const contentHash = (text: string): string => createHash('sha1').update(text).digest('hex')

/** The 1-based line `offset` sits on. Pure. */
export const lineAt = (text: string, offset: number): number => {
    let n = 1
    for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
    return n
}

function parseLines(raw: string): Map<string, NoteSummary> {
    const out = new Map<string, NoteSummary>()
    for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
            const v = JSON.parse(line) as NoteSummary
            if (typeof v.path === 'string' && typeof v.summary === 'string' && Array.isArray(v.points)) out.set(v.path, v)
        } catch {
            // a torn last line from a killed build: skip it
        }
    }
    return out
}

/** Every stored summary by vault-relative path; the last line for a path wins. Empty when none. */
export async function loadSummaries(vault: string, file = summariesFile(vault)): Promise<Map<string, NoteSummary>> {
    try {
        return parseLines(await readFile(file, 'utf-8'))
    } catch {
        return new Map()
    }
}

/** The same, read synchronously: the embedder builds chunk headers inside a synchronous step. */
export function loadSummariesSync(vault: string, file = summariesFile(vault)): Map<string, NoteSummary> {
    try {
        return existsSync(file) ? parseLines(readFileSync(file, 'utf-8')) : new Map()
    } catch {
        return new Map()
    }
}

export const hasSummaries = (vault: string, file = summariesFile(vault)): boolean => existsSync(file)

/** A path as a model may echo it back: compatibility-normalised (a narrow no-break space becomes a
 *  space), curly quotes made straight, runs of space collapsed, case folded. Two paths with one key
 *  name the same note for a reply's purposes. Pure. */
export const replyPathKey = (path: string): string =>
    path
        .normalize('NFKC')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
