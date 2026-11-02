import { readdir, readFile, stat as statFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
    claudeProjectDirs,
    isChatVisibleTo,
    parseSession,
    readChatVisibility,
    resolveChatVisibility,
    todayISO,
    type ChatVisibilityRules,
    type MemoryNote,
} from '@bismuth/memory'
import { bismuthHome } from './bismuthHome'
import { readEmbeddingsEnabledSync } from './embeddingsSetting'
import { realpathLoose } from './realPath'
import { createVectorStore, hashOf, noteChunks, QUERY_PREFIX, sharedSemanticChannel } from './memoryEmbed'
import type { SemanticChannel, VectorStore } from './memoryEmbed'
import { SOURCE_EXCERPT_CHARS, type SourceHit, type SourceQuery } from './semanticSources'
import type { SemanticUnavailable } from './vaultEmbed'

/** Semantic index over this vault's past chats: the Claude Code session logs `bismuth history`
 *  reads, one note per session, embedded in the background and answered from what is embedded so far.
 *  THIS FILE MUST NOT STATICALLY IMPORT `@huggingface/transformers` or `onnxruntime-node`
 *  (`memoryEmbed.test.ts` pins it). */

export type ChatSearchOpts = {
    k?: number
    channel: 'chat' | 'daemon'
    excludeSessionId?: string
    waitMs?: number
    build?: boolean
}

const DEFAULT_K = 10
const DEFAULT_WAIT_MS = 20_000
const SYNC_DEBOUNCE_MS = 1500
const PASS_BATCH_NOTES = 8
/** One message is cut here so a code dump cannot take the whole session's chunk budget. */
const PER_MESSAGE_CHARS = 1500

const OFF: SemanticUnavailable = {
    unavailable: 'off',
    message: 'embeddings are off: set `embeddings.enabled` to true in the vault .settings',
}
const NO_WORKER: SemanticUnavailable = {
    unavailable: 'no-worker',
    message: 'this build cannot run the embedding model: semantic search is unavailable here',
}
const warming = (why: string): SemanticUnavailable => ({
    unavailable: 'warming',
    message: `the semantic index is still warming up (${why}): try again shortly`,
})

type Session = {
    note: MemoryNote
    date: string
    /** Start offset of each turn inside `note.content`. */
    starts: number[]
    turns: string[]
}

type ChatState = {
    store: VectorStore
    /** file name → what was read, so an unchanged log is not read again. */
    files: Map<string, { dir: string; mtimeMs: number; size: number; id: string }>
    sessions: Map<string, Session>
    timer: ReturnType<typeof setTimeout> | null
}

type Config = {
    channel?: SemanticChannel
    vectorsDir?: string
    syncDebounceMs?: number
    storeDebounceMs?: number
}
let config: Config = {}
const states = new Map<string, ChatState>()

/** Test seam: swap the channel / vector dir / debounce and forget every cached vault. */
export function configureChatEmbed(c: Config = {}): void {
    for (const s of states.values()) {
        if (s.timer) clearTimeout(s.timer)
        s.store.pause()
    }
    states.clear()
    config = c
}

const channel = () => config.channel ?? sharedSemanticChannel()

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

function sessionOf(id: string, text: string, mtimeMs: number): Session | null {
    const rec = parseSession(id, text)
    if (!rec) return null
    const turns = rec.turns.map(
        t =>
            `you: ${collapse(t.user).slice(0, PER_MESSAGE_CHARS)} claude: ${collapse(t.claude).slice(0, PER_MESSAGE_CHARS)}`.trim(),
    )
    const starts: number[] = []
    let at = 0
    for (const t of turns) {
        starts.push(at)
        at += t.length + 2
    }
    const first = collapse(rec.turns[0]?.user ?? '').slice(0, 100)
    const note = {
        name: id,
        content: turns.join('\n\n'),
        backlinks: [],
        frontmatter: { type: 'fact', tags: [], created: '', updated: '', description: first },
    } as MemoryNote
    return { note, date: rec.date || todayISO(new Date(mtimeMs)), starts, turns }
}

