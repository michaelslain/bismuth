// app/src/editor/TaskCheckbox.tsx
//
// The task-list checkbox rendered inside the live-preview editor. A small Solid
// component (mounted into a CodeMirror widget by livePreview.ts) so it stays
// consistent with the rest of the app: a reactive `data-status` flips in place, and the
// marker is the literal `[ ]` / `[x]` / `[/]` / `[-]` text, the same register as
// bases/TaskCheck.tsx and the calendar TaskChip, so every todo in the app reads alike.
import { type Accessor } from 'solid-js'
import BracketToggle from '../ui/BracketToggle'
import Text from '../ui/Text'

// Status comes from the char between the brackets: space=todo, x/X=done,
// "/" or "\"=in-progress, "-"=cancelled. done + cancelled strike the text.
export type TaskStatus = 'todo' | 'done' | 'doing' | 'cancelled'

export function charToStatus(ch: string): TaskStatus {
    if (ch === 'x' || ch === 'X') return 'done'
    if (ch === '/' || ch === '\\') return 'doing'
    if (ch === '-') return 'cancelled'
    return 'todo'
}

/**
 * The bracket marker. The GLYPH is `ui/BracketToggle` in its four-state form — the one bracket
 * recipe every checkbox in the app draws, shared with `bases/TaskCheck.tsx` rather than written a
 * second time as a `[ ]`/`[x]`/`[/]`/`[-]` string table here. The inks come from livePreview.ts's
 * theme (`.cm-task-checkbox[data-status]`), which drives that primitive's `--bracket-*` custom
 * properties with the same status map `bases/TaskCheck.module.css` declares.
 *
 * ARIA: `role="checkbox"` + `aria-checked` (with `mixed` for an in-progress task) so the mark is
 * announced as the control it is, instead of as the literal characters "[ x ]".
 *
 * TWO THINGS IT DELIBERATELY DOES NOT CARRY, both because of where it lives — inside the
 * CodeMirror document, as a replace widget:
 *  - NO `aria-label`. The task's own text is this widget's immediate sibling in the same line, so
 *    a screen reader reading the line already announces the name right after the state. Threading
 *    the text in would put it in `CheckboxWidget.eq()`, and the widget would then be destroyed and
 *    rebuilt on every keystroke in the task.
 *  - NO tab stop. The editor's keymap owns Tab (list indent/outdent), so focus can never land
 *    here by tabbing; a `tabindex` would be a promise of a keyboard path that cannot be reached.
 *    The toggle is driven by the EditorView's own click handler (livePreview.ts), not from here.
 */
export function TaskCheckbox(props: { status: Accessor<TaskStatus> }) {
    // The two extra marks BracketToggle takes as `state`; `checked` covers the other two. Read
    // through a local so TypeScript narrows the union — `props.status()` is a call, not a field.
    const extraMark = () => {
        const s = props.status()
        return s === 'doing' || s === 'cancelled' ? s : undefined
    }
    return (
        <Text
            as="span"
            inherit
            class="cm-task-checkbox"
            data-status={props.status()}
            role="checkbox"
            aria-checked={
                props.status() === 'doing'
                    ? 'mixed'
                    : props.status() === 'done'
                      ? 'true'
                      : 'false'
            }
        >
            <BracketToggle
                checked={props.status() === 'done'}
                state={extraMark()}
            />
        </Text>
    )
}
