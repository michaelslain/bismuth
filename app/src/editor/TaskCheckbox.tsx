// app/src/editor/TaskCheckbox.tsx
//
// The task-list checkbox rendered inside the live-preview editor. A small Solid
// component (mounted into a CodeMirror widget by livePreview.ts) so it stays
// consistent with the rest of the app: a reactive `data-status` flips in place, and the
// marker is the literal `[ ]` / `[x]` / `[/]` / `[-]` text, the same register as
// bases/TaskCheck.tsx and the calendar TaskChip, so every todo in the app reads alike.
import { type Accessor } from 'solid-js'

// Status comes from the char between the brackets: space=todo, x/X=done,
// "/" or "\"=in-progress, "-"=cancelled. done + cancelled strike the text.
export type TaskStatus = 'todo' | 'done' | 'doing' | 'cancelled'

export function charToStatus(ch: string): TaskStatus {
    if (ch === 'x' || ch === 'X') return 'done'
    if (ch === '/' || ch === '\\') return 'doing'
    if (ch === '-') return 'cancelled'
    return 'todo'
}

const MARK: Record<TaskStatus, string> = {
    todo: '[ ]',
    done: '[x]',
    doing: '[/]',
    cancelled: '[-]',
}

/** The bracket marker. Styled by livePreview.ts's theme (`.cm-task-checkbox[data-status]`). */
export function TaskCheckbox(props: { status: Accessor<TaskStatus> }) {
    return (
        <span class="cm-task-checkbox" data-status={props.status()}>
            {MARK[props.status()]}
        </span>
    )
}
