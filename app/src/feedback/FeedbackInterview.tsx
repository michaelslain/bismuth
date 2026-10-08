// app/src/feedback/FeedbackInterview.tsx — FeedbackInterview.tsx is the ONLY importer of
// FeedbackInterview.module.css. The interview half of the feedback page: before it starts, one line
// and `[ start interview ]`; once started, the shared chat/ChatSessionBody (variant "column", the
// daemon page chat's look) over the interview's own session. `session` is undefined for the tick
// between the start gesture and the registry creating it.
import { Show, type Component } from 'solid-js'
import type { ChatSession } from '../chat/chatSession'
import ChatSessionBody from '../chat/ChatSessionBody'
import EmptyState from '../ui/EmptyState'
import TextButton from '../ui/TextButton'
import type { NoteCandidate } from '../editor/wikilink'
import type { MemoryCandidate } from '../../../core/src/memoryRef'
import styles from './FeedbackInterview.module.css'

export type FeedbackInterviewProps = {
    started: boolean
    session: ChatSession | undefined
    /** Who interviews: the daemon's name when it is on, else the chat backend's label. */
    persona: string
    onStart: (e: MouseEvent) => void
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
    class?: string
}

const FeedbackInterview: Component<FeedbackInterviewProps> = props => (
    <div class={`${styles.interview} ${props.class ?? ''}`} data-chat-surface>
        <Show
            when={props.started}
            fallback={
                <EmptyState
                    fill
                    tone="quiet"
                    title={`${props.persona} asks, you answer`}
                    action={
                        <TextButton primary onClick={e => props.onStart(e)}>
                            start interview
                        </TextButton>
                    }
                >
                    a few short questions, then a draft you can edit before it is sent
                </EmptyState>
            }
        >
            <ChatSessionBody
                variant="column"
                session={props.session}
                placeholder={`Answer ${props.persona}`}
                persona={props.persona}
                noteNames={props.noteNames}
                memoryNames={props.memoryNames}
                tagNames={props.tagNames}
                controls={false}
            />
        </Show>
    </div>
)

export default FeedbackInterview
