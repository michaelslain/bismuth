// app/src/feedback/FeedbackPageHost.tsx
// Wires the `::feedback` page (FeedbackPage.tsx): the mode, the draft, the send round-trip through
// core's owner-only `POST /feedback`, and the interview. Starting an interview takes a trusted click
// (an agent driving the app cannot start one), mints a fresh chat (feedbackInterviewState.ts) that
// App retains while this tab is open, and sends the opening turn once the socket accepts it. Each
// new ```feedback draft the interviewer writes replaces the form's title + body; the reply-to the
// user typed is kept. Nothing is sent until the user presses `[ send ]`.
import { createEffect, createSignal, on, untrack, type Component } from 'solid-js'
import { createStore } from 'solid-js/store'
import { api } from '../api'
import { chatSession } from '../chat/chatSessions'
import type { ChatSession } from '../chat/chatSession'
import { chatPersonaName } from '../daemon/daemonIdentityLogic'
import { providerLabel } from '../chat/chatProvider'
import { sendWhenOpen } from '../quickAsk/quickAskLogic'
import type { NoteCandidate } from '../editor/wikilink'
import type { MemoryCandidate } from '../../../core/src/memoryRef'
import FeedbackPage, { type FeedbackInterviewView } from './FeedbackPage'
import FeedbackInterview from './FeedbackInterview'
import type { FeedbackSendState } from './FeedbackDraftForm'
import {
    EMPTY_DRAFT,
    INTERVIEW_KICKOFF,
    latestDraftIn,
    type FeedbackDraft,
    type FeedbackMode,
} from './feedbackLogic'
import { feedbackInterviewChatId, startFeedbackInterview } from './feedbackInterviewState'

export type FeedbackPageHostProps = {
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
}

const SEND_RETRY_MS = 100

const FeedbackPageHost: Component<FeedbackPageHostProps> = props => {
    const [mode, setMode] = createSignal<FeedbackMode>(
        untrack(feedbackInterviewChatId) ? 'interview' : 'write',
    )
    const [draft, setDraft] = createStore<FeedbackDraft>({ ...EMPTY_DRAFT })
    const [state, setState] = createSignal<FeedbackSendState>({ kind: 'idle' })
    const [kickoffPending, setKickoffPending] = createSignal(false)
    const [view, setView] = createSignal<FeedbackInterviewView>('chat')
    // Who interviews: the daemon's name when it is on, else the interview session's own backend
    // (whichever provider the chat resolved to), and before a session exists, a neutral name.
    const persona = () => {
        const s = session()
        return chatPersonaName() ?? (s ? providerLabel(s.provider()) : 'your agent')
    }
    const session = (): ChatSession | undefined => {
        const id = feedbackInterviewChatId()
        return id ? chatSession(id) : undefined
    }

    const onDraft = (patch: Partial<FeedbackDraft>) => {
        setDraft(patch)
        if (state().kind === 'error') setState({ kind: 'idle' })
    }

    const onStart = (e: MouseEvent) => {
        if (!e.isTrusted) return
        startFeedbackInterview()
        setView('chat')
        setKickoffPending(true)
    }

    // The registry creates the session a tick after the id is minted: open the interview then,
    // retrying while the socket is still connecting. The interviewer only talks, so the session
    // asks before any tool use rather than inheriting the app's bypass default.
    createEffect(() => {
        const s = session()
        if (!s || !kickoffPending()) return
        setKickoffPending(false)
        const id = untrack(feedbackInterviewChatId)
        untrack(() => s.setPermissionModeLocal('default'))
        sendWhenOpen(
            {
                setDraft: v => untrack(() => s.setDraft(v)),
                send: () => untrack(() => s.send()),
                draft: () => untrack(() => s.draft()),
                blocked: () => untrack(() => !!(s.setupError() || s.gateRefusal())),
            },
            INTERVIEW_KICKOFF,
            () => feedbackInterviewChatId() === id,
            fn => setTimeout(fn, SEND_RETRY_MS),
        )
    })

    // A new draft from the interviewer lands in the form and opens the review (keyed on its text, so re-renders of the
    // same turn do not overwrite the user's edits).
    const interviewDraft = () => {
        const s = session()
        return s ? latestDraftIn(s.transcript) : null
    }
    createEffect(
        on(
            () => {
                const d = interviewDraft()
                return d ? `${d.title}\n${d.body}` : null
            },
            key => {
                const d = untrack(interviewDraft)
                if (key === null || !d) return
                setDraft({ title: d.title, body: d.body })
                setState({ kind: 'idle' })
                setView('review')
            },
        ),
    )

    const onSend = async () => {
        if (state().kind === 'sending') return
        setState({ kind: 'sending' })
        try {
            await api.sendFeedback({
                kind: mode() === 'interview' ? 'interview' : 'written',
                title: draft.title,
                body: draft.body,
                ...(draft.contact.trim() ? { contact: draft.contact } : {}),
                meta: { daemonName: chatPersonaName() ?? undefined },
            })
            setState({ kind: 'sent' })
        } catch (e) {
            setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
        }
    }

    const onReset = () => {
        setDraft({ ...EMPTY_DRAFT })
        setState({ kind: 'idle' })
    }

    return (
        <FeedbackPage
            mode={mode()}
            onMode={setMode}
            draft={draft}
            onDraft={onDraft}
            state={state()}
            onSend={onSend}
            onReset={onReset}
            interviewView={view()}
            onInterviewView={setView}
            draftReady={!!interviewDraft()}
            persona={persona()}
            interview={
                <FeedbackInterview
                    started={!!feedbackInterviewChatId()}
                    session={session()}
                    persona={persona()}
                    onStart={onStart}
                    noteNames={props.noteNames}
                    memoryNames={props.memoryNames}
                    tagNames={props.tagNames}
                />
            }
        />
    )
}

export default FeedbackPageHost
