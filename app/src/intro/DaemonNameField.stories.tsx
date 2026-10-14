import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent } from 'storybook/test'
import { createSignal } from 'solid-js'
import DaemonNameField from './DaemonNameField'

const meta = {
    title: 'Intro/DaemonNameField',
    component: DaemonNameField,
    parameters: { layout: 'centered' },
    args: { value: '', onInput: () => {} },
} satisfies Meta<typeof DaemonNameField>

export default meta
type Story = StoryObj<typeof meta>

/** Empty, as the slide opens: the face idles over the placeholder's default name. */
export const Empty: Story = {
    play: async ({ canvasElement }) => {
        const input = canvasElement.querySelector('input')!
        await expect(input.placeholder).toBe('daemon')
        await expect(input.getAttribute('aria-label')).toBe('daemon name')
    },
}

/** A typed name: the face listens. */
export const Filled: Story = { args: { value: 'ada' } }

/** Holds its own value; Enter calls onSubmit once. */
export const Interactive: Story = {
    args: { onSubmit: fn() },
    render: args => {
        const [value, setValue] = createSignal('')
        return (
            <DaemonNameField
                value={value()}
                onInput={setValue}
                onSubmit={args.onSubmit}
            />
        )
    },
    play: async ({ args, canvasElement }) => {
        const input = canvasElement.querySelector('input')!
        await userEvent.type(input, 'ada{Enter}')
        await expect(input.value).toBe('ada')
        await expect(args.onSubmit).toHaveBeenCalledOnce()
    },
}
