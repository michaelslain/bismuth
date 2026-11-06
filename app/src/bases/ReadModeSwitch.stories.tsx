// Visual spec for <ReadModeSwitch>: the reader's `scroll | pages | text` switch.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import ReadModeSwitch, { type ReadMode } from './ReadModeSwitch'

const meta = {
    title: 'Bases/ReadModeSwitch',
    component: ReadModeSwitch,
} satisfies Meta<typeof ReadModeSwitch>

export default meta
type Story = StoryObj<typeof meta>

/** All three ways to read; a click picks one. */
export const Default: Story = {
    render: () => {
        const [mode, setMode] = createSignal<ReadMode>('scroll')
        return <ReadModeSwitch value={mode()} onChange={setMode} />
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByRole('button', { name: 'scroll' })).toHaveAttribute('aria-pressed', 'true')
        await userEvent.click(c.getByRole('button', { name: 'text' }))
        await expect(c.getByRole('button', { name: 'text' })).toHaveAttribute('aria-pressed', 'true')
    },
}

/** No transcript yet: `text` is disabled and its title says why. */
export const TextUnavailable: Story = {
    name: 'Text unavailable',
    render: () => <ReadModeSwitch value="pages" onChange={() => {}} textUnavailable="no page is transcribed yet" />,
    play: async ({ canvasElement }) => {
        const text = within(canvasElement).getByRole('button', { name: 'text' })
        await expect(text).toBeDisabled()
        await expect(text).toHaveAttribute('title', 'no page is transcribed yet')
    },
}
