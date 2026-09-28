// Visual spec for <RemoveRowButton> — the `[x]` that removes one row from an editable list.
import { createSignal, For } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import RemoveRowButton from './RemoveRowButton'
import Text from './Text'

const meta = {
    title: 'UI/RemoveRowButton',
    component: RemoveRowButton,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof RemoveRowButton>

export default meta
type Story = StoryObj<typeof meta>

/** A list that loses a row on click — real state, not a noop. */
export const RemovesARow: Story = {
    args: { label: 'remove', onClick: () => {} },
    render: () => {
        const [rows, setRows] = createSignal(['alpha', 'beta', 'gamma'])
        return (
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
                <For each={rows()}>
                    {row => (
                        <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
                            <Text as="span">{row}</Text>
                            <RemoveRowButton
                                label={`remove ${row}`}
                                onClick={() => setRows(r => r.filter(x => x !== row))}
                            />
                        </div>
                    )}
                </For>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        expect(c.getAllByRole('button').length).toBe(3)
        await userEvent.click(c.getByRole('button', { name: 'remove beta' }))
        expect(c.getAllByRole('button').length).toBe(2)
        expect(c.queryByRole('button', { name: 'remove beta' })).toBeNull()
    },
}
