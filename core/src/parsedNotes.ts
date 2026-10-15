// The one parse of every note. The graph build, the bases rows feed, the change tracker, the task
// migration scan and the embeddings scan each used to read and re-parse every note in the vault
// (five full passes per structural edit). They now read through this cache, so a note is parsed
// once per change: an entry is reused only while a fresh stat still reports the same mtime and size.
//
// Reads go through getFileAccess(), never node:fs, so this module is mobile-safe; a FileAccess
// whose statNote cannot answer (null, or mtime 0) is read every time and nothing is stored.
import { baseFormatOf, isBasePath } from './bases/baseFile'
import { fingerprintOfParsed, type Fingerprint } from './changeClassifier'
import { mapWithConcurrency } from './concurrency'
import { getFileAccess, type FileAccess, type FileStat } from './fileAccess'
import { parseFrontmatter } from './frontmatter'
import { extractTags } from './tags'
import { extractWikilinks } from './wikilinks'

export type ParsedNote = {
    readonly rel: string
    readonly stat: FileStat
    /** The file's text; null once the raw-bytes budget is spent (read it again if you need it). */
    readonly raw: string | null
    readonly data: Readonly<Record<string, unknown>>
    /** The text after the frontmatter; null together with `raw`. */
    readonly body: string | null
    readonly links: readonly string[]
    readonly tags: readonly string[]
    readonly fingerprint: Fingerprint
}

/** A note modified this recently may be rewritten inside the same timestamp tick, so it is
 *  returned but never stored (the same reasoning as git's racy-index window). */
export const RACY_MS = 2000
/** Total text the cache keeps; past it entries keep their parsed fields but drop `raw`/`body`. */
export const MAX_RAW_BYTES = 64 * 1024 * 1024
const READ_CONCURRENCY = 32

type Entry = { note: ParsedNote; counted: number }

let maxRawBytes = MAX_RAW_BYTES
let racyMs = RACY_MS
let nowMs: () => number = Date.now

const entries = new Map<string, Entry>()
const inflight = new Map<string, Promise<ParsedNote>>()
// Bumped by forget, so a read already in flight cannot store a stale parse after it.
const keyGens = new Map<string, number>()
const rootEpochs = new Map<string, number>()
// Bumped by configureParsedNotes, so a read begun before a reset is not stored after it.
let resetEpoch = 0
let rawBytes = 0
let hits = 0
let misses = 0

const NO_STAT: FileStat = { size: 0, mtimeMs: 0, ctimeMs: 0, birthtimeMs: 0 }

const rootOf = (root: string): string => root.replace(/\/+$/, '')
const keyOf = (root: string, rel: string): string => `${rootOf(root)}/${rel}`
const tokenOf = (root: string, key: string): string =>
    `${resetEpoch}/${keyGens.get(key) ?? 0}/${rootEpochs.get(rootOf(root)) ?? 0}`

function drop(key: string): void {
    const e = entries.get(key)
    if (!e) return
    rawBytes -= e.counted
    entries.delete(key)
}

function parse(rel: string, stat: FileStat, raw: string): ParsedNote {
    // A JSON Lines base has no frontmatter, links or tags of its own; only its line-1 config is
    // fingerprinted, and scanning a large base for wikilinks would be wasted work.
    const jsonl = isBasePath(rel) && baseFormatOf(raw) === 'jsonl'
    const { data, body } = jsonl ? { data: {}, body: raw } : parseFrontmatter(raw)
    const links = jsonl ? [] : extractWikilinks(raw)
    const tags = jsonl ? [] : extractTags(data, body)
    Object.freeze(data)
    Object.freeze(links)
    Object.freeze(tags)
    return {
        rel,
        stat,
        raw,
        data,
        body,
        links,
        tags,
        fingerprint: fingerprintOfParsed(raw, data, links, tags),
    }
}

function store(key: string, note: ParsedNote): ParsedNote {
    drop(key)
    const size = note.raw?.length ?? 0
    let kept = note
    let counted = size
    if (rawBytes + size > maxRawBytes) {
        kept = { ...note, raw: null, body: null }
        counted = 0
    }
    entries.set(key, { note: kept, counted })
    rawBytes += counted
    return kept
}

