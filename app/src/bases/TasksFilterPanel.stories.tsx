// Visual spec for <TasksFilterPanel> — the Tasks source's preset filters (status / priority /
// due / recurring / sort), the optional "scope to a base", and the advanced-filter field for a
// DSL leaf no preset expresses.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { createSignal } from 'solid-js'
import TasksFilterPanel from './TasksFilterPanel'
import { defaultTaskFilters, compileTaskLeaves, type TaskFilters } from './queryGen'

const meta = {
    title: 'Bases/TasksFilterPanel',
    component: TasksFilterPanel,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof TasksFilterPanel>

export default meta
type Story = StoryObj<typeof meta>

const BASES = [
    { value: '[[Keep]]', label: 'Keep' },
    { value: '[[Projects]]', label: 'Projects' },
]

function Harness(p: { initial: TaskFilters }) {
    const [value, setValue] = createSignal<TaskFilters>(p.initial)
    return (
        <div style={{ width: '560px' }}>
            <TasksFilterPanel
                value={value()}
                onChange={patch => setValue({ ...value(), ...patch })}
                bases={BASES}
            />
            <pre data-testid="leaves-out">
                {JSON.stringify(compileTaskLeaves(value()))}
            </pre>
        </div>
    )
}

export const Defaults: Story = {
    render: () => <Harness initial={defaultTaskFilters()} />,
}

/** Sorted, scoped to a base, with a leaf the presets could not express. */
export const SortedScopedAdvanced: Story = {
    render: () => (
        <Harness
            initial={{
                ...defaultTaskFilters(),
                status: 'open',
                sortKey: 'due',
                sortReverse: true,
                from: '[[Keep]]',
                rawWhere: 'tag includes foo',
            }}
        />
    ),
}

/** Toggling status and priority rewrites the compiled leaves. */
export const EditPresets: Story = {
    render: () => <Harness initial={defaultTaskFilters()} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const out = () => c.getByTestId('leaves-out').textContent
        await expect(out()).toBe('[]')
        await userEvent.click(c.getByText('open'))
        await expect(out()).toBe('["not done"]')
        await userEvent.click(c.getByText('Any priority'))
        await userEvent.click(await within(document.body).findByText('High'))
        await expect(out()).toBe('["not done","priority is high"]')
    },
}
