// Link-aware recall: which memory notes are about given vault notes, and which memory notes sit one
// wikilink away from notes already injected.
import { memoryLinkIndex } from '@bismuth/memory'
import type { MemoryNote } from '@bismuth/memory'

/** Lowercase link target with alias, heading and `.md` removed. */
const linkKey = (target: string): string =>
    target.split('|')[0]!.split('#')[0]!.replace(/\.md$/i, '').trim().toLowerCase()

const baseOf = (key: string): string => key.slice(key.lastIndexOf('/') + 1)

/** Memory notes whose `[[links]]` resolve to one of `vaultPaths`, by full path or by basename (the
 *  vault's `resolveLinkTarget` rule). Notes that link more of the paths come first; ties keep the
 *  order of `notes`. Only the given paths are resolved, never the whole vault. */
export function notesAbout(notes: MemoryNote[], vaultPaths: string[]): MemoryNote[] {
    const keys = new Set<string>()
    const bases = new Set<string>()
    for (const p of vaultPaths) {
        const key = linkKey(p.replace(/^\.?\//, ''))
        if (!key) continue
        keys.add(key)
        bases.add(baseOf(key))
    }
    if (!keys.size) return []
    const hits: { note: MemoryNote; count: number; order: number }[] = []
    notes.forEach((note, order) => {
        const matched = new Set<string>()
        for (const raw of note.backlinks) {
            const key = linkKey(raw)
            if (!key) continue
            // a path-qualified link must match the whole path; a bare name matches any folder
            if (keys.has(key)) matched.add(key)
            else if (!key.includes('/') && bases.has(key)) matched.add(key)
        }
        if (matched.size) hits.push({ note, count: matched.size, order })
    })
    return hits.sort((a, b) => b.count - a.count || a.order - b.order).map(h => h.note)
}

/** Memory notes one wikilink away (either direction) from any injected note, injected excluded,
 *  in a stable order: most links to the injected set first, then by name. */
export function neighbourNames(notes: MemoryNote[], injected: string[]): string[] {
    if (!injected.length) return []
    const { out, inbound } = memoryLinkIndex(notes)
    const skip = new Set(injected)
    const weight = new Map<string, number>()
    for (const name of injected)
        for (const side of [out.get(name), inbound.get(name)])
            for (const n of side ?? [])
                if (!skip.has(n)) weight.set(n, (weight.get(n) ?? 0) + 1)
    return [...weight.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .map(([n]) => n)
}
