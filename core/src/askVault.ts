// core/src/askVault.ts
// `bismuth ask`: answer a question that spans many notes or a stretch of time by walking the summary
// layers top down. Digests for any time the question names (and the memory notes that match it), then
// the vault notes those digests link to and the notes vault search finds, each with its summary
// (noteSummaries.ts). One headless turn on the chat provider's backend reads them and answers, naming
// the passages it rests on; each passage is located in the REAL text (locateQuote), so an invented
// citation is dropped and every source printed is `path:line` of a span that exists.
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { MemoryNote } from '@bismuth/memory'
import { BACKENDS } from './agentBackends/catalog'
import { resolveAiBackend } from './aiTranscribe'
import { AppError } from './error'
import { installedBackendIds } from './freeAgent'
import { runHeadlessTurn, type HeadlessTurn } from './chatProviders/headlessTurn'
import { locateQuote } from './searchPrompt'
import { MAX_FIND_TEXT } from './findAi'
import { lineAt, loadSummaries, replyPathKey } from './noteSummaryStore'

/** Where a document sits in the layers: a day/week/month digest, another memory note, a vault note. */
export type AskLayer = 'digest' | 'memory' | 'note'
export type AskDoc = { path: string; layer: AskLayer; text: string; summary?: string }
/** A document as sent: whole text while the budget holds, then its summary alone. */
export type SentDoc = { path: string; layer: AskLayer; text?: string; summary?: string }
export type AskSource = { path: string; line: number; text: string }
export type AskResult = { answer: string; sources: AskSource[]; backend: string; read: { path: string; layer: AskLayer; whole: boolean }[] }

const ASK_TIMEOUT_MS = 300_000
/** Most sources one answer prints. */
export const MAX_ASK_SOURCES = 10

/** Documents in order, each whole while the running total stays within `budget` characters; past it,
 *  a document with a summary goes as its summary alone and one without is left out. Pure. */
export function packDocs(docs: AskDoc[], budget = MAX_FIND_TEXT): SentDoc[] {
    const out: SentDoc[] = []
    let used = 0
    for (const d of docs) {
        if (used + d.text.length <= budget) {
            used += d.text.length
            out.push({ path: d.path, layer: d.layer, text: d.text, ...(d.summary ? { summary: d.summary } : {}) })
        } else if (d.summary && used + d.summary.length <= budget) {
            used += d.summary.length
            out.push({ path: d.path, layer: d.layer, summary: d.summary })
        }
    }
    return out
}

const LAYER_WORD: Record<AskLayer, string> = { digest: 'digest', memory: 'memory', note: 'note' }

export function buildAskVaultPrompt(question: string, docs: SentDoc[]): string {
    return [
        "A person asked a question about their vault that may span many notes or a stretch of time. Below are documents from it, top layer first:",
        '- digest: a day, week or month summary written from their notes and chats; it links down to the notes it names.',
        '- memory: a fact an assistant kept about them, linked to its source.',
        '- note: one of their notes, with its one-line summary; some are given as the summary alone.',
        'Answer from these documents alone, in plain text (no markdown headings), as long as the question needs and no longer. Gather across all of them: an aggregate question ("what have I…", "every time…", "how often…") wants every relevant document counted, not the first.',
        "If they do not say, answer that the vault doesn't say.",
        `Then give at most ${MAX_ASK_SOURCES} passages the answer rests on, best first, each {"path": "<the document path exactly as given>", "quote": "<a phrase copied EXACTLY from that document's text, character for character, never more than one line>"}. Quote only documents whose text is given.`,
        'Reply with ONLY a JSON object, no code fence: {"answer": "<the answer>", "sources": [...]}',
        '',
        `Question: ${question}`,
        '',
        ...docs.map(d =>
            [
                `<document path="${d.path}" layer="${LAYER_WORD[d.layer]}">`,
                ...(d.summary ? [`summary: ${d.summary}`] : []),
                ...(d.text !== undefined ? [d.text] : ['(text not included; summary only)']),
                '</document>',
            ].join('\n'),
        ),
    ].join('\n')
}

