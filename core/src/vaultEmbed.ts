import type { MemoryNote } from '@bismuth/memory'
import { bismuthHome } from './bismuthHome'
import { getFileAccess } from './fileAccess'
import { readEmbeddingsEnabledSync } from './embeddingsSetting'
import { parseFrontmatter } from './frontmatter'
import { createVectorStore, noteChunks, QUERY_PREFIX, sharedSemanticChannel } from './memoryEmbed'
import type { SemanticChannel, VectorStore } from './memoryEmbed'
import { mapWithConcurrency } from './concurrency'
import { fileBasename } from './pathUtils'
import { extractTags } from './tags'
import { findDeniedEntry } from './visibility'
import type { DenyEntry } from './visibility'

/** Semantic search over vault notes. One persisted vector store per vault root (separate from memory
 *  vectors), fed by the process-wide embedder. THIS FILE MUST NOT STATICALLY IMPORT
 *  `@huggingface/transformers` or `onnxruntime-node` (`memoryEmbed.test.ts` pins it). */

/** One ranked note. `path` is vault-relative with `.md`; `excerpt` is the best chunk, at most 300
 *  chars. */
export type SemanticHit = { path: string; score: number; excerpt: string }
export type SemanticUnavailable = {
    unavailable: 'off' | 'no-worker' | 'warming' | 'failed'
    message: string
}
export type SemanticOpts = {
    k?: number
    deny?: DenyEntry[]
    waitMs?: number
    /** This process is the only one that will embed (a one-shot CLI with no core): run the pending
     *  pass now, inside `waitMs`, instead of only arming a debounce the exiting process never fires. */
    build?: boolean
}

export const EXCERPT_CHARS = 300
export const DEFAULT_K = 10
/** How long a query waits for the model (cold load included) before answering `warming`. */
export const DEFAULT_WAIT_MS = 20_000
export const SYNC_DEBOUNCE_MS = 1500
/** Notes per `embed()` call during a pass: small enough that a query slips in between slices. */
export const PASS_BATCH_NOTES = 8
const READ_CONCURRENCY = 16

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

type VaultState = {
    store: VectorStore
    notes: Map<string, MemoryNote>
    loading: Promise<void> | null
    timer: ReturnType<typeof setTimeout> | null
    pending: Set<string>
    full: boolean
}

type Config = {
    channel?: SemanticChannel
    vectorsDir?: string
    syncDebounceMs?: number
    storeDebounceMs?: number
}
let config: Config = {}
const states = new Map<string, VaultState>()

/** Test seam: swap the channel / vector dir / debounce and forget every cached vault. */
export function configureVaultEmbed(c: Config = {}): void {
    for (const s of states.values()) {
        if (s.timer) clearTimeout(s.timer)
        s.store.pause()
    }
    states.clear()
    config = c
}

const channel = () => config.channel ?? sharedSemanticChannel()

const isIndexable = (p: string) => p.endsWith('.md') && !p.split('/').some(seg => seg.startsWith('.'))

const titleOf = (path: string, body: string): string => {
    const h = /^#{1,6}\s+(.+?)\s*$/m.exec(body)
    return h?.[1] ?? fileBasename(path)
}

/** A vault note in the shape the shared store hashes and chunks: the path is the name, the title the
 *  description, so every chunk leads with path, title and tags. */
function toNote(path: string, raw: string): MemoryNote {
    const { data, body } = parseFrontmatter(raw)
    return {
        name: path,
        content: body,
        backlinks: [],
        frontmatter: {
            type: 'fact',
            tags: extractTags(data, body),
            created: '',
            updated: '',
            description: titleOf(path, body),
        },
    } as MemoryNote
}

async function readInto(vault: string, notes: Map<string, MemoryNote>, paths: string[]) {
    const { readNote } = await getFileAccess()
    await mapWithConcurrency(paths, READ_CONCURRENCY, async p => {
        try {
            notes.set(p, toNote(p, await readNote(vault, p)))
        } catch {
            notes.delete(p) // gone from disk or unreadable
        }
    })
}

async function scan(vault: string, st: VaultState): Promise<void> {
    const { listMarkdown } = await getFileAccess()
    const paths = (await listMarkdown(vault)).filter(isIndexable)
    const fresh = new Map<string, MemoryNote>()
    await readInto(vault, fresh, paths)
    st.notes = fresh
}

function stateFor(vault: string, emb: NonNullable<ReturnType<SemanticChannel['embedder']>>): VaultState {
    let st = states.get(vault)
    if (!st) {
        st = {
            store: createVectorStore(config.vectorsDir ?? bismuthHome('cache', 'vault-vectors'), vault, {
                embedder: emb,
                batchNotes: PASS_BATCH_NOTES,
                debounceMs: config.storeDebounceMs,
            }),
            notes: new Map(),
            loading: null,
            timer: null,
            pending: new Set(),
            full: true,
        }
        states.set(vault, st)
    }
    return st
}

/** The vault's note list, scanned on first use and patched by `syncVaultEmbeddings` after. */
async function ensureNotes(vault: string, st: VaultState): Promise<MemoryNote[]> {
    if (st.full) {
        st.full = false
        st.loading = scan(vault, st).finally(() => (st.loading = null))
    }
    if (st.loading) await st.loading
    return [...st.notes.values()]
}

