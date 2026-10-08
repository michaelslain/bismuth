// Visual spec for <FeedbackInterview> — the interview column: the start prompt, then the shared
// chat body over the interview's session.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import FeedbackInterview from './FeedbackInterview'
import { makeStubChatSession } from '../chat/_stubChatSession'
import { INTERVIEW_DONE_ITEMS, INTERVIEW_ITEMS } from './_feedbackFixtures'

const meta = {
    title: 'Feedback/FeedbackInterview',
    component: FeedbackInterview,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FeedbackInterview>

export default meta
type Story = StoryObj<typeof meta>

const noNames = () => []

function Frame(props: { children: unknown }) {
    return (
        <div style={{ width: '560px', height: '560px', 'max-width': '100%', padding: 'var(--sp-5)' }}>
            {props.children as never}
        </div>
    )
}

/** Not started: one line + [ start interview ]. Clicking it starts a (stubbed) interview. */
export const NotStarted: Story = {
    render: () => {
        const [started, setStarted] = createSignal(false)
        return (
            <Frame>
                <FeedbackInterview
                    started={started()}
                    session={started() ? makeStubChatSession({ transcript: INTERVIEW_ITEMS.slice(0, 2) }) : undefined}
                    persona="ash"
                    onStart={() => setStarted(true)}
                    noteNames={noNames}
                    memoryNames={noNames}
                    tagNames={noNames}
                />
            </Frame>
        )
    },
}

export const Talking: Story = {
    render: () => (
        <Frame>
            <FeedbackInterview
                started
                session={makeStubChatSession({ transcript: INTERVIEW_ITEMS })}
                persona="ash"
                onStart={() => {}}
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        </Frame>
    ),
}

export const DraftWritten: Story = {
    render: () => (
        <Frame>
            <FeedbackInterview
                started
                session={makeStubChatSession({ transcript: INTERVIEW_DONE_ITEMS })}
                persona="ash"
                onStart={() => {}}
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        </Frame>
    ),
}
