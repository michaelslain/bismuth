/// <reference path="./pdfjs-worker.d.ts" />
import type { MemoryNote } from '@bismuth/memory'
import { bismuthHome } from './bismuthHome'
import { getFileAccess } from './fileAccess'
import { readEmbeddingsEnabledSync } from './embeddingsSetting'
import { parseFrontmatter } from './frontmatter'
import { getParsedNote, type ParsedNote } from './parsedNotes'
import {
    CHUNK_CHARS,
    CHUNK_CONTEXT,
    createVectorStore,
    hashOf,
    MAX_CHUNKS_PER_NOTE,
    noteChunks,
    QUERY_PREFIX,
    sharedSemanticChannel,
} from './memoryEmbed'
import type { SemanticChannel, VectorStore } from './memoryEmbed'
import { mapWithConcurrency } from './concurrency'
import { readTranscript, stripTranscriptMarkers } from './transcript'
import { stripMarks } from './bookMarks'
import { binaryForCompanion, companionPathFor, isImagePath, isPdfPath } from './fileKinds'
import { fileBasename } from './pathUtils'
import { extractTags } from './tags'
import { findDeniedEntry } from './visibility'
import { SOURCE_EXCERPT_CHARS } from './semanticSources'
import type { SourceHit, SourceQuery } from './semanticSources'
import type { DenyEntry } from './visibility'

/** Semantic search over vault notes. One persisted vector store per vault root (separate from memory
 *  vectors), fed by the process-wide embedder. THIS FILE MUST NOT STATICALLY IMPORT
 *  `@huggingface/transformers` or `onnxruntime-node` (`memoryEmbed.test.ts` pins it). */

/** One ranked note. `path` is vault-relative with `.md`; `excerpt` is the best chunk, at most 300
 *  chars. */
export type SemanticHit = {
    path: string
    score: number
    excerpt: string
    /** What the hit is; absent reads as `note`. An image hit's `path` is the binary, not its companion. */
    kind?: 'note' | 'pdf' | 'image'
    /** pdf: the 1-based page of the best chunk. */
    page?: number
}
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

const kindOf = (path: string): 'note' | 'pdf' | 'image' =>
    isPdfPath(path) ? 'pdf' : isImagePath(path) ? 'image' : 'note'

/** The index key a changed vault path feeds, or null when it feeds none. A note and a PDF are their
 *  own entries; a binary's companion `x.pdf.md` / `photo.png.md` folds into the binary's entry, so
 *  the companion is never a hit of its own; an image itself changes nothing (its description lives
 *  in the companion). Dot-prefixed paths stay out. */
function entryPath(p: string): string | null {
    if (p.split('/').some(seg => seg.startsWith('.'))) return null
    const binary = binaryForCompanion(p)
    if (binary) return binary
    if (p.endsWith('.md') || isPdfPath(p)) return p
    return null
}

/** PDFs larger than this are not read for text; their companion still indexes. */
const MAX_PDF_BYTES = 40 * 1024 * 1024
const MAX_PDF_PAGES = 500

