// app/src/feedback/feedbackInterviewState.ts
// Which chat backs the feedback page's interview — plain app state, never persisted, so a relaunch
// or a restored layout always comes back with no interview running. App reads the id to retain
// `::chat:<id>` while the feedback tab is open (chat/chatSessions.ts) and ends it when the last
// feedback leaf closes. Each start mints a fresh id, so an interview never resumes an old one.
import { createSignal } from 'solid-js'
import { setChatInstruction } from '../chat/chatContext'
import { INTERVIEW_INSTRUCTION } from './feedbackLogic'

const [chatId, setChatId] = createSignal<string | null>(null)

/** Reactive: the running interview's chat id (no `::chat:` prefix), or null. */
export const feedbackInterviewChatId = chatId

/** Start a fresh interview: mint its id and set the interviewer's standing instruction. */
export function startFeedbackInterview(): string {
    endFeedbackInterview()
    const id = `feedback-${crypto.randomUUID()}`
    setChatInstruction(id, INTERVIEW_INSTRUCTION)
    setChatId(id)
    return id
}

/** End the interview: its session is released by App's retention effect. */
export function endFeedbackInterview(): void {
    const id = chatId()
    if (!id) return
    setChatInstruction(id, null)
    setChatId(null)
}
