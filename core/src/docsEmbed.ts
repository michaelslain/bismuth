import type { MemoryNote } from '@bismuth/memory'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { bismuthHome } from './bismuthHome'
import { createVectorStore, hashOf, noteChunks, sharedSemanticChannel } from './memoryEmbed'
import type { SemanticChannel, VectorStore } from './memoryEmbed'
import { SOURCE_EXCERPT_CHARS } from './semanticSources'
import type { SourceHit, SourceQuery } from './semanticSources'

/** Semantic index over Bismuth's own documentation pages: one entry per `##` section, ranked against
 *  a query vector the caller embedded. THIS FILE MUST NOT STATICALLY IMPORT
 *  `@huggingface/transformers` or `onnxruntime-node` (`memoryEmbed.test.ts` pins it). */

type Config = { channel?: SemanticChannel; vectorsDir?: string; docsRoot?: string | null; storeDebounceMs?: number }
let config: Config = {}
let store: { root: string; store: VectorStore } | null = null
const scanned = new Map<string, { sig: string; notes: MemoryNote[] }>()

/** Test seam: swap the channel / vector dir / docs root and forget every cached store and page. */
export function configureDocsEmbed(c: Config = {}): void {
    store?.store.pause()
    store = null
    scanned.clear()
    config = c
}

/** The docs directory core reads, or null when none is found: `BISMUTH_DOCS_DIR`, else
 *  `bismuthHome('docs')`, else the repo's `docs/`. */
export function resolveDocsRoot(): string | null {
    if (config.docsRoot !== undefined) return config.docsRoot
    const env = process.env.BISMUTH_DOCS_DIR
    const candidates = [
        ...(env ? [env] : []),
        bismuthHome('docs'),
        join(import.meta.dir, '..', '..', 'docs'),
    ]
    return candidates.find(isDir) ?? null
}

const isDir = (p: string) => {
    try {
        return existsSync(p) && statSync(p).isDirectory()
    } catch {
        return false
    }
}

function walkMarkdown(root: string): string[] {
    const out: string[] = []
    const stack = [root]
    while (stack.length) {
        const dir = stack.pop()!
        let entries
        try {
            entries = readdirSync(dir, { withFileTypes: true })
        } catch {
            continue
        }
        for (const e of entries) {
            const full = join(dir, e.name)
            if (e.isDirectory()) stack.push(full)
            else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(full)
        }
    }
    return out
}

/** The same GitHub-style heading slug `mcp/src/docs.ts` resolves `#anchor` with (core cannot import
 *  mcp; `docsEmbed.test.ts` pins the two together). */
