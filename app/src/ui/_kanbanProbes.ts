// Story helpers shared across KanbanView.stories.tsx / KanbanColumns.stories.tsx /
// KanbanStoredRows.stories.tsx — the column header rename/delete sequence and the `views` config
// literal were each retyped in ~20 stories; this is the one place both live now.
import { within } from 'storybook/test'

/** Focuses a kanban column header's hover-revealed `[✎]`/`[🗑]` IconButton (rename/delete —
 *  `KanbanView.module.css`'s `.kbHeaderActions`, opacity/pointer-events 0 at rest, revealed on
 *  the column's `:hover`/`[data-hover]` or the header's `:focus-within`). CSS `:hover` can't be
 *  posed from a story — it follows the physical pointer, `userEvent.hover` only dispatches events
 *  without moving it (see TabRail.stories.tsx; KanbanView's own `data-hover` mirror is what
 *  HeaderActionsOnHover exercises) — but `:focus-within` follows real focus, so focusing the button itself
 *  both reveals it and gives it keyboard focus in one step, same as a real keyboard user tabbing
 *  to it. Returns the column element so the caller can scope its own follow-up queries (the
 *  rename field that replaces the title renders inline in this same header, not portaled). */
export function focusColumnHeaderButton(
    canvasElement: HTMLElement,
    colKey: string,
    label: 'Rename column' | 'Delete column',
): HTMLElement {
    const col = canvasElement.querySelector<HTMLElement>(
        `[data-kbcol="${colKey}"]`,
    )!
    ;(within(col).getByLabelText(label) as HTMLElement).focus()
    return col
}

/** The kanban `views` config literal — `type: 'kanban'`, `name: 'Kanban'`, grouped by `status`,
 *  ordered by `priority`/`tags` — retyped across ~20 stories. `overrides` replaces only the keys
 *  that vary for a given story (`order`, `groupOrder`, `groupColors`, …). An `undefined` value in
 *  `overrides` OMITS that key entirely rather than setting it to `undefined` — `kanbanViews({
 *  order: undefined })` yields a literal with no `order` key at all, matching what a hand-written
 *  literal without `order` would look like. */
export function kanbanViews(overrides?: Record<string, unknown>) {
    const clean = Object.fromEntries(
        Object.entries(overrides ?? {}).filter(([, v]) => v !== undefined),
    )
    return [
        {
            type: 'kanban' as const,
            name: 'Kanban',
            groupBy: { property: 'status' },
            order: ['priority', 'tags'],
            ...clean,
        },
    ]
}
