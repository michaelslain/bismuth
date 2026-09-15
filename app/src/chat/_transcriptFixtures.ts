// app/src/chat/_transcriptFixtures.ts
// Static TurnItem[] fixtures for Storybook (ChatTranscript.stories.tsx and its parts' own
// stories) — the same idiom as app/src/ui/_* fixtures elsewhere in the app. Hand-built rather than
// run through `buildTranscript(frames)` so each story can show exactly one thing without needing a
// full frame sequence to arrive at it (an answered permission, say, with no unanswered one ever
// having existed).
import type { TurnItem } from '../chatTranscript'

/** Prose with a bulleted list and bold text — proves bold reads at prose size (Acceptance: "Bold
 *  text in prose is the prose size at bold weight — never larger"), not just plain paragraphs. */
export const CONVERSATION_ITEMS: readonly TurnItem[] = [
    { role: 'user', text: 'What changed in the last release?' },
    {
        role: 'assistant',
        footer: { numTurns: 2, costUsd: 0.0142 },
        parts: [
            {
                kind: 'text',
                text: [
                    'A few things landed:',
                    '',
                    '- **Faster startup** — the daemon now boots in under a second',
                    '- Fixed a bug where queued messages could double-send',
                    '- `bismuth daemon logs` now supports `--since`',
                    '',
                    'The **bold** items above should read at the same size as this sentence,',
                    'never larger.',
                ].join('\n'),
            },
        ],
    },
    { role: 'user', text: 'Nice, thanks.' },
]

/** A user turn that arrives with sent images attached, no text. */
export const IMAGE_TURN_ITEMS: readonly TurnItem[] = [
    {
        role: 'user',
        text: '',
        images: [
            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="80"%3E%3Crect width="120" height="80" fill="%23888"/%3E%3C/svg%3E',
        ],
    },
    {
        role: 'assistant',
        footer: null,
        parts: [{ kind: 'text', text: 'Got the screenshot — looking now.' }],
    },
]

/** Tool calls in each state a chip can be in: settled ok, settled error, still pending. */
export const TOOL_CALL_ITEMS: readonly TurnItem[] = [
    { role: 'user', text: 'Find every TODO in the app workspace.' },
    {
        role: 'assistant',
        footer: { numTurns: 3, costUsd: 0.031 },
        parts: [
            {
                kind: 'tool',
                id: 'tc-1',
                name: 'Grep',
                toolKind: 'search',
                input: { pattern: 'TODO', path: 'app/src' },
                result: 'app/src/chat/ChatComposer.tsx:42\napp/src/graph/graphRenderer.ts:118',
                isError: false,
                pending: false,
            },
            {
                kind: 'text',
                text: 'Two hits. Let me check the composer one first.',
            },
            {
                kind: 'tool',
                id: 'tc-2',
                name: 'Bash',
                toolKind: 'execute',
                input: { command: 'bun test app/src/chat/ChatComposer.test.ts' },
                result: 'error: Cannot find module app/src/chat/ChatComposer.test.ts',
                isError: true,
                pending: false,
            },
            {
                kind: 'tool',
                id: 'tc-3',
                name: 'Read',
                toolKind: 'read',
                input: { file_path: 'app/src/chat/ChatComposer.tsx' },
                result: null,
                isError: false,
                pending: true,
            },
        ],
    },
]

/** Inline prompts: an unanswered permission, an answered one, and an AskUserQuestion card. */
export const INLINE_PROMPT_ITEMS: readonly TurnItem[] = [
    { role: 'user', text: 'Rename the old chat view file.' },
    {
        role: 'assistant',
        footer: null,
        parts: [
            {
                kind: 'permission',
                id: 'perm-1',
                toolName: 'Bash',
                input: { command: 'git mv ChatView.tsx ChatView.old.tsx' },
                answered: null,
            },
            {
                kind: 'permission',
                id: 'perm-2',
                toolName: 'Write',
                input: { file_path: 'app/src/chat/README.md' },
                answered: { behavior: 'allow', always: true },
            },
            {
                kind: 'question',
                id: 'q-1',
                questions: [
                    {
                        question: 'Which package should the fix land in?',
                        header: 'scope',
                        multiSelect: false,
                        options: [
                            { label: 'app', description: 'the frontend workspace' },
                            { label: 'core', description: 'the backend workspace' },
                        ],
                    },
                ],
                answered: null,
            },
        ],
    },
]

/** A slash-command result — the boxed monospace "Command output" panel, not loose prose (#28). */
export const COMMAND_OUTPUT_ITEMS: readonly TurnItem[] = [
    { role: 'user', text: '/context' },
    {
        role: 'assistant',
        command: true,
        footer: null,
        parts: [
            {
                kind: 'text',
                text: [
                    '| tokens | budget |',
                    '| --- | --- |',
                    '| 42,318 | 200,000 |',
                ].join('\n'),
            },
        ],
    },
]

/** A queued (staged, not yet sent) user turn — dimmed, with a cancel affordance. */
export const QUEUED_ITEMS: readonly TurnItem[] = [
    { role: 'user', text: 'First message, already sent.' },
    {
        role: 'assistant',
        footer: null,
        parts: [{ kind: 'text', text: 'Working on it…' }],
    },
    {
        role: 'user',
        text: 'Also check the daemon logs for errors.',
        queued: true,
        queueId: 'q-abc',
    },
]

/** A non-error system notice (BUG #87) — a client-side slash command confirming it did something. */
export const SYSTEM_NOTE_ITEMS: readonly TurnItem[] = [
    { role: 'user', text: '/chrome' },
    { role: 'system', text: 'Browser control enabled for this turn.' },
]

/** An assistant turn that reasoned before answering — proves ChatThinkingBlock renders (collapsed
 *  by default) alongside the turn's other parts. */
export const THINKING_ITEMS: readonly TurnItem[] = [
    { role: 'user', text: 'Why did the last deploy take so long?' },
    {
        role: 'assistant',
        footer: { numTurns: 1, costUsd: 0.0081 },
        parts: [
            {
                kind: 'thinking',
                text: 'The build step ran the full test suite instead of the fast subset — that adds about four minutes.',
            },
            {
                kind: 'text',
                text: 'The build ran the full test suite instead of the fast subset.',
            },
        ],
    },
]
