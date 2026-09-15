// app/src/editor/queryRanges.ts
// Pure ```query fence-range finder, extracted out of queryBlock.ts so it can be imported by a
// headless-tested .ts module. queryBlock.ts transitively imports `../bases/BaseView` (a Solid
// component), which bun's test transform can't compile outside a .tsx or a dynamic import — the
// same trap cellEditorExtensions.ts documents for `livePreview`. queryBuilderEdit.ts needs this
// finder to stay pure and unit-tested (TransactionSpec math, no Solid, no DOM), so the finder
// itself lives here; queryBlock.ts re-exports it for its own callers (reveal(), buildDecorations()).
import type { EditorState } from '@codemirror/state'

// The ONE embedded block: ```query — kept in sync with queryBlock.ts's own copy of this comment.
// See queryBlock.ts for the full rationale; this file only owns the regex + range extraction.
const QUERY_FENCE = /^```query[ \t]*\n([\s\S]*?)\n```/gm

export interface QueryRange {
    from: number
    to: number
    bodyFrom: number
    body: string
}

/** All ```query fences in the document, in order. */
export function queryRanges(state: EditorState): QueryRange[] {
    const text = state.doc.toString()
    const out: QueryRange[] = []
    QUERY_FENCE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = QUERY_FENCE.exec(text))) {
        const from = m.index
        const bodyFrom = from + m[0].indexOf('\n') + 1 // first char after the ```query line
        out.push({ from, to: from + m[0].length, bodyFrom, body: m[1] })
    }
    return out
}
