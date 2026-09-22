// Visual spec for <KanbanColumnMenu> — a kanban column header's `…` menu (Rename / Delete).
// Presentational: it owns only its own trigger + popover state (and the inline rename text
// field); persisting a rename/delete is entirely the caller's `onRename`/`onDelete`. The popover
// is portaled (AnchoredPopover), so play() reads it off `canvasElement.ownerDocument.body`, the
// same pattern DateFieldEditor.stories.tsx uses.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import KanbanColumnMenu from './KanbanColumnMenu'

const meta = {
    title: 'Bases/KanbanColumnMenu',
    component: KanbanColumnMenu,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof KanbanColumnMenu>

export default meta
type Story = StoryObj<typeof meta>

/** Resting trigger — the `…` button, faint until hovered/focused in real use (driven by the
 *  HOST's `.kanbanColHeader:hover`/`:focus-within` rule, not visible in this isolated story). */
export const Default: Story = {
    args: {
        name: 'Todo',
        canDelete: false,
        existing: ['Doing', 'Done'],
        onRename: () => {},
        onDelete: () => {},
    },
}

let renamedTo: string[] = []

/** Clicking the trigger opens Rename/Delete; picking Rename swaps in a text field prefilled
 *  with the column's current name; typing a fresh name and Enter fires `onRename` trimmed, and
 *  the popover closes. A name matching an existing column is refused inline (`already a
 *  column`), same wording as KanbanAddColumn's duplicate check. */
export const RenameFlow: Story = {
    render: () => {
        renamedTo = []
        return (
            <KanbanColumnMenu
                name="Todo"
                canDelete={false}
                existing={['Doing', 'Done']}
                onRename={to => renamedTo.push(to)}
                onDelete={() => {}}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        const trigger = canvas.getByLabelText('Column menu') as HTMLElement
        // The trigger is `pointer-events: none` at rest (Finding 2 — it sits over the column
        // count's own slot and must not intercept a pointer click there); a keyboard user still
        // reaches it via focus + Enter, which is what this drives instead of a pointer click.
        trigger.focus()
        await userEvent.keyboard('{Enter}')
        const rename = await waitFor(() => body.getByText('rename'))
        await userEvent.click(rename)
        const input = await waitFor(() => body.getByDisplayValue('Todo'))
        await userEvent.clear(input)
        await userEvent.type(input, '  Backlog  ')
        await userEvent.keyboard('{Enter}')
        expect(renamedTo).toEqual(['Backlog'])
        await waitFor(() =>
            expect(body.queryByTestId('kanban-column-menu')).toBeNull(),
        )

        // Reopen + retype a name that collides with an existing column — refused inline.
        trigger.focus()
        await userEvent.keyboard('{Enter}')
        await userEvent.click(await waitFor(() => body.getByText('rename')))
        const input2 = await waitFor(() => body.getByDisplayValue('Todo'))
        await userEvent.clear(input2)
        await userEvent.type(input2, 'Doing')
        await userEvent.keyboard('{Enter}')
        await waitFor(() => body.getByText('already a column'))
        expect(renamedTo).toEqual(['Backlog'])
    },
}

/** `canDelete: false` (a non-empty column) shows Delete disabled, with a reason. */
export const DeleteDisabled: Story = {
    render: () => (
        <KanbanColumnMenu
            name="Todo"
            canDelete={false}
            existing={['Doing', 'Done']}
            onRename={() => {}}
            onDelete={() => {}}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        // pointer-events: none at rest (Finding 2) — reach the trigger via keyboard, as a real
        // keyboard user would.
        ;(canvas.getByLabelText('Column menu') as HTMLElement).focus()
        await userEvent.keyboard('{Enter}')
        await waitFor(() => body.getByText('delete'))
        await waitFor(() => body.getByText('column not empty'))
    },
}

let deleted = false

/** `canDelete: true` (an empty column) — clicking Delete fires `onDelete` and closes. */
export const DeleteEnabled: Story = {
    render: () => {
        deleted = false
        return (
            <KanbanColumnMenu
                name="Blocked"
                canDelete={true}
                existing={['Todo', 'Doing']}
                onRename={() => {}}
                onDelete={() => (deleted = true)}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        // pointer-events: none at rest (Finding 2) — reach the trigger via keyboard, as a real
        // keyboard user would.
        ;(canvas.getByLabelText('Column menu') as HTMLElement).focus()
        await userEvent.keyboard('{Enter}')
        const del = await waitFor(() => body.getByText('delete'))
        await userEvent.click(del)
        expect(deleted).toBe(true)
        await waitFor(() =>
            expect(body.queryByTestId('kanban-column-menu')).toBeNull(),
        )
    },
}
