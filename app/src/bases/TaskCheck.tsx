import { type Component } from 'solid-js'
import { Icon } from '../icons/Icon'
import styles from './TaskCheck.module.css'

/** The four glyph states the box can paint. `doing` rather than `in-progress` because it is a
 *  DATA-ATTRIBUTE value the stylesheet matches on, not a `TaskStatus` — `taskDisplay.ts`'s
 *  `checkStatus()` is the one place the two vocabularies are bridged. */
export type TaskCheckStatus = 'todo' | 'done' | 'doing' | 'cancelled'

export type TaskCheckProps = {
    status: TaskCheckStatus
    /** Left-click: flip done ⇄ todo. */
    onToggle: (e: MouseEvent) => void
    /** Right-click: the shared status menu (app/src/taskStatusMenu.tsx). */
    onSetStatus: (e: MouseEvent) => void
    /** `row` sits inside <TaskRow>'s flex line; `cell` stands alone in a table `status` cell,
     *  where an inline <span> would drop its width/height entirely. A prop, not a second
     *  component — the mark is identical, only its box is not. */
    variant?: 'row' | 'cell'
    /** Merged onto the root so one caller can adjust one instance without forking this. */
    class?: string
}

/**
 * The task checkbox: the same mark the editor draws for a `- [ ]` line, with the done check,
 * the in-progress slash and the cancelled dash all mounted and revealed by `data-status`.
 *
 * Extracted from ListView's task row because the TABLE needs the box WITHOUT the row — its
 * `status` column becomes a checkbox cell in tasks mode, and a description-plus-chips row does
 * not fit a table cell.
 *
 * IT STOPS THE POINTER GESTURE, NOT JUST THE CLICK. `stopPropagation` on `onClick` does not
 * stop `onPointerDown`/`onPointerUp`, and a kanban card arms its column drag on pointerdown and
 * completes it (`dropCard()`) on pointerup — so without these two, ticking a task with a few
 * pixels of finger travel would also drag the card into another column. The list view has no
 * pointer handlers above it, so there the two are inert. (The card's edit MODAL is not part of
 * this: it opens from inside <KanbanCard>, which tasks mode does not render.)
 */
const TaskCheck: Component<TaskCheckProps> = props => (
    <span
        class={`${styles.taskCheck} ${props.variant === 'cell' ? styles.cell : ''} ${props.class ?? ''}`}
        data-status={props.status}
        title="Toggle task — right-click to set status"
        onClick={e => props.onToggle(e)}
        onContextMenu={e => props.onSetStatus(e)}
        onPointerDown={e => e.stopPropagation()}
        onPointerUp={e => e.stopPropagation()}
    >
        <span class={`${styles.ckGlyph} ${styles.ckCheck}`}>
            <Icon value="Check" size={11} strokeWidth={3} />
        </span>
        <span class={`${styles.ckGlyph} ${styles.ckSlash}`} />
        <span class={`${styles.ckGlyph} ${styles.ckDash}`} />
    </span>
)

export default TaskCheck
