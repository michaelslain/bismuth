import { existsSync, readFileSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { parse } from 'yaml'
import * as mem from '@bismuth/memory'
import type {
    MemoryNote,
    Packed,
    RankedNote,
    RecallIndex,
    RecallMode,
    TranscriptEntry,
} from '@bismuth/memory'
import { sharedSemanticChannel } from './memoryEmbed'
import { SETTINGS_FILE, readDaemonEnabledSync } from './settings'

/** The recall service: ONE long-lived owner of ranking, packing and the per-session dedup ledger,
 *  shared by `POST /memory/recall` (relay hooks), the visual chat and opencode. Core is long-lived,
 *  so the index and the ledger stay warm between calls and `.settings` is read live per request. */

export type Embedder = {
    embed(texts: string[]): Promise<Float32Array[]>
    dispose(): void
}

export type RecallToolCall = {
    tool_name: string
    tool_input: unknown
    tool_response?: unknown
}

export type RecallRequest = {
    mode: RecallMode
    sessionId: string
    agentId?: string
    prompt?: string
    transcriptPath?: string
    toolCalls?: RecallToolCall[]
    /** SessionStart source: startup | resume | clear | compact */
    source?: string
    /** Aborted when the caller gave up (hook timeout, dropped fetch). An aborted recall still runs
     *  but never commits to the dedup ledger, since the model never saw what it packed. */
    signal?: AbortSignal
}

export type RecallResponse = {
    context: string | null
    injected: string[]
    reason?: 'disabled' | 'mid-turn-off' | 'no-memory' | 'no-match'
    /** True when the semantic channel contributed scores to this ranking. */
    semantic?: true
}

export type RecallSettings = {
    enabled: boolean
    midTurn: boolean
    semantic: boolean
}

/** The `@bismuth/memory` functions the service calls. Injectable so tests can use simple fakes. */
export type RecallEngine = Pick<
    typeof mem,
    | 'buildRecallIndex'
    | 'rankNotes'
    | 'formatSessionStart'
    | 'noteHash'
    | 'contextFromTranscript'
    | 'queryFromToolCalls'
    | 'lastAgentPrompt'
> & {
    /** The tiered tool-batch query (`queryFromToolCalls` is its flat form). Optional so a minimal
     *  engine can omit it; recall then ranks the flat string as the primary. */
    toolQuery?: typeof mem.toolQuery
    /** Every Agent/Task tool_use in order, with its id. Optional: absent = `lastAgentPrompt`. */
    agentPrompts?: typeof mem.agentPrompts
    /** widened locally: the optional 4th arg makes excerpts carry an absolute path */
    packRecall: (
        ranked: RankedNote[],
        mode: Parameters<typeof mem.packRecall>[1],
        exclude?: Set<string>,
        opts?: { dir?: string },
    ) => Packed
}

export type RecallDeps = {
    /** null = daemon off */
    memoryDir: () => string | null
    /** read live per request */
    settings: () => RecallSettings
    /** null = lexical only */
    embedder: () => Embedder | null
    now?: () => number
    /** Test seams; the defaults are the real `@bismuth/memory` functions. */
    engine?: RecallEngine
    loadNotes?: (dir: string) => Promise<MemoryNote[]>
    readTranscript?: (path: string) => Promise<TranscriptEntry[]>
    /** Cosine scores per note name for a query, from the embedder. Supplied by the vector store
     *  (Task 8); absent = no semantic channel even when an embedder exists. */
    semanticScores?: (
        embedder: Embedder,
        query: string,
        notes: MemoryNote[],
        memoryDir: string,
    ) => Promise<Map<string, number> | undefined>
    /** Called when a recall arrives with `semantic` off: stops background re-embedding. */
    semanticOff?: () => void
}

const LEDGER_IDLE_MS = 6 * 60 * 60 * 1000
const TRANSCRIPT_TAIL_BYTES = 256 * 1024

export const RECALL_SETTINGS_DEFAULTS: RecallSettings = {
    enabled: true,
    midTurn: true,
    semantic: true,
}

/** `daemon.recall` from the vault's `.settings`, merged over the defaults. Sync + tolerant: a
 *  missing, corrupt or partial file reads as the defaults, and it never throws. */
export function readRecallSettingsSync(vault: string): RecallSettings {
    try {
        const full = join(vault, SETTINGS_FILE)
        if (!existsSync(full)) return { ...RECALL_SETTINGS_DEFAULTS }
        const parsed = parse(readFileSync(full, 'utf8')) as {
            daemon?: { recall?: Record<string, unknown> }
        } | null
        const recall = parsed?.daemon?.recall
        const pick = (k: keyof RecallSettings) =>
            typeof recall?.[k] === 'boolean'
                ? (recall[k] as boolean)
                : RECALL_SETTINGS_DEFAULTS[k]
        return {
            enabled: pick('enabled'),
            midTurn: pick('midTurn'),
            semantic: pick('semantic'),
        }
    } catch {
        return { ...RECALL_SETTINGS_DEFAULTS }
    }
}

/** Last ~256KB of a Claude Code transcript JSONL as entries; unreadable or non-jsonl = []. */
async function readTranscriptTail(path: string): Promise<TranscriptEntry[]> {
    if (!isAbsolute(path) || !path.endsWith('.jsonl')) return []
    try {
        const fh = await open(path, 'r')
        try {
            const { size } = await fh.stat()
            const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES)
            const buf = Buffer.alloc(size - start)
            await fh.read(buf, 0, buf.length, start)
            const lines = buf.toString('utf8').split('\n')
            if (start > 0) lines.shift() // first line is cut mid-record
            const out: TranscriptEntry[] = []
            for (const line of lines) {
                if (!line.trim()) continue
                try {
                    out.push(JSON.parse(line) as TranscriptEntry)
                } catch {
                    /* torn line */
                }
            }
            return out
        } finally {
            await fh.close()
        }
    } catch {
        return []
    }
}

