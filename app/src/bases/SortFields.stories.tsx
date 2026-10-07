// Visual spec for <SortFields> — "sort by" then any number of "then by" keys, each with its own
// direction.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { createSignal } from 'solid-js'
import SortFields from './SortFields'
import type { SortSpec } from '../../../core/src/bases/types'

const meta = {
    title: 'Bases/SortFields',
    component: SortFields,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof SortFields>

export default meta
type Story = StoryObj<typeof meta>

const OPTIONS = ['file.name', 'status', 'priority', 'due'].map(v => ({
    value: v,
    label: v.replace(/^file\./, ''),
}))

function Harness(p: { initial: SortSpec[] }) {
    const [sort, setSort] = createSignal(p.initial)
    return (
        <div style={{ width: '460px' }}>
            <SortFields sort={sort()} onChange={setSort} options={OPTIONS} />
            <pre
                data-testid="sort-out"
                style={{ 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere' }}
            >{JSON.stringify(sort())}</pre>
        </div>
    )
}

export const Unsorted: Story = { render: () => <Harness initial={[]} /> }

export const ThreeKeys: Story = {
    render: () => (
        <Harness
            initial={[
                { property: 'status', direction: 'ASC' },
                { property: 'priority', direction: 'DESC' },
                { property: 'due', direction: 'ASC' },
            ]}
        />
    ),
}

/** A saved key the option list no longer offers still shows (withCurrent), not a blank. */
export const KeyMissingFromOptions: Story = {
    render: () => (
        <Harness initial={[{ property: 'legacy_rank', direction: 'DESC' }]} />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('legacy_rank')).toBeInTheDocument()
        await expect(c.getByText('descending')).toBeInTheDocument()
    },
}

/** Every option already used: "add sort key" is off rather than repeating a key. */
export const AllOptionsUsed: Story = {
    render: () => (
        <Harness
            initial={OPTIONS.map(o => ({
                property: o.value,
                direction: 'ASC' as const,
            }))}
        />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getAllByLabelText('Remove sort key')).toHaveLength(4)
        const add = c.getByRole('button', { name: 'add sort key' }) as HTMLButtonElement
        await expect(add.disabled).toBe(true)
        await userEvent.click(add)
        await expect(c.getAllByLabelText('Remove sort key')).toHaveLength(4)
    },
}

/** "add sort key" appends the first unused option; removing a key drops it. */
export const AddThenRemove: Story = {
    render: () => <Harness initial={[{ property: 'status', direction: 'ASC' }]} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const out = () => JSON.parse(c.getByTestId('sort-out').textContent!)
        await userEvent.click(c.getByText('add sort key'))
        await expect(out()).toEqual([
            { property: 'status', direction: 'ASC' },
            { property: 'file.name', direction: 'ASC' },
        ])
        await userEvent.click(c.getAllByLabelText('Remove sort key')[0])
        await expect(out()).toEqual([{ property: 'file.name', direction: 'ASC' }])
    },
}

/** Order IS the meaning of a sort: each key has an up / down pair (the same pair a declared
 *  property has). Moving a key swaps it with its neighbour, the first key cannot go up and the last
 *  cannot go down, and the "sort by" / "then by" captions follow the new order. */
export const Reorder: Story = {
    render: () => (
        <Harness
            initial={[
                { property: 'status', direction: 'ASC' },
                { property: 'priority', direction: 'DESC' },
                { property: 'due', direction: 'ASC' },
            ]}
        />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const out = () => JSON.parse(c.getByTestId('sort-out').textContent!)
        const btn = (name: string) =>
            c.getByRole('button', { name }) as HTMLButtonElement
        await expect(btn('Move sort key 1 up').disabled).toBe(true)
        await expect(btn('Move sort key 3 down').disabled).toBe(true)
        await userEvent.click(btn('Move sort key 3 up'))
        await expect(out().map((k: { property: string }) => k.property)).toEqual([
            'status',
            'due',
            'priority',
        ])
        // the direction travels with its key, not with its slot
        await expect(out()[2]).toEqual({ property: 'priority', direction: 'DESC' })
        await userEvent.click(btn('Move sort key 1 down'))
        await expect(out().map((k: { property: string }) => k.property)).toEqual([
            'due',
            'status',
            'priority',
        ])
    },
}
