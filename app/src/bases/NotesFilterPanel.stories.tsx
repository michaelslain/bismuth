// Visual spec for <NotesFilterPanel> — the query builder's Notes filter: the shared
// FiltersEditor over the builder's rows, or one advanced-expression field when the block's
// `where` could not be reversed into rows.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { createSignal } from 'solid-js'
import NotesFilterPanel from './NotesFilterPanel'
import type { NotesFilter } from './notesFilterForm'
import { compileNotesWhere } from './queryGen'
import { SAMPLE_ROWS } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/NotesFilterPanel',
    component: NotesFilterPanel,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof NotesFilterPanel>

export default meta
type Story = StoryObj<typeof meta>

const PROPS = ['file.name', 'status', 'priority', 'done', 'due', 'tags']

function Harness(p: { initial: NotesFilter }) {
    const [value, setValue] = createSignal<NotesFilter>(p.initial)
    return (
        <div style={{ width: '560px' }}>
            <NotesFilterPanel
                value={value()}
                onChange={next => setValue({ ...value(), ...next })}
                properties={PROPS}
                rows={SAMPLE_ROWS}
            />
            <pre data-testid="where-out">{compileNotesWhere(value())}</pre>
        </div>
    )
}

export const Empty: Story = {
    render: () => <Harness initial={{ connective: 'and', rows: [] }} />,
}

/** Two rows: the "match all / any" line appears, and the connective rewrites the where. */
export const TwoRowsAnyAll: Story = {
    render: () => (
        <Harness
            initial={{
                connective: 'and',
                rows: [
                    { prop: 'status', op: 'equals', val: 'Todo', type: 'string' },
                    { prop: 'priority', op: 'gt', val: '1', type: 'number' },
                ],
            }}
        />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const out = () => c.getByTestId('where-out').textContent
        await expect(out()).toBe('(status == "Todo") && (priority > 1)')
        await userEvent.click(c.getByText('any'))
        await expect(out()).toBe('(status == "Todo") || (priority > 1)')
    },
}

/** A where the builder could not reverse is one field, kept verbatim. */
export const AdvancedExpression: Story = {
    render: () => (
        <Harness
            initial={{
                connective: 'and',
                rows: [],
                rawWhere: 'items.filter(x => x > 2).length > 0',
            }}
        />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(
            c.getByDisplayValue('items.filter(x => x > 2).length > 0'),
        ).toBeInTheDocument()
        await expect(c.queryByText('add condition')).not.toBeInTheDocument()
    },
}

/** Add then remove a condition — real state, asserted on the compiled where. */
export const AddAndRemove: Story = {
    render: () => <Harness initial={{ connective: 'and', rows: [] }} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByText('add condition'))
        await expect(c.getByLabelText('Remove condition')).toBeInTheDocument()
        await expect(c.getByTestId('where-out').textContent).toBe('file.name == ""')
        await userEvent.click(c.getByLabelText('Remove condition'))
        await expect(c.queryByLabelText('Remove condition')).not.toBeInTheDocument()
        await expect(c.getByTestId('where-out').textContent).toBe('')
    },
}
