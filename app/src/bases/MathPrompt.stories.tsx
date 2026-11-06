// Visual spec for <MathPrompt>: asked when transcription finds pages that look like math.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, Show } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import MathPrompt, { estimate } from './MathPrompt'
import Text from '../ui/Text'

const meta = {
    title: 'Bases/MathPrompt',
    component: MathPrompt,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MathPrompt>

export default meta
type Story = StoryObj<typeof meta>

/** One page: the estimate is the per-page time alone. */
export const OnePage: Story = {
    name: 'One page',
    render: () => <MathPrompt pages={1} onChoose={() => {}} />,
    play: async () => {
        const body = within(document.body)
        await expect(await body.findByText('this page has math')).toBeInTheDocument()
        await expect(body.getByText(/^reading math properly takes about 15 s a page\. the fast read garbles formulas\.$/)).toBeInTheDocument()
    },
}

/** Several pages: the title counts them and the body gives the whole run's time. Choosing reports
 *  the choice and whether to remember it. */
export const SeveralPages: Story = {
    name: 'Several pages',
    render: () => {
        const [chosen, setChosen] = createSignal<string>()
        return (
            <>
                <Show when={!chosen()}>
                    <MathPrompt pages={10} onChoose={(c, r) => setChosen(`${c} ${r ? 'remember' : 'once'}`)} />
                </Show>
                <Text data-chosen>{chosen() ?? ''}</Text>
            </>
        )
    },
    play: async ({ canvasElement }) => {
        const body = within(document.body)
        await expect(await body.findByText('10 pages have math')).toBeInTheDocument()
        await expect(body.getByText(/\(10 pages, about 3 min\)/)).toBeInTheDocument()
        await userEvent.click(body.getByRole('switch'))
        await userEvent.click(body.getByRole('button', { name: /read it properly/ }))
        await waitFor(() => expect(canvasElement.querySelector('[data-chosen]')!.textContent).toBe('careful remember'))
        await expect(estimate(12)).toBe('about 3 min')
    },
}

/** Marker, the local math reader, is not installed yet: the body says reading properly downloads it. */
export const NeedsInstall: Story = {
    name: 'Needs install',
    render: () => <MathPrompt pages={3} install onChoose={() => {}} />,
    play: async () => {
        const body = within(document.body)
        await expect(await body.findByText(/the math reader downloads itself \(about 1\.2 GB/)).toBeInTheDocument()
    },
}
