// app/src/ui/_tagsFieldPlay.ts — story-play helpers for ui/TagsField (the single-line editor a
// tags / multiselect property is typed in). Shared by the TagsField, PropertyValueEditor,
// TableView and CardEditModal stories so each drives the field the same way a person does.
//
// Typing goes through CodeMirror as `input.type` transactions — the annotation CodeMirror's own
// DOM input handling stamps on real keystrokes, which is what opens the completion popup
// (`activateOnTyping`) and what TagsField's `#` trigger listens for. Keys (Tab, Enter, Escape,
// arrows) are real KeyboardEvents on the editor's content element, which CodeMirror's keymaps
// handle exactly as they do a physical key.
import { EditorView } from '@codemirror/view'
import { expect, waitFor } from 'storybook/test'

/** The TagsField editor inside `root` (the first one, or the one matching `index`). */
export async function tagsFieldView(root: ParentNode, index = 0): Promise<EditorView> {
    return waitFor(() => {
        const host = root.querySelectorAll<HTMLElement>('[data-tags-field] .cm-editor')[index]
        const view = host && EditorView.findFromDOM(host)
        if (!view) throw new Error('no TagsField editor mounted')
        return view
    })
}

/** Type `text` at the caret, one character per transaction, as keystrokes would. */
export function typeInto(view: EditorView, text: string): void {
    view.focus()
    for (const ch of text) {
        const pos = view.state.selection.main.head
        view.dispatch({
            changes: { from: pos, insert: ch },
            selection: { anchor: pos + 1 },
            userEvent: 'input.type',
        })
    }
}

/** Press a key on the editor (`Tab`, `Enter`, `Escape`, `ArrowDown`, …). */
export function pressKey(view: EditorView, key: string): KeyboardEvent {
    const e = new KeyboardEvent('keydown', {
        key,
        code: key,
        bubbles: true,
        cancelable: true,
    })
    view.contentDOM.dispatchEvent(e)
    return e
}

/** The labels in the open completion popup, top to bottom; empty when it is closed. */
export function completionLabels(doc: Document = document): string[] {
    return [...doc.querySelectorAll('.cm-tooltip-autocomplete li .cm-completionLabel')].map(
        el => (el.textContent ?? '').trim(),
    )
}

/** The highlighted row's label in the open popup, or null. */
export function selectedCompletion(doc: Document = document): string | null {
    const li = doc.querySelector('.cm-tooltip-autocomplete li[aria-selected="true"]')
    return li?.querySelector('.cm-completionLabel')?.textContent?.trim() ?? null
}

/** Wait until the popup lists exactly `labels`, in order — then a beat longer, because
 *  CodeMirror ignores an accept (Tab/Enter) pressed within its `interactionDelay` (75ms) of the
 *  popup opening. A person never presses that fast; a play does. */
export async function expectCompletions(labels: string[]): Promise<void> {
    await waitFor(() => expect(completionLabels()).toEqual(labels))
    if (labels.length) await new Promise(r => setTimeout(r, 120))
}
