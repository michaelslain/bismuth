// Visual spec for <TranscribeProgress>: what a running transcription says in a bar, with its cancel.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, within } from 'storybook/test'
import TranscribeProgress from './TranscribeProgress'

const meta = { title: 'Bases/TranscribeProgress', component: TranscribeProgress } satisfies Meta<typeof TranscribeProgress>

export default meta
type Story = StoryObj<typeof meta>

const Running = (props: { lead?: boolean; installing?: boolean }) => {
    const [running, setRunning] = createSignal(!props.installing)
    return (
        <TranscribeProgress
            lead={props.lead}
            transcription={{
                progress: () => (running() ? { done: 3, total: 12, etaMs: 120_000 } : undefined),
                installing: () => !!props.installing,
                cancel: () => setRunning(false),
            }}
        />
    )
}

/** How far it is, the time left and a cancel that ends it. */
export const Default: Story = {
    render: () => <Running lead={false} />,
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain('transcribing 4 of 12')
        await expect(within(canvasElement).getByRole('button', { name: 'cancel' })).toBeInTheDocument()
    },
}

/** After a page number in one readout. */
export const AfterAPageNumber: Story = {
    render: () => <>p. 3 / 12<Running /></>,
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain('p. 3 / 12 // transcribing 4 of 12')
    },
}

/** The math reader installing before the run can go on. */
export const SettingUp: Story = {
    render: () => <Running installing lead={false} />,
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toBe('setting up the math reader')
    },
}