const titleOf = (path: string, body: string): string => {
    for (const m of body.matchAll(/^#{1,6}\s+(.+?)\s*$/gm))
        if (!/^Page \d+$/.test(m[1])) return m[1]
    return fileBasename(path)
}

/** A vault note in the shape the shared store hashes and chunks: the path is the name, the title the
 *  description, so every chunk leads with path, title and tags. */
function memoryNote(path: string, body: string, tags: readonly string[], summary?: string): MemoryNote {
    const title = titleOf(path, body)
    return {
        name: path,
        content: stripMarks(stripTranscriptMarkers(body)),
        backlinks: [],
        frontmatter: {
            type: 'fact',
            tags: [...tags],
            created: '',
            updated: '',
            description: summary ? `${title}\n${summary}` : title,
        },
    } as MemoryNote
}

/** `CHUNK_CONTEXT=summaries`: each vault's note summaries by path (noteSummaries.ts), loaded once per
 *  scan, so a chunk header carries the note's summary line. */
const summaryLines = new Map<string, Map<string, string>>()
const summaryFor = (vault: string, path: string): string | undefined =>
    CHUNK_CONTEXT === 'summaries' ? summaryLines.get(vault)?.get(path) : undefined

async function loadSummaryLines(vault: string): Promise<void> {
    if (CHUNK_CONTEXT !== 'summaries') return
    const { loadSummaries } = await import('./noteSummaryStore')
    const all = await loadSummaries(vault)
    summaryLines.set(vault, new Map([...all].map(([p, s]) => [p, s.summary])))
}

/** One MemoryNote per ParsedNote: the object stays the same while the file is unchanged, which is
 *  what lets the store memoize its content hash by identity (memoryEmbed.ts). */
const memoryNotes = new WeakMap<ParsedNote, MemoryNote>()

async function toNote(vault: string, p: ParsedNote): Promise<MemoryNote> {
    const known = memoryNotes.get(p)
    if (known) return known
    let note: MemoryNote
    if (p.body !== null) note = memoryNote(p.rel, p.body, p.tags, summaryFor(vault, p.rel))
    else {
        // The cache dropped this note's text (raw-bytes budget): parse a fresh copy, uncached.
        const { readNote } = await getFileAccess()
        const { data, body } = parseFrontmatter(await readNote(vault, p.rel))
        note = memoryNote(p.rel, body, extractTags(data, body), summaryFor(vault, p.rel))
    }
    memoryNotes.set(p, note)
    return note
}

type PdfStart = { page: number; start: number }
/** Where each page's text starts inside a PDF entry's content. */
const pdfStarts = new WeakMap<MemoryNote, PdfStart[]>()

type PdfDoc = {
    numPages: number
    getPage(n: number): Promise<{
        getTextContent(): Promise<{ items: ({ str: string; hasEOL?: boolean } | { type: string })[] }>
        cleanup(): void
    }>
}

/** Every page's text (1-based page numbers), '' for a page without a text layer; [] when pdf.js
 *  cannot open the file. pdf.js loads here, on first use, never at import. */
async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
    let task: { destroy(): Promise<void> } | null = null
    try {
        const g = globalThis as Record<string, unknown>
        const canvas = await import('@napi-rs/canvas')
        g.DOMMatrix ??= canvas.DOMMatrix
        g.Path2D ??= canvas.Path2D
        g.pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
        const warn = console.warn
        console.warn = (...a: unknown[]) => {
            if (!String(a[0]).includes('Cannot load "@napi-rs/canvas"')) warn(...a)
        }
        let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs')
        try {
            pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        } finally {
            console.warn = warn
        }
        const loading = pdfjs.getDocument({
            data: new Uint8Array(bytes),
            useWorkerFetch: false,
            disableFontFace: true,
            verbosity: 0,
        })
        task = loading
        const doc = (await loading.promise) as unknown as PdfDoc
        const out: string[] = []
        for (let i = 1; i <= Math.min(doc.numPages, MAX_PDF_PAGES); i++) {
            const page = await doc.getPage(i)
            const tc = await page.getTextContent()
            let text = ''
            for (const it of tc.items) if ('str' in it) text += it.str + (it.hasEOL ? '\n' : '')
            out.push(text.replace(/\s+/g, ' ').trim())
            page.cleanup()
        }
        return out
    } catch {
        return []
    } finally {
        await task?.destroy().catch(() => {})
    }
}

type Companion = { data: Readonly<Record<string, unknown>>; body: string; tags: readonly string[] }

async function companionOf(vault: string, binary: string): Promise<{ parsed: ParsedNote; c: Companion } | null> {
    const parsed = await getParsedNote(vault, companionPathFor(binary))
    if (!parsed) return null
    if (parsed.body !== null) return { parsed, c: { data: parsed.data, body: parsed.body, tags: parsed.tags } }
    const { readNote } = await getFileAccess()
    const { data, body } = parseFrontmatter(await readNote(vault, parsed.rel))
    return { parsed, c: { data, body, tags: extractTags(data, body) } }
}

const descriptionOf = (c: Companion | null): string => {
    const d = c?.data.description
    return typeof d === 'string' ? d.replace(/\s+/g, ' ').trim() : ''
}

function binaryNote(path: string, description: string, content: string, tags: readonly string[]): MemoryNote {
    return {
        name: path,
        content,
        backlinks: [],
        frontmatter: { type: 'fact', tags: [...tags], created: '', updated: '', description },
    } as MemoryNote
}

type PdfCached = { sig: string; companion: ParsedNote | null; notes: MemoryNote[] }
const pdfCache = new Map<string, PdfCached>()
const imageNotes = new WeakMap<ParsedNote, MemoryNote>()

/** A store key is `x.pdf` for a PDF's first entry and `x.pdf#p<page>` (`#p<page>.<n>` for a long page's later segments) for each later one. No
 *  such key leaves this file: hits carry the PDF path. */
const PDF_ENTRY_KEY = /^(.*)#p\d+(?:\.\d+)?$/
function baseOf(key: string): string {
    const m = PDF_ENTRY_KEY.exec(key)
    return m && isPdfPath(m[1]!) ? m[1]! : key
}

/** Share of the `MAX_CHUNKS_PER_NOTE` window an entry may fill: chunks break on whitespace, so they
 *  run a little short, and the headroom keeps every entry under the cap. */
const PDF_ENTRY_FILL = 0.8

/** A PDF as one entry per page (a page too long for one entry is cut into several), each small enough that `noteChunks` never hits its
 *  chunk cap, so every page of the PDF is searchable. Each entry carries the companion's description
 *  and tags in its header, so a query matching only the companion finds the PDF. */
function pdfEntries(path: string, description: string, tags: readonly string[], pages: string[]): MemoryNote[] {
    const header = [`${path}#p${MAX_PDF_PAGES}`, description, tags.join(' ')].filter(Boolean).join('\n') + '\n'
    const budget = Math.floor(Math.max(40, CHUNK_CHARS - header.length) * (MAX_CHUNKS_PER_NOTE - 2) * PDF_ENTRY_FILL)
    // A page longer than one entry is cut at whitespace into segments that each fit.
    const segs: { page: number; text: string }[] = []
    pages.forEach((text, i) => {
        while (text.length > budget) {
            let cut = text.lastIndexOf(' ', budget)
            if (cut <= 0) cut = budget
            segs.push({ page: i + 1, text: text.slice(0, cut) })
            text = text.slice(cut).trim()
        }
        if (text) segs.push({ page: i + 1, text })
    })
    // One entry per segment, so every chunk lies inside one page and a hit's page is exact.
    const out: MemoryNote[] = []
    const seen = new Map<number, number>()
    for (const seg of segs) {
        const n = seen.get(seg.page) ?? 0
        seen.set(seg.page, n + 1)
        const key = out.length === 0 ? path : `${path}#p${seg.page}${n ? `.${n}` : ''}`
        const note = binaryNote(key, description, seg.text, tags)
        pdfStarts.set(note, [{ page: seg.page, start: 0 }])
        out.push(note)
    }
    // No text layer: one entry holding the description alone.
    return out.length ? out : [binaryNote(path, description, '', tags)]
}

/** A PDF as its entries (see `pdfEntries`), null when the file is gone. */
async function toPdfNotes(vault: string, path: string): Promise<MemoryNote[] | null> {
    const fa = await getFileAccess()
    const stat = await fa.statNote(vault, path)
    const key = `${vault}\0${path}`
    if (!stat) {
        pdfCache.delete(key)
        return null
    }
    const comp = await companionOf(vault, path).catch(() => null)
    const sig = `${stat.size}:${stat.mtimeMs}`
    const hit = pdfCache.get(key)
    if (hit && hit.sig === sig && hit.companion === (comp?.parsed ?? null)) return hit.notes
    const layer = stat.size > MAX_PDF_BYTES ? [] : await pdfPageTexts(await fa.readBinary(vault, path))
    // A page's transcript (the companion's marked block, transcribe.ts) is the deliberate reading of
    // it: a scan or a handwritten notebook has no text layer, or a garbled one from OCR. It wins over
    // the PDF's own text for its page, with highlight marks taken out.
    const transcript = new Map(readTranscript(comp?.c.body ?? '').map(p => [p.page, stripMarks(p.text)]))
    const count = Math.max(layer.length, ...transcript.keys(), 0)
    const pages = Array.from({ length: count }, (_, i) => transcript.get(i + 1) ?? layer[i] ?? '')
    const description = descriptionOf(comp?.c ?? null) || fileBasename(path)
    const notes = pdfEntries(path, description, comp?.c.tags ?? [], pages)
    pdfCache.set(key, { sig, companion: comp?.parsed ?? null, notes })
    return notes
}

/** An image as one entry, made of its companion note: the description counts as its text. An image
 *  with no companion, or one that says nothing, has nothing to find it by. */
async function toImageNote(vault: string, path: string): Promise<MemoryNote | null> {
    const fa = await getFileAccess()
    if (!(await fa.statNote(vault, path))) return null
    const comp = await companionOf(vault, path)
    if (!comp) return null
    const known = imageNotes.get(comp.parsed)
    if (known) return known
    const description = descriptionOf(comp.c)
    // the companion's own text, with a transcript's markers and highlight marks taken out
    const body = stripMarks(stripTranscriptMarkers(comp.c.body)).trim()
    if (!description && !body && comp.c.tags.length === 0) return null
    const note = binaryNote(path, description || fileBasename(path), [description, body].filter(Boolean).join('\n'), comp.c.tags)
    imageNotes.set(comp.parsed, note)
    return note
}

async function buildEntries(vault: string, p: string): Promise<MemoryNote[]> {
    const kind = kindOf(p)
    if (kind === 'pdf') return (await toPdfNotes(vault, p)) ?? []
    const note = kind === 'image' ? await toImageNote(vault, p) : await noteAt(vault, p)
    return note ? [note] : []
}

async function noteAt(vault: string, p: string): Promise<MemoryNote | null> {
    const parsed = await getParsedNote(vault, p)
    return parsed ? toNote(vault, parsed) : null
}

/** Replace every entry of `p` (a PDF has several) with `fresh`. */
function setEntries(notes: Map<string, MemoryNote>, p: string, fresh: MemoryNote[]) {
    if (kindOf(p) === 'pdf') for (const key of [...notes.keys()]) if (baseOf(key) === p) notes.delete(key)
    notes.delete(p)
    for (const n of fresh) notes.set(n.name, n)
}

async function readInto(vault: string, notes: Map<string, MemoryNote>, paths: string[]) {
    await mapWithConcurrency(paths, READ_CONCURRENCY, async p => {
        try {
            setEntries(notes, p, await buildEntries(vault, p)) // none when gone from disk
        } catch {
            setEntries(notes, p, []) // unreadable
        }
    })
}

async function scan(vault: string, st: VaultState): Promise<void> {
    await loadSummaryLines(vault)
    const { listMarkdown, listTree } = await getFileAccess()
    const found = new Set<string>()
    for (const p of await listMarkdown(vault)) {
        const e = entryPath(p)
        if (e) found.add(e)
    }
    try {
        for (const e of await listTree(vault)) {
            if (e.kind === 'file' && isPdfPath(e.path) && entryPath(e.path)) found.add(e.path)
        }
    } catch {}
    const paths = [...found]
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

/** The text of chunk `chunkIndex` without the header every chunk leads with. */
function chunkBody(note: MemoryNote, chunks: string[], chunkIndex: number): string {
    const chunk = chunks[Math.max(0, Math.min(chunkIndex, chunks.length - 1))] ?? ''
    const fm = note.frontmatter
    const header = [note.name, fm.description, fm.tags.join(' ')].filter(Boolean).join('\n') + '\n'
    return chunk.startsWith(header) ? chunk.slice(header.length) : chunk
}

function excerptOf(note: MemoryNote, chunkIndex: number, max = EXCERPT_CHARS): string {
    const body = chunkBody(note, noteChunks(note), chunkIndex).replace(/\s+/g, ' ').trim()
    // A PDF or image with no text of its own is found by its description
    return (body || note.frontmatter.description || '').slice(0, max)
}

/** The 1-based PDF page the chunk sits on, found by walking the chunks in order through the text. */
function pageOf(note: MemoryNote, chunkIndex: number): number | undefined {
    const starts = pdfStarts.get(note)
    if (!starts || starts.length === 0) return undefined
    const chunks = noteChunks(note)
    const last = Math.max(0, Math.min(chunkIndex, chunks.length - 1))
    let cursor = 0
    let pos = -1
    for (let i = 0; i <= last; i++) {
        const body = chunkBody(note, chunks, i)
        pos = note.content.indexOf(body, cursor)
        if (pos < 0) return undefined
        cursor = pos + body.length
    }
    let page = starts[0]!.page
    for (const s of starts) if (s.start <= pos) page = s.page
    return page
}

/** A denied binary, or one whose companion is denied, is hidden. */
function deniedEntry(deny: DenyEntry[] | undefined, path: string): boolean {
    if (!deny?.length) return false
    if (findDeniedEntry(deny, path)) return true
    return kindOf(path) !== 'note' && !!findDeniedEntry(deny, companionPathFor(path))
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
    const seen = new Set<string>()
    // Scores come best first, so the first entry of a PDF seen is its best; the rest fold into it.
    for (const [key, score] of scores) {
        if (hits.length >= k) break
        const path = baseOf(key)
        if (path === skip || seen.has(path)) continue
        if (deniedEntry(opts.deny, path)) continue
        const note = st.notes.get(key)
        if (!note) continue
        seen.add(path)
        const chunk = st.store.bestChunk(queryVec, key)
        const hit: SemanticHit = { path, score, excerpt: excerptOf(note, chunk) }
        const kind = kindOf(path)
        if (kind !== 'note') hit.kind = kind
        if (kind === 'pdf') {
            const page = pageOf(note, chunk)
            if (page !== undefined) hit.page = page
        }
        hits.push(hit)
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
    if (deniedEntry(opts.deny, path)) return []
    st.store.sync(notes)
    if (opts.build && !(await built(st, notes, Date.now() + (opts.waitMs ?? DEFAULT_WAIT_MS))))
        return indexing(st, notes)
    // A PDF anchors on its first entry (its opening pages plus the description), not on all of them.
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
        for (const p of changedPaths) {
            const e = entryPath(p)
            if (e) st.pending.add(e)
        }
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

/** Vault files ranked against a query vector the caller embedded: notes, PDFs and described images
 *  as `SourceHit`s, denied files dropped before `k`. Resolves [] while the index is off or empty. */
export async function vaultSourceHits(vault: string, q: SourceQuery): Promise<SourceHit[]> {
    const r = ready(vault)
    if ('unavailable' in r) return []
    const { st } = r
    const notes = await ensureNotes(vault, st)
    st.store.sync(notes)
    const scores = await st.store.scores(q.vec, notes, notes.length)
    const groups = new Map<string, MemoryNote[]>()
    for (const n of notes) {
        const g = groups.get(baseOf(n.name))
        if (g) g.push(n)
        else groups.set(baseOf(n.name), [n])
    }
    const hits: SourceHit[] = []
    const seen = new Set<string>()
    for (const [key, score] of scores) {
        if (hits.length >= q.k) break
        const path = baseOf(key)
        if (seen.has(path)) continue
        if (deniedEntry(q.deny, path)) continue
        const note = st.notes.get(key)
        if (!note) continue
        seen.add(path)
        const kind = kindOf(path)
        const chunk = st.store.bestChunk(q.vec, key)
        const hit: SourceHit = {
            kind,
            id: path,
            score,
            excerpt: excerptOf(note, chunk, SOURCE_EXCERPT_CHARS),
            // a PDF changes when any of its entries does
            hash: (groups.get(path) ?? [note]).map(hashOf).join('+'),
        }
        if (kind === 'pdf') {
            const page = pageOf(note, chunk)
            if (page !== undefined) hit.page = page
        }
        if (kind === 'note') hit.title = note.frontmatter.description
        hits.push(hit)
    }
    return hits
}
