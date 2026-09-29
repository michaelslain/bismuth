// Visual spec for <ColumnsFields> — a record view's column visibility toggles.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import ColumnsFields from './ColumnsFields'
import { sampleBaseConfig } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/ColumnsFields',
    component: ColumnsFields,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof ColumnsFields>

export default meta
type Story = StoryObj<typeof meta>

function Harness(p: { initial: { col: string; visible: boolean }[] }) {
    const [cols, setCols] = createSignal(p.initial)
    return (
        <div style={{ width: '460px' }}>
            <ColumnsFields
                columns={cols()}
                config={sampleBaseConfig()}
                onToggle={col =>
                    setCols(
                        cols().map(c =>
                            c.col === col ? { ...c, visible: !c.visible } : c,
                        ),
                    )
                }
            />
        </div>
    )
}

export const Mixed: Story = {
    render: () => (
        <Harness
            initial={[
                { col: 'file.name', visible: true },
                { col: 'status', visible: true },
                { col: 'priority', visible: false },
                { col: 'due', visible: true },
            ]}
        />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const rows = c.getAllByRole('switch')
        rows[2].focus()
        await userEvent.keyboard(' ')
        await expect(rows[2].getAttribute('aria-checked')).toBe('true')
        // <Index>: the same node stays and keeps focus
        await expect(document.activeElement).toBe(rows[2])
    },
}

/** The last visible column is locked — hiding every column is not offered. */
export const LastVisibleLocked: Story = {
    render: () => (
        <Harness
            initial={[
                { col: 'file.name', visible: true },
                { col: 'status', visible: false },
            ]}
        />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const first = c.getAllByRole('switch')[0]
        await expect(first.getAttribute('aria-disabled')).toBe('true')
        await userEvent.click(first)
        await expect(first.getAttribute('aria-checked')).toBe('true')
    },
}
