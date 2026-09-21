// Visual spec for <ChatView> — the in-app visual Claude Code (ChatView.tsx). The whole transcript
// is built from server-pushed `ChatFrame`s (core/src/chat.ts is the single source of truth for that
// wire contract), which are PLAIN DATA — so a static `ChatFrame[]` can drive the entire conversation
// UI with no Agent-SDK session, no `claude` binary, and no backend. That is what these stories do.
//
// ChatView mounts for real here (it is NOT a stand-in renderer): the only thing faked is the
// transport. The session registry (chat/chatSessions.ts) creates a chat's session — which opens
// `new WebSocket(`${wsBase()}/chat?chatId=…`)` and funnels every message through the pure reducer in
// `chatTranscript.ts` — so a fake socket that hands back JSON-stringified frames reproduces the real
// render path exactly: the same code that runs against a live session.
//
// Everything ELSE a session needs is already provided by the preview: `api.tree()` (the hidden-path
// / @-mention refresh) is served by the global in-memory `fakeTransport`, and the theme tokens the
// chat chrome reads come from `settingsToCssVars(DEFAULTS)` — see .storybook/preview.ts. Nothing here
// hardcodes a color.
//
// ORDER IS LOAD-BEARING (chat/_fakeChatSocket.ts): a session connects the instant it is retained, so
// the wrapper installs the fake socket, forgets any remembered session id (a remembered id RESUMES
// over HTTP instead of connecting), THEN retains — synchronously, before <ChatView> first reads the
// registry, the way App's effect has retained a tab's session before its pane mounts. Cleanup
// releases the session before restoring the real WebSocket: a leaked global would corrupt every
// story loaded afterwards in the same Storybook session.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { ChatView } from './ChatView'
import { retainFakeChat } from './chat/_fakeChatSocket'
import { expectProseFace, expectUiFace, expectEditorSize, expectBoundToUiFont } from './ui/_fontFace'
import type { ChatFrame, ChatManifest } from '../../core/src/chat'

/** Wraps <ChatView> with the fake socket + session lifecycle, scoped to exactly this story instance. */
function FakeSocketChat(props: { chatId: string; frames: readonly ChatFrame[] }) {
    retainFakeChat(props.chatId, props.frames)
    return (
        <ChatView
            chatId={props.chatId}
            noteNames={() => []}
            memoryNames={() => []}
            tagNames={() => []}
        />
    )
}

/** Wait until `text` appears anywhere in the story (frames arrive a microtask after the socket opens). */
const findText = (root: HTMLElement, text: string) =>
    waitFor(() => {
        if (!root.textContent?.includes(text))
            throw new Error(`"${text}" not rendered yet`)
        return true
    })

/** Wait until a turn label's OWN element reads exactly `text` — unlike `findText`, this cannot be
 *  fooled by a substring match inside unrelated prose (`findText(root, 'you')` also matches "your
 *  vault" in the empty-state greeting). ChatTurnLabel renders the label as a `Text as="span"`. */
const findLabel = (root: HTMLElement, text: string) =>
    waitFor(() => {
        const match = [...root.querySelectorAll('span')].find(
            el => el.textContent?.trim() === text,
        )
        if (!match) throw new Error(`"${text}" turn label not rendered yet`)
        return match
    })

