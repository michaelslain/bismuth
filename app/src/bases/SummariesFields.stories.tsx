// Visual spec for <SummariesFields> — a table's footer aggregations, one picker per visible column.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import SummariesFields from './SummariesFields'

const meta = {
    title: 'Bases/SummariesFields',
    component: SummariesFields,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof SummariesFields>

export default meta
type Story = StoryObj<typeof meta>

function Harness(p: { columns: string[]; initial: Record<string, string> }) {
    const [choices, setChoices] = createSignal(p.initial)
    return (
        <div style={{ width: '460px' }}>
            <SummariesFields
                columns={p.columns}
                choices={choices()}
                onChange={setChoices}
            />
        </div>
    )
}

export const Table: Story = {
    render: () => (
        <Harness
            columns={['file.name', 'status', 'priority', 'formula.ppu']}
            initial={{ 'file.name': 'Count', priority: 'Average' }}
        />
    ),
}

export const NoVisibleColumns: Story = {
    render: () => <Harness columns={[]} initial={{}} />,
}
