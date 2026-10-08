// app/src/feedback/FeedbackPageHost.stories.tsx
// Spec for <FeedbackPageHost> — the feedback page's real container, against the global
// fakeTransport (app/.storybook/preview.ts). Proves the HOST's own job: the draft it owns reaches
// api.sendFeedback (POST /feedback) and the page lands on the thank-you line, and switching to
// interview shows the start prompt. Layout states live in FeedbackPage.stories.tsx.
import type { JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import FeedbackPageHost from './FeedbackPageHost'

const meta = {
    title: 'Feedback/FeedbackPageHost',
    component: FeedbackPageHost,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FeedbackPageHost>

export default meta
type Story = StoryObj<typeof meta>

const noNames = () => []

function Frame(props: { children: JSX.Element }) {
    return <div style={{ width: '100%', height: '100vh' }}>{props.children}</div>
}

/** Write a draft and send it: the round trip through POST /feedback ends on the thank-you line. */
export const SendWritten: Story = {
    render: () => (
        <Frame>
            <FeedbackPageHost noteNames={noNames} memoryNames={noNames} tagNames={noNames} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const [title, body] = await waitFor(() => {
            const boxes = c.getAllByRole('textbox')
            expect(boxes.length).toBeGreaterThanOrEqual(2)
            return boxes
        })
        await userEvent.type(title, 'Graph pans slowly')
        await userEvent.type(body, 'Panning stutters in a big vault.')
        await userEvent.click(c.getByRole('button', { name: /send/ }))
        await waitFor(() => expect(c.getByText('sent // thank you')).toBeInTheDocument())
    },
}

/** The interview facet shows the start prompt before any session exists. */
export const InterviewFacet: Story = {
    render: () => (
        <Frame>
            <FeedbackPageHost noteNames={noNames} memoryNames={noNames} tagNames={noNames} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(await c.findByRole('button', { name: 'interview' }))
        await waitFor(() =>
            expect(c.getByRole('button', { name: /start interview/ })).toBeInTheDocument(),
        )
    },
}
