// Visual spec for <CheckCrop> — the strip of a page a flagged line was read from.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import CheckCrop from './CheckCrop'
import { bookPage } from './_bookPages'

const meta = {
    title: 'Bases/CheckCrop',
    component: CheckCrop,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof CheckCrop>

export default meta
type Story = StoryObj<typeof meta>

const face = () => Promise.resolve({ kind: 'ready' as const, source: bookPage(1) })

export const Line: Story = {
    render: () => <CheckCrop face={face} boxes={() => Promise.resolve([{ x: 0.1, y: 0.12, w: 0.8, h: 0.04 }])} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelector('[data-check-crop]')?.getAttribute('data-check-crop')).toBe('ready'))
    },
}

export const NotFound: Story = {
    name: 'Not found',
    render: () => <CheckCrop face={face} boxes={() => Promise.resolve([])} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.textContent).toContain('could not be found'))
    },
}
