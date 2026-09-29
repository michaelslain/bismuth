// Visual spec for <KanbanAddColumn> — the trailing bare-`+` ghost column KanbanView renders
// after its real columns (Acceptance 11). Presentational: the component owns only its own
// open/editing state and the inline duplicate-name refusal; persisting the new column is
// entirely the caller's `onAdd`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import KanbanAddColumn from './KanbanAddColumn'
import {
    boardWidths,
    fontsSettled,
    ghostOf,
    inputTextOrigin,
    restGlyphOrigin,
} from '../ui/_kanbanAddColumnAssertions'

const meta = {
    title: 'Bases/KanbanAddColumn',
    component: KanbanAddColumn,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof KanbanAddColumn>

export default meta
type Story = StoryObj<typeof meta>

/** Resting ghost column — a bare `+`, muted, no word or brackets, no input shown. */
export const Default: Story = {
    args: {
        existing: ['Todo', 'Doing', 'Done'],
        onAdd: () => {},
    },
}

// Captured by each story's render() and read back in its play() — same shared-closure shape as
// FileTree.stories.tsx's `dragStarts` counter.
let addedNames: string[] = []

/** Clicking the ghost swaps in the text input, focused, with the `name` placeholder;
 *  typing a fresh name and hitting Enter fires `onAdd` with the trimmed name and the input
 *  resets back to the ghost trigger. */
export const Editing: Story = {
    render: () => {
        addedNames = []
        // A flex row, as KanbanView's column row is, so the ghost shrinks to its own content
        // there too — in a block container it would fill the width and no growth could show.
        return (
            <div style={{ display: 'flex' }}>
                <KanbanAddColumn
                    existing={['Todo', 'Doing', 'Done']}
                    onAdd={name => addedNames.push(name)}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await fontsSettled()
        const ghost = ghostOf(canvasElement)
        const trigger = canvas.getByLabelText('Add a column')
        const restOrigin = restGlyphOrigin(ghost)
        const restWidths = boardWidths(canvasElement)
        await userEvent.click(trigger)
        const input = (await canvas.findByPlaceholderText(
            'name',
        )) as HTMLInputElement
        expect(input).toBe(document.activeElement)
        // The swap must neither move the text nor resize the ghost (which would reflow a board's
        // real columns) — the same measurement KanbanColumns.stories' AddColumn asserts.
        const editOrigin = inputTextOrigin(input)
        expect(Math.abs(editOrigin.x - restOrigin.x)).toBeLessThanOrEqual(1)
        expect(Math.abs(editOrigin.y - restOrigin.y)).toBeLessThanOrEqual(1)
        expect(boardWidths(canvasElement)).toEqual(restWidths)
        await userEvent.type(input, '  Blocked  ')
        await userEvent.keyboard('{Enter}')
        expect(addedNames).toEqual(['Blocked'])
        // back to the ghost trigger after a successful add
        expect(canvas.getByLabelText('Add a column')).toBeVisible()
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
        await userEvent.click(canvas.getByLabelText('Add a column'))
        const input = await canvas.findByPlaceholderText('name')
        await userEvent.type(input, 'Doing')
        await userEvent.keyboard('{Enter}')
        const error = await canvas.findByText('already a column')
        expect(error).toBeVisible()
        expect(addedNames).toEqual([])
        // input is still open and still holds what was typed
        expect(canvas.getByPlaceholderText('name')).toHaveValue('Doing')
    },
}

/** Escape closes the input without adding: back to the ghost trigger, `onAdd` never fires. */
export const CancelEscape: Story = {
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
        await userEvent.click(canvas.getByLabelText('Add a column'))
        const input = await canvas.findByPlaceholderText('name')
        await userEvent.type(input, 'Blocked')
        await userEvent.keyboard('{Escape}')
        await waitFor(() =>
            expect(canvas.queryByPlaceholderText('name')).toBeNull(),
        )
        expect(canvas.getByLabelText('Add a column')).toBeVisible()
        expect(addedNames).toEqual([])
    },
}

/** Leaving the input while it is empty closes it: nothing was typed, nothing is added. */
export const CancelBlurEmpty: Story = {
    render: () => {
        addedNames = []
        return (
            <div>
                <KanbanAddColumn
                    existing={['Todo', 'Doing', 'Done']}
                    onAdd={name => addedNames.push(name)}
                />
                <button type="button">elsewhere</button>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByLabelText('Add a column'))
        await canvas.findByPlaceholderText('name')
        await userEvent.click(canvas.getByText('elsewhere'))
        await waitFor(() =>
            expect(canvas.queryByPlaceholderText('name')).toBeNull(),
        )
        expect(addedNames).toEqual([])
    },
}

/** Enter on an empty (or whitespace-only) field is a cancel, not an add of a blank column. */
export const CancelEnterEmpty: Story = {
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
        await userEvent.click(canvas.getByLabelText('Add a column'))
        const input = await canvas.findByPlaceholderText('name')
        await userEvent.type(input, '   ')
        await userEvent.keyboard('{Enter}')
        await waitFor(() =>
            expect(canvas.queryByPlaceholderText('name')).toBeNull(),
        )
        expect(addedNames).toEqual([])
    },
}
