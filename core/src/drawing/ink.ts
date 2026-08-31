// core/src/drawing/ink.ts
// The NOTE-INK document: freehand strokes drawn directly over a note in the editor's draw mode
// (app/src/editor/ink/). Deliberately minimal next to DrawingDoc — no pages, paper, or images;
// just strokes in the note's content space (x in the 680px logical reading column, y in absolute
// content pixels). Persisted per note as a hidden sidecar: `.ink/<note path>.ink` (see
// inkPathFor) — invisible to every listing (walkDir prunes dot-dirs) and cache-neutral to write
// (the server classifies `.ink/**` as dirty to nothing).
import type { Stroke } from './model'
import { roundStrokes } from './model'

/** Where a stroke was drawn, relative to the TEXT rather than to the page.
 *  `p` is a document position — the `from` of the line the stroke's first point sat on, remapped
 *  through every subsequent edit. `y` is that line's top in ink-logical units at draw time.
 *  Painting shifts the stroke by `lineTop(p) - y`, so inserting a line above moves the ink down
 *  with the text it annotates.
 *
 *  OPTIONAL ON PURPOSE. Every `.ink` file written before this existed has no `a`, and a stroke
 *  without one shifts by exactly 0 — the original paper-like behaviour, unchanged. That is the
 *  whole migration: there isn't one. (Which is also why serializeInkDoc must never invent an
 *  `a: undefined` key — see InkOverlay's conditional spread at the commit site.) */
export interface InkAnchor {
    p: number
    y: number
}

/** A note-ink stroke: a drawing Stroke plus its optional line anchor. */
export type InkStroke = Stroke & { a?: InkAnchor }

export interface InkDoc {
    v: 1
    kind: 'ink'
    strokes: InkStroke[]
}

/** The fixed logical width ink coordinates are stored in — the editor's reading column. Strokes
 *  scale by `contentWidth / INK_LOGICAL_W` at paint/pointer time so pane-width changes and
 *  sidebar toggles are absorbed without touching the persisted geometry. */
export const INK_LOGICAL_W = 680

/** The hidden sidecar path for a note's ink: `.ink/` mirrors the vault structure. */
export function inkPathFor(notePath: string): string {
    return `.ink/${notePath}.ink`
}

/** True for paths inside the hidden ink store — the server treats these as dirty to nothing
 *  (no graph/tree/search/rows/tasks invalidation), publishing only the SSE version bump that
 *  keeps a split-pane sibling in sync. */
export function isInkSidecarPath(p: string): boolean {
    return p === '.ink' || p.startsWith('.ink/')
}

export function emptyInkDoc(): InkDoc {
    return { v: 1, kind: 'ink', strokes: [] }
}

export function serializeInkDoc(doc: InkDoc): string {
    return JSON.stringify({ ...doc, strokes: roundStrokes(doc.strokes) })
}

/** Parse a persisted ink sidecar. Throws on anything that isn't an ink doc — the `kind`
 *  discriminant keeps a stray page-based `.draw` from ever being misread as note ink. */
export function parseInkDoc(text: string): InkDoc {
    const o = JSON.parse(text)
    if (!o || o.kind !== 'ink' || !Array.isArray(o.strokes)) {
        throw new Error('not an ink document')
    }
    return o as InkDoc
}
