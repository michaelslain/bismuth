// Visual spec for <KanbanAddColumn> — the trailing "+ column" ghost column KanbanView renders
// after its real columns. Presentational: the component owns only its own open/editing state
// and the inline duplicate-name refusal; persisting the new column is entirely the caller's
// `onAdd`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import KanbanAddColumn from './KanbanAddColumn'

const meta = {
    title: 'Bases/KanbanAddColumn',
    component: KanbanAddColumn,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof KanbanAddColumn>

export default meta
type Story = StoryObj<typeof meta>

/** Resting ghost column — "+ column" in muted text, no input shown. */
export const Default: Story = {
    args: {
        existing: ['Todo', 'Doing', 'Done'],
        onAdd: () => {},
    },
}

// Captured by each story's render() and read back in its play() — same shared-closure shape as
// FileTree.stories.tsx's `dragStarts` counter.
let addedNames: string[] = []

/** Clicking the ghost swaps in the text input, focused, with the `column name` placeholder;
 *  typing a fresh name and hitting Enter fires `onAdd` with the trimmed name and the input
 *  resets back to the ghost trigger. */
export const Editing: Story = {
    render: () => {
        addedNames = []
        return (
            <KanbanAddColumn
                existing={['Todo', 'Doing', 'Done']}
                onAdd={name => addedNames.push(name)}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const trigger = canvas.getByText('+ column')
        await userEvent.click(trigger)
        const input = await canvas.findByPlaceholderText('column name')
        expect(input).toBe(document.activeElement)
        await userEvent.type(input, '  Blocked  ')
        await userEvent.keyboard('{Enter}')
        expect(addedNames).toEqual(['Blocked'])
        // back to the ghost trigger after a successful add
        expect(canvas.getByText('+ column')).toBeVisible()
    },
}

/** A name matching an existing column is refused inline — the input stays open, showing
 *  `already a column` in `--danger`, and `onAdd` never fires. */
export const DuplicateRefused: Story = {
    render: () => {
        addedNames = []
        return (
            <KanbanAddColumn
                existing={['Todo', 'Doing', 'Done']}
                onAdd={name => addedNames.push(name)}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByText('+ column'))
        const input = await canvas.findByPlaceholderText('column name')
        await userEvent.type(input, 'Doing')
        await userEvent.keyboard('{Enter}')
        const error = await canvas.findByText('already a column')
        expect(error).toBeVisible()
        expect(addedNames).toEqual([])
        // input is still open and still holds what was typed
        expect(canvas.getByPlaceholderText('column name')).toHaveValue(
            'Doing',
        )
    },
}