type LedgerEntry = { lastSeen: number; injected: Map<string, string> }

export function createRecallService(deps: RecallDeps): {
    recall(req: RecallRequest): Promise<RecallResponse>
    reset(sessionId: string): void
} {
    const now = deps.now ?? Date.now
    const engine = (): RecallEngine => deps.engine ?? mem
    // `@bismuth/memory` exports no stat-keyed loader, so the service keeps its own: a note file is
    // re-read only when its (mtimeMs, size) changed, and an unchanged one returns the SAME object.
    const fileCache = new Map<
        string,
        Map<string, { mtimeMs: number; size: number; note: MemoryNote }>
    >()
    const loadCached = async (dir: string): Promise<MemoryNote[]> => {
        const refs = await mem.listNotes(dir)
        const cache = fileCache.get(dir) ?? new Map()
        fileCache.set(dir, cache)
        const loaded = await Promise.all(
            refs.map(async ref => {
                const parsed = mem.parseNoteRef(ref)
                let st
                try {
                    st = await stat(
                        mem.memoryNotePath(parsed.name, dir, parsed.folder),
                    )
                } catch {
                    cache.delete(ref)
                    return null
                }
                const hit = cache.get(ref)
                if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size)
                    return hit.note
                const note = await mem.readNote(parsed.name, dir, parsed.folder)
                if (!note) {
                    cache.delete(ref)
                    return null
                }
                cache.set(ref, { mtimeMs: st.mtimeMs, size: st.size, note })
                return note
            }),
        )
        return loaded.filter(
            (n): n is MemoryNote =>
                n !== null && mem.isMemoryNoteVisibleToDaemon(n),
        )
    }
    const loadNotes = deps.loadNotes ?? loadCached
    const readTranscript = deps.readTranscript ?? readTranscriptTail

    const ledgers = new Map<string, LedgerEntry>()
    const keyOf = (sessionId: string, agentId?: string) =>
        `${sessionId}|${agentId ?? ''}`

    // One index per memory dir, rebuilt only when the loaded notes are not the same objects as last
    // time. `loadAllNotesCached` hands back the cached object for any file whose mtime + size are
    // unchanged, so identity IS the mtime/size check, and an unchanged graph is never re-read.
    const indexes = new Map<
        string,
        { notes: MemoryNote[]; index: RecallIndex }
    >()
    const indexFor = (dir: string, notes: MemoryNote[]): RecallIndex => {
        const hit = indexes.get(dir)
        if (
            hit &&
            hit.notes.length === notes.length &&
            hit.notes.every((n, i) => n === notes[i])
        )
            return hit.index
        const index = engine().buildRecallIndex(notes)
        indexes.set(dir, { notes, index })
        return index
    }

    const sweep = (t: number) => {
        for (const [k, v] of ledgers)
            if (t - v.lastSeen > LEDGER_IDLE_MS) ledgers.delete(k)
        for (const [k, v] of claims)
            if (t - v.lastSeen > LEDGER_IDLE_MS) claims.delete(k)
    }

    const reset = (sessionId: string) => {
        const prefix = `${sessionId}|`
        for (const k of ledgers.keys())
            if (k.startsWith(prefix)) ledgers.delete(k)
    }

    // Agent tool_use ids already handed to a subagent, per parent session.
    const claims = new Map<string, { lastSeen: number; ids: Set<string> }>()
    const claimsFor = (sessionId: string, t: number): Set<string> => {
        const c = claims.get(sessionId) ?? { lastSeen: t, ids: new Set<string>() }
        c.lastSeen = t
        claims.set(sessionId, c)
        return c.ids
    }

    const none = (reason: RecallResponse['reason']): RecallResponse => ({
        context: null,
        injected: [],
        reason,
    })

    async function recall(req: RecallRequest): Promise<RecallResponse> {
        // Compaction and /clear drop the injected text from the model's context, so the ledger that
        // says "already shown" is wrong from then on, whether or not recall is currently on.
        if (
            req.mode === 'session-start' &&
            (req.source === 'compact' || req.source === 'clear')
        )
            reset(req.sessionId)
        const settings = deps.settings()
        if (!settings.enabled) return none('disabled')
        if (req.mode === 'tool' && !settings.midTurn)
            return none('mid-turn-off')
        const dir = deps.memoryDir()
        if (!dir) return none('no-memory')

        const t = now()
        sweep(t)

        const notes = await loadNotes(dir)
        if (!notes.length) return none('no-memory')

        if (req.mode === 'session-start') {
            const context = engine().formatSessionStart(notes)
            return context ? { context, injected: [] } : none('no-match')
        }

        const eng = engine()
        const entries = req.transcriptPath
            ? await readTranscript(req.transcriptPath)
            : []
        let primary = ''
        let context: string | undefined
        let location: string | undefined
        if (req.mode === 'tool') {
            const calls = req.toolCalls ?? []
            const q = eng.toolQuery
                ? eng.toolQuery(calls)
                : { primary: eng.queryFromToolCalls(calls), context: '', location: '' }
            primary = q.primary
            location = q.location || undefined
            // What the calls returned, then what the session was about.
            context =
                [q.context, entries.length ? eng.contextFromTranscript(entries) : '']
                    .filter(Boolean)
                    .join('\n') || undefined
        } else if (req.mode === 'subagent') {
            // Parallel dispatch puts N Agent tool_uses in one assistant message and N SubagentStarts
            // follow: each takes the earliest one no sibling has claimed yet.
            const prompts = eng.agentPrompts ? eng.agentPrompts(entries) : []
            const claimed = claimsFor(req.sessionId, t)
            const next = prompts.find(p => !claimed.has(p.id))
            if (next) claimed.add(next.id)
            primary =
                next?.prompt ??
                req.prompt ??
                (entries.length ? eng.lastAgentPrompt(entries) : null) ??
                ''
        } else {
            primary = req.prompt ?? ''
            if (entries.length) context = eng.contextFromTranscript(entries)
        }
        if (!primary.trim() && !context?.trim() && !location?.trim()) return none('no-match')

        let semantic: Map<string, number> | undefined
        if (settings.semantic) {
            const embedder = deps.embedder()
            if (embedder && deps.semanticScores)
                semantic = await deps
                    .semanticScores(
                        embedder,
                        mem.semanticQueryText({ primary, context, location }),
                        notes,
                        dir,
                    )
                    .catch(() => undefined)
        } else deps.semanticOff?.()

        const ranked: RankedNote[] = eng.rankNotes(
            indexFor(dir, notes),
            { primary, ...(context ? { context } : {}), ...(location ? { location } : {}) },
            mem.rankOptions(req.mode, semantic),
        )

        const key = keyOf(req.sessionId, req.agentId)
        const ledger = ledgers.get(key) ?? {
            lastSeen: t,
            injected: new Map<string, string>(),
        }
        // A note already shown with this exact content is skipped; a changed hash counts as new.
        const exclude = new Set<string>()
        for (const n of notes)
            if (ledger.injected.get(n.name) === eng.noteHash(n))
                exclude.add(n.name)

        const packed: Packed = eng.packRecall(ranked, req.mode, exclude, {
            dir,
        })
        // `semantic: true` says the semantic channel scored this request, matched or not.
        if (!packed.text)
            return semantic && semantic.size > 0
                ? { ...none('no-match'), semantic: true }
                : none('no-match')

        // The caller gave up on this recall, so the model never saw these notes: leave the ledger be.
        if (req.signal?.aborted) return none('no-match')
        for (const i of packed.injected) ledger.injected.set(i.name, i.hash)
        ledger.lastSeen = t
        ledgers.set(key, ledger)
        return {
            context: packed.text,
            injected: packed.injected.map(i => i.name),
            ...(semantic && semantic.size > 0 ? { semantic: true as const } : {}),
        }
    }

    return {
        recall: req => recall(req).catch(() => none('no-match')),
        reset,
    }
}