/** The answer and cited passages of a reply; a reply that is not the JSON asked for is the answer
 *  whole, with no sources. Pure. */
export function parseAskVaultReply(reply: string): { answer: string; sources: { path: string; quote: string }[] } {
    const start = reply.indexOf('{')
    const end = reply.lastIndexOf('}')
    if (start >= 0 && end > start) {
        try {
            const v = JSON.parse(reply.slice(start, end + 1)) as { answer?: unknown; sources?: unknown }
            if (typeof v.answer === 'string') {
                const sources = Array.isArray(v.sources)
                    ? v.sources.flatMap(s => {
                          const q = s as { path?: unknown; quote?: unknown }
                          return typeof q.path === 'string' && typeof q.quote === 'string' && q.quote.trim()
                              ? [{ path: q.path, quote: q.quote.trim() }]
                              : []
                      })
                    : []
                return { answer: v.answer.trim(), sources }
            }
        } catch {
            // not JSON: fall through
        }
    }
    return { answer: reply.trim(), sources: [] }
}

/** Cited passages located in the text that was sent: unknown paths, quotes not in the text and
 *  repeats are dropped. Pure. */
export function locateSources(sources: { path: string; quote: string }[], docs: SentDoc[]): AskSource[] {
    const byPath = new Map(docs.filter(d => d.text !== undefined).map(d => [replyPathKey(d.path), d]))
    const out: AskSource[] = []
    const seen = new Set<string>()
    for (const s of sources) {
        const doc = byPath.get(replyPathKey(s.path))
        if (!doc) continue
        const text = doc.text!
        const at = locateQuote(text, s.quote)
        if (!at || at.end <= at.start) continue
        const line = lineAt(text, at.start)
        const key = `${doc.path}:${line}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ path: doc.path, line, text: text.slice(at.start, at.end) })
        if (out.length >= MAX_ASK_SOURCES) break
    }
    return out
}

/** Link targets of a memory note resolved to vault note paths: `[[Name]]` → the note whose file is
 *  `Name.md` (shortest path first, as the editor resolves it), `[[folder/Name]]` → that path. Pure. */
export function resolveLinkedNotes(links: string[], vaultPaths: string[]): string[] {
    const byBase = new Map<string, string[]>()
    for (const p of vaultPaths) {
        const base = (p.split('/').pop() ?? p).replace(/\.md$/i, '').toLowerCase()
        const list = byBase.get(base) ?? []
        list.push(p)
        byBase.set(base, list)
    }
    const all = new Set(vaultPaths)
    const out: string[] = []
    for (const raw of links) {
        const name = raw.split('|')[0]!.split('#')[0]!.trim()
        if (!name) continue
        const direct = name.toLowerCase().endsWith('.md') ? name : `${name}.md`
        const hit = all.has(direct) ? direct : byBase.get(name.toLowerCase())?.sort((a, b) => a.length - b.length)[0]
        if (hit && !out.includes(hit)) out.push(hit)
    }
    return out
}

/** The memory notes a question reaches, top layer first: digests for every time range it names, then
 *  the memory notes that match it. Pure of the disk; the caller loads and filters the notes. */
export function memoryLayer(
    question: string,
    notes: MemoryNote[],
    api: {
        now: Date
        timeRefs: (text: string, now: Date) => { start: string; end: string }[]
        digestsCovering: (notes: MemoryNote[], start: string, end: string) => MemoryNote[]
        isDigest: (n: MemoryNote) => boolean
        matches: MemoryNote[]
    },
): { note: MemoryNote; layer: AskLayer }[] {
    const out: { note: MemoryNote; layer: AskLayer }[] = []
    const seen = new Set<string>()
    const add = (n: MemoryNote, layer: AskLayer) => {
        if (seen.has(n.name)) return
        seen.add(n.name)
        out.push({ note: n, layer })
    }
    for (const r of api.timeRefs(question, api.now)) for (const d of api.digestsCovering(notes, r.start, r.end)) add(d, 'digest')
    for (const m of api.matches) add(m, api.isDigest(m) ? 'digest' : 'memory')
    return out
}

export async function askVault(
    req: { question: string; docs: AskDoc[]; chatProvider?: unknown; model?: string },
    deps: { installed?: () => readonly string[]; runTurn?: (turn: HeadlessTurn) => Promise<string> } = {},
): Promise<AskResult> {
    const question = req.question.trim()
    if (!question) throw new AppError('BAD_REQUEST', 'empty question', 400)
    const installed = deps.installed ?? (() => installedBackendIds())
    const id = resolveAiBackend({ provider: 'auto' }, req.chatProvider, installed)
    if (!installed().includes(id)) {
        throw new AppError('AI_UNAVAILABLE', `${BACKENDS[id].label} is not installed on this machine`, 503)
    }
    const sent = packDocs(req.docs)
    const read = sent.map(d => ({ path: d.path, layer: d.layer, whole: d.text !== undefined }))
    if (!sent.length) return { answer: "The vault doesn't say: nothing in it matched the question.", sources: [], backend: id, read }
    const run = deps.runTurn ?? runHeadlessTurn
    const dir = await mkdtemp(join(tmpdir(), 'bismuth-ask-'))
    try {
        const reply = await run({
            backend: id,
            cwd: dir,
            text: buildAskVaultPrompt(question, sent),
            timeoutMs: ASK_TIMEOUT_MS,
            ...(req.model ? { model: req.model } : {}),
        })
        const { answer, sources } = parseAskVaultReply(reply)
        return { answer, sources: locateSources(sources, sent), backend: id, read }
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}

/** Every document `ask` sends, top layer first: the memory layer (digests, then matching memory
 *  notes; each as its file's text so a cited line is the file's line), the search hits (a PDF or
 *  image hit by its companion note), then the vault notes the memory layer links to. Each carries
 *  its stored summary. `allowed` is the caller's visibility gate; a note it refuses is never read. */
export async function gatherAskDocs(o: {
    vault: string
    question: string
    now: Date
    memoryDir: string | null
    /** Vault-relative paths vault search found, best first. */
    hits: string[]
    allowed: (path: string) => boolean
}): Promise<AskDoc[]> {
    const mem = await import('@bismuth/memory')
    const { readNote } = await import('./files')
    const { summaryPaths } = await import('./noteSummaries')
    const summaries = await loadSummaries(o.vault)
    const vaultPaths = (await summaryPaths(o.vault).catch(() => [] as string[])).filter(o.allowed)
    const docs: AskDoc[] = []
    const seen = new Set<string>()
    const push = async (path: string, layer: AskLayer) => {
        if (seen.has(path)) return
        seen.add(path)
        try {
            const text = await readNote(o.vault, path)
            const summary = summaries.get(path)?.summary
            docs.push({ path, layer, text, ...(summary ? { summary } : {}) })
        } catch {
            // a note gone since the index saw it
        }
    }
    const linked: string[] = []
    if (o.memoryDir) {
        const notes = (await mem.loadAllNotes(o.memoryDir).catch(() => [] as MemoryNote[])).filter(mem.isMemoryNoteVisibleToDaemon)
        const visible = new Set(notes.map(n => n.name))
        const matches = (await mem.searchMemory(o.question, o.memoryDir).catch(() => [] as MemoryNote[])).filter(n => visible.has(n.name))
        const layer = memoryLayer(o.question, notes, {
            now: o.now,
            timeRefs: mem.timeRefs,
            digestsCovering: mem.digestsCovering,
            isDigest: mem.isDigestNote,
            matches,
        })
        for (const { note, layer: l } of layer) {
            await push(relative(o.vault, mem.memoryNotePath(note.name, o.memoryDir)), l)
            linked.push(...resolveLinkedNotes(note.backlinks, vaultPaths))
        }
    }
    for (const h of o.hits) {
        const path = h.endsWith('.md') ? h : `${h}.md`
        if (o.allowed(path) && (path === h || existsSync(join(o.vault, path)))) await push(path, 'note')
    }
    for (const p of linked) await push(p, 'note')
    return docs
}