/** Stat the vault's session logs and read only those whose mtime or size changed. */
async function refresh(vault: string, st: ChatState, skipId?: string): Promise<void> {
    const roots = [vault]
    try {
        const real = realpathLoose(vault)
        if (real !== vault) roots.push(real)
    } catch {}
    const seen = new Set<string>()
    for (const dir of claudeProjectDirs(roots)) {
        let names: string[]
        try {
            names = await readdir(dir)
        } catch {
            continue
        }
        for (const name of names) {
            if (!name.endsWith('.jsonl')) continue
            const id = name.slice(0, -'.jsonl'.length)
            const key = join(dir, name)
            // the asking session's own log grows every turn and is never returned: do not read it
            if (id === skipId) {
                seen.add(key)
                continue
            }
            let stat: Awaited<ReturnType<typeof statFile>>
            try {
                stat = await statFile(key)
            } catch {
                continue
            }
            seen.add(key)
            const known = st.files.get(key)
            if (known && known.mtimeMs === stat.mtimeMs && known.size === stat.size) continue
            st.files.set(key, { dir, mtimeMs: stat.mtimeMs, size: stat.size, id })
            let session: Session | null = null
            try {
                session = sessionOf(id, await readFile(key, 'utf8'), stat.mtimeMs)
            } catch {}
            if (session) st.sessions.set(id, session)
            else st.sessions.delete(id)
        }
    }
    for (const [key, f] of st.files) {
        if (seen.has(key)) continue
        st.files.delete(key)
        st.sessions.delete(f.id)
    }
}

function stateFor(vault: string, emb: NonNullable<ReturnType<SemanticChannel['embedder']>>): ChatState {
    let st = states.get(vault)
    if (!st) {
        st = {
            store: createVectorStore(config.vectorsDir ?? bismuthHome('cache', 'chat-vectors'), vault, {
                embedder: emb,
                batchNotes: PASS_BATCH_NOTES,
                debounceMs: config.storeDebounceMs,
            }),
            files: new Map(),
            sessions: new Map(),
            timer: null,
        }
        states.set(vault, st)
    }
    return st
}

