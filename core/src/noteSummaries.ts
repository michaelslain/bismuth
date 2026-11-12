// core/src/noteSummaries.ts
// The note layer of the summary layers: one summary per vault note, written by the chat provider's
// backend, with a few points each tied to a passage of the note. A point's quote is located in the
// REAL text (locateQuote), so an invented quote is dropped and every point resolves to `path:line`.
// The day digests link down to notes and the notes link down to passages: the chain
// `bismuth ask` walks (askVault.ts).
//
// The store lives outside the vault (`~/.bismuth/cache/summaries/<sha1(vault)>.jsonl`), like the
// vault vectors, so writing it never trips the file watcher. One JSON line per note; a note is
// summarised again only when its content hash changes. Notes hidden from ai on either channel are
// never sent and never stored.
import { mkdir, mkdtemp, rename, rm, writeFile, appendFile } from 'node:fs/promises'
import { cpus, freemem, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BACKENDS } from './agentBackends/catalog'
import { resolveAiBackend } from './aiTranscribe'
import { AppError } from './error'
import { installedBackendIds } from './freeAgent'
import { runHeadlessTurn, type HeadlessTurn } from './chatProviders/headlessTurn'
import { locateQuote } from './searchPrompt'
import { MAX_AI_MATCHES } from './findAi'
import { contentHash, lineAt, loadSummaries, replyPathKey, summariesFile, type NoteSummary, type SummaryPoint } from './noteSummaryStore'

export { contentHash, hasSummaries, lineAt, loadSummaries, loadSummariesSync, summariesFile } from './noteSummaryStore'
export type { NoteSummary, SummaryPoint } from './noteSummaryStore'

/** Most note text one turn carries: a cost and latency knob, not a quality cutoff. */
export const TURN_CHARS = 100_000
/** Most notes one turn summarises, so a reply of every note's JSON line stays short. */
export const TURN_NOTES = 20
const TURN_TIMEOUT_MS = 300_000
/** Memory one headless backend process holds while it runs. */
const TURN_PROCESS_BYTES = 400 * 1024 * 1024

export function buildSummaryPrompt(notes: { path: string; text: string }[]): string {
    return [
        'Below are notes from a person\'s vault. Summarise each one for someone deciding whether to open it.',
        'For each note give:',
        '- "summary": one plain sentence saying what the note is about and what it concludes or holds (names, dates, numbers it turns on).',
        `- "points": at most ${MAX_AI_MATCHES} of its distinct parts, in note order, each {"text": "<what that part says, a short phrase>", "quote": "<a phrase copied EXACTLY from that part of the note, character for character, never more than one line>"}. A short note may have one point or none.`,
        'Reply with ONLY JSON lines, one per note, in the order given, no code fence, no commentary:',
        '{"path": "<the note path exactly as given>", "summary": "...", "points": [...]}',
        '',
        ...notes.map(n => `<note path="${n.path}">\n${n.text}\n</note>`),
    ].join('\n')
}

type RawSummary = { path: string; summary: string; points: { text: string; quote: string }[] }

/** The JSON lines of a reply to buildSummaryPrompt; malformed lines are dropped, never thrown. Pure. */
export function parseSummaryReply(reply: string): RawSummary[] {
    const out: RawSummary[] = []
    for (const raw of reply.split('\n')) {
        const start = raw.indexOf('{')
        const end = raw.lastIndexOf('}')
        if (start < 0 || end <= start) continue
        try {
            const v = JSON.parse(raw.slice(start, end + 1)) as { path?: unknown; summary?: unknown; points?: unknown }
            if (typeof v.path !== 'string' || typeof v.summary !== 'string' || !v.summary.trim()) continue
            const points = Array.isArray(v.points)
                ? v.points.flatMap(p => {
                      const q = p as { text?: unknown; quote?: unknown }
                      return typeof q.text === 'string' && typeof q.quote === 'string' && q.quote.trim()
                          ? [{ text: q.text.trim(), quote: q.quote.trim() }]
                          : []
                  })
                : []
            out.push({ path: v.path, summary: v.summary.trim(), points })
        } catch {
            // not JSON: skip
        }
    }
    return out
}

/** A parsed summary checked against the note it names: points whose quote is not in the text are
 *  dropped, and each kept point carries the line its quote starts on. Pure. */
export function anchorSummary(raw: RawSummary, text: string, extra: { hash: string; partial?: boolean }): NoteSummary {
    const points: SummaryPoint[] = []
    for (const p of raw.points) {
        const at = locateQuote(text, p.quote)
        if (!at || at.end <= at.start) continue
        points.push({ text: p.text, quote: text.slice(at.start, at.end), line: lineAt(text, at.start) })
        if (points.length >= MAX_AI_MATCHES) break
    }
    return { path: raw.path, hash: extra.hash, summary: raw.summary, points, ...(extra.partial ? { partial: true } : {}) }
}

/** Notes packed into turns: at most `TURN_NOTES` notes and `TURN_CHARS` characters each; a note
 *  longer than a turn goes alone, cut to `TURN_CHARS`. Pure. */
export function packTurns<T extends { text: string }>(notes: T[]): T[][] {
    const turns: T[][] = []
    let cur: T[] = []
    let size = 0
    for (const n of notes) {
        const len = Math.min(n.text.length, TURN_CHARS)
        if (cur.length && (size + len > TURN_CHARS || cur.length >= TURN_NOTES)) {
            turns.push(cur)
            cur = []
            size = 0
        }
        cur.push(n)
        size += len
    }
    if (cur.length) turns.push(cur)
    return turns
}

