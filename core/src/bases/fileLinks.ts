// Link resolution over a set of rows, for `file.backlinks` and `asFile()`. A target resolves the
// way the graph resolves a wikilink (core/src/vault.ts resolveLinkTarget): an exact path match
// (`[[reading/Note]]`) wins, then the base name (`[[Note]]`), with notes sharing a base name
// settled by preferId. So a note's backlinks are exactly its incoming edges in the graph.
import { preferId } from '../linkTarget'
import { noteId } from '../pathUtils'
import type { FileLookup, FileMeta, Row } from './types'
import { isLink } from './values'

type Index = { byPath: Map<string, number>; byBase: Map<string, number> }

function indexRows(rows: readonly Row[]): Index {
    const byPath = new Map<string, number>()
    const byBase = new Map<string, number>()
    const baseWinner = new Map<string, string>()
    rows.forEach((r, i) => {
        const path = r.file?.path
        if (!path) return
        const id = noteId(path)
        if (!byPath.has(id)) byPath.set(id, i)
        if (!byPath.has(path)) byPath.set(path, i)
        const base = id.slice(id.lastIndexOf('/') + 1)
        const prev = baseWinner.get(base)
        if (prev === undefined || preferId(prev, id) === id) {
            baseWinner.set(base, id)
            byBase.set(base, i)
        }
    })
    return { byPath, byBase }
}

/** The note a link value names, as a target to resolve: `"[[folder/Note#h|alias]]"`, a Link,
 *  or plain `"Note"` → `folder/Note` / `Note`. Empty for anything else. */
export function linkTargetOf(v: unknown): string {
    let s = isLink(v) ? v.path : typeof v === 'string' ? v : ''
    const m = /^\s*!?\[\[([^\]]*)\]\]\s*$/.exec(s)
    if (m) s = m[1]
    return noteId(s.split('|')[0].split('#')[0].replace(/\\$/, '').trim())
}

function resolveIn(index: Index, target: string): number | undefined {
    return index.byPath.get(target) ?? index.byBase.get(target)
}

/** Finds a row by link target among `rows`: what `asFile()` reads. */
export function fileLookup(rows: readonly Row[]): FileLookup {
    let index: Index | undefined
    return target => {
        index ??= indexRows(rows)
        const i = resolveIn(index, linkTargetOf(target))
        if (i === undefined) return undefined
        const r = rows[i]
        return { file: r.file, note: r.note }
    }
}

/** Set every row's `file.backlinks`: the names of the rows whose links or embeds resolve to it,
 *  sorted by path, each linking note once. Mutates the rows' file objects in place. */
export function fillBacklinks(rows: readonly Row[]): void {
    const index = indexRows(rows)
    const incoming: number[][] = rows.map(() => [])
    rows.forEach((r, from) => {
        const f = r.file as FileMeta
        const seen = new Set<number>()
        for (const t of [...f.links, ...(f.embeds ?? [])]) {
            const to = resolveIn(index, noteId(t))
            if (to === undefined || seen.has(to)) continue
            seen.add(to)
            incoming[to].push(from)
        }
    })
    const pathOf = (i: number) => rows[i].file.path
    rows.forEach((r, i) => {
        r.file.backlinks = incoming[i]
            .sort((a, b) =>
                pathOf(a) < pathOf(b) ? -1 : pathOf(a) > pathOf(b) ? 1 : 0,
            )
            .map(j => rows[j].file.name)
    })
}
