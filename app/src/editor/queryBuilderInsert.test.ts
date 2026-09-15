// app/src/editor/queryBuilderInsert.test.ts
// Coverage for the tracker behind slashComplete.ts's "Query builder" apply() — extracted to
// queryBuilderInsert.ts specifically because it had none: apply() itself dynamically imports
// `./openQueryBuilder` (a Solid component bun's test transform can't compile), so
// slashComplete.test.ts could only assert that the item is offered, never exercise confirm/cancel
// or the position tracking. This file drives insertViaQueryBuilder directly against a real
// (happy-dom-backed) EditorView, mirroring undoRedoScroll.test.ts's DOM-global isolation
// contract, with a synchronous fake `open` standing in for the dynamic import + modal.
import { GlobalWindow } from 'happy-dom'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
    insertViaQueryBuilder,
    QUERY_BLOCK_LOST_MESSAGE,
    type QueryBuilderBridge,
} from './queryBuilderInsert'
import { queryFenceText } from './queryBuilderEdit'

// Same pattern as undoRedoScroll.test.ts / app/src/milkdown/milkdownSerialize.test.ts:
// CodeMirror's EditorView touches `document` to build its DOM even when never attached to a
// page, so install happy-dom's globals ONLY for this file's tests (beforeAll) and remove
// exactly what we added (afterAll) so a leaked global DOM can't affect other (intentionally
// headless) test files loaded in the same `bun test app` process.
const DOM_GLOBALS = [
    'document',
    'window',
    'navigator',
    'Node',
    'Element',
    'HTMLElement',
    'Text',
    'DocumentFragment',
    'Event',
    'CustomEvent',
    'InputEvent',
    'KeyboardEvent',
    'MouseEvent',
    'DOMParser',
    'XMLSerializer',
    'getComputedStyle',
    'MutationObserver',
    'Range',
    'NodeFilter',
    'HTMLDivElement',
    'HTMLSpanElement',
    'DOMRect',
]
const installed: string[] = []

beforeAll(() => {
    const win = new GlobalWindow()
    for (const key of DOM_GLOBALS) {
        if (!(key in globalThis) && key in win) {
            ;(globalThis as Record<string, unknown>)[key] = (
                win as unknown as Record<string, unknown>
            )[key]
            installed.push(key)
        }
    }
    if (!('window' in globalThis)) {
        ;(globalThis as Record<string, unknown>).window = win
        installed.push('window')
    }
})

afterAll(() => {
    for (const key of installed)
        delete (globalThis as Record<string, unknown>)[key]
    installed.length = 0
})

/** Mount a real EditorView, attached to document.body (so `view.dom.isConnected` starts true —
 *  the state a live note editor is actually in), with no extensions of our own; the tracker adds
 *  its own listener via appendConfig, exactly as the real caller does. */
function mountView(doc: string): EditorView {
    return new EditorView({
        state: EditorState.create({ doc }),
        parent: document.body,
    })
}

describe('insertViaQueryBuilder', () => {
    test('confirm inserts exactly queryFenceText(body) at the trigger position', () => {
        const view = mountView('Intro line\n/query')
        const from = 'Intro line\n'.length
        const to = view.state.doc.length
        let bridge!: QueryBuilderBridge
        insertViaQueryBuilder(view, from, to, b => {
            bridge = b
        })
        // The trigger text is gone immediately, before the "modal" (our fake `open`) even runs.
        expect(view.state.doc.toString()).toBe('Intro line\n')

        bridge.onConfirm('of: notes')
        expect(view.state.doc.toString()).toBe(
            'Intro line\n' + queryFenceText('of: notes'),
        )
        view.destroy()
    })

    test('an edit ABOVE the tracked position before confirm inserts at the mapped position, not the stale offset', () => {
        const view = mountView('Intro line\n/query')
        const from = 'Intro line\n'.length // 11
        const to = view.state.doc.length
        let bridge!: QueryBuilderBridge
        insertViaQueryBuilder(view, from, to, b => {
            bridge = b
        })
        expect(view.state.doc.toString()).toBe('Intro line\n')

        // An edit above the tracked position (e.g. autosave reflow, another keystroke) shifts
        // everything after it. Without ChangeSet.mapPos this would insert the fence back at the
        // stale offset 11, landing mid-word instead of at the (now shifted) end of the doc.
        view.dispatch({ changes: { from: 0, to: 0, insert: 'XX' } })
        expect(view.state.doc.toString()).toBe('XXIntro line\n')

        bridge.onConfirm('of: notes')
        expect(view.state.doc.toString()).toBe(
            'XXIntro line\n' + queryFenceText('of: notes'),
        )
        view.destroy()
    })

    test('cancel (onClose) inserts nothing and tears the update listener down', () => {
        const view = mountView('/query')
        const before = view.state.facet(EditorView.updateListener).length
        let bridge!: QueryBuilderBridge
        insertViaQueryBuilder(view, 0, view.state.doc.length, b => {
            bridge = b
        })
        const during = view.state.facet(EditorView.updateListener).length
        expect(during).toBe(before + 1) // the tracker's listener is live

        bridge.onClose()
        expect(view.state.doc.toString()).toBe('') // nothing inserted
        const after = view.state.facet(EditorView.updateListener).length
        expect(after).toBe(before) // the compartment is empty again

        // Prove the listener is really gone, not just quiet: an edit after cancel must not throw
        // and must not resurrect tracking (there is nothing left to insert into).
        expect(() =>
            view.dispatch({ changes: { from: 0, to: 0, insert: 'z' } }),
        ).not.toThrow()
        view.destroy()
    })

    test('confirm on a destroyed view does not dispatch — it reports the loss instead of silently dropping the body', () => {
        const view = mountView('/query')
        let bridge!: QueryBuilderBridge
        let notified: string | undefined
        insertViaQueryBuilder(
            view,
            0,
            view.state.doc.length,
            b => {
                bridge = b
            },
            undefined,
            msg => {
                notified = msg
            },
        )
        // Simulate the note's tab being closed/switched while the modal is still open: the view
        // is destroyed (its dom detached) before the user confirms.
        view.destroy()
        expect(view.dom.isConnected).toBe(false)

        expect(() => bridge.onConfirm('of: notes')).not.toThrow()
        expect(notified).toBe(QUERY_BLOCK_LOST_MESSAGE)
    })

    test('the default notifyLost pushes a real toast when no override is given', async () => {
        const { toasts } = await import('../toastStore')
        const view = mountView('/query')
        let bridge!: QueryBuilderBridge
        insertViaQueryBuilder(view, 0, view.state.doc.length, b => {
            bridge = b
        })
        view.destroy()
        const before = toasts().length
        bridge.onConfirm('of: notes')
        expect(toasts().length).toBe(before + 1)
        expect(toasts()[toasts().length - 1].message).toBe(
            QUERY_BLOCK_LOST_MESSAGE,
        )
    })
})