/** Turns run at once: one backend process each, bounded by free cores and free memory. */
export function turnConcurrency(): number {
    const byCpu = Math.max(1, Math.floor(cpus().length / 2))
    const byMem = Math.max(1, Math.floor(freemem() / TURN_PROCESS_BYTES))
    return Math.min(byCpu, byMem)
}

export type BuildSummariesOpts = {
    vault: string
    /** Vault-relative note paths to consider (already filtered by visibility). */
    paths: string[]
    readText: (path: string) => Promise<string>
    chatProvider?: unknown
    model?: string
    /** The model for the backend the chat provider resolves to, when `model` is not given (the
     *  daemon passes its fast tier). */
    modelFor?: (backend: string) => string | undefined
    /** Stop after summarising this many notes (the rest stay for the next build). */
    limit?: number
    concurrency?: number
    file?: string
    onProgress?: (p: { done: number; total: number; failed: number }) => void
}

export type BuildSummariesResult = { total: number; summarised: number; unchanged: number; failed: number; removed: number; backend: string }

/** Summarise every note whose text changed since its stored summary; drop summaries of notes no
 *  longer in `paths`. Each finished turn is appended at once, so a killed build keeps its work. */
export async function buildSummaries(
    o: BuildSummariesOpts,
    deps: { installed?: () => readonly string[]; runTurn?: (turn: HeadlessTurn) => Promise<string> } = {},
): Promise<BuildSummariesResult> {
    const installed = deps.installed ?? (() => installedBackendIds())
    const id = resolveAiBackend({ provider: 'auto' }, o.chatProvider, installed)
    if (!installed().includes(id)) {
        throw new AppError('AI_UNAVAILABLE', `${BACKENDS[id].label} is not installed on this machine`, 503)
    }
    const model = o.model ?? o.modelFor?.(id)
    const file = o.file ?? summariesFile(o.vault)
    const stored = await loadSummaries(o.vault, file)
    const keep = new Set(o.paths)
    const removed = [...stored.keys()].filter(p => !keep.has(p)).length
    const todo: { path: string; text: string; hash: string }[] = []
    let unchanged = 0
    for (const path of o.paths) {
        let text: string
        try {
            text = await o.readText(path)
        } catch {
            continue
        }
        if (!text.trim()) continue
        const hash = contentHash(text)
        if (stored.get(path)?.hash === hash) {
            unchanged++
            continue
        }
        todo.push({ path, text, hash })
    }
    const chosen = o.limit !== undefined ? todo.slice(0, o.limit) : todo
    const turns = packTurns(chosen)
    const run = deps.runTurn ?? runHeadlessTurn
    await mkdir(dirname(file), { recursive: true })
    let done = 0
    let failed = 0
    let next = 0
    const fresh = new Map<string, NoteSummary>()
    const worker = async () => {
        while (next < turns.length) {
            const batch = turns[next++]!
            const dir = await mkdtemp(join(tmpdir(), 'bismuth-summary-'))
            try {
                const sent = batch.map(n => ({ path: n.path, text: n.text.slice(0, TURN_CHARS) }))
                const reply = await run({
                    backend: id,
                    cwd: dir,
                    text: buildSummaryPrompt(sent),
                    timeoutMs: TURN_TIMEOUT_MS,
                    ...(model ? { model } : {}),
                })
                const byPath = new Map(parseSummaryReply(reply).map(r => [replyPathKey(r.path), r]))
                const lines: string[] = []
                for (const n of batch) {
                    const found = byPath.get(replyPathKey(n.path))
                    const raw = found && { ...found, path: n.path }
                    if (!raw) {
                        failed++
                        continue
                    }
                    const s = anchorSummary(raw, n.text, { hash: n.hash, partial: n.text.length > TURN_CHARS })
                    fresh.set(n.path, s)
                    lines.push(JSON.stringify(s))
                    done++
                }
                if (lines.length) await appendFile(file, lines.join('\n') + '\n')
            } catch {
                failed += batch.length
            } finally {
                await rm(dir, { recursive: true, force: true })
            }
            o.onProgress?.({ done, total: chosen.length, failed })
        }
    }
    await Promise.all(Array.from({ length: Math.min(turns.length, o.concurrency ?? turnConcurrency()) }, worker))
    // Compact: one line per note still in the vault, newest summary wins.
    const merged = new Map([...(await loadSummaries(o.vault, file))].filter(([p]) => keep.has(p)))
    for (const [p, s] of fresh) merged.set(p, s)
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, [...merged.values()].map(s => JSON.stringify(s)).join('\n') + (merged.size ? '\n' : ''))
    await rename(tmp, file)
    return { total: o.paths.length, summarised: done, unchanged, failed, removed, backend: id }
}

/** The notes a summary may be written for: every markdown note visible to ai on BOTH channels
 *  (chat and daemon), since either kind of agent reads the summary. */
export async function summaryPaths(vault: string): Promise<string[]> {
    const { listMarkdown } = await import('./files')
    const { buildDenyPaths, isDeniedPath } = await import('./visibility')
    const [chat, daemon] = await Promise.all([buildDenyPaths(vault, 'chat'), buildDenyPaths(vault, 'daemon')])
    const deny = [...chat, ...daemon]
    return (await listMarkdown(vault)).filter(p => !isDeniedPath(deny, p)).sort()
}
