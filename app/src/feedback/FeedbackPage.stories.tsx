// Visual + behavioural spec for <FeedbackPage> — the `::feedback` page. Stories hold real state:
// the facet switches modes, the form edits, send runs a fake round-trip, and the interview story
// lands the interviewer's draft in the form exactly as FeedbackPageHost does (latestDraftIn).
import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import FeedbackPage, { type FeedbackInterviewView } from './FeedbackPage'
import FeedbackInterview from './FeedbackInterview'
import type { FeedbackSendState } from './FeedbackDraftForm'
import { EMPTY_DRAFT, latestDraftIn, type FeedbackDraft, type FeedbackMode } from './feedbackLogic'
import { makeStubChatSession } from '../chat/_stubChatSession'
import { INTERVIEW_DONE_ITEMS, INTERVIEW_ITEMS } from './_feedbackFixtures'

const meta = {
    title: 'Feedback/FeedbackPage',
    component: FeedbackPage,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FeedbackPage>

export default meta
type Story = StoryObj<typeof meta>

const noNames = () => []

function Live(props: { mode?: FeedbackMode; started?: boolean; done?: boolean }) {
    const [mode, setMode] = createSignal<FeedbackMode>(props.mode ?? 'write')
    const [started, setStarted] = createSignal(!!props.started)
    const items = props.done ? INTERVIEW_DONE_ITEMS : INTERVIEW_ITEMS
    const session = makeStubChatSession({ transcript: items })
    const fromInterview = latestDraftIn(items)
    const [draft, setDraft] = createStore<FeedbackDraft>({
        ...EMPTY_DRAFT,
        ...(props.done && fromInterview ? fromInterview : {}),
    })
    const [state, setState] = createSignal<FeedbackSendState>({ kind: 'idle' })
    const [view, setView] = createSignal<FeedbackInterviewView>(props.done ? 'review' : 'chat')
    return (
        <div style={{ height: '100vh' }}>
            <FeedbackPage
                mode={mode()}
                onMode={setMode}
                draft={draft}
                onDraft={p => setDraft(p)}
                state={state()}
                onSend={() => {
                    setState({ kind: 'sending' })
                    setTimeout(() => setState({ kind: 'sent' }), 400)
                }}
                onReset={() => (setDraft({ ...EMPTY_DRAFT }), setState({ kind: 'idle' }))}
                interviewView={view()}
                onInterviewView={setView}
                draftReady={!!props.done && started()}
                persona="ash"
                interview={
                    <FeedbackInterview
                        started={started()}
                        session={started() ? session : undefined}
                        persona="ash"
                        onStart={() => setStarted(true)}
                        noteNames={noNames}
                        memoryNames={noNames}
                        tagNames={noNames}
                    />
                }
            />
        </div>
    )
}

/** Write mode: the form alone. Switching the facet shows the interview's start prompt. */
export const Write: Story = {
    render: () => <Live />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: 'interview' }))
        await waitFor(() => expect(c.getByRole('button', { name: /start interview/ })).toBeInTheDocument())
        await userEvent.click(c.getByRole('button', { name: 'write' }))
        await waitFor(() => expect(c.getByRole('button', { name: /send/ })).toBeInTheDocument())
    },
}

export const InterviewNotStarted: Story = { render: () => <Live mode="interview" /> }

export const InterviewTalking: Story = { render: () => <Live mode="interview" started /> }

/** The interviewer wrote its draft: the page shows the review ALONE — the form, filled, with
 *  [ back to interview ] — never the transcript and the form together. Back to interview returns to the
 *  conversation, which offers [ open draft ] to come back. */
export const InterviewDraft: Story = {
    render: () => <Live mode="interview" started done />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await waitFor(() =>
            expect(c.getByDisplayValue('Graph panning + kanban due dates')).toBeInTheDocument(),
        )
        await expect(c.queryByText('What gets in your way most often?')).toBeNull()
        await expect(c.getByRole('button', { name: /^\[?\s*send/ })).toBeEnabled()
        await userEvent.click(c.getByRole('button', { name: /back to interview/ }))
        await waitFor(() => expect(c.getByRole('button', { name: /open draft/ })).toBeInTheDocument())
        await expect(c.queryByDisplayValue('Graph panning + kanban due dates')).toBeNull()
        await userEvent.click(c.getByRole('button', { name: /open draft/ }))
        await waitFor(() =>
            expect(c.getByDisplayValue('Graph panning + kanban due dates')).toBeInTheDocument(),
        )
    },
}
