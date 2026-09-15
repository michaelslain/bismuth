import { Show, type Component, type JSX } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import { todayISO } from '../../../core/src/dates'
import { formatDateField } from '../../../core/src/taskFields'
import TaskCheck from './TaskCheck'
import { checkStatus, isOverdue, PRIORITY_MARK } from './taskDisplay'
import styles from './TaskRow.module.css'

// Render a task description as lightweight inline markdown — wikilinks become
// clickable, #tags get the tag color, **bold**/*italic* render — so a task line
// reads like it does in the editor instead of as flat, truncated text.
const INLINE_RE =
    /\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|(^|\s)#([A-Za-z0-9_/-]+)|\*\*([^*]+)\*\*|\*([^*]+)\*/g
function renderTaskText(text: string): JSX.Element[] {
    const out: JSX.Element[] = []
    let last = 0
    let m: RegExpExecArray | null
    INLINE_RE.lastIndex = 0
    while ((m = INLINE_RE.exec(text))) {
        if (m.index > last) out.push(text.slice(last, m.index))
        if (m[1] !== undefined) {
            // [[wikilink]] -> open the note
            const [target, display] = m[1].split('|')
            const label = display ?? target.split('/').pop() ?? target
            const path = target.endsWith('.md') ? target : `${target}.md`
            out.push(
                <span
                    class={styles.taskLink}
                    onClick={e => {
                        e.stopPropagation()
                        window.dispatchEvent(
                            new CustomEvent('bismuth-open', { detail: path }),
                        )
                    }}
                >
                    {label}
                </span>,
            )
        } else if (m[2] !== undefined) {
            // [label](url) -> external links open in a new tab; note paths open in-app
            const url = m[3]
            const external = /^https?:\/\//.test(url)
            out.push(
                <span
                    class={styles.taskLink}
                    title={url}
                    onClick={e => {
                        e.stopPropagation()
                        if (external) window.open(url, '_blank', 'noopener')
                        else
                            window.dispatchEvent(
                                new CustomEvent('bismuth-open', {
                                    detail: url.endsWith('.md')
                                        ? url
                                        : `${url}.md`,
                                }),
                            )
                    }}
                >
                    {m[2]}
                </span>,
            )
        } else if (m[5] !== undefined) {
            if (m[4]) out.push(m[4]) // preserve the whitespace captured before the tag
            out.push(<span class={styles.taskTag}>#{m[5]}</span>)
        } else if (m[6] !== undefined) {
            out.push(<strong>{m[6]}</strong>)
        } else if (m[7] !== undefined) {
            out.push(<em>{m[7]}</em>)
        }
        last = INLINE_RE.lastIndex
    }
    if (last < text.length) out.push(text.slice(last))
    return out
}

export type TaskRowProps = {
    row: Row
    /** Left-click the box: flip done ⇄ todo. */
    onToggle: (row: Row, e: Event) => void
    /** Right-click the box: pick an exact status. */
    onSetStatus: (row: Row, e: MouseEvent) => void
    /** `list` keeps the list view's 18px gutter; `card` drops it, because a kanban or masonry
     *  card already supplies its own padding. Variants are props, not extra files. */
    variant?: 'list' | 'card'
    /** Merged onto the root so one caller can adjust one instance without forking this. */
    class?: string
}

/**
 * ONE task line, in the compact register `calendar/components/TaskChip.tsx` established: a
 * `[ ]` bracket marker, a markdown description, and the parsed signifiers (priority + dates +
 * recurrence) as plain muted text. The note editor's own checkbox (`editor/livePreview.ts`'s
 * `.cm-task-checkbox`) renders the same bracket look now too, so this is one shared marker
 * register across the row views and the CodeMirror note editor, not two.
 *
 * It is the shared body of every ROW view in tasks mode — list, bullets, cards and kanban all
 * render this, so "tasks mode" looks the same regardless of the view KIND, and regardless of
 * whether the row was scanned out of a note's checkbox line or stored as a YAML row in a
 * base's own body. It reads only `note.*` keys BOTH producers emit (core/src/bases/taskRow.ts),
 * so it never has to ask which kind it is holding — the write seam above it does that.
 *
 * Props are read through accessors and never destructured: this is Solid, and destructuring
 * would read each field once at setup and never see a later change.
 */
const TaskRow: Component<TaskRowProps> = props => {
    const n = () => props.row.note
    const status = () => checkStatus(n().status)
    const done = () => n().status === 'done'
    const desc = () => String(n().description ?? props.row.file.name)
    const priority = () => n().priority as string | undefined
    const due = () => n().due as string | undefined
    const scheduled = () => n().scheduled as string | undefined
    const start = () => n().start as string | undefined
    const recurrence = () => n().recurrence as string | undefined
    const overdue = () => isOverdue(n(), todayISO())

    return (
        <div
            class={`${styles.taskItem} ${props.variant === 'card' ? styles.inCard : ''} ${props.class ?? ''}`}
        >
            <TaskCheck
                status={status()}
                onToggle={e => props.onToggle(props.row, e)}
                onSetStatus={e => props.onSetStatus(props.row, e)}
            />
            <span class={`${styles.taskBody} ${done() ? styles.done : ''}`}>
                {renderTaskText(desc())}
                <Show when={priority() && priority() !== 'none'}>
                    <span
                        class={styles.taskField}
                        title={`${priority()} priority`}
                    >
                        {PRIORITY_MARK[priority()!]}
                    </span>
                </Show>
                <Show when={start()}>
                    <span class={styles.taskField}>
                        {formatDateField('start', start()!)}
                    </span>
                </Show>
                <Show when={scheduled()}>
                    <span class={styles.taskField}>
                        {formatDateField('scheduled', scheduled()!)}
                    </span>
                </Show>
                <Show when={due()}>
                    <span
                        class={`${styles.taskField} ${overdue() ? styles.overdue : ''}`}
                    >
                        {formatDateField('due', due()!)}
                    </span>
                </Show>
                <Show when={recurrence()}>
                    <span class={styles.taskField}>[{recurrence()}]</span>
                </Show>
            </span>
        </div>
    )
}

export default TaskRow
