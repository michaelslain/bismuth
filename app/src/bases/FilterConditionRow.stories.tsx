// Visual spec for <FilterConditionRow> — one filter condition: property / operator / value
// pickers (the value editor follows the operator: tag + folder pickers, date presets, a number
// field), or a raw expression field for anything the pickers can't express.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import FilterConditionRow from './FilterConditionRow'
import type { FilterRow } from './filterForm'
import { SAMPLE_ROWS } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/FilterConditionRow',
    component: FilterConditionRow,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof FilterConditionRow>

export default meta
type Story = StoryObj<typeof meta>

const PROPS = [
    'file.name',
    'status',
    'priority',
    'done',
    'due',
    'tags',
    'file.folder',
]

function Harness(p: { initial: FilterRow }) {
    const [row, setRow] = createSignal<FilterRow>(p.initial)
    return (
        <div style={{ width: '560px' }}>
            <FilterConditionRow
                row={row()}
                properties={PROPS}
                rows={SAMPLE_ROWS}
                onPatch={patch => setRow({ ...row(), ...patch } as FilterRow)}
                onRemove={() => {}}
                onToRaw={() =>
                    setRow({ kind: 'raw', text: 'status == "Todo"' })
                }
            />
        </div>
    )
}

export const TextEquals: Story = {
    render: () => (
        <Harness
            initial={{
                kind: 'cond',
                prop: 'status',
                op: 'equals',
                val: 'Todo',
                type: 'string',
            }}
        />
    ),
}

export const NumberCompare: Story = {
    render: () => (
        <Harness
            initial={{
                kind: 'cond',
                prop: 'priority',
                op: 'gt',
                val: '1',
                type: 'number',
            }}
        />
    ),
}

export const HasTag: Story = {
    render: () => (
        <Harness
            initial={{
                kind: 'cond',
                prop: 'tags',
                op: 'has_tag',
                val: 'planning',
                type: 'tag',
            }}
        />
    ),
}

export const DateBefore: Story = {
    render: () => (
        <Harness
            initial={{
                kind: 'cond',
                prop: 'due',
                op: 'date_before',
                val: 'today+7d',
                type: 'date',
            }}
        />
    ),
}

/** Valueless operator: the value cell stays empty but the grid keeps its columns. */
export const Checked: Story = {
    render: () => (
        <Harness
            initial={{
                kind: 'cond',
                prop: 'done',
                op: 'checked',
                val: '',
                type: 'boolean',
            }}
        />
    ),
}

export const RawExpression: Story = {
    render: () => (
        <Harness initial={{ kind: 'raw', text: '(priority > 2) || (done)' }} />
    ),
}
