// Visual spec for <PropertiesFields> — the base's declared property list. Holds real state and
// asserts add / expand-one-at-a-time / remove in play().
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import PropertiesFields from './PropertiesFields'
import { blankPropertyRow, type PropertyFormRow } from './basePropertiesForm'

const meta = {
    title: 'Bases/PropertiesFields',
    component: PropertiesFields,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof PropertiesFields>

export default meta
type Story = StoryObj<typeof meta>

const named = (
    name: string,
    patch: Partial<PropertyFormRow> = {},
): PropertyFormRow => ({ ...blankPropertyRow([]), name, ...patch })

function Harness(p: { initial: PropertyFormRow[]; editing?: number | null }) {
    const [rows, setRows] = createSignal(p.initial)
    const [editing, setEditing] = createSignal<number | null>(p.editing ?? null)
    return (
        <div style={{ width: '460px' }}>
            <PropertiesFields
                rows={rows()}
                onChange={setRows}
                editing={editing()}
                onEditing={setEditing}
            />
        </div>
    )
}

const SAMPLE = [
    named('status', { kind: 'select', optionsText: 'todo, doing, done' }),
    named('priority', { kind: 'number' }),
    named('tags', { kind: 'multiselect', hidden: true }),
]

export const Empty: Story = {
    render: () => <Harness initial={[]} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: /add property/i }))
        // the new row opens straight into its editor
        await expect(await c.findByPlaceholderText('property name')).toBeVisible()
    },
}

export const Collapsed: Story = {
    render: () => <Harness initial={SAMPLE} />,
}

export const OneOpen: Story = {
    render: () => <Harness initial={SAMPLE} editing={1} />,
}

export const DuplicateNames: Story = {
    render: () => (
        <Harness
            initial={[named('status'), named('other'), named('status')]}
            editing={2}
        />
    ),
}

export const ExpandAndRemove: Story = {
    render: () => <Harness initial={SAMPLE} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: /^status/ }))
        await expect(c.getAllByPlaceholderText('property name')).toHaveLength(1)
        // opening another collapses the first: one editor at a time
        await userEvent.click(c.getByRole('button', { name: /^priority/ }))
        const inputs = c.getAllByPlaceholderText('property name')
        await expect(inputs).toHaveLength(1)
        await expect((inputs[0] as HTMLInputElement).value).toBe('priority')
        await userEvent.click(c.getByLabelText('Remove property'))
        await expect(c.queryByRole('button', { name: /^priority/ })).toBeNull()
        await expect(c.getByRole('button', { name: /^tags/ })).toBeVisible()
    },
}
