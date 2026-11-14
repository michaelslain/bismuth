// Shared task-status right-click menu: the option set + an imperative opener, used by both
// the cards view (BodyCard) and the note editor (livePreview's CodeMirror checkbox widget).
// `char` is the box char written between the brackets; the CURRENT status is filtered out so
// the menu only ever offers the OTHER modes (per the spec).
import { ContextMenu, type MenuItem } from './ui/ContextMenu'
import { mountModal } from './ui/mountModal'
import TaskMark from './ui/TaskMark'
import {
    TASK_STATUS_OPTIONS,
    isCurrentStatus,
    otherStatuses,
    type TaskStatusOption,
} from './taskStatusOptions'

export { TASK_STATUS_OPTIONS, isCurrentStatus, type TaskStatusOption }

/** The menu items for a task whose current box char is `cur`, each invoking `onPick(char)`. */
export function taskStatusItems(
    cur: string,
    onPick: (char: string) => void,
): MenuItem[] {
    return otherStatuses(cur).map(o => ({
        label: o.label,
        prefix: <TaskMark char={o.char} />,
        onSelect: () => onPick(o.char),
    }))
}

/**
 * Imperatively mount the shared <ContextMenu> at (x, y) for picking a task status — for callers
 * OUTSIDE Solid's reactive tree (the CodeMirror editor). Solid components inside the tree
 * (BodyCard) render <ContextMenu> directly instead. Self-disposing: closes on pick, Escape, or
 * outside-click, then removes its host node.
 */
export function openTaskStatusMenu(
    x: number,
    y: number,
    cur: string,
    onPick: (char: string) => void,
): void {
    mountModal(close => (
        <ContextMenu
            x={x}
            y={y}
            items={taskStatusItems(cur, onPick)}
            onClose={close}
        />
    ))
}