const meta = {
    title: 'App/ChatView',
    component: ChatView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ChatView>

export default meta
type Story = StoryObj<typeof meta>

// Fixed px, not vh/%: matches Terminal/GraphView stories' own note — the preview iframe is short
// with the Controls panel open, and the chat pane fills its parent's height.
const STORY_H = '620px'

/** The per-turn manifest every session emits from its `init` event. Sourced from the SDK in the
 *  real app — never hardcoded there — so this is only a plausible sample of that shape. */
const MANIFEST: ChatManifest = {
    model: 'claude-opus-4-8',
    permissionMode: 'default',
    slashCommands: ['clear', 'compact', 'context', 'model'],
    tools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob', 'Task'],
    mcpServers: [{ name: 'bismuth', status: 'connected' }],
}

/** The frames that open any session: the manifest and the model list the header picker renders. */
const SESSION_OPEN: ChatFrame[] = [
    { type: 'manifest', manifest: MANIFEST },
    {
        type: 'models',
        models: [
            {
                value: 'opus',
                label: 'Opus',
                description: 'Most capable',
                effortLevels: ['low', 'medium', 'high'],
            },
            {
                value: 'sonnet',
                label: 'Sonnet',
                description: 'Balanced',
                effortLevels: ['low', 'medium', 'high'],
            },
        ],
    },
]

/** An everyday completed turn: the user asks a question, Claude thinks, narrates, calls a tool,
 *  gets its result, answers, and the turn closes with its cost footer. Exercises the streaming
 *  merge (consecutive deltas coalesce into ONE bubble) and the prose/tool/prose split — the two
 *  rules that make a transcript read like a conversation instead of a log. */
export const Default: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <FakeSocketChat
                chatId="story-chat-default"
                frames={[
                    ...SESSION_OPEN,
                    {
                        type: 'user-message',
                        text: "What's still open in my daily note?",
                    },
                    {
                        type: 'thinking',
                        text: 'The daily note lives under `journal/`. ',
                    },
                    {
                        type: 'thinking',
                        text: "I'll read today's file and pull out the unchecked tasks.",
                    },
                    { type: 'assistant-text', text: 'Let me read ' },
                    { type: 'assistant-text', text: "today's note.\n\n" },
                    {
                        type: 'tool-use',
                        id: 't1',
                        name: 'Read',
                        kind: 'read',
                        input: { file_path: 'journal/2026-08-04.md' },
                    },
                    {
                        type: 'tool-result',
                        id: 't1',
                        content:
                            '# 2026-08-04\n\n- [x] review the layout benchmark\n- [ ] ship the chat refactor\n- [ ] reply to the vault-review digest\n',
                        isError: false,
                    },
                    {
                        type: 'assistant-text',
                        text: 'Two things are still open in [[2026-08-04]]:\n\n1. **Ship the chat refactor**\n2. **Reply to the vault-review digest**\n\nThe layout benchmark is already checked off.',
                    },
                    {
                        type: 'result',
                        isError: false,
                        numTurns: 2,
                        costUsd: 0.0314,
                    },
                    {
                        type: 'context',
                        percentage: 14,
                        totalTokens: 28_400,
                        maxTokens: 200_000,
                    },
                    { type: 'done' },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await findText(canvasElement, 'Ship the chat refactor')
        // Turn labels are lowercase heads, and the composer is the CodeMirror field.
        await findLabel(canvasElement, 'you')
        await expect(canvasElement.querySelector('.cm-content')).not.toBeNull()
        await expect(canvasElement.querySelector('[data-chat-host]')).toBeNull()
    },
}

/** Tool chips in every state at once: one resolved, one FAILED (its result renders as an error),
 *  and one still in flight (the pending spinner state, which a live session only shows for the
 *  moment between the call and its result — hard to catch by hand, trivial to pose from frames). */
export const ToolCalls: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <FakeSocketChat
                chatId="story-chat-tools"
                frames={[
                    ...SESSION_OPEN,
                    {
                        type: 'user-message',
                        text: 'Run the app tests and show me anything failing.',
                    },
                    { type: 'assistant-text', text: 'Running the suite now.' },
                    {
                        type: 'tool-use',
                        id: 't1',
                        name: 'Bash',
                        kind: 'execute',
                        input: { command: 'bun test app' },
                    },
                    {
                        type: 'tool-result',
                        id: 't1',
                        content:
                            '2904 pass\n0 fail\nRan 2904 tests across 199 files.',
                        isError: false,
                    },
                    {
                        type: 'tool-use',
                        id: 't2',
                        name: 'Read',
                        kind: 'read',
                        input: { file_path: 'app/src/does-not-exist.ts' },
                    },
                    {
                        type: 'tool-result',
                        id: 't2',
                        content: 'ENOENT: no such file or directory',
                        isError: true,
                    },
                    {
                        type: 'assistant-text',
                        text: 'The suite is green. Let me grep for the stale import that path came from.',
                    },
                    {
                        type: 'tool-use',
                        id: 't3',
                        name: 'Grep',
                        kind: 'search',
                        input: { pattern: 'does-not-exist' },
                    },
                    // No `tool-result` for t3 and no `done`: the chip stays PENDING, which is the point.
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await findText(canvasElement, 'bun test app')
        await findText(canvasElement, 'app/src/does-not-exist.ts')
    },
}

/** The two INTERACTIVE cards, which a live session only raises when Claude happens to need them:
 *  an inline permission prompt (canUseTool asking to approve a not-pre-allowed tool) and an
 *  AskUserQuestion card with its multiple-choice options. Both render unanswered — the state the
 *  user actually has to act on. */
export const InlinePrompts: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <FakeSocketChat
                chatId="story-chat-prompts"
                frames={[
                    ...SESSION_OPEN,
                    {
                        type: 'user-message',
                        text: 'Clean up the build output and export the vault.',
                    },
                    {
                        type: 'assistant-text',
                        text: "I'll remove the build directory first — this needs your approval.",
                    },
                    {
                        type: 'permission',
                        id: 'p1',
                        toolName: 'Bash',
                        input: { command: 'rm -rf app/dist' },
                    },
                    {
                        type: 'question',
                        id: 'q1',
                        questions: [
                            {
                                question: 'Which format should the export use?',
                                header: 'Format',
                                multiSelect: false,
                                options: [
                                    {
                                        label: 'Markdown',
                                        description:
                                            'Plain .md files, wikilinks preserved',
                                    },
                                    {
                                        label: 'HTML',
                                        description:
                                            'Styled, self-contained pages',
                                    },
                                    {
                                        label: 'PDF',
                                        description: 'One document per note',
                                    },
                                ],
                            },
                            {
                                question: 'Which folders should it include?',
                                header: 'Scope',
                                multiSelect: true,
                                options: [
                                    {
                                        label: 'journal',
                                        description: 'Daily notes',
                                    },
                                    {
                                        label: 'reading',
                                        description: 'Book notes and quotes',
                                    },
                                    {
                                        label: 'thoughts',
                                        description: 'Everything else',
                                    },
                                ],
                            },
                        ],
                    },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await findText(canvasElement, 'rm -rf app/dist')
        await findText(canvasElement, 'Which format should the export use?')
    },
}

/** A turn answering a SLASH COMMAND: the reducer flags the assistant turn as `command` when the
 *  preceding user bubble starts with "/", and its prose renders in the boxed monospace
 *  command-output container rather than as loose conversational prose (#28). */
export const CommandOutput: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <FakeSocketChat
                chatId="story-chat-command"
                frames={[
                    ...SESSION_OPEN,
                    { type: 'user-message', text: '/context' },
                    {
                        type: 'assistant-text',
                        text: 'claude-opus-4-8 // 28.4k/200k tokens (14%)\n\n  system prompt    2.1k\n  tools           11.8k\n  messages        14.5k',
                    },
                    {
                        type: 'result',
                        isError: false,
                        numTurns: 1,
                        costUsd: null,
                    },
                    { type: 'done' },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await findText(canvasElement, 'system prompt')
    },
}

/** A failed turn: the `error` frame drives ChatView's inline turn-error notice (signal state — the
 *  transcript itself is deliberately untouched by error frames, see chatTranscript.ts's SCOPE
 *  note), so the completed prose above it stays readable instead of being replaced. */
export const TurnError: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <FakeSocketChat
                chatId="story-chat-error"
                frames={[
                    ...SESSION_OPEN,
                    {
                        type: 'user-message',
                        text: 'Summarise every note tagged #reading.',
                    },
                    {
                        type: 'assistant-text',
                        text: 'Gathering the tagged notes…',
                    },
                    {
                        type: 'error',
                        code: 'error',
                        message:
                            'The session ended unexpectedly (exit code 1).',
                    },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await findText(canvasElement, 'The session ended unexpectedly')
        await findText(canvasElement, 'Gathering the tagged notes')
    },
}

/** The empty state: a session that has opened (its manifest and models populate the header) but has
 *  no turns yet — what the user sees the instant a fresh chat tab opens. */
export const Empty: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <FakeSocketChat chatId="story-chat-empty" frames={SESSION_OPEN} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await findText(canvasElement, 'anything about your vault')
        // The greeting is centred in the transcript area: its midline sits in the middle band of
        // the space between the header and the composer, not pinned to the top.
        const greeting = canvasElement.querySelector<HTMLElement>(
            '[data-testid="ui-empty-block"]',
        )!
        const bar = canvasElement.querySelector<HTMLElement>('[data-viewbar]')!
        const composer = canvasElement.querySelector<HTMLElement>('.cm-content')!
        const g = greeting.getBoundingClientRect()
        const top = bar.getBoundingClientRect().bottom
        const bottom = composer.getBoundingClientRect().top
        const mid = (g.top + g.bottom) / 2
        await expect(Math.abs(mid - (top + bottom) / 2)).toBeLessThan((bottom - top) * 0.15)
        // Capped to the 680px reading column (ChatTurnColumn), not the full pane width — the
        // greeting's own paragraph wraps at that width instead of stretching edge to edge.
        await expect(g.width).toBeLessThanOrEqual(680)
        const body = canvasElement.querySelector<HTMLElement>(
            '[data-testid="ui-empty"]',
        )!
        await expect(body.getBoundingClientRect().width).toBeLessThanOrEqual(680)
    },
}

