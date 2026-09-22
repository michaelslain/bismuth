// Visual spec for <KanbanColumnNameInput> — the column-name field shared by KanbanAddColumn
// (adding a column) and KanbanColumnMenu (renaming one). Presentational: it owns only the
// input's value/error state; the caller owns what happens on submit/cancel.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import KanbanColumnNameInput from './KanbanColumnNameInput'

const meta = {
    title: 'Bases/KanbanColumnNameInput',
    component: KanbanColumnNameInput,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof KanbanColumnNameInput>

export default meta
type Story = StoryObj<typeof meta>

/** A fresh field, no prefilled value — the "add column" shape. */
export const Empty: Story = {
    args: {
        placeholder: 'column name',
        existing: ['Todo', 'Doing', 'Done'],
        onSubmit: () => {},
        onCancel: () => {},
    },
}

/** Prefilled with the current column name, selected on mount so typing replaces it outright —
 *  the "rename" shape. */
export const Prefilled: Story = {
    args: {
        initial: 'Todo',
        existing: ['Doing', 'Done'],
        selectOnMount: true,
        onSubmit: () => {},
        onCancel: () => {},
    },
}

// Captured by the story's render() and read back in its play() — same shared-closure shape as
// FileTree.stories.tsx's `dragStarts` counter.
let submitted: string[] = []

/** Typing a name that matches an existing column and hitting Enter is refused inline: the
 *  `already a column` error appears with its left edge aligned to the input's own text x, and
 *  `onSubmit` never fires. */
export const Duplicate: Story = {
    render: () => {
        submitted = []
        return (
            <KanbanColumnNameInput
                placeholder="column name"
                existing={['Todo', 'Doing', 'Done']}
                onSubmit={name => submitted.push(name)}
                onCancel={() => {}}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const input = await canvas.findByPlaceholderText('column name')
        await userEvent.type(input, 'Doing')
        await userEvent.keyboard('{Enter}')
        const error = await canvas.findByText('already a column')
        expect(error).toBeVisible()
        expect(submitted).toEqual([])

        const inputRect = input.getBoundingClientRect()
        const inputStyle = getComputedStyle(input)
        const inputTextX = inputRect.left + parseFloat(inputStyle.paddingLeft)
        const errorRect = error.getBoundingClientRect()
        const errorStyle = getComputedStyle(error)
        const errorTextX = errorRect.left + parseFloat(errorStyle.paddingLeft)
        expect(Math.abs(errorTextX - inputTextX)).toBeLessThanOrEqual(1)
    },
}
