// app/src/feedback/FeedbackPage.tsx — FeedbackPage.tsx is the ONLY importer of
// FeedbackPage.module.css. The `::feedback` page: feedback for Bismuth's developer, written by hand
// or drawn out by an interview. A ViewBar (identity + the write | interview facet) over one centred
// column. Write: the draft form alone. Interview: ONE thing at a time — the conversation, or the
// review of the draft it produced (the form, with `[ back to interview ]`). Never both on one
// screen, so the draft is never shown twice and there is only ever one place to type. Owns no state
// and never fetches — FeedbackPageHost wires it — so every state renders in Storybook.
import { Match, Show, Switch, type Component, type JSX } from 'solid-js'
import ViewBar, { Crumb } from '../ui/ViewBar'
import SegmentedToggle from '../ui/SegmentedToggle'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import FeedbackDraftForm, { type FeedbackSendState } from './FeedbackDraftForm'
import type { FeedbackDraft, FeedbackMode } from './feedbackLogic'
import styles from './FeedbackPage.module.css'

export type FeedbackInterviewView = 'chat' | 'review'

export type FeedbackPageProps = {
    mode: FeedbackMode
    onMode: (mode: FeedbackMode) => void
    draft: FeedbackDraft
    onDraft: (patch: Partial<FeedbackDraft>) => void
    state: FeedbackSendState
    onSend: () => void
    onReset: () => void
    /** The interview column (a FeedbackInterview), rendered in interview mode's chat view. */
    interview: JSX.Element
    /** Interview mode: the conversation, or the review of its draft. */
    interviewView: FeedbackInterviewView
    onInterviewView: (view: FeedbackInterviewView) => void
    /** The interviewer has written a draft — the chat view offers `[ open draft ]`. */
    draftReady: boolean
    /** Who interviews, for the review's heading. */
    persona: string
    class?: string
}

const FeedbackPage: Component<FeedbackPageProps> = props => {
    const form = () => (
        <FeedbackDraftForm
            draft={props.draft}
            onDraft={props.onDraft}
            state={props.state}
            onSend={props.onSend}
            onReset={props.onReset}
        />
    )
    return (
        <div class={`${styles.page} ${props.class ?? ''}`}>
            <ViewBar
                identity={<Crumb icon="Megaphone">feedback</Crumb>}
                facet={
                    <SegmentedToggle
                        options={[
                            { id: 'write', label: 'write' },
                            { id: 'interview', label: 'interview' },
                        ]}
                        value={props.mode}
                        onChange={props.onMode}
                    />
                }
            />
            <div class={styles.stage}>
                <Switch>
                    <Match when={props.mode === 'write'}>
                        <div class={styles.column}>
                            <Text size="ui" tone="muted">
                                tell bismuth's developer what works, what doesn't and what is missing
                            </Text>
                            {form()}
                        </div>
                    </Match>
                    <Match when={props.interviewView === 'review'}>
                        <div class={styles.column}>
                            <div class={styles.reviewHead}>
                                <Text size="ui" tone="muted">
                                    {props.persona}'s draft // edit it, then send
                                </Text>
                                <TextButton onClick={() => props.onInterviewView('chat')}>
                                    back to interview
                                </TextButton>
                            </div>
                            {form()}
                        </div>
                    </Match>
                    <Match when={true}>
                        <div class={`${styles.column} ${styles.interviewColumn}`}>
                            <div class={styles.interview}>{props.interview}</div>
                            <Show when={props.draftReady}>
                                <div class={styles.ready}>
                                    <Text size="ui" tone="muted">
                                        draft ready
                                    </Text>
                                    <TextButton
                                        primary
                                        onClick={() => props.onInterviewView('review')}
                                    >
                                        open draft
                                    </TextButton>
                                </div>
                            </Show>
                        </div>
                    </Match>
                </Switch>
            </div>
        </div>
    )
}

export default FeedbackPage
