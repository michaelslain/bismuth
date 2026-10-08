// Visual + behavioural spec for <FeedbackDraftForm> — the editable draft with its one [ send ].
// Every story holds real state: typing edits the draft, and send runs a fake round-trip.
import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import FeedbackDraftForm, { type FeedbackSendState } from './FeedbackDraftForm'
import { EMPTY_DRAFT, type FeedbackDraft } from './feedbackLogic'

const meta = {
    title: 'Feedback/FeedbackDraftForm',
    component: FeedbackDraftForm,
} satisfies Meta<typeof FeedbackDraftForm>

export default meta
type Story = StoryObj<typeof meta>

function Live(props: { draft?: FeedbackDraft; state?: FeedbackSendState; fail?: string }) {
    const [draft, setDraft] = createStore<FeedbackDraft>({ ...(props.draft ?? EMPTY_DRAFT) })
    const [state, setState] = createSignal<FeedbackSendState>(props.state ?? { kind: 'idle' })
    const onSend = () => {
        setState({ kind: 'sending' })
        setTimeout(
            () => setState(props.fail ? { kind: 'error', message: props.fail } : { kind: 'sent' }),
            400,
        )
    }
    return (
        <div style={{ width: '560px', 'max-width': '100%' }}>
            <FeedbackDraftForm
                draft={draft}
                onDraft={p => setDraft(p)}
                state={state()}
                onSend={onSend}
                onReset={() => (setDraft({ ...EMPTY_DRAFT }), setState({ kind: 'idle' }))}
            />
        </div>
    )
}

const FILLED: FeedbackDraft = {
    title: 'Graph panning is slow',
    body: 'Panning the graph stutters in a vault of about 3,000 notes. Zoom is fine.',
    contact: '',
}

/** Empty: send is disabled and the status line says what is missing. Typing a title and body enables it. */
export const Empty: Story = {
    render: () => <Live />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const send = c.getByRole('button', { name: /send/ })
        await expect(send).toBeDisabled()
        await expect(c.getByText('add a title')).toBeInTheDocument()
        const [title, body] = c.getAllByRole('textbox')
        await userEvent.type(title, 'Sync')
        await userEvent.type(body, 'works great')
        await expect(send).toBeEnabled()
    },
}

/** Filled: send runs the round-trip and lands on the thank-you line. */
export const Filled: Story = {
    render: () => <Live draft={FILLED} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: /send/ }))
        await waitFor(() => expect(c.getByText('sent // thank you')).toBeInTheDocument())
    },
}

export const Sending: Story = { render: () => <Live draft={FILLED} state={{ kind: 'sending' }} /> }

/** The relay refused: the error replaces the status line and the draft is kept for a retry. */
export const Failed: Story = {
    render: () => (
        <Live
            draft={FILLED}
            state={{ kind: 'error', message: 'too many feedback submissions, try again later' }}
        />
    ),
}

export const Sent: Story = { render: () => <Live draft={FILLED} state={{ kind: 'sent' }} /> }
