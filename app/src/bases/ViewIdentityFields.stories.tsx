// Visual spec for <ViewIdentityFields> — a view's name, its kind (one of the 12 renderers) and
// whether every row is a task.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import ViewIdentityFields from './ViewIdentityFields'
import type { ViewType } from '../../../core/src/bases/types'

const meta = {
    title: 'Bases/ViewIdentityFields',
    component: ViewIdentityFields,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof ViewIdentityFields>

export default meta
type Story = StoryObj<typeof meta>

function Harness(p: {
    kind: ViewType
    mode: 'normal' | 'tasks'
    showMode: boolean
}) {
    const [name, setName] = createSignal('Reading list')
    const [kind, setKind] = createSignal<ViewType>(p.kind)
    const [mode, setMode] = createSignal(p.mode)
    return (
        <div style={{ width: '460px' }}>
            <ViewIdentityFields
                name={name()}
                kind={kind()}
                mode={mode()}
                showMode={p.showMode}
                onName={setName}
                onKind={setKind}
                onMode={setMode}
            />
        </div>
    )
}

export const TableRecords: Story = {
    render: () => <Harness kind="table" mode="normal" showMode />,
}

export const ListTasks: Story = {
    render: () => <Harness kind="list" mode="tasks" showMode />,
}

/** Charts have no tasks mode — the toggle is hidden. */
export const Chart: Story = {
    render: () => <Harness kind="bar" mode="normal" showMode={false} />,
}
