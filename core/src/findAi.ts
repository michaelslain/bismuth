// core/src/findAi.ts
// Ask ai about one note: one headless turn on the chat provider's backend over the note's text.
// A search (`bismuth find`) gets back the passages it most likely means; a question (`ask`, the find
// bar's Enter on `no results ↵ ask`, `bismuth find --ask`) gets back an answer drawn from the note AND
// the passages that answer is about, in the same turn, so the find bar marks them as the answer shows.
// Each passage is located in the REAL text (locateQuote: exact, then case, then whitespace-normalized),
// so a passage the model invented is dropped and every range returned is a span of the note. The turn
// runs in an empty temp dir and asks for no tools.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BACKENDS } from './agentBackends/catalog'
import { resolveAiBackend } from './aiTranscribe'
import { AppError } from './error'
import { installedBackendIds } from './freeAgent'
import { runHeadlessTurn, type HeadlessTurn } from './chatProviders/headlessTurn'
import { locateQuote } from './searchPrompt'

/** Most passages one search returns. */
export const MAX_AI_MATCHES = 5
/** Longest note text sent; a longer note is refused rather than cut, so no passage is missed silently. */
export const MAX_FIND_TEXT = 400_000
const FIND_TIMEOUT_MS = 90_000
const NONE = 'NONE'

export type FindAiMatch = { from: number; to: number; text: string }
/** `answer` only for a question (`ask`): the reply drawn from the note, plain text. */
export type FindAiResult = { matches: FindAiMatch[]; backend: string; answer?: string }

const COPY_RULE =
    'Copy each passage EXACTLY as it appears in the document, character for character, a phrase or a sentence long, never more than one line of the document.'

export function buildFindPrompt(query: string, text: string): string {
    return [
        'A person pressed find in the document below and typed a search that matches no text in it literally.',
        'Find the passages they are most likely looking for: the same meaning, a paraphrase, a misspelling, a synonym, or the part that answers their question.',
        `Reply with at most ${MAX_AI_MATCHES} passages, best first, one per line.`,
        COPY_RULE,
        'No numbering, no quotes around it, no commentary.',
        `If nothing in the document fits, reply with the single word ${NONE}.`,
        '',
        `Search: ${query}`,
        '',
        '<document>',
        text,
        '</document>',
    ].join('\n')
}

/** The prompt for a question: answer from the document alone, and name the passages the answer rests on. */
export function buildAskPrompt(question: string, text: string): string {
    return [
        'A person reading the document below asked a question about it.',
        'Answer from the document alone, in one to three short sentences of plain text (no markdown), using its own words where you can.',
        "If the document does not say, answer that it doesn't say.",
        `Then give at most ${MAX_AI_MATCHES} passages of the document the answer rests on, best first.`,
        COPY_RULE,
        'Reply with ONLY a JSON object, no code fence: {"answer": "<the answer>", "passages": ["<passage>", ...]}',
        '',
        `Question: ${question}`,
        '',
        '<document>',
        text,
        '</document>',
    ].join('\n')
}

/** The answer and passages of a reply to buildAskPrompt. A reply that is not the JSON asked for is
 *  taken whole as the answer, with no passages. */
export function parseAskReply(reply: string): { answer: string; passages: string[] } {
    const start = reply.indexOf('{')
    const end = reply.lastIndexOf('}')
    if (start >= 0 && end > start) {
        try {
            const v = JSON.parse(reply.slice(start, end + 1)) as { answer?: unknown; passages?: unknown }
            if (typeof v.answer === 'string') {
                const passages = Array.isArray(v.passages)
                    ? v.passages.filter((p): p is string => typeof p === 'string' && !!p.trim()).map(p => p.trim())
                    : []
                return { answer: v.answer.trim(), passages }
            }
        } catch {
            // not JSON: fall through
        }
    }
    return { answer: reply.trim(), passages: [] }
}

/** The passages in a reply: one per non-empty line, list markers and wrapping quotes stripped. */
export function parseFindReply(reply: string): string[] {
    const out: string[] = []
    for (const raw of reply.split('\n')) {
        let line = raw.trim()
        if (!line || line === NONE || line.startsWith('```')) continue
        line = line.replace(/^(?:[-*•]|\d+[.)])\s+/, '')
        const q = line.match(/^["'“‘`](.*)["'”’`]$/)
        if (q) line = q[1]
        line = line.trim()
        if (line) out.push(line)
    }
    return out
}

/** Each passage's range in `text`, in reply order, without misses and duplicates. */
export function locatePassages(text: string, passages: string[]): FindAiMatch[] {
    const out: FindAiMatch[] = []
    for (const p of passages) {
        const at = locateQuote(text, p)
        if (!at || at.end <= at.start) continue
        if (out.some(m => m.from < at.end && at.start < m.to)) continue
        out.push({ from: at.start, to: at.end, text: text.slice(at.start, at.end) })
        if (out.length >= MAX_AI_MATCHES) break
    }
    return out
}

export async function findAi(
    req: { query: string; text: string; ask?: boolean; chatProvider?: unknown },
    deps: {
        installed?: () => readonly string[]
        runTurn?: (turn: HeadlessTurn) => Promise<string>
    } = {},
): Promise<FindAiResult> {
    const query = req.query.trim()
    if (!query) throw new AppError('BAD_REQUEST', 'empty search', 400)
    if (req.text.length > MAX_FIND_TEXT) {
        throw new AppError('TOO_LARGE', 'this note is too long to ask ai about', 413)
    }
    const installed = deps.installed ?? (() => installedBackendIds())
    const id = resolveAiBackend({ provider: 'auto' }, req.chatProvider, installed)
    const label = BACKENDS[id].label
    if (!installed().includes(id)) {
        throw new AppError('AI_UNAVAILABLE', `${label} is not installed on this machine`, 503)
    }
    if (!req.text.trim()) {
        return req.ask ? { matches: [], backend: id, answer: 'This note is empty.' } : { matches: [], backend: id }
    }
    const run = deps.runTurn ?? runHeadlessTurn
    const dir = await mkdtemp(join(tmpdir(), 'bismuth-find-'))
    try {
        const reply = await run({
            backend: id,
            cwd: dir,
            text: req.ask ? buildAskPrompt(query, req.text) : buildFindPrompt(query, req.text),
            timeoutMs: FIND_TIMEOUT_MS,
        })
        if (req.ask) {
            const { answer, passages } = parseAskReply(reply)
            return { matches: locatePassages(req.text, passages), backend: id, answer }
        }
        return { matches: locatePassages(req.text, parseFindReply(reply)), backend: id }
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}
