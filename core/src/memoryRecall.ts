import { existsSync, readFileSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
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
import { composeBrain } from './brain'
import type { BrainOpts } from './brain'
import { QUERY_PREFIX, QUERY_TIMEOUT_MS, sharedSemanticChannel } from './memoryEmbed'
import { neighbourNames, notesAbout } from './memoryLinkBoost'
import { RERANK_TIMEOUT_MS, sharedReranker } from './memoryRerank'
import type { Reranker } from './memoryRerank'
import { readEmbeddingsEnabledSync, readRecallSourcesSync } from './embeddingsSetting'
import type { RecallSourceSwitches } from './embeddingsSetting'
import { sourceKey } from './semanticSources'
import type { SourceHit, SourceQuery } from './semanticSources'
import { packSources, sourceSection } from './sourcePack'
import { SOURCE_K, backgroundOf, gateAccepts, gateProbability, loadGateModel } from './sourceGate'
import type { GateFeatures, GateModel, GateTraceRow } from './sourceGate'
import { hasTimeRefs, timeRecall } from './timeRecall'
import type { TimeApi, TimeRecallResult } from './timeRecall'
import { resolveDenyPlan } from './visibility'
import type { DenyPlan } from './visibility'
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
    /** Whose view the session-start brain block composes. Absent means `daemon`, the stricter one
     *  (fails closed); in-process chat callers and the route (for a chat-channel request) set `chat`. */
    channel?: 'chat' | 'daemon'
    /** Aborted when the caller gave up (hook timeout, dropped fetch). An aborted recall still runs
     *  but never commits to the dedup ledger, since the model never saw what it packed. */
    signal?: AbortSignal
}

export type RecallResponse = {
    context: string | null
    injected: string[]
    reason?: 'disabled' | 'mid-turn-off' | 'no-memory' | 'no-match' | 'turn-budget'
    /** True when the semantic channel contributed scores to this ranking. */
    semantic?: true
    /** True when the cross-encoder gate decided this request (injected or refused). */
    reranked?: true
    /** The source hits injected beside memory, as `sourceKey` (`kind:id`), in block order. */
    sources?: string[]
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
        opts?: { dir?: string; semantic?: boolean },
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
    /** The cross-encoder behind the relevance gate (prompt + subagent only). null/absent = today's
     *  rules; a rejection or a slower answer than `rerankTimeoutMs` falls back the same way. */
    reranker?: () => Reranker | null
    rerankTimeoutMs?: number
    /** Called when a recall arrives with `semantic` off: stops background re-embedding. */
    semanticOff?: () => void
    /** The vault root: lets the link boost turn absolute tool file paths into vault paths, and
     *  session-start compose the brain. Absent = no link boost from tool paths, and session-start
     *  falls back to the memory index alone. */
    vault?: string
    /** The session-start block (vault map + profile + memory index). Defaults to `composeBrain`. */
    brain?: (opts: BrainOpts) => Promise<string | null>
    /** Candidates from the vault-file, past-chat and docs sources for a query vector the service
     *  embedded once (prompt + subagent only). Absent = no sources. */
    sources?: (q: SourceQuery & { switches: RecallSourceSwitches }) => Promise<SourceHit[]>
    /** Past chats for a time-worded prompt (visibility-gated like `sources`' chats). Absent = digests only. */
    timeChats?: (q: SourceQuery) => Promise<SourceHit[]>
    /** Test seam for time routing; defaults to `@bismuth/memory`'s `timeRefs` and `digestsCovering`. */
    time?: TimeApi
    /** The learned source gate; defaults to the committed `sourceGateModel.json`, which fails closed. */
    gateModel?: GateModel
    /** Receives every candidate the gate scored, accepted or not, once per gate run. The bench fits on it. */
    gateTrace?: (rows: GateTraceRow[]) => void
}

/** Memory notes injected because they link a note the user has open or a tool just touched. */
const LINK_BOOST_CAP = { prompt: 2, subagent: 2, tool: 1 } as const
const ABOUT_MARK = ' (about the open note)'
const POINTER_TITLE = 'Also related notes (not included; read the file if needed):'
const POINTER_DESC_MAX = 120

const LEDGER_IDLE_MS = 6 * 60 * 60 * 1000
const TRANSCRIPT_TAIL_BYTES = 256 * 1024

