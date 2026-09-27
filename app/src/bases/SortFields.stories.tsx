// Visual spec for <SortFields> — "sort by" then any number of "then by" keys, each with its own
// direction.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
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