function ready(vault: string): { st: VaultState; emb: NonNullable<ReturnType<SemanticChannel['embedder']>> } | SemanticUnavailable {
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

/** Run the store's pending pass now; false when `deadline` came first. The pass keeps going and
 *  persists as it goes, so the next call starts where this one stopped. */
async function built(st: VaultState, notes: MemoryNote[], deadline: number): Promise<boolean> {
    st.store.sync(notes)
    return (await withTimeout(st.store.flush(), Math.max(0, deadline - Date.now()))) !== 'timeout'
}

const indexing = (st: VaultState, notes: MemoryNote[]) =>
    warming(`indexing the vault: ${st.store.size()} of ${notes.length} notes embedded`)

function excerptOf(note: MemoryNote, chunkIndex: number): string {
    const chunks = noteChunks(note)
    const chunk = chunks[Math.max(0, Math.min(chunkIndex, chunks.length - 1))] ?? ''
    const fm = note.frontmatter
    const header = [note.name, fm.description, fm.tags.join(' ')].filter(Boolean).join('\n') + '\n'
    const body = (chunk.startsWith(header) ? chunk.slice(header.length) : chunk).replace(/\s+/g, ' ').trim()
    return body.slice(0, EXCERPT_CHARS)
}

/** Rank, drop denied notes, THEN cut to k: a hidden best match never takes a slot. */
async function rank(
    st: VaultState,
    notes: MemoryNote[],
    queryVec: Float32Array,
    skip: string | null,
    opts: SemanticOpts,
): Promise<SemanticHit[]> {
    const k = opts.k ?? DEFAULT_K
    const scores = await st.store.scores(queryVec, notes, notes.length)
    const hits: SemanticHit[] = []
    for (const [path, score] of scores) {
        if (hits.length >= k) break
        if (path === skip) continue
        if (opts.deny?.length && findDeniedEntry(opts.deny, path)) continue
        const note = st.notes.get(path)
        if (!note) continue
        hits.push({ path, score, excerpt: excerptOf(note, st.store.bestChunk(queryVec, path)) })
    }
    return hits
}

export async function vaultSemanticSearch(
    vault: string,
    query: string,
    opts: SemanticOpts = {},
): Promise<SemanticHit[] | SemanticUnavailable> {
    const r = ready(vault)
    if ('unavailable' in r) return r
    const { st, emb } = r
    const deadline = Date.now() + (opts.waitMs ?? DEFAULT_WAIT_MS)
    const notes = await ensureNotes(vault, st)
    st.store.sync(notes) // arms the background pass; the query does not wait for it
    const q = emb.embed([QUERY_PREFIX + query])
    q.catch(() => {})
    if (opts.build && !(await built(st, notes, deadline))) return indexing(st, notes)
    let qv: Float32Array | undefined
    try {
        const got = await withTimeout(q, deadline - Date.now())
        if (got === 'timeout') return warming('the model is loading')
        qv = got[0]
    } catch (e) {
        return { unavailable: 'failed', message: `the embedding model failed: ${(e as Error).message}` }
    }
    if (!qv) return warming('no query vector')
    const hits = await rank(st, notes, qv, null, opts)
    if (hits.length === 0 && st.store.size() === 0 && notes.length > 0) return warming('nothing is embedded yet')
    return hits
}

/** The notes nearest to `notePath`, the note itself excluded; an unknown note yields []. */
export async function vaultSemanticNeighbours(
    vault: string,
    notePath: string,
    opts: SemanticOpts = {},
): Promise<SemanticHit[] | SemanticUnavailable> {
    const r = ready(vault)
    if ('unavailable' in r) return r
    const { st } = r
    const notes = await ensureNotes(vault, st)
    const path = st.notes.has(notePath) ? notePath : st.notes.has(`${notePath}.md`) ? `${notePath}.md` : null
    if (!path) return []
    if (opts.deny?.length && findDeniedEntry(opts.deny, path)) return []
    st.store.sync(notes)
    if (opts.build && !(await built(st, notes, Date.now() + (opts.waitMs ?? DEFAULT_WAIT_MS))))
        return indexing(st, notes)
    const centre = st.store.centroid(path)
    if (!centre) return warming('this note is not embedded yet')
    return rank(st, notes, centre, path, opts)
}

/** Schedule a debounced background re-embed; a no-op while `embeddings.enabled` is false. */
export function syncVaultEmbeddings(vault: string, changedPaths?: string[]): void {
    if (!readEmbeddingsEnabledSync(vault)) {
        const st = states.get(vault)
        if (st) {
            if (st.timer) {
                clearTimeout(st.timer)
                st.timer = null
            }
            st.pending.clear()
            st.full = true
            st.store.pause()
        }
        return
    }
    const emb = channel().embedder()
    if (!emb) return
    const st = stateFor(vault, emb)
    if (changedPaths && changedPaths.length) {
        for (const p of changedPaths) if (isIndexable(p)) st.pending.add(p)
        if (st.pending.size === 0) return
    } else {
        st.full = true
    }
    if (st.timer) return
    st.timer = setTimeout(() => {
        st.timer = null
        if (!readEmbeddingsEnabledSync(vault)) return
        void (async () => {
            try {
                if (st.full) {
                    st.pending.clear()
                    await ensureNotes(vault, st)
                } else {
                    if (st.loading) await st.loading
                    const paths = [...st.pending]
                    st.pending.clear()
                    await readInto(vault, st.notes, paths)
                }
                st.store.sync([...st.notes.values()])
            } catch {}
        })()
    }, config.syncDebounceMs ?? SYNC_DEBOUNCE_MS)
    ;(st.timer as { unref?: () => void }).unref?.()
}

export const isSemanticUnavailable = (
    r: SemanticHit[] | SemanticUnavailable,
): r is SemanticUnavailable => !Array.isArray(r)
