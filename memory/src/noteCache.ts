import { stat } from 'node:fs/promises'
import { listNotes, memoryNotePath, parseNoteRef, readNote } from './graph'
import type { MemoryNote } from './graph'

type Entry = { mtimeMs: number; size: number; note: MemoryNote }

const caches = new Map<string, Map<string, Entry>>()

/**
 * `loadAllNotes(dir)` with a per-file cache keyed on (mtimeMs, size). Only new or changed files are
 * re-read; entries whose file is gone are dropped. A note's `backlinks` are the `[[links]]` found in
 * ITS OWN content (see `parseNoteFile`), so they are derived from the file the entry caches — a
 * re-read of a changed file recomputes them, and no other note's backlinks depend on it.
 */
export async function loadAllNotesCached(dir: string): Promise<MemoryNote[]> {
    const refs = await listNotes(dir)
    let cache = caches.get(dir)
    if (!cache) {
        cache = new Map()
        caches.set(dir, cache)
    }
    const live = cache
    const notes = await Promise.all(
        refs.map(async ref => {
            const parsed = parseNoteRef(ref)
            let st
            try {
                st = await stat(memoryNotePath(parsed.name, dir, parsed.folder))
            } catch {
                live.delete(ref)
                return null
            }
            const hit = live.get(ref)
            if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size)
                return hit.note
            const note = await readNote(parsed.name, dir, parsed.folder)
            if (!note) {
                live.delete(ref)
                return null
            }
            live.set(ref, { mtimeMs: st.mtimeMs, size: st.size, note })
            return note
        }),
    )
    const present = new Set(refs)
    for (const key of live.keys()) if (!present.has(key)) live.delete(key)
    return notes.filter((n): n is MemoryNote => n !== null)
}

/** Drop one dir's cache, or every dir's when omitted. */
export function clearNoteCache(dir?: string): void {
    if (dir === undefined) caches.clear()
    else caches.delete(dir)
}