/** A markdown table AND an Obsidian-style callout inside an assistant message. `ChatTextBubble`
 *  renders assistant prose through the SAME `renderNoteBody` pipeline notes use, onto
 *  `.chat-bubble` — so a `| … |` pipe table renders as a real `<table>`, and TABLES ARE PROSE
 *  here too (2026-08-31, matching Editor.css): a table is the message's own content, not chrome,
 *  so it must render in the same face as the paragraph around it. Asserted against
 *  `--prose-font` rather than a literal family name, same as Editor.stories.tsx's
 *  MixedTypography — the token is the source of truth. The trailing `> [!note]` callout is this
 *  repo's ONE rendered-markdown-callout coverage through a card/chat/transclusion surface (as
 *  opposed to the CodeMirror live-preview widget, covered elsewhere) — its `.callout*` rules
 *  moved from the deleted BlockEditor.module.css to styles/content.css (blocks-mode removal). */
export const TableMessage: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <FakeSocketChat
                chatId="story-chat-table"
                frames={[
                    ...SESSION_OPEN,
                    {
                        type: 'user-message',
                        text: 'Show me the team roster.',
                    },
                    {
                        type: 'assistant-text',
                        text: "Here's the roster:\n\n| Name | Role | Status |\n| --- | --- | --- |\n| Ada | Engineer | Active |\n| Grace | Design | Active |\n\n> [!note] Heads up\n> Grace is out next week.\n",
                    },
                    {
                        type: 'result',
                        isError: false,
                        numTurns: 1,
                        costUsd: 0.0012,
                    },
                    { type: 'done' },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const cell = canvasElement.querySelector('td, th') as HTMLElement
        await expect(cell).not.toBeNull()
        expectProseFace(cell)
        const callout = canvasElement.querySelector('.callout')
        await expect(callout).not.toBeNull()
    },
}

