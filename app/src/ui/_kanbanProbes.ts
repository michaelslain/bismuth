// Story helpers shared across KanbanView.stories.tsx — the column-menu open sequence and the
// `views` config literal were each retyped in ~20 stories; this is the one place both live now.
import { userEvent, within } from 'storybook/test'

/** Opens a kanban column's `…` menu: finds the column by `data-kbcol="<colKey>"`, takes its
 *  (first) "Column menu" trigger, focuses it — the trigger sits `pointer-events: none` at rest
 *  (Finding 2 — it occupies the count's own slot until hovered/focused), so a pointer click can't
 *  reach it reliably — and presses Enter, same as a real keyboard user would. */
export async function openColumnMenu(
    canvasElement: HTMLElement,
    colKey: string,
): Promise<void> {
    const col = canvasElement.querySelector<HTMLElement>(
        `[data-kbcol="${colKey}"]`,
    )!
    const menu = within(col).getAllByLabelText('Column menu')[0]!
    menu.focus()
    await userEvent.keyboard('{Enter}')
}

/** The kanban `views` config literal — `type: 'kanban'`, `name: 'Kanban'`, grouped by `status`,
 *  ordered by `priority`/`tags` — retyped across ~20 stories. `overrides` replaces only the keys
 *  that vary for a given story (`order`, `groupOrder`, `groupColors`, …). */
export function kanbanViews(overrides?: Record<string, unknown>) {
    return [
        {
            type: 'kanban' as const,
            name: 'Kanban',
            groupBy: { property: 'status' },
            order: ['priority', 'tags'],
            ...overrides,
        },
    ]
}
