// core/src/daemonMemory.ts
// The daemon page's memory panel: list/search this vault's 3rd-brain notes (`.daemon/memory`)
// and let the user forget one. Pure over an explicit memory dir (no vault/server coupling) —
// usable from server.ts routes and unit-testable against a tmp dir the same way daemonGraph.ts
// is. Delegates all on-disk note handling to `@bismuth/memory` (loadAllNotes/searchMemory/
// deleteNote); this module only shapes the result for the daemon page and gates path traversal
// on forget.
import {
    loadAllNotes,
    searchMemory,
    deleteNote,
    isMemoryNoteVisibleToDaemon,
    type MemoryNote,
} from '@bismuth/memory'
import { AppError } from './error'

export interface DaemonMemoryItem {
    /** Vault-relative path (`.daemon/memory/<name>.md`) — opens like any other note, and is
     *  what `forgetDaemonMemory` expects back. */
    path: string
    name: string
    type: string
    /** The note's `updated` frontmatter — a local calendar date `YYYY-MM-DD`
     *  (memory/src/dates.ts), not a timestamp. */
    updated: string
    /** First non-empty content line, truncated to `EXCERPT_MAX` chars. */
    excerpt: string
}

export interface DaemonMemoryList {
    /** Count of daemon-visible notes, independent of `q`/`limit` — so the panel can show the
     *  full "118" even while `items` is filtered down to a handful of matches. */
    total: number
    items: DaemonMemoryItem[]
}

const EXCERPT_MAX = 160

function toItem(note: MemoryNote): DaemonMemoryItem {
    const line =
        note.content
            .split('\n')
            .map(l => l.trim())
            .find(l => l.length > 0) ?? ''
    return {
        path: `.daemon/memory/${note.name}.md`,
        name: note.name,
        type: note.frontmatter.type,
        updated: note.frontmatter.updated,
        excerpt: line.slice(0, EXCERPT_MAX),
    }
}

/**
 * List (or search) this vault's daemon-visible memory notes for the daemon page's memory
 * panel. No `q`: every visible note, sorted by `updated` desc. With `q`: `searchMemory`'s
 * relevance ranking (already visibility-filtered internally). `total` always reflects the
 * full visible count, regardless of `q`/`limit`. Never throws — degrades to
 * `{ total: 0, items: [] }`.
 */
export async function listDaemonMemory(
    dir: string,
    q: string,
    limit: number,
): Promise<DaemonMemoryList> {
    try {
        const all = await loadAllNotes(dir)
        const visible = all.filter(isMemoryNoteVisibleToDaemon)
        const total = visible.length
        if (q) {
            const found = await searchMemory(q, dir, limit)
            return { total, items: found.map(toItem) }
        }
        const sorted = [...visible].sort((a, b) =>
            b.frontmatter.updated.localeCompare(a.frontmatter.updated),
        )
        return { total, items: sorted.slice(0, limit).map(toItem) }
    } catch {
        return { total: 0, items: [] }
    }
}

/**
 * Delete a memory note by its VAULT-relative path (`.daemon/memory/<name>.md`, exactly as
 * returned by `listDaemonMemory`). Rejects anything outside `.daemon/memory/` or carrying a
 * `..` segment before it ever reaches the filesystem. Unknown note → `AppError("ENOENT", …,
 * 404)`. Recoverable — the memory dir is its own git repo.
 */
export async function forgetDaemonMemory(
    dir: string,
    relPath: string,
): Promise<void> {
    const PREFIX = '.daemon/memory/'
    if (!relPath.startsWith(PREFIX) || relPath.includes('..'))
        throw new AppError('EINVAL', `Invalid memory path "${relPath}"`, 400)
    const name = relPath.slice(PREFIX.length).replace(/\.md$/, '')
    const deleted = await deleteNote(name, dir)
    if (!deleted)
        throw new AppError(
            'ENOENT',
            `Memory note "${relPath}" not found`,
            404,
        )
}
