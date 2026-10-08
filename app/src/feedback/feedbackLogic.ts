// app/src/feedback/feedbackLogic.ts
// Pure logic behind the feedback page (FeedbackPage.tsx): the interview's standing instruction and
// opening turn, pulling the daemon's finished draft out of its reply, and whether a draft can be
// sent. No framework imports, so it is unit-tested directly (feedbackLogic.test.ts).
import { FEEDBACK_LIMITS } from '../../../core/src/feedbackContract'

export type FeedbackMode = 'write' | 'interview'

export type FeedbackDraft = { title: string; body: string; contact: string }

export const EMPTY_DRAFT: FeedbackDraft = { title: '', body: '', contact: '' }

/** The fence the interviewer wraps its finished draft in. */
export const DRAFT_FENCE = 'feedback'

/** Folded into every interview turn's preamble (chatContext's per-chat instruction). */
export const INTERVIEW_INSTRUCTION = [
    "You are interviewing the user to collect feedback about the Bismuth app for Bismuth's developer.",
    'Ask ONE short question at a time and wait for the answer: what they use Bismuth for, what works,',
    'what frustrates them, what is missing, and anything concrete (steps, a view, a setting) behind a',
    'complaint. Do not read or change vault files and do not run tools: this is a conversation only.',
    'After about five answers, or as soon as the user says they are done, write the feedback as ONE',
    `fenced code block with the info string \`${DRAFT_FENCE}\`. Its first line is \`title: <one line>\`,`,
    "then a blank line, then the body: the user's points in their own words, grouped, plain text. Never",
    'send it yourself: the user edits and sends it from the feedback page. Write a new block if they',
    'ask for changes.',
].join(' ')

/** The visible opening turn the page sends when an interview starts. */
export const INTERVIEW_KICKOFF = 'Interview me about Bismuth so I can send feedback.'

const FENCE_RE = new RegExp('```' + DRAFT_FENCE + '[^\\n]*\\n([\\s\\S]*?)```', 'g')

/** Pure: the LAST ```feedback fence in `text` as a draft, or null when there is none. A first line
 *  `title: …` becomes the title; without one the title is the body's first line. */
export function extractDraft(text: string): Omit<FeedbackDraft, 'contact'> | null {
    let last: string | null = null
    for (const m of text.matchAll(FENCE_RE)) last = m[1]
    if (last === null) return null
    const lines = last.replace(/\s+$/, '').split('\n')
    const head = lines[0]?.match(/^\s*title\s*:\s*(.*)$/i)
    if (head) {
        const body = lines.slice(1).join('\n').trim()
        return { title: head[1].trim(), body }
    }
    const body = lines.join('\n').trim()
    return { title: (body.split('\n')[0] ?? '').slice(0, FEEDBACK_LIMITS.title), body }
}

/** Pure: why `draft` cannot be sent yet, or null when it can. */
export function draftProblem(draft: FeedbackDraft): string | null {
    if (!draft.title.trim()) return 'add a title'
    if (!draft.body.trim()) return 'add some feedback'
    if (draft.title.length > FEEDBACK_LIMITS.title)
        return `title is over ${FEEDBACK_LIMITS.title} characters`
    if (draft.body.length > FEEDBACK_LIMITS.body)
        return `feedback is over ${FEEDBACK_LIMITS.body} characters`
    if (draft.contact.length > FEEDBACK_LIMITS.contact)
        return `contact is over ${FEEDBACK_LIMITS.contact} characters`
    return null
}

type TranscriptLike = readonly {
    role: string
    parts?: readonly { kind: string; text?: string }[]
}[]

/** Pure: the newest draft the interviewer wrote — the last assistant turn holding a complete
 *  ```feedback fence — or null. A fence still streaming (no closing ```) does not count yet. */
export function latestDraftIn(transcript: TranscriptLike): Omit<FeedbackDraft, 'contact'> | null {
    for (let i = transcript.length - 1; i >= 0; i--) {
        const item = transcript[i]
        if (item.role !== 'assistant' || !item.parts) continue
        const text = item.parts
            .filter(p => p.kind === 'text')
            .map(p => p.text ?? '')
            .join('')
        const draft = extractDraft(text)
        if (draft) return draft
    }
    return null
}
