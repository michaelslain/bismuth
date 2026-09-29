// Mounts <TaskEditModal> outside any Solid component tree, for callers that are plain
// functions (a row's click handler built with createElement-free imperative code, e.g.
// CalendarView.tsx's chip click) rather than JSX inside the app's own component tree.
// Mounted through ui/mountModal, the one imperative mount.
import type { Row } from '../../../core/src/bases/types'
import TaskEditModal from './TaskEditModal'
import { mountModal } from '../ui/mountModal'

export type TaskEditorOptions = {
    row: Row
    categoryField?: string
    categories?: string[]
    destinations?: { label: string; path: string }[]
    onChanged?: () => void
}

export function openTaskEditor(opts: TaskEditorOptions): void {
    mountModal(close => (
        <TaskEditModal
            row={opts.row}
            categoryField={opts.categoryField}
            categories={opts.categories}
            destinations={opts.destinations}
            onChanged={opts.onChanged}
            onClose={close}
        />
    ))
}
