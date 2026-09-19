import { type Component } from 'solid-js'
import { chipKeyAction } from '../calendar/taskChipKeys'
import Text from '../ui/Text'
import styles from './TaskCheck.module.css'

/** The four glyph states the box can paint. `doing` rather than `in-progress` because it is a
 *  DATA-ATTRIBUTE value the stylesheet matches on, not a `TaskStatus` — `taskDisplay.ts`'s
 *  `checkStatus()` is the one place the two vocabularies are bridged. */
export type TaskCheckStatus = 'todo' | 'done' | 'doing' | 'cancelled'

export type TaskCheckProps = {
    status: TaskCheckStatus
    /** Left-click, or Space/Enter while focused: flip done ⇄ todo. Every caller's handler is
     *  already `(row, e: Event)`, so a KeyboardEvent flows through unchanged. */
    onToggle: (e: Event) => void
    /** Right-click, or Shift+F10 / the ContextMenu key while focused: the shared status menu
     *  (app/src/taskStatusMenu.tsx). Stays `MouseEvent` because every caller positions the menu
     *  at `clientX`/`clientY`; the keyboard path hands over a synthesized one anchored to the
     *  mark's bottom-left, the same anchor TaskChip uses. */
    onSetStatus: (e: MouseEvent) => void
    /** `row` sits inside <TaskRow>'s flex line; `cell` stands alone in a table `status` cell,
     *  where an inline <span> would drop its width/height entirely. A prop, not a second
     *  component — the mark is identical, only its box is not. */
    variant?: 'row' | 'cell'
    /** Merged onto the root so one caller can adjust one instance without forking this. */
    class?: string
    /** Overrides the accessible name. The mark itself is plain bracket text with no adjoining
     *  `<label>`, so a caller whose task text sits beside the mark as a sibling (not wrapping
     *  it) must supply the task's own text here — otherwise a screen reader announces only
     *  "checkbox, not checked" with no indication of which task. */
    label?: string
}

const MARK: Record<TaskCheckStatus, string> = {
    todo: '[ ]',
    done: '[x]',
    doing: '[/]',
    cancelled: '[-]',
}

/**
 * The task checkbox: a literal `[ ]` / `[x]` / `[/]` / `[-]` bracket marker, the same register
 * `calendar/components/TaskChip.tsx` renders for the tasks calendar — plain muted text, not a
 * drawn box.
 *
 * Extracted from ListView's task row because the TABLE needs the mark WITHOUT the row — its
 * `status` column becomes a checkbox cell in tasks mode, and a description-plus-chips row does
 * not fit a table cell.
 *
 * IT STOPS THE POINTER GESTURE, NOT JUST THE CLICK. `stopPropagation` on `onClick` does not
 * stop `onPointerDown`/`onPointerUp`, and a kanban card arms its column drag on pointerdown and
 * completes it (`dropCard()`) on pointerup — so without these two, ticking a task with a few
 * pixels of finger travel would also drag the card into another column. The list view has no
 * pointer handlers above it, so there the two are inert. (The card's edit MODAL is not part of
 * this: it opens from inside <KanbanCard>, which tasks mode does not render.)
 *
 * KEYBOARD. `role="checkbox"` promises a keyboard path, so the mark is in the tab order and the
 * key mapping is `calendar/taskChipKeys.ts`'s pure `chipKeyAction` — the calendar chip's own
 * vocabulary: Space toggles, Shift+F10 / ContextMenu opens the status menu, Ctrl/Meta combos
 * pass through. The chip's `open` (Enter) has nothing to open here, so Enter toggles too, as a
 * native checkbox-in-a-form user would expect; the chip's Alt+arrow reschedule is ignored.
 */
const TaskCheck: Component<TaskCheckProps> = props => (
    <Text
        as="span"
        size="inherit"
        tone="inherit"
        weight="inherit"
        class={`${styles.taskCheck} ${props.variant === 'cell' ? styles.cell : ''} ${props.class ?? ''}`}
        data-status={props.status}
        title="Toggle task — right-click to set status"
        role="checkbox"
        aria-label={props.label}
        aria-checked={
            props.status === 'doing'
                ? 'mixed'
                : props.status === 'done'
                  ? 'true'
                  : 'false'
        }
        tabIndex={0}
        aria-keyshortcuts="Space Enter Shift+F10"
        onClick={e => props.onToggle(e)}
        onKeyDown={e => {
            const action = chipKeyAction(e)
            if (!action || action.kind === 'reschedule') return
            e.preventDefault()
            e.stopPropagation()
            if (action.kind === 'menu') {
                const r = e.currentTarget.getBoundingClientRect()
                return props.onSetStatus(
                    new MouseEvent('contextmenu', {
                        clientX: r.left,
                        clientY: r.bottom,
                        cancelable: true,
                    }),
                )
            }
            props.onToggle(e)
        }}
        onContextMenu={e => props.onSetStatus(e)}
        onPointerDown={e => e.stopPropagation()}
        onPointerUp={e => e.stopPropagation()}
    >
        {MARK[props.status]}
    </Text>
)

export default TaskCheck
