// app/src/editor/wikilinkOptions.ts
// Pure mapping from wikilink note candidates to autocomplete options. Kept O(n) over the
// whole vault by building a basename→count map once, rather than calling linkTargetFor
// (which itself scans all ids) once per note.
import type { NoteCandidate } from './wikilink'
import { folderLinkTarget } from './wikilink'
import { baseOf, dirOf } from '../../../core/src/linkTarget'

/** `folder` marks an option naming a folder, whose target ends in `/`. */
export type WikilinkOption = {
    label: string
    detail: string
    target: string
    folder?: boolean
}

/** One option per note: label = basename (display only), detail = parent dir (dirOf(path),
 *  '' at root), target = linkTargetFor(path, allPaths) — the bare baseOf(path) when unique
 *  among `notes`, else the full path, so a duplicate name inserts a path-qualified link.
 *  Counted by `baseOf(path)`, NOT `label` — they only agree when `label === baseOf(path)`,
 *  which breaks for a `.markdown` note whose id keeps its extension (noteId only strips
 *  `.md`). This must stay in lockstep with pickByBase/linkTargetFor/core's byBase, which
 *  all key off baseOf(path). */
export function wikilinkOptions(notes: NoteCandidate[]): WikilinkOption[] {
    const counts = new Map<string, number>()
    for (const n of notes) {
        const base = baseOf(n.path)
        counts.set(base, (counts.get(base) || 0) + 1)
    }
    return notes.map(n => {
        const base = baseOf(n.path)
        return {
            label: n.label,
            detail: dirOf(n.path),
            target: (counts.get(base) || 0) > 1 ? n.path : base,
        }
    })
}

/** One option per folder path: label = folder name with a trailing slash (`Work/`), detail = its
 *  parent dir, target = the full path with a trailing slash (`Projects/Work/`). The full path is
 *  always used, so a folder link never depends on its name being unique. */
export function folderOptions(paths: readonly string[]): WikilinkOption[] {
    return paths.map(path => {
        const target = folderLinkTarget(path)
        const name = target.slice(0, -1)
        return {
            label: `${name.slice(name.lastIndexOf('/') + 1)}/`,
            detail: dirOf(name),
            target,
            folder: true,
        }
    })
}
