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

/** Ink selected, as the intro opens. */
export const Default: Story = {
    play: async ({ canvasElement }) => {
        const group = canvasElement.querySelector('[role="group"]')!
        await expect(group.getAttribute('aria-label')).toBe('Theme')
        const pressed = group.querySelectorAll('[aria-pressed="true"]')
        await expect(pressed.length).toBe(1)
    },
}

/** Holds its own selection in a local signal. */
export const Interactive: Story = {
    render: () => {
        const [value, setValue] = createSignal<ThemeName>('ink')
        return <ThemePicker value={value()} onChange={setValue} />
    },
}

/** A narrow window: the four cards wrap or shrink inside the art box, never overflow it. */
export const Narrow: Story = {
    decorators: [
        Story => (
            <div style={{ width: 'calc(90 * var(--cell-w))' }}>
                <Story />
            </div>
        ),
    ],
}
