// app/src/feedback/_feedbackFixtures.ts — story fixtures for the feedback page: an interview
// transcript that ends in a finished ```feedback draft.
import type { TurnItem } from '../chat/chatTranscriptLogic'
import { INTERVIEW_KICKOFF } from './feedbackLogic'

const say = (text: string): TurnItem => ({
    role: 'assistant',
    parts: [{ kind: 'text', text }],
    footer: null,
})

export const INTERVIEW_ITEMS: TurnItem[] = [
    { role: 'user', text: INTERVIEW_KICKOFF },
    say('Happy to. What do you mostly use Bismuth for?'),
    { role: 'user', text: 'Reading notes and a kanban for side projects.' },
    say('What gets in your way most often?'),
    { role: 'user', text: 'The graph is slow to pan in a big vault, and I miss a due-date column on kanban cards.' },
]

export const INTERVIEW_DONE_ITEMS: TurnItem[] = [
    ...INTERVIEW_ITEMS,
    say(
        'Thanks — here is a draft. Edit it below before you send it.\n\n```feedback\ntitle: Graph panning + kanban due dates\n\nI use Bismuth for reading notes and a kanban for side projects.\n\n- The graph is slow to pan in a big vault.\n- Kanban cards should be able to show a due-date column.\n```',
    ),
]
