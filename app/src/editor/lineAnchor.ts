// app/src/editor/lineAnchor.ts
// A wikilink's line anchor: `[[Note#L12]]` names line 12 of Note, `[[Note#L12-L18]]` lines 12 to
// 18, counted from 1 over the whole file, as the editor's line-number gutter shows them. Chat is
// told to cite lines this way while line numbers are on (core/src/chatLineRefNote.ts). Rendered as
// `Note:12` / `Note:12–18` (livePreview.ts pushWikilinks); a click opens the note with those lines
// selected (Editor.tsx revealHeading). Pure: no CodeMirror, no Solid.

export type LineAnchor = { from: number; to: number }

const LINE_ANCHOR_RE = /^L(\d+)(?:-L?(\d+))?$/

/** The line range a `#…` anchor names, or null when it is a heading anchor. A reversed range is
 *  put in order; line 0 is not a line. */
export function parseLineAnchor(anchor: string | undefined): LineAnchor | null {
    const m = anchor?.trim().match(LINE_ANCHOR_RE)
    if (!m) return null
    const a = Number(m[1])
    const b = m[2] === undefined ? a : Number(m[2])
    if (a < 1 || b < 1) return null
    return { from: Math.min(a, b), to: Math.max(a, b) }
}

/** The label a line anchor renders after the note name: `:12`, or `:12–18` for a range. */
export function lineAnchorLabel(range: LineAnchor): string {
    return range.from === range.to
        ? `:${range.from}`
        : `:${range.from}–${range.to}`
}

/** The range clamped to a document of `lines` lines, or null when it starts past the end. */
export function clampLineAnchor(
    range: LineAnchor,
    lines: number,
): LineAnchor | null {
    if (range.from > lines) return null
    return { from: range.from, to: Math.min(range.to, lines) }
}