export function docSlug(heading: string): string {
    return heading
        .toLowerCase()
        .replace(/[`*_~]/g, '')
        .replace(/[^a-z0-9 \-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
}

const entry = (id: string, title: string, text: string): MemoryNote =>
    ({
        name: id,
        content: text,
        backlinks: [],
        frontmatter: { type: 'fact', tags: [], created: '', updated: '', description: title },
    }) as MemoryNote

/** One entry per `##` section of a page (deeper headings stay inside their `##`); a page with no `##`
 *  is one entry. Anchors are counted across every heading depth 2-6, exactly as `readDoc` does, so a
 *  duplicate heading gets the `-1` suffix `bismuth docs read` expects. Pure. */
export function docSections(rel: string, text: string, fallbackTitle: string): MemoryNote[] {
    const lines = text.split(/\r?\n/)
    const pageTitle = lines.map(l => /^#\s+(.+?)\s*$/.exec(l)?.[1]).find(Boolean)?.trim() ?? fallbackTitle
    const seen = new Map<string, number>()
    type Part = { id: string; heading: string; buf: string[] }
    const parts: Part[] = [{ id: rel, heading: pageTitle, buf: [] }]
    for (const line of lines) {
        const h = /^(#{2,6})\s+(.+?)\s*$/.exec(line)
        if (h) {
            const heading = h[2]!.trim()
            const base = docSlug(heading)
            const n = seen.get(base) ?? 0
            seen.set(base, n + 1)
            if (h[1]!.length === 2) {
                parts.push({ id: `${rel}#${n === 0 ? base : `${base}-${n}`}`, heading, buf: [] })
                continue
            }
        } else if (parts.length === 1 && /^#\s+/.test(line)) continue
        parts[parts.length - 1]!.buf.push(line)
    }
    const out: MemoryNote[] = []
    for (const p of parts) {
        const body = p.buf.join('\n').trim()
        if (!body && !(p === parts[0] && parts.length === 1)) continue
        out.push(entry(p.id, p === parts[0] ? pageTitle : `${pageTitle} // ${p.heading}`, body || p.heading))
    }
    return out
}

/** Every section of every page, re-read only for pages whose size or mtime changed. */
function scan(root: string): MemoryNote[] {
    const live = new Set<string>()
    const out: MemoryNote[] = []
    for (const abs of walkMarkdown(root)) {
        live.add(abs)
        try {
            const st = statSync(abs)
            const sig = `${st.mtimeMs}:${st.size}`
            let got = scanned.get(abs)
            if (!got || got.sig !== sig) {
                const rel = abs.slice(root.length + 1).split('\\').join('/')
                got = { sig, notes: docSections(rel, readFileSync(abs, 'utf8'), basename(abs).replace(/\.md$/i, '')) }
                scanned.set(abs, got)
            }
            out.push(...got.notes)
        } catch {}
    }
    for (const k of scanned.keys()) if (!live.has(k)) scanned.delete(k)
    return out
}

function excerptOf(note: MemoryNote, chunk: number): string {
    const chunks = noteChunks(note)
    const raw = chunks[Math.max(0, Math.min(chunk, chunks.length - 1))] ?? ''
    const header = [note.name, note.frontmatter.description].filter(Boolean).join('\n') + '\n'
    return (raw.startsWith(header) ? raw.slice(header.length) : raw).replace(/\s+/g, ' ').trim().slice(0, SOURCE_EXCERPT_CHARS)
}

/** Sections per `embed()` call in a pass. The whole tree is thousands of chunks (over a minute on
 *  the real model), and the process has one embedder that runs one call at a time: one call for the
 *  whole tree would queue every recall's query embed behind it and turn each into a timeout. Slices
 *  keep a query waiting one slice at most, and each slice's vectors are searchable when it lands. */
export const DOCS_PASS_BATCH_NOTES = 8

/** The store and the current section list, or null when there is no docs root or no embedder. */
function open(): { st: VectorStore; notes: MemoryNote[] } | null {
    const root = resolveDocsRoot()
    if (!root) return null
    const emb = (config.channel ?? sharedSemanticChannel()).embedder()
    if (!emb) return null
    if (!store || store.root !== root)
        store = {
            root,
            store: createVectorStore(config.vectorsDir ?? bismuthHome('cache', 'docs-vectors'), root, {
                embedder: emb,
                debounceMs: config.storeDebounceMs,
                batchNotes: DOCS_PASS_BATCH_NOTES,
            }),
        }
    return { st: store.store, notes: scan(root) }
}

/** Start the background pass that embeds every docs section not already in the store. Core calls it
 *  at boot when embeddings are on, so the first docs question finds a built index instead of starting
 *  the build. Returns at once; vectors persist under `bismuthHome('cache', 'docs-vectors')`, so a
 *  later boot embeds only changed sections. */
export function syncDocsEmbeddings(): void {
    const o = open()
    o?.st.sync(o.notes)
}

/** Run the docs pass to the end and wait for it: true when every section has a vector, false when
 *  there is no docs root, no embedder, or the pass failed. For harnesses and measurements. */
export async function docsIndexReady(): Promise<boolean> {
    const o = open()
    if (!o) return false
    o.st.sync(o.notes)
    await o.st.flush()
    return o.st.size() >= o.notes.length
}

/** Sections scored per docs hit kept, so `k` distinct pages survive the one-hit-per-page cut. */
const DOCS_SECTIONS_PER_HIT = 4

/** The page a section id belongs to: `a/b.md#anchor` -> `a/b.md`. */
export const docPage = (id: string): string => id.split('#')[0]!

export async function docsSourceHits(q: SourceQuery): Promise<SourceHit[]> {
    const o = open()
    if (!o) return []
    const { st, notes } = o
    st.sync(notes) // re-embeds only sections whose content hash changed, in the background
    // One hit per page, its best section: a page's sections would otherwise fill every docs slot, so
    // more sections are scored than kept.
    const scores = await st.scores(q.vec, notes, q.k * DOCS_SECTIONS_PER_HIT)
    const byName = new Map(notes.map(n => [n.name, n]))
    const pages = new Set<string>()
    const hits: SourceHit[] = []
    for (const [id, score] of scores) {
        const n = byName.get(id)
        if (!n || hits.length >= q.k) continue
        const page = docPage(id)
        if (pages.has(page)) continue
        pages.add(page)
        hits.push({
            kind: 'docs',
            id,
            score,
            excerpt: excerptOf(n, st.bestChunk(q.vec, id)),
            title: n.frontmatter.description,
            hash: hashOf(n),
        })
    }
    return hits.sort((a, b) => b.score - a.score)
}
