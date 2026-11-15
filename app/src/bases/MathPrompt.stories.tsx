// Visual spec for <MathPrompt>: asked when transcription finds pages that look like math.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, Show } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import MathPrompt, { estimate } from './MathPrompt'
import Text from '../ui/Text'
import { TextButton } from '../ui/TextButton'

const meta = {
    title: 'Bases/MathPrompt',
    component: MathPrompt,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MathPrompt>

export default meta
type Story = StoryObj<typeof meta>

/** One page: each reader's time is the per-page time alone. */
export const OnePage: Story = {
    name: 'One page',
    render: () => <MathPrompt pages={1} onChoose={() => {}} />,
    play: async () => {
        const body = within(document.body)
        await expect(await body.findByText('this page has math')).toBeInTheDocument()
        await expect(body.getAllByText('about 15 s')[0]).toBeInTheDocument()
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
        await expect(body.getAllByText('about 3 min')[0]).toBeInTheDocument()
        await userEvent.click(body.getByRole('switch'))
        await userEvent.click(body.getByRole('button', { name: /math reader/ }))
        await waitFor(() => expect(canvasElement.querySelector('[data-chosen]')!.textContent).toBe('careful remember'))
        await expect(estimate(12)).toBe('about 3 min')
    },
}

/** `read it properly` sends the pages to the ai, the best reader: it reports `ai`, and `make this the default` saves it like the others. */
export const ReadItProperly: Story = {
    name: 'Read it properly',
    render: () => {
        const [chosen, setChosen] = createSignal<string>()
        return (
            <>
                <Show when={!chosen()}>
                    <MathPrompt pages={2} onChoose={(c, r) => setChosen(`${c} ${r ? 'remember' : 'once'}`)} />
                </Show>
                <Text data-chosen>{chosen() ?? ''}</Text>
            </>
        )
    },
    play: async ({ canvasElement }) => {
        const body = within(document.body)
        await expect(await body.findByText('2 pages have math')).toBeInTheDocument()
        await userEvent.click(body.getByRole('switch'))
        await userEvent.click(body.getByRole('button', { name: /read it properly/ }))
        await waitFor(() => expect(canvasElement.querySelector('[data-chosen]')!.textContent).toBe('ai remember'))
    },
}

/** Marker, the local math reader, is not installed yet: its row says it downloads first. */
export const NeedsInstall: Story = {
    name: 'Needs install',
    render: () => <MathPrompt pages={3} install onChoose={() => {}} />,
    play: async () => {
        const body = within(document.body)
        await expect(await body.findByText(/first time only: the math reader downloads 1\.2 GB/)).toBeInTheDocument()
    },
}

/** A run is still reading: the count is what it has found so far and grows as more math pages turn up. */
export const CountGrows: Story = {
    name: 'Count grows',
    render: () => {
        const [n, setN] = createSignal(3)
        return (
            <>
                <MathPrompt pages={n()} running onChoose={() => {}} />
                <TextButton data-found-more onClick={() => setN(c => c + 1)}>
                    found one more
                </TextButton>
            </>
        )
    },
    play: async () => {
        const body = within(document.body)
        await expect(await body.findByText('3 pages have math')).toBeInTheDocument()
        await expect(body.getAllByText('about 45 s')[0]).toBeInTheDocument()
        await expect(body.getByText(/later math pages get the same choice/)).toBeInTheDocument()
        await userEvent.click(body.getByRole('button', { name: /found one more/ }))
        await expect(await body.findByText('4 pages have math')).toBeInTheDocument()
        await expect(body.getAllByText('about 60 s')[0]).toBeInTheDocument()
    },
}