/** #tags in an assistant message read in the EDITOR's mono face at the editor size, matching
 *  .cm-tag / the Milkdown chip / the in-table chip (the user's call, 2026-09-03: "they should all
 *  be the same, monaspace"). Scoped to the chat bubble so this cannot accidentally measure a tag
 *  rendered by some other part of the chat chrome.
 *
 *  `.chat-bubble` IS a CSS-Modules class here (unlike `.bismuth-tag`, a global class written into
 *  the rendered markdown string) — chat/ChatTextBubble.tsx applies it from its own module, which
 *  Vite's dev scoping turns into `_chat-bubble_<hash>_<n>`, a single token that does not
 *  contain "chat-bubble" as a separate class. Confirmed against the real story DOM
 *  (`bun bench/probeStory.ts app-chatview--tag-typography --html`). `[class*="chat-bubble"]`
 *  also matches the wrapper (`_chat-bubble-wrap_…`), so the query is scoped to the
 *  chat-bubble-or-wrapper subtree rather than to the bubble alone — that still isolates the
 *  assertion from unrelated chat chrome, since the wrapper's only other child is the copy
 *  button, which never carries a tag. */
export const TagTypography: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <FakeSocketChat
                chatId="story-chat-tag-typography"
                frames={[
                    ...SESSION_OPEN,
                    {
                        type: 'user-message',
                        text: 'What tags does this note use?',
                    },
                    {
                        type: 'assistant-text',
                        text: 'It uses #project and #planning.',
                    },
                    {
                        type: 'result',
                        isError: false,
                        numTurns: 1,
                        costUsd: 0.0012,
                    },
                    { type: 'done' },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            if (!canvasElement.querySelector('[class*="chat-bubble"] .bismuth-tag')) {
                throw new Error('tag not rendered in a chat bubble yet')
            }
            return true
        })
        const tags = canvasElement.querySelectorAll<HTMLElement>(
            '[class*="chat-bubble"] .bismuth-tag',
        )
        await expect(tags.length).toBeGreaterThan(0)
        for (const el of tags) {
            expectUiFace(el)
            expectEditorSize(el)
            expectBoundToUiFont(el)
        }
    },
}