async function load(
    fa: FileAccess,
    root: string,
    rel: string,
    key: string,
    st: FileStat | null,
): Promise<ParsedNote> {
    const token = tokenOf(root, key)
    const raw = await fa.readNote(root, rel)
    const note = parse(rel, st ?? NO_STAT, raw)
    const storable =
        st !== null && st.mtimeMs !== 0 && nowMs() - st.mtimeMs > racyMs
    if (storable && tokenOf(root, key) === token) return store(key, note)
    return note
}

/** Resolves with the parsed note; rejects when it cannot be read. */
async function readParsed(
    fa: FileAccess,
    root: string,
    rel: string,
): Promise<ParsedNote> {
    const key = keyOf(root, rel)
    const st = await fa.statNote(root, rel)
    const cached = entries.get(key)
    if (cached) {
        if (
            st &&
            st.mtimeMs !== 0 &&
            cached.note.stat.mtimeMs === st.mtimeMs &&
            cached.note.stat.size === st.size
        ) {
            hits++
            return cached.note
        }
        drop(key)
    }
    const shared = inflight.get(key)
    if (shared) return shared
    misses++
    const pending = load(fa, root, rel, key, st)
    inflight.set(key, pending)
    try {
        return await pending
    } finally {
        if (inflight.get(key) === pending) inflight.delete(key)
    }
}

/** One note, or null when it cannot be read. */
export async function getParsedNote(
    root: string,
    rel: string,
): Promise<ParsedNote | null> {
    const fa = await getFileAccess()
    return readParsed(fa, root, rel).catch(() => null)
}

/** Every readable note among `rels`, in `rels` order. A note that cannot be read is skipped and
 *  reported to `onError`, never returned empty. */
export async function getParsedNotes(
    root: string,
    rels: string[],
    onError?: (rel: string, err: unknown) => void,
): Promise<ParsedNote[]> {
    const fa = await getFileAccess()
    const read = await mapWithConcurrency(rels, READ_CONCURRENCY, async rel => {
        try {
            return await readParsed(fa, root, rel)
        } catch (err) {
            onError?.(rel, err)
            return null
        }
    })
    return read.filter(n => n !== null)
}

/** Drop the entries for `rels` (vault-relative; a folder also drops everything beneath it), or every entry under `root` when omitted. A read
 *  already in flight for a forgotten key is not stored. */
export function forgetParsedNotes(root: string, rels?: string[]): void {
    if (rels) {
        for (const rel of rels) {
            const key = keyOf(root, rel)
            drop(key)
            inflight.delete(key)
            keyGens.set(key, (keyGens.get(key) ?? 0) + 1)
            // A folder rel (deleted or renamed externally) takes every key beneath it too.
            const under = `${key}/`
            for (const k of [...entries.keys()]) {
                if (!k.startsWith(under)) continue
                drop(k)
                keyGens.set(k, (keyGens.get(k) ?? 0) + 1)
            }
            for (const k of [...inflight.keys()]) {
                if (!k.startsWith(under)) continue
                inflight.delete(k)
                keyGens.set(k, (keyGens.get(k) ?? 0) + 1)
            }
        }
        return
    }
    const r = rootOf(root)
    const prefix = `${r}/`
    for (const key of [...entries.keys()]) if (key.startsWith(prefix)) drop(key)
    for (const key of [...inflight.keys()])
        if (key.startsWith(prefix)) inflight.delete(key)
    rootEpochs.set(r, (rootEpochs.get(r) ?? 0) + 1)
}

export function parsedNoteStats(): {
    entries: number
    rawBytes: number
    hits: number
    misses: number
} {
    return { entries: entries.size, rawBytes, hits, misses }
}

/** Test seam: drop every entry and counter, and swap the budget, racy window and clock. Called
 *  with no argument it restores the defaults. */
export function configureParsedNotes(
    o: { maxRawBytes?: number; racyMs?: number; now?: () => number } = {},
): void {
    entries.clear()
    inflight.clear()
    keyGens.clear()
    rootEpochs.clear()
    resetEpoch++
    rawBytes = 0
    hits = 0
    misses = 0
    maxRawBytes = o.maxRawBytes ?? MAX_RAW_BYTES
    racyMs = o.racyMs ?? RACY_MS
    nowMs = o.now ?? Date.now
}
