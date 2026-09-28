// Visual spec for <FilterConditionRow> — one filter condition: property / operator / value
// pickers (the value editor follows the operator: tag + folder pickers, date presets, a number
// field), or a raw expression field for anything the pickers can't express.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { Show, createSignal } from 'solid-js'
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

function Harness(p: {
    initial: FilterRow
    /** Omit the "edit as expression" affordance (a caller with no raw form). */
    noToRaw?: boolean
    properties?: string[]
}) {
    const [row, setRow] = createSignal<FilterRow>(p.initial)
    const [removed, setRemoved] = createSignal(false)
    return (
        <div style={{ width: '560px' }}>
            <Show when={!removed()} fallback={<span>removed</span>}>
                <FilterConditionRow
                    row={row()}
                    properties={p.properties ?? PROPS}
                    rows={SAMPLE_ROWS}
                    onPatch={patch => setRow({ ...row(), ...patch } as FilterRow)}
                    onRemove={() => setRemoved(true)}
                    onToRaw={
                        p.noToRaw
                            ? undefined
                            : () =>
                                  setRow({ kind: 'raw', text: 'status == "Todo"' })
                    }
                />
            </Show>
            <pre data-testid="row-out">{JSON.stringify(row())}</pre>
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

/** A folder operator: the value cell is a folder picker fed by the sample rows. */
export const FolderOp: Story = {
    render: () => (
        <Harness
            initial={{
                kind: 'cond',
                prop: 'file.folder',
                op: 'in_folder',
                val: 'projects',
                type: 'string',
            }}
        />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('projects')).toBeInTheDocument()
        await expect(c.getByText('is in folder')).toBeInTheDocument()
    },
}

/** `is within N days`: the value is a number field, edited into the row's `val`. */
export const DateWithin: Story = {
    render: () => (
        <Harness
            initial={{
                kind: 'cond',
                prop: 'due',
                op: 'date_within',
                val: '7',
                type: 'date',
            }}
        />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const days = c.getByPlaceholderText('days') as HTMLInputElement
        await expect(days.type).toBe('number')
        await userEvent.clear(days)
        await userEvent.type(days, '14')
        await expect(JSON.parse(c.getByTestId('row-out').textContent!).val).toBe('14')
    },
}

/** A property and a tag the samples do not contain still show (withCurrent), never a blank. */
export const CurrentValueNotInSamples: Story = {
    render: () => (
        <Harness
            initial={{
                kind: 'cond',
                prop: 'legacy_field',
                op: 'has_tag',
                val: 'ghost-tag',
                type: 'tag',
            }}
        />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('ghost-tag')).toBeInTheDocument()
        await expect(c.getAllByText('legacy_field').length).toBeGreaterThan(0)
    },
}

/** No `onToRaw`: the "edit as expression" button is not offered. */
export const NoToRaw: Story = {
    render: () => (
        <Harness
            noToRaw
            initial={{
                kind: 'cond',
                prop: 'status',
                op: 'equals',
                val: 'Todo',
                type: 'string',
            }}
        />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.queryByLabelText('Edit as expression')).not.toBeInTheDocument()
        await expect(c.getByLabelText('Remove condition')).toBeInTheDocument()
    },
}

/** A condition swaps to a raw expression carrying its text; a raw row can then be removed. */
export const ToRawThenRemove: Story = {
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
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByLabelText('Edit as expression'))
        await expect(c.getByDisplayValue('status == "Todo"')).toBeInTheDocument()
        await expect(c.queryByLabelText('Edit as expression')).not.toBeInTheDocument()
        await userEvent.click(c.getByLabelText('Remove condition'))
        await expect(c.getByText('removed')).toBeInTheDocument()
    },
}