function ready(vault: string): { st: ChatState; emb: NonNullable<ReturnType<SemanticChannel['embedder']>> } | SemanticUnavailable {
    if (!readEmbeddingsEnabledSync(vault)) return OFF
    const emb = channel().embedder()
    if (!emb) return NO_WORKER
    return { st: stateFor(vault, emb), emb }
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> => {
    let t: ReturnType<typeof setTimeout>
    return Promise.race([
        p,
        new Promise<'timeout'>(res => {
            t = setTimeout(() => res('timeout'), ms)
        }),
    ]).finally(() => clearTimeout(t))
}

const notesOf = (st: ChatState): MemoryNote[] => [...st.sessions.values()].map(s => s.note)

/** The best-matching turn of a session, `you: … claude: …`, cut to the excerpt size. */
function excerptOf(s: Session, chunkIndex: number): string {
    const chunks = noteChunks(s.note)
    const chunk = chunks[Math.max(0, Math.min(chunkIndex, chunks.length - 1))] ?? ''
    const header = [s.note.name, s.note.frontmatter.description].filter(Boolean).join('\n') + '\n'
    const body = chunk.startsWith(header) ? chunk.slice(header.length) : chunk
    // Locate the chunk in the session text, then take the turn that holds its start.
    const at = s.note.content.indexOf(body.slice(0, 60))
    let turn = 0
    if (at >= 0) for (let i = 0; i < s.starts.length; i++) if (s.starts[i]! <= at) turn = i
    return (s.turns[turn] ?? body).slice(0, SOURCE_EXCERPT_CHARS)
}

async function rank(
    st: ChatState,
    vault: string,
    vec: Float32Array,
    k: number,
    channelName: 'chat' | 'daemon',
    exclude?: string,
): Promise<SourceHit[]> {
    const vis = await readChatVisibility(vault)
    if (!vis.ok) return [] // an invalid .settings hides every chat
    const rules: ChatVisibilityRules = vis.rules
    const notes = notesOf(st)
    const scores = await st.store.scores(vec, notes, notes.length)
    const hits: SourceHit[] = []
    for (const [id, score] of scores) {
        if (hits.length >= k) break
        if (id === exclude) continue
        const s = st.sessions.get(id)
        if (!s) continue
        if (!isChatVisibleTo(resolveChatVisibility(id, rules), channelName)) continue
        hits.push({
            kind: 'chat',
            id,
            score,
            excerpt: excerptOf(s, st.store.bestChunk(vec, id)),
            date: s.date,
            hash: hashOf(s.note),
        })
    }
    return hits
}

/** Past chats ranked against a query vector the caller embedded; [] when embeddings are off, the
 *  model is unavailable or nothing is embedded yet. */
export async function chatSourceHits(vault: string, q: SourceQuery): Promise<SourceHit[]> {
    const r = ready(vault)
    if ('unavailable' in r) return []
    const { st } = r
    await refresh(vault, st, q.excludeSessionId)
    st.store.sync(notesOf(st)) // arms the background pass; the query answers from what is embedded
    return rank(st, vault, q.vec, q.k, q.channel, q.excludeSessionId)
}

export async function chatSemanticSearch(
    vault: string,
    query: string,
    opts: ChatSearchOpts,
): Promise<SourceHit[] | SemanticUnavailable> {
    const r = ready(vault)
    if ('unavailable' in r) return r
    const { st, emb } = r
    const deadline = Date.now() + (opts.waitMs ?? DEFAULT_WAIT_MS)
    await refresh(vault, st, opts.excludeSessionId)
    const notes = notesOf(st)
    st.store.sync(notes)
    const q = emb.embed([QUERY_PREFIX + query])
    q.catch(() => {})
    if (opts.build) {
        const done = await withTimeout(st.store.flush(), Math.max(0, deadline - Date.now()))
        if (done === 'timeout')
            return warming(`indexing chats: ${st.store.size()} of ${notes.length} sessions embedded`)
    }
    let qv: Float32Array | undefined
    try {
        const got = await withTimeout(q, Math.max(0, deadline - Date.now()))
        if (got === 'timeout') return warming('the model is loading')
        qv = got[0]
    } catch (e) {
        return { unavailable: 'failed', message: `the embedding model failed: ${(e as Error).message}` }
    }
    if (!qv) return warming('no query vector')
    const hits = await rank(st, vault, qv, opts.k ?? DEFAULT_K, opts.channel, opts.excludeSessionId)
    if (hits.length === 0 && st.store.size() === 0 && notes.length > 0) return warming('nothing is embedded yet')
    return hits
}

/** Schedule a debounced background rescan + re-embed; a no-op while `embeddings.enabled` is false. */
export function syncChatEmbeddings(vault: string): void {
    if (!readEmbeddingsEnabledSync(vault)) {
        const st = states.get(vault)
        if (st) {
            if (st.timer) {
                clearTimeout(st.timer)
                st.timer = null
            }
            st.files.clear()
            st.sessions.clear()
            st.store.pause()
        }
        return
    }
    const emb = channel().embedder()
    if (!emb) return
    const st = stateFor(vault, emb)
    if (st.timer) return
    st.timer = setTimeout(() => {
        st.timer = null
        if (!readEmbeddingsEnabledSync(vault)) return
        void refresh(vault, st).then(
            () => st.store.sync(notesOf(st)),
            () => {},
        )
    }, config.syncDebounceMs ?? SYNC_DEBOUNCE_MS)
    ;(st.timer as { unref?: () => void }).unref?.()
}
