// app/src/editor/queryBuilderEdit.ts
// Pure, DOM-free editing helpers for the no-code query builder's CodeMirror side: turning a
// generated block body into fence text, and rewriting an EXISTING ```query fence's body in
// place. No Solid, no DOM — unit-tested directly like blockLocate.ts / slashMenu.ts.
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { queryRanges } from './queryRanges'

/** Wrap a generated block body in ```query fences, ready to insert into a document. */
export function queryFenceText(body: string): string {
    return '```query\n' + body + '\n```'
}

/** A transaction that replaces block `blockIndex`'s BODY (the text between its ```query fence
 *  lines) with `body`, or `null` if that index no longer names a fence — e.g. the document
 *  changed (another edit, a save/reload) between when the index was captured and when the
 *  caller is ready to apply it. Refusing to act beats guessing a neighbour, same rule as
 *  blockLocate.ts's locateBlockIndex. */
export function replaceQueryBody(
    state: EditorState,
    blockIndex: number,
    body: string,
): TransactionSpec | null {
    const ranges = queryRanges(state)
    const range = ranges[blockIndex]
    if (!range) return null
    return {
        changes: {
            from: range.bodyFrom,
            to: range.bodyFrom + range.body.length,
            insert: body,
        },
    }
}