const shared = new Map<string, ReturnType<typeof createRecallService>>()

/** The process-wide service for a vault, so the route and the in-process chat surfaces share one
 *  ledger. Settings and the daemon gate are read live from the vault's `.settings`; pass
 *  `memoryDir` only when a caller already holds the resolved dir (chat, opencode). */
export function recallServiceFor(
    vault: string,
    memoryDir?: string,
): ReturnType<typeof createRecallService> {
    const key = `${vault}|${memoryDir ?? ''}`
    let svc = shared.get(key)
    if (!svc) {
        svc = createRecallService({
            memoryDir: () =>
                memoryDir ??
                (readDaemonEnabledSync(vault)
                    ? join(vault, '.daemon', 'memory')
                    : null),
            settings: () => readRecallSettingsSync(vault),
            // Lazy: nothing loads until a semantic query actually runs (see memoryEmbed.ts).
            embedder: () => sharedSemanticChannel().embedder(),
            semanticScores: (e, q, n, d) => sharedSemanticChannel().semanticScores(e, q, n, d),
            semanticOff: () => sharedSemanticChannel().pause(),
        })
        shared.set(key, svc)
    }
    return svc
}

/** Race a recall against a budget; on timeout resolve to "inject nothing". The timer is cleared as
 *  soon as the recall settles so it never holds the event loop. Two forms:
 *  - `recallWithin(service, request, ms)` owns an AbortController, hands its signal to the request
 *    and aborts it on timeout, so a late recall cannot commit its notes to the dedup ledger.
 *  - `recallWithin(promise, ms, abort?)` races an already-started recall; pass the controller whose
 *    signal the request carries to get the same guarantee. */
