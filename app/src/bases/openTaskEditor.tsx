// Mounts <TaskEditModal> outside any Solid component tree, for callers that are plain
// functions (a row's click handler built with createElement-free imperative code, e.g.
// CalendarView.tsx's chip click) rather than JSX inside the app's own component tree.
// Same shape as editor/openQueryBuilder.tsx: append a fresh container to document.body,
// render into it, tear down on close. Not a double portal — FormModal -> Modal already
// portals its actual dialog DOM to document.body (see ui/Modal.tsx); this container is
// only ever a mount point, never visible itself.
import { render } from 'solid-js/web'
import type { Row } from '../../../core/src/bases/types'
import TaskEditModal from './TaskEditModal'

export type TaskEditorOptions = {
    row: Row
    categoryField?: string
    categories?: string[]
    destinations?: { label: string; path: string }[]
    onChanged?: () => void
}

export function openTaskEditor(opts: TaskEditorOptions): void {
    const container = document.createElement('div')
    document.body.appendChild(container)

    let dispose: () => void = () => {}
    const close = () => {
        dispose()
        container.remove()
    }

    dispose = render(
        () => (
            <TaskEditModal
                row={opts.row}
                categoryField={opts.categoryField}
                categories={opts.categories}
                destinations={opts.destinations}
                onChanged={opts.onChanged}
                onClose={close}
            />
        ),
        container,
    )
}