export const RECALL_SETTINGS_DEFAULTS: RecallSettings = {
    enabled: false,
    midTurn: false,
    semantic: false,
}

/** `daemon.recall` from the vault's `.settings`, merged over the defaults; `semantic` is the
 *  vault's `embeddings.enabled` switch. Sync + tolerant: a
 *  missing, corrupt or partial file reads as the defaults, and it never throws. */
export function readRecallSettingsSync(vault: string): RecallSettings {
    try {
        const full = join(vault, SETTINGS_FILE)
        if (!existsSync(full)) return { ...RECALL_SETTINGS_DEFAULTS }
        const parsed = parse(readFileSync(full, 'utf8')) as {
            daemon?: { recall?: Record<string, unknown> }
        } | null
        const recall = parsed?.daemon?.recall
        const pick = (k: 'enabled' | 'midTurn') =>
            typeof recall?.[k] === 'boolean'
                ? (recall[k] as boolean)
                : RECALL_SETTINGS_DEFAULTS[k]
        return {
            enabled: pick('enabled'),
            midTurn: pick('midTurn'),
            semantic: readEmbeddingsEnabledSync(vault),
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

/** Rerank the top candidates (at the mode's lexical floor, ledger exclusions applied) against the
 *  prompt and gate them. null = no verdict (no reranker, too slow, rejected, bad shape): the caller
 *  keeps today's rules. A late answer is left to finish in the background. */
async function rerankGate(
    ranked: RankedNote[],
    mode: 'prompt' | 'subagent',
    query: string,
    exclude: Set<string>,
    reranker: Reranker | null,
    timeoutMs: number,
): Promise<RankedNote[] | null> {
    if (!reranker) return null
    try {
        // the reranker only runs when semantics scored the request, so candidates clear the same bar the semantic path packs at; a note under it is a word or tag hit the cross-encoder should not get a chance to admit
        const floor = mem.PACK_LIMITS[mode].semanticMinScore ?? mem.PACK_LIMITS[mode].minScore
        const candidates = ranked
            .filter(r => r.score >= floor && !exclude.has(r.note.name))
            .slice(0, mem.RERANK_CANDIDATES)
        if (!candidates.length) return null
        const perNote = mem.PACK_LIMITS[mode].perNoteChars
        const passages = candidates.map(r => mem.excerptText(r, perNote))
        const work = reranker.rerank(query, passages)
        work.catch(() => {})
        let timer: ReturnType<typeof setTimeout> | undefined
        const late = new Promise<undefined>(res => {
            timer = setTimeout(() => res(undefined), timeoutMs)
        })
        let logits: number[] | undefined
        try {
            logits = await Promise.race([work, late])
        } finally {
            clearTimeout(timer)
        }
        if (!logits || logits.length !== candidates.length) return null
        return mem.gateByRerank(candidates, logits)
    } catch {
        return null
    }
}

/** With embeddings on, the semantic or gated pack plus every note the keyword-only path packs for
 *  the same request (`keyword`, in its pack order). The semantic path's own picks keep their order
 *  and the keyword picks it dropped follow them; when the two together overrun the mode's
 *  `maxNotes` or char budget, the semantic path's own picks give way from the tail, never a keyword
 *  pick. `list` is what the semantic path packed from and `floor` the score it packed at: a keyword
 *  pick is lifted to it, since a hybrid score and a keyword-only score sit on different bars. */
function withKeywordPicks(
    packed: Packed,
    list: RankedNote[],
    keyword: RankedNote[],
    floor: number,
    maxNotes: number,
    pack: (list: RankedNote[]) => Packed,
): Packed {
    const picked = new Set(packed.injected.map(i => i.name))
    const missing = keyword.filter(r => !picked.has(r.note.name))
    if (!missing.length) return packed
    const keywordNames = new Set(keyword.map(r => r.note.name))
    const byName = new Map(list.map(r => [r.note.name, r]))
    const own = packed.injected
        .map(i => byName.get(i.name))
        .filter((r): r is RankedNote => !!r)
    const dropOwn = (): boolean => {
        for (let i = own.length - 1; i >= 0; i--)
            if (!keywordNames.has(own[i]!.note.name)) {
                own.splice(i, 1)
                return true
            }
        return false
    }
    while (own.length + missing.length > maxNotes && dropOwn()) {}
    const lift = (r: RankedNote): RankedNote => ({ ...r, score: Math.max(r.score, floor) })
    for (;;) {
        const chosen = [...own, ...missing].map(lift)
        const chosenNames = new Set(chosen.map(r => r.note.name))
        const out = pack([...chosen, ...list.filter(r => !chosenNames.has(r.note.name))])
        const got = new Set(out.injected.map(i => i.name))
        if (keyword.every(r => got.has(r.note.name)) || !dropOwn()) return out
    }
}

/** A vault-relative path for `p`, or null when it is outside the vault (or relative and escaping). */
function vaultRelative(p: string, vault: string | undefined): string | null {
    if (!p) return null
    if (isAbsolute(p)) {
        if (!vault) return null
        const rel = relative(vault, p)
        return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : null
    }
    const clean = p.replace(/^\.\//, '')
    return clean.startsWith('..') ? null : clean
}

/** Vault paths named in a prompt's `<editor-context>` block (Active file, Open tabs, ...). Read
 *  before the block is stripped. `chat.ts` imports this module, so it is loaded lazily. */
async function editorContextVaultPaths(text: string, vault: string | undefined): Promise<string[]> {
    if (!text.includes('<editor-context>')) return []
    const { extractEditorContextPaths } = await import('./chat')
    return extractEditorContextPaths(text)
        .map(p => vaultRelative(p, vault))
        .filter((p): p is string => !!p)
}

/** Vault paths a tool batch read or edited: `file_path`-style string inputs inside the vault. */
function toolVaultPaths(calls: RecallToolCall[], vault: string | undefined): string[] {
    const out: string[] = []
    for (const c of calls) {
        const input = c.tool_input
        if (!input || typeof input !== 'object') continue
        for (const k of ['file_path', 'path', 'notebook_path']) {
            const v = (input as Record<string, unknown>)[k]
            const rel = typeof v === 'string' ? vaultRelative(v, vault) : null
            if (rel) out.push(rel)
        }
    }
    return [...new Set(out)]
}

/** Tag the excerpt headers of link-boosted notes. Left unmarked if the marks would push the block
 *  over its budget. */
function markBoosted(text: string, boosted: MemoryNote[], budget: number): string {
    let out = text
    for (const n of boosted) {
        const header = `## ${n.name} (${n.frontmatter.type}) [${n.frontmatter.tags.join(', ')}]`
        out = out.replace(header, () => header + ABOUT_MARK)
    }
    return out.length <= budget ? out : text
}

/** Put 1-hop wikilink neighbours of the injected notes (visible, unsent) first in the "Also
 *  related" pointer lines, then the ranked pointers the packer already chose. */
function preferNeighbourPointers(
    text: string,
    notes: MemoryNote[],
    injected: string[],
    exclude: Set<string>,
    limits: { pointers: number; budgetChars: number },
): string {
    const byName = new Map(notes.map(n => [n.name, n]))
    const near = neighbourNames(notes, injected).filter(n => !exclude.has(n) && byName.has(n))
    if (!near.length) return text
    const close = `</${mem.MEMORY_BLOCK_TAG}>`
    const closeAt = text.lastIndexOf(close)
    if (closeAt < 0) return text
    let head = text.slice(0, closeAt)
    const kept: string[] = []
    // the packer's own list is the LAST title with only pointer lines after it; an excerpt can quote the title
    const titleAt = head.lastIndexOf(POINTER_TITLE)
    if (titleAt >= 0) {
        const after = head.slice(titleAt + POINTER_TITLE.length).split('\n')
        if (after.every(l => !l.trim() || l.startsWith('- [['))) {
            kept.push(...after.filter(l => l.startsWith('- [[')))
            head = head.slice(0, titleAt)
        }
    }
    const defang = (t: string) =>
        t.replace(new RegExp(`<(/?)${mem.MEMORY_BLOCK_TAG}>`, 'g'), '[$1' + mem.MEMORY_BLOCK_TAG + ']')
    const lineFor = (n: MemoryNote) => {
        const d = mem.noteDescription(n)
        const cut = d.length > POINTER_DESC_MAX ? `${d.slice(0, POINTER_DESC_MAX - 1).trimEnd()}…` : d
        return defang(`- [[${n.name}]] (${n.frontmatter.type})${cut ? ` — ${cut}` : ''}`)
    }
    const nearLines = near.map(n => lineFor(byName.get(n)!))
    const nearSet = new Set(near)
    const rest = kept.filter(l => !nearSet.has(l.match(/^- \[\[(.+?)\]\]/)?.[1] ?? ''))
    const lines: string[] = []
    let cost = head.length + POINTER_TITLE.length + 2 + close.length
    for (const l of [...nearLines, ...rest]) {
        if (lines.length >= limits.pointers || cost + l.length + 1 > limits.budgetChars) break
        lines.push(l)
        cost += l.length + 1
    }
    if (!lines.length) return text
    return `${head}${POINTER_TITLE}\n${lines.join('\n')}\n\n${close}`
}

/** Candidates per source the cross-encoder reads and the gate scores. Bounds cost only: 15 passages
 *  rerank in about 130 ms; what is injected among them is the gate's decision. */
export const SOURCE_CANDIDATES = 5

const withTimeout = async <T>(p: Promise<T>, ms: number): Promise<T | undefined> => {
    p.catch(() => {})
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<undefined>(res => {
        timer = setTimeout(() => res(undefined), ms)
    })
    try {
        return await Promise.race([p, late])
    } finally {
        clearTimeout(timer)
    }
}

/** What the reranker reads a source hit as: its title, if any, over its best excerpt. */
export function sourcePassage(h: SourceHit): string {
    return h.title ? `${h.title}\n${h.excerpt}` : h.excerpt
}

const kindOfHit = (h: SourceHit): GateFeatures['kind'] => ({ files: 'file', chats: 'chat', docs: 'docs' } as const)[sourceSection(h)]

/** The source hits worth injecting for a query. Each source's best `SOURCE_CANDIDATES` by cosine are
 *  read by the cross-encoder and scored by the learned gate (`core/src/sourceGate.ts`), which alone
 *  decides; hits already in the session's ledger are dropped after scoring so ranks stay stable.
 *  No reranker, no embedder, a slow source or any failure = no hits (a source hit is semantic-only
 *  evidence, never injected without the second check). Never rejects. */
async function gatherSources(a: {
    sources: NonNullable<RecallDeps['sources']>
    switches: RecallSourceSwitches
    embedder: Embedder | null
    reranker: Reranker | null
    queryText: string
    rerankText: string
    promptChars: number
    channel: 'chat' | 'daemon'
    sessionId: string
    sent: Map<string, string>
    timeoutMs: number
    gate: GateModel
    trace?: (rows: GateTraceRow[]) => void
}): Promise<SourceHit[]> {
    try {
        if (!a.embedder || !a.reranker) return []
        const deadline = Date.now() + a.timeoutMs
        const left = () => Math.max(0, deadline - Date.now())
        const vec = (await withTimeout(a.embedder.embed([QUERY_PREFIX + a.queryText]), QUERY_TIMEOUT_MS))?.[0]
        if (!vec) return []
        const all = await withTimeout(
            a.sources({
                vec,
                k: SOURCE_K,
                channel: a.channel,
                excludeSessionId: a.sessionId,
                switches: a.switches,
            }),
            left(),
        )
        if (!all?.length) return []
        const groups = { files: [] as SourceHit[], chats: [] as SourceHit[], docs: [] as SourceHit[] }
        for (const h of all) groups[sourceSection(h)].push(h)
        const cands: { hit: SourceHit; rank: number; background: number }[] = []
        for (const key of Object.keys(groups) as (keyof typeof groups)[]) {
            const hits = groups[key].sort((x, y) => y.score - x.score)
            const background = backgroundOf(hits)
            hits.slice(0, SOURCE_CANDIDATES).forEach((hit, rank) => cands.push({ hit, rank, background }))
        }
        if (!cands.length) return []
        const logits = await withTimeout(a.reranker.rerank(a.rerankText, cands.map(c => sourcePassage(c.hit))), left())
        if (!logits || logits.length !== cands.length) return []
        const rows: GateTraceRow[] = cands.map((c, i) => {
            const features: GateFeatures = {
                cosine: c.hit.score,
                background: c.background,
                rank: c.rank,
                rerank: Number.isFinite(logits[i]) ? logits[i]! : null,
                kind: kindOfHit(c.hit),
                inRange: false,
                promptChars: a.promptChars,
            }
            return { key: sourceKey(c.hit), path: 'ordinary', features, probability: gateProbability(features, a.gate), accepted: gateAccepts(features, a.gate) }
        })
        a.trace?.(rows)
        return cands
            .filter((c, i) => rows[i]!.accepted && a.sent.get(sourceKey(c.hit)) !== c.hit.hash)
            .map(c => c.hit)
            .sort((x, y) => y.score - x.score)
    } catch {
        return []
    }
}

/** `toolBatches`: tool batches that injected since this key's last prompt (or subagent start). */
type LedgerEntry = { lastSeen: number; injected: Map<string, string>; toolBatches: number }

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
        // sources can answer a prompt even when memory has nothing
        const sourcesOn =
            !!deps.sources &&
            settings.semantic &&
            (req.mode === 'prompt' || req.mode === 'subagent')
        // an empty memory dir still has a vault map to hand a new session
        if (!notes.length && !(req.mode === 'session-start' && deps.vault) && !sourcesOn)
            return none('no-memory')

        if (req.mode === 'session-start') {
            // The brain block (vault map + profile + memory index); without a vault, or if composing
            // it fails or comes back empty, the memory index alone.
            let context: string | null = null
            if (deps.vault)
                context = await (deps.brain ?? composeBrain)({
                    vaultDir: deps.vault,
                    memoryDir: dir,
                    channel: req.channel ?? 'daemon',
                }).catch(() => null)
            if (!context && notes.length) context = engine().formatSessionStart(notes)
            return context ? { context, injected: [] } : none(notes.length ? 'no-match' : 'no-memory')
        }

        const key = keyOf(req.sessionId, req.agentId)
        const ledger = ledgers.get(key) ?? {
            lastSeen: t,
            injected: new Map<string, string>(),
            toolBatches: 0,
        }
        // A new prompt opens a new turn, whatever this recall goes on to inject.
        if (req.mode !== 'tool') ledger.toolBatches = 0
        const perTurn = mem.PACK_LIMITS.tool.maxBatchesPerTurn
        if (req.mode === 'tool' && perTurn !== undefined && ledger.toolBatches >= perTurn) {
            ledger.lastSeen = t
            ledgers.set(key, ledger)
            return none('turn-budget')
        }
        if (req.mode !== 'tool') ledgers.set(key, ledger)

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
            // The app prepends an <editor-context> block to every chat prompt; ranked raw, its pane
            // name outweighs a short question.
            primary = mem.stripInjectedBlocks(req.prompt ?? '')
            if (entries.length) context = eng.contextFromTranscript(entries)
        }
        const vaultPaths =
            req.mode === 'tool'
                ? toolVaultPaths(req.toolCalls ?? [], deps.vault)
                : await editorContextVaultPaths(
                      req.mode === 'prompt' ? (req.prompt ?? '') : primary,
                      deps.vault,
                  )
        const hasQuery = !!(primary.trim() || context?.trim() || location?.trim())
        if (!hasQuery && !vaultPaths.length) return none('no-match')

        // Sources start now and run beside the memory pipeline; they are read after the memory pack.
        const sourcesP: Promise<SourceHit[]> =
            sourcesOn && primary.trim()
                ? gatherSources({
                      sources: deps.sources!,
                      switches: deps.vault
                          ? readRecallSourcesSync(deps.vault)
                          : { files: true, chats: true, docs: true },
                      embedder: deps.embedder(),
                      reranker: deps.reranker?.() ?? null,
                      queryText: mem.semanticQueryText({ primary, context, location }),
                      rerankText: mem.rerankQuery({ primary, ...(context ? { context } : {}) }),
                      promptChars: primary.length,
                      gate: deps.gateModel ?? loadGateModel(),
                      ...(deps.gateTrace ? { trace: deps.gateTrace } : {}),
                      channel: req.channel ?? 'daemon',
                      sessionId: req.sessionId,
                      sent: ledger.injected,
                      timeoutMs: deps.rerankTimeoutMs ?? RERANK_TIMEOUT_MS,
                  })
                : Promise.resolve([])

        // A prompt that names a time also gets the digests covering it and the chats dated in it.
        // It starts now, beside the memory pipeline, and learns what the ordinary path injected
        // through `settle` before it filters; a late or failed lookup adds nothing.
        let settle: (v: { skipNames: Set<string>; skipKeys: Set<string>; budgetChars: number }) => void = () => {}
        const settled = new Promise<{ skipNames: Set<string>; skipKeys: Set<string>; budgetChars: number }>(res => {
            settle = res
        })
        const timedP: Promise<TimeRecallResult | null> =
            (req.mode === 'prompt' || req.mode === 'subagent') && primary.trim() && hasTimeRefs(primary, new Date(t), deps.time)
                ? (async () => {
                          const embedder = deps.embedder()
                          const vec =
                              settings.semantic && embedder && deps.timeChats
                                  ? (await withTimeout(embedder.embed([QUERY_PREFIX + mem.semanticQueryText({ primary, context, location })]), QUERY_TIMEOUT_MS))?.[0]
                                  : undefined
                          return timeRecall(
                              {
                                  vault: deps.vault ?? '',
                                  memoryDir: dir,
                                  prompt: primary,
                                  now: new Date(t),
                                  channel: req.channel ?? 'daemon',
                                  sessionId: req.sessionId,
                                  vec: vec ? Array.from(vec) : null,
                                  sent: ledger.injected,
                                  settled,
                              },
                              {
                                  loadNotes,
                                  ...(deps.timeChats ? { chatHits: q => deps.timeChats!(q) } : {}),
                                  gate: deps.gateModel ?? loadGateModel(),
                                  ...(deps.gateTrace ? { trace: deps.gateTrace } : {}),
                                  ...(deps.time ? { time: deps.time } : {}),
                              },
                          )
                  })()
                      .then(r => r ?? null)
                      .catch(() => null)
                : Promise.resolve(null)
        // the deadline runs from here, not from `settled`: a slow ordinary path must not eat the time path's budget
        const timeDeadline = Date.now() + (deps.rerankTimeoutMs ?? RERANK_TIMEOUT_MS)

        let semantic: Map<string, number> | undefined
        if (settings.semantic) {
            const embedder = deps.embedder()
            if (hasQuery && notes.length && embedder && deps.semanticScores)
                semantic = await deps
                    .semanticScores(
                        embedder,
                        mem.semanticQueryText({ primary, context, location }),
                        notes,
                        dir,
                    )
                    .catch(() => undefined)
        } else deps.semanticOff?.()

        const query = { primary, ...(context ? { context } : {}), ...(location ? { location } : {}) }
        const ranked: RankedNote[] = hasQuery && notes.length
            ? eng.rankNotes(indexFor(dir, notes), query, mem.rankOptions(req.mode, semantic))
            : []

        // A note already shown with this exact content is skipped; a changed hash counts as new.
        const exclude = new Set<string>()
        for (const n of notes)
            if (ledger.injected.get(n.name) === eng.noteHash(n))
                exclude.add(n.name)

        // Memory notes that link a note the user has open (or a tool just touched) go first, even
        // without a word match; the ledger still skips what was already sent.
        const boosted = notesAbout(notes, vaultPaths)
            .filter(n => !exclude.has(n.name))
            .filter(n => !mem.isDigestNote(n) && !mem.isNowNote(n))
            .slice(0, LINK_BOOST_CAP[req.mode])
        const boostedNames = new Set(boosted.map(n => n.name))
        const withBoost = (list: RankedNote[], pool: RankedNote[] = ranked): RankedNote[] =>
            boosted.length
                ? [
                      ...boosted.map(note => {
                          const hit = list.find(r => r.note.name === note.name) ?? pool.find(r => r.note.name === note.name)
                          return { lexical: 0, ...hit, note, score: Math.max(hit?.score ?? 0, 1) }
                      }),
                      ...list.filter(r => !boostedNames.has(r.note.name)),
                  ]
                : list

        const scored = !!semantic && semantic.size > 0
        // The relevance gate: with the semantic channel in hand, a cross-encoder reads the top
        // candidates against the prompt and the weak ones are refused. Any failure = today's rules.
        let gated: RankedNote[] | null = null
        if (hasQuery && scored && (req.mode === 'prompt' || req.mode === 'subagent') && primary.trim())
            gated = await rerankGate(
                ranked,
                req.mode,
                mem.rerankQuery({ primary, ...(context ? { context } : {}) }),
                exclude,
                deps.reranker?.() ?? null,
                deps.rerankTimeoutMs ?? RERANK_TIMEOUT_MS,
            )

        const gatedList = gated ? withBoost(gated) : null
        // the gate replaced the stricter semantic floor, and its order is the pack order
        const onList = gatedList ?? withBoost(ranked)
        const onSemantic = gatedList ? false : scored
        const mode = req.mode
        const packOn = (list: RankedNote[]): Packed =>
            eng.packRecall(list, mode, exclude, { dir, semantic: onSemantic })
        let packed: Packed =
            gatedList && !gatedList.length ? { text: null, injected: [] } : packOn(onList)
        // Embeddings on never recall less than off: what the keyword-only path (ranked with no
        // semantic map, packed as the off service packs) injects for this request is kept, whatever
        // the semantic path or the gate decided about it.
        if (scored && hasQuery) {
            const lexical = eng.rankNotes(indexFor(dir, notes), query, mem.rankOptions(req.mode))
            const keywordList = withBoost(lexical, lexical)
            const keywordPack = eng.packRecall(keywordList, req.mode, exclude, { dir, semantic: false })
            const byName = new Map(keywordList.map(r => [r.note.name, r]))
            const keyword = keywordPack.injected
                .map(i => byName.get(i.name))
                .filter((r): r is RankedNote => !!r)
            const limits = mem.PACK_LIMITS[req.mode]
            const floor = (onSemantic && limits.semanticMinScore) || limits.minScore
            packed = withKeywordPicks(packed, onList, keyword, floor, limits.maxNotes, packOn)
        }
        const sourceHits = await sourcesP
        const limits = mem.PACK_LIMITS[req.mode]
        settle({
            skipNames: new Set(packed.injected.map(i => i.name)),
            skipKeys: new Set(sourceHits.map(sourceKey)),
            budgetChars: Math.max(0, limits.budgetChars - (packed.text ?? '').length),
        })
        const timed = (await withTimeout(timedP, Math.max(0, timeDeadline - Date.now()))) ?? null
        // `semantic: true` says the semantic channel scored this request, matched or not.
        if (!packed.text && !sourceHits.length && !timed)
            return {
                ...none(notes.length ? 'no-match' : 'no-memory'),
                ...(scored ? { semantic: true as const } : {}),
                ...(gated ? { reranked: true as const } : {}),
            }

        if (packed.text) {
            const injectedNow = new Set(packed.injected.map(i => i.name))
            packed.text = markBoosted(packed.text, boosted.filter(n => injectedNow.has(n.name)), limits.budgetChars)
            if (limits.pointers > 0)
                packed.text = preferNeighbourPointers(packed.text, notes, [...injectedNow], exclude, limits)
        }

        // Sources fill what budget memory left; with no memory the block is the banner and sources.
        let block: string | null = packed.text
        let sourcesNow: SourceHit[] = []
        if (sourceHits.length || timed) {
            const tag = mem.MEMORY_BLOCK_TAG
            const bare = `<${tag}>\n${mem.MEMORY_BANNER}\n\n</${tag}>`
            const room = limits.budgetChars - (packed.text ?? bare).length - (timed?.block.length ?? 0)
            const chatsNow = (timed?.chats ?? []).filter(h => !sourceHits.some(s => sourceKey(s) === sourceKey(h)))
            const sp = packSources([...sourceHits, ...chatsNow], req.mode as 'prompt' | 'subagent', room, deps.vault ?? '')
            // the time block sits before `# Vault files`
            const text = `${timed?.block ?? ''}${sp.text ?? ''}`
            if (text) {
                sourcesNow = sp.injected
                if (!packed.text) block = `<${tag}>\n${mem.MEMORY_BANNER}\n\n${text}</${tag}>`
                else {
                    const closeAt = packed.text.lastIndexOf(`</${tag}>`)
                    block =
                        closeAt < 0
                            ? `${packed.text}\n${text}`
                            : `${packed.text.slice(0, closeAt)}${text}${packed.text.slice(closeAt)}`
                }
            }
        }
        if (!block)
            return {
                ...none(notes.length ? 'no-match' : 'no-memory'),
                ...(scored ? { semantic: true as const } : {}),
                ...(gated ? { reranked: true as const } : {}),
            }

        // The caller gave up on this recall, so the model never saw these notes: leave the ledger be.
        if (req.signal?.aborted) return none('no-match')
        for (const i of packed.injected) ledger.injected.set(i.name, i.hash)
        for (const h of sourcesNow) ledger.injected.set(sourceKey(h), h.hash)
        if (timed) for (const [k, h] of timed.hashes) ledger.injected.set(k, h)
        if (req.mode === 'tool') ledger.toolBatches++
        ledger.lastSeen = t
        ledgers.set(key, ledger)
        return {
            context: block,
            injected: [
                ...packed.injected.map(i => i.name),
                ...(timed ? timed.injected : []),
            ],
            ...(scored ? { semantic: true as const } : {}),
            ...(gated ? { reranked: true as const } : {}),
            ...(sourcesNow.length ? { sources: sourcesNow.map(sourceKey) } : {}),
        }
    }

    return {
        recall: req => recall(req).catch(() => none('no-match')),
        reset,
    }
}

const denyPlans = new Map<string, { at: number; p: Promise<DenyPlan> }>()
/** The deny plan walks every frontmatter in the vault: share one per vault and channel for 30 s. */
const denyPlanFor = (vault: string, ch: 'chat' | 'daemon') => {
    const k = `${vault}|${ch}`
    const hit = denyPlans.get(k)
    if (hit && Date.now() - hit.at < 30_000) return hit.p
    const p = resolveDenyPlan(vault, ch)
    denyPlans.set(k, { at: Date.now(), p })
    p.catch(() => denyPlans.delete(k))
    return p
}

/** Drop a vault's cached deny plans; the server calls it whenever the watcher bumps its version,
 *  so a note hidden just now stops being recalled at once. The 30 s TTL is only an upper bound. */
export function invalidateRecallDenyPlans(vault: string): void {
    denyPlans.delete(`${vault}|chat`)
    denyPlans.delete(`${vault}|daemon`)
}

/** Past chats for a query, only where the vault shows them: as `bismuth history`, a transcript may
 *  quote any restricted note, so a vault that restricts a note or folder (per-chat levels alone do
 *  not count) recalls no chats. A folderVisibility rule on an empty folder yields no deny entries,
 *  so chats still inject there (nothing in it to quote). */
export async function chatHitsFor(vault: string, q: SourceQuery): Promise<SourceHit[]> {
    const plan = await denyPlanFor(vault, q.channel)
    if (!plan.determined || plan.entries.some(e => e.kind !== 'chat')) return []
    return (await import('./chatEmbed')).chatSourceHits(vault, q)
}

/** The three real sources, run side by side; each is dropped alone when it is slower than the
 *  rerank budget or fails. Loaded lazily: nothing here is needed until a semantic query runs. */
export async function sourcesFor(
    vault: string,
    q: SourceQuery & { switches: RecallSourceSwitches },
): Promise<SourceHit[]> {
    const run = async (on: boolean, f: () => Promise<SourceHit[]>): Promise<SourceHit[]> =>
        on ? ((await withTimeout(f(), RERANK_TIMEOUT_MS).catch(() => undefined)) ?? []) : []
    const [files, chats, docs] = await Promise.all([
        run(q.switches.files, async () => {
            const plan = await denyPlanFor(vault, q.channel)
            // a vault that cannot say what is restricted shows no files
            if (!plan.determined) return []
            return (await import('./vaultEmbed')).vaultSourceHits(vault, { ...q, deny: plan.entries })
        }),
        run(q.switches.chats, () => chatHitsFor(vault, q)),
        run(q.switches.docs, async () => (await import('./docsEmbed')).docsSourceHits(q)),
    ])
    return [...files, ...chats, ...docs]
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
            reranker: () => sharedReranker(),
            sources: q => sourcesFor(vault, q),
            timeChats: async q => (readRecallSourcesSync(vault).chats ? await chatHitsFor(vault, q) : []),
            vault,
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
