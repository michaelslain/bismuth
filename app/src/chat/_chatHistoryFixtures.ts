// app/src/chat/_chatHistoryFixtures.ts
// Past conversations for stories that open the chat history panel against the REAL ChatSession
// (via fakeTransport's `chatHistory` seed), so a row can actually be resumed: each session carries
// the frames GET /chat/session-messages replays into the transcript.
//
// Times are anchored to LOCAL CALENDAR DAYS, not "now minus N hours" — the panel groups by calendar
// day, and "now minus 26h" is two days back at 1am, which silently empties the `yesterday` group.
import type { ChatSessionInfo } from '../api'
import type { ChatFrame } from '../../../core/src/chat'

/** Today, `minutes` ago — clamped to today's midnight so it never slips into yesterday. */
export function minutesAgoToday(minutes: number): number {
    const n = new Date()
    const midnight = new Date(
        n.getFullYear(),
        n.getMonth(),
        n.getDate(),
    ).getTime()
    return Math.max(midnight, Date.now() - minutes * 60_000)
}

/** Noon, `days` local calendar days back. */
export function daysBack(days: number): number {
    const n = new Date()
    return new Date(
        n.getFullYear(),
        n.getMonth(),
        n.getDate() - days,
        12,
    ).getTime()
}

const turn = (ask: string, answer: string): ChatFrame[] => [
    { type: 'user-message', text: ask },
    { type: 'assistant-text', text: answer },
    { type: 'result', isError: false, numTurns: 1, costUsd: 0.012 },
    { type: 'done' },
]

export type ChatHistoryEntry = { session: ChatSessionInfo; frames: ChatFrame[] }

export function chatHistoryFixture(): ChatHistoryEntry[] {
    return [
        {
            session: {
                sessionId: 'h1',
                summary: 'Restyle the daemon page',
                lastModified: minutesAgoToday(5),
                origin: 'user',
            },
            frames: turn(
                'The chat controls under the composer feel noisy. Can we make them calmer?',
                'The chat controls should be one quiet row: the model and permission mode as plain readouts, then `[history]` and `[new chat]` as the only two commands, split by `//`.',
            ),
        },
        {
            session: {
                sessionId: 'h2',
                summary: 'dream — nightly vault review',
                lastModified: minutesAgoToday(40),
                origin: 'daemon',
            },
            frames: turn(
                'Run the nightly review.',
                'Consolidated three notes about the quiet row redesign into [[Chat controls]], and flagged two orphaned drafts in `inbox/`.',
            ),
        },
        {
            session: {
                sessionId: 'h3',
                summary:
                    'Why does the month grid clip its last two week rows on short panes',
                lastModified: daysBack(1),
                origin: 'user',
            },
            frames: turn(
                'The calendar month view cuts off the bottom rows when the pane is short.',
                'The grid is sized from the pane height minus the bar, but the bar grows when its chips wrap and nothing re-measures after that — so on short panes the last two week rows are clipped.',
            ),
        },
        {
            session: {
                sessionId: 'h4',
                summary: 'vault-review — orphaned notes',
                lastModified: daysBack(3),
                origin: 'daemon',
            },
            frames: turn(
                'Find notes nothing links to.',
                'Found 4 orphaned notes, all under `drafts/`. None have been edited in 30 days.',
            ),
        },
        {
            session: {
                sessionId: 'h5',
                summary: 'Draft the bases query-block docs',
                lastModified: daysBack(5),
                origin: 'user',
            },
            frames: turn(
                'Write the docs page for the query block.',
                'Drafted `docs/bases/query-block.md`: the flat spec, the inline base config, and three worked examples.',
            ),
        },
        {
            session: {
                sessionId: 'h6',
                summary: 'Pick a serif for note prose',
                lastModified: daysBack(12),
                origin: 'user',
            },
            frames: turn(
                'IBM Plex Serif or Lora for note bodies?',
                'Plex Serif: its x-height sits closer to Monaspace, so prose and inline code share a line without the code looking shrunken.',
            ),
        },
        {
            session: {
                sessionId: 'h7',
                summary: 'Set up Google Calendar sync',
                lastModified: daysBack(48),
                origin: 'user',
            },
            frames: turn(
                'How do I connect my Google Calendar?',
                'Run `bismuth gcal auth`, then add a calendar base with `source: gcal`.',
            ),
        },
    ]
}
