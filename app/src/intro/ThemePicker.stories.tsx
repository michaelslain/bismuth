import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { createSignal } from 'solid-js'
import ThemePicker from './ThemePicker'
import type { ThemeName } from '../themes'

const meta = {
    title: 'Intro/ThemePicker',
    component: ThemePicker,
    parameters: { layout: 'centered' },
    args: { value: 'ink', onChange: () => {} },
} satisfies Meta<typeof ThemePicker>

export default meta
type Story = StoryObj<typeof meta>

/** Ink selected, as the intro opens: four theme names, one pressed. */
export const Default: Story = {
    play: async ({ canvasElement }) => {
        const group = canvasElement.querySelector('[role="group"]')!
        await expect(group.getAttribute('aria-label')).toBe('Theme')
        await expect(group.querySelectorAll('button').length).toBe(4)
        const pressed = group.querySelectorAll('[aria-pressed="true"]')
        await expect(pressed.length).toBe(1)
        await expect(pressed[0]!.textContent).toContain('ink')
    },
}

/** Holds its own selection in a local signal. */
export const Interactive: Story = {
    render: () => {
        const [value, setValue] = createSignal<ThemeName>('ink')
        return <ThemePicker value={value()} onChange={setValue} />
    },
}
