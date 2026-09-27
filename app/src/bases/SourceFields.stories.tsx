// Visual spec for <SourceFields> — where a view's rows come from: this base's own body rows,
// vault notes (+ a `where` filter and an optional "limit to base"), vault tasks, or another base.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import SourceFields from './SourceFields'
import { sourceToForm } from './sourceForm'
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
    scope?: 'base' | 'view'
    views?: number
}) {
    const [form, setForm] = createSignal(sourceToForm(p.spec))
    return (
        <div style={{ width: '560px' }}>
            <SourceFields
                value={form()}
                onChange={setForm}
                bases={BASES}
                scope={p.scope ?? 'base'}
                viewCount={p.views ?? 1}
                properties={PROPS}
                rows={SAMPLE_ROWS}
            />
        </div>
    )
}

/** No `source:` — the base owns its rows. */
export const OwnRows: Story = { render: () => <Harness /> }

/** Vault notes filtered by a `where` built from condition rows, shared by three views. */
export const NotesWhere: Story = {
    render: () => (
        <Harness
            spec={{
                kind: 'notes',
                where: 'file.hasTag("planning") && priority > 1',
            }}
            views={3}
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

/** Another base's rows (composition), as this view's own override. */
export const AnotherBaseViewOverride: Story = {
    render: () => (
        <Harness spec={{ kind: 'base', ref: '[[Books]]' }} scope="view" />
    ),
}
