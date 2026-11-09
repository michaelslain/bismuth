// Visual spec for <ReadModeSwitch>: the `show` row of the reader's display panel: pages, text and side by side.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import BarSettings from '../ui/BarSettings'
import ViewBar, { Crumb } from '../ui/ViewBar'
import ReadModeSwitch, { type ReadView } from './ReadModeSwitch'

const meta = {
    title: 'Bases/ReadModeSwitch',
    component: ReadModeSwitch,
} satisfies Meta<typeof ReadModeSwitch>

export default meta
type Story = StoryObj<typeof meta>

const Live = (props: { view?: ReadView; textUnavailable?: string }) => {
    const [view, setView] = createSignal<ReadView>(props.view ?? 'pages')
    return <ReadModeSwitch view={view()} onView={setView} textUnavailable={props.textUnavailable} />
}

/** Three words; the one in use is bracketed, and a click picks another. */
export const Default: Story = {
    render: () => <Live />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByRole('button', { name: 'pages' })).toHaveAttribute('aria-pressed', 'true')
        await userEvent.click(c.getByRole('button', { name: 'side by side' }))
        await expect(c.getByRole('button', { name: 'side by side' })).toHaveAttribute('aria-pressed', 'true')
        await expect(c.getByRole('button', { name: 'pages' })).toHaveAttribute('aria-pressed', 'false')
    },
}

/** As the display panel's first row. */
export const InPanel: Story = {
    name: 'In panel',
    render: () => (
        <div style={{ width: '480px', 'max-width': 'none' }}>
            <ViewBar identity={<Crumb icon="File">lecture.pdf</Crumb>} config={<BarSettings label="display" defaultOpen rows={[{ label: 'show', control: <Live view="text" /> }]} />} />
        </div>
    ),
    play: async () => {
        const panel = await waitFor(() => {
            const p = document.querySelector<HTMLElement>('[data-bar-settings-panel]')
            expect(p).not.toBeNull()
            return p!
        })
        await expect(within(panel).getByRole('button', { name: 'text' })).toHaveAttribute('aria-pressed', 'true')
    },
}

/** No transcript yet: `text` and `side by side` are disabled and their tooltip says why. */
export const TextUnavailable: Story = {
    name: 'Text unavailable',
    render: () => <Live textUnavailable="no page is transcribed yet" />,
    play: async ({ canvasElement }) => {
        for (const name of ['text', 'side by side']) {
            const b = within(canvasElement).getByRole('button', { name })
            await expect(b).toBeDisabled()
            await expect(b).toHaveAttribute('title', 'no page is transcribed yet')
        }
    },
}