export function recallWithin(
    svc: { recall(req: RecallRequest): Promise<RecallResponse> },
    req: RecallRequest,
    ms: number,
): Promise<RecallResponse>
export function recallWithin(
    p: Promise<RecallResponse>,
    ms: number,
    abort?: AbortController,
): Promise<RecallResponse>
export function recallWithin(
    a: Promise<RecallResponse> | { recall(req: RecallRequest): Promise<RecallResponse> },
    b: RecallRequest | number,
    c?: number | AbortController,
): Promise<RecallResponse> {
    let p: Promise<RecallResponse>
    let ms: number
    let abort: AbortController | undefined
    if (typeof b === 'number') {
        p = a as Promise<RecallResponse>
        ms = b
        abort = c as AbortController | undefined
    } else {
        abort = new AbortController()
        const outer = b.signal
        if (outer) {
            if (outer.aborted) abort.abort()
            else outer.addEventListener('abort', () => abort!.abort(), { once: true })
        }
        p = (a as { recall(req: RecallRequest): Promise<RecallResponse> }).recall({
            ...b,
            signal: abort.signal,
        })
        ms = c as number
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<RecallResponse>(r => {
        timer = setTimeout(() => {
            abort?.abort()
            r({ context: null, injected: [], reason: 'no-match' })
        }, ms)
    })
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}
