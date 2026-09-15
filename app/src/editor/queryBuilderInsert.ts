// app/src/editor/queryBuilderInsert.ts
// Pure(ish) position-tracking behind the "Query builder" slash item (slashComplete.ts's
// applyQueryBuilder). Split out of slashComplete.ts so it can be unit-tested with a real
// (happy-dom) EditorView — see undoRedoScroll.test.ts's DOM-global isolation contract — without
// pulling in the Solid QueryBuilder component that makes openQueryBuilder.tsx uncompilable under
// bun's test transform (the same trap queryRanges.ts/queryBuilderEdit.ts document for this
// module's neighbours).
//
// The doc can change while the modal is open (autosave reflow, a wikilink edit elsewhere, even
// another keystroke once focus returns to the editor before confirm) — a raw remembered offset
// would then insert into the wrong place. So the insertion point is tracked LIVE through every
// intervening change via a transient `EditorView.updateListener`, added through a throwaway
// Compartment right on the deletion transaction and torn down in the same dispatch that inserts
// the fence (confirm) or on close (cancel) — `ChangeSet.mapPos` is CodeMirror's own answer to
// "where did this position go", so this never has to re-validate a stale guess.
import type { TransactionSpec } from '@codemirror/state'
import { Compartment, StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { queryFenceText } from './queryBuilderEdit'
import { pushToast } from '../toastStore'

// Shared with QueryBlockWidget.editQuery in queryBlock.ts, which hits the same "the view is gone
// by the time confirm fires" case through its own (DOM-position-based) relocation instead of this
// tracker — one message either way.
export const QUERY_BLOCK_LOST_MESSAGE =
    "Query block wasn't inserted — the note was closed"

export type QueryBuilderBridge = {
    onConfirm: (body: string) => void
    onClose: () => void
}

/** Delete `[from, to)` (the `/…` trigger text the slash item matched), start tracking where that
 *  point lands through every later doc change, and hand `open` a `{ onConfirm, onClose }` bridge:
 *  `onConfirm(body)` inserts `queryFenceText(body)` at the tracked position and tears the tracker
 *  down; `onClose()` tears it down without inserting anything.
 *
 *  `open` is the caller's job, not this function's — real callers dynamically import
 *  `./openQueryBuilder` and call it from inside `open` (see slashComplete.ts, which keeps the
 *  dynamic import for the reason documented there); a test can pass a synchronous fake that
 *  captures the bridge directly.
 *
 *  If the view is destroyed (its `dom` detached — e.g. the note's tab was closed or switched)
 *  by the time `onConfirm` fires, dispatching to it would be a silent no-op (`@codemirror/view`
 *  never throws on a destroyed view), so the confirmed body would vanish with no sign anything
 *  went wrong. Detect that instead of dispatching, and tell the user via `notifyLost` (a toast
 *  by default; tests can inject their own to avoid depending on the real toast store). */
export function insertViaQueryBuilder(
    view: EditorView,
    from: number,
    to: number,
    open: (bridge: QueryBuilderBridge) => void,
    annotations?: TransactionSpec['annotations'],
    notifyLost: (message: string) => void = message => pushToast(message),
): void {
    const tracker = new Compartment()
    let pos = from
    view.dispatch({
        changes: { from, to, insert: '' },
        effects: StateEffect.appendConfig.of(
            tracker.of(
                EditorView.updateListener.of(update => {
                    if (update.docChanged) pos = update.changes.mapPos(pos)
                }),
            ),
        ),
        annotations,
    })
    open({
        onConfirm: body => {
            if (!view.dom.isConnected) {
                notifyLost(QUERY_BLOCK_LOST_MESSAGE)
                return
            }
            view.dispatch({
                changes: { from: pos, to: pos, insert: queryFenceText(body) },
                effects: tracker.reconfigure([]),
            })
        },
        onClose: () => {
            view.dispatch({ effects: tracker.reconfigure([]) })
        },
    })
}
