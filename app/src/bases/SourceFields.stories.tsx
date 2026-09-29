// Visual spec for <SourceFields> — where a base's rows come from: this base's own body rows,
// vault notes (+ a `where` filter and an optional "limit to base"), vault tasks, or another base.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { createSignal } from 'solid-js'
import SourceFields from './SourceFields'
import { formToSource, sourceToForm } from './sourceForm'
import { SAMPLE_ROWS } from '../ui/_baseFixtures'
import type { SourceSpec } from '../../../core/src/bases/types'

const meta = {
    title: 'Bases/SourceFields',
    component: SourceFields,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof SourceFields>

export default meta
type Story = StoryObj<typeof meta>

const BASES = [
    { value: '[[Books]]', label: 'Books' },
    { value: '[[Keep]]', label: 'Keep' },
    { value: '[[Projects]]', label: 'Projects' },
]
const PROPS = ['file.name', 'status', 'priority', 'done', 'due', 'tags']

function Harness(p: {
    spec?: SourceSpec
    bases?: typeof BASES
}) {
    const [form, setForm] = createSignal(sourceToForm(p.spec))
    return (
        <div style={{ width: '560px' }}>
            <SourceFields
                value={form()}
                onChange={setForm}
                bases={p.bases ?? BASES}
                properties={PROPS}
                rows={SAMPLE_ROWS}
            />
            <pre data-testid="source-out">
                {JSON.stringify(formToSource(form()) ?? null)}
            </pre>
        </div>
    )
}

/** No `source:` — the base owns its rows. */
export const OwnRows: Story = { render: () => <Harness /> }

/** Vault notes filtered by a `where` built from condition rows. */
export const NotesWhere: Story = {
    render: () => (
        <Harness
            spec={{
                kind: 'notes',
                where: 'file.hasTag("planning") && priority > 1',
            }}
        />
    ),
}

/** Vault tasks scoped to the notes another base selects; a legacy task-DSL where stays raw. */
export const TasksFromBase: Story = {
    render: () => (
        <Harness
            spec={{ kind: 'tasks', from: '[[Keep]]', where: 'not done' }}
        />
    ),
}

/** Another base's rows (composition) — how a second view of the same rows is made. */
export const AnotherBase: Story = {
    render: () => <Harness spec={{ kind: 'base', ref: '[[Books]]' }} />,
}

/** Nothing set: the hint says where rows come from. */
export const OwnRowsHint: Story = {
    render: () => <Harness />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText(/rows come from the table in this base/)).toBeInTheDocument()
        await expect(c.getByTestId('source-out').textContent).toBe('null')
    },
}

/** Another base as the source, with no bases in the vault to pick: the picker stays empty. */
export const EmptyBases: Story = {
    render: () => <Harness spec={{ kind: 'base', ref: '' }} bases={[]} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('pick a base')).toBeInTheDocument()
    },
}

/** Editing a `where` condition propagates to the saved source spec. */
export const WherePropagates: Story = {
    render: () => <Harness spec={{ kind: 'notes' }} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByText('add condition'))
        await userEvent.type(c.getByPlaceholderText('value'), 'Todo')
        await expect(JSON.parse(c.getByTestId('source-out').textContent!)).toEqual({
            kind: 'notes',
            where: 'file.name == "Todo"',
        })
    },
}
