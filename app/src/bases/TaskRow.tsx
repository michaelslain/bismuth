import { Show, type Component } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import { todayISO } from '../../../core/src/dates'
import ListRow from '../ui/ListRow'
import Text from '../ui/Text'
import { IconButton } from '../ui/IconButton'
import TaskCheck from './TaskCheck'
import TaskText from './TaskText'
import TaskFieldChips from './TaskFieldChips'
import { checkStatus, isOverdue } from './taskDisplay'
import { isEditableTask } from './taskEdit'
import { openTaskEditor } from './openTaskEditor'
import styles from './TaskRow.module.css'

export type TaskRowProps = {
    row: Row
    /** Left-click the box: flip done ⇄ todo. */
    onToggle: (row: Row, e: Event) => void
    /** Right-click the box: pick an exact status. */
    onSetStatus: (row: Row, e: MouseEvent) => void
    /** `list` keeps the list view's gutter; `card` drops it, because a kanban or masonry
     *  card already supplies its own padding. Variants are props, not extra files. */
    variant?: 'list' | 'card'
    /** Merged onto the root so one caller can adjust one instance without forking this. */
    class?: string
    /** Which `note.*` key a STORED row's category lives under — passed through to the edit
     *  modal opened by the trailing pencil button. Optional: undefined lets the modal fall
     *  back to its own default ('category'). */
    categoryField?: string
    /** Called after the edit modal saves, deletes, or moves the task — lets the caller
     *  refetch. Optional: a caller with no refetch of its own (a story) can omit it. */
    onChanged?: () => void
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
            <ListRow
                baseline
                reveal
                class={styles.line}
                leading={
                    <TaskCheck
                        status={status()}
                        onToggle={e => props.onToggle(props.row, e)}
                        onSetStatus={e => props.onSetStatus(props.row, e)}
                    />
                }
                trailing={
                    <Show when={isEditableTask(props.row)}>
                        <IconButton
                            icon="Pencil"
                            label="Edit task"
                            size="sm"
                            onClick={e => {
                                e.stopPropagation()
                                openTaskEditor({
                                    row: props.row,
                                    categoryField: props.categoryField,
                                    onChanged: props.onChanged,
                                })
                            }}
                        />
                    </Show>
                }
            >
                <Text
                    as="span"
                    inherit
                    class={`${styles.taskBody} ${done() ? styles.done : ''}`}
                >
                    <TaskText text={desc()} />
                    <TaskFieldChips
                        priority={priority()}
                        start={start()}
                        scheduled={scheduled()}
                        due={due()}
                        recurrence={recurrence()}
                        overdue={overdue()}
                    />
                </Text>
            </ListRow>
        </div>
    )
}

export default TaskRow
