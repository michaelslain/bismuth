// app/src/editor/wikilinkOptions.ts
// Pure mapping from wikilink note candidates to autocomplete options. Kept O(n) over the
// whole vault by building a basename→count map once, rather than calling linkTargetFor
// (which itself scans all ids) once per note.
import type { NoteCandidate } from './wikilink'
import { dirOf } from '../../../core/src/linkTarget'

export type WikilinkOption = { label: string; detail: string; target: string }

/** One option per note: label = basename, detail = parent dir (dirOf(path), '' at root),
 *  target = linkTargetFor(path, allPaths) — the bare basename when unique among `notes`,
 *  else the full path, so a duplicate name inserts a path-qualified link. */
export function wikilinkOptions(notes: NoteCandidate[]): WikilinkOption[] {
    const counts = new Map<string, number>()
    for (const n of notes) {
        counts.set(n.label, (counts.get(n.label) || 0) + 1)
    }
    return notes.map(n => ({
        label: n.label,
        detail: dirOf(n.path),
        target: (counts.get(n.label) || 0) > 1 ? n.path : n.label,
    }))
}
