// Visual spec for <ChatView> — the in-app visual Claude Code (ChatView.tsx). The whole transcript
// is built from server-pushed `ChatFrame`s (core/src/chat.ts is the single source of truth for that
// wire contract), which are PLAIN DATA — so a static `ChatFrame[]` can drive the entire conversation
// UI with no Agent-SDK session, no `claude` binary, and no backend. That is what these stories do.
//
// ChatView mounts for real here (it is NOT a stand-in renderer): the only thing faked is the
// transport. `ChatView.tsx`'s `connect()` opens `new WebSocket(`${wsBase()}/chat?chatId=…`)` and
// funnels every `ws.onmessage` payload through `JSON.parse` into `onFrame`, which delegates the
// transcript to the pure reducer in `chatTranscript.ts`. So a fake socket that hands back
// JSON-stringified frames reproduces the real render path exactly — the same code that runs against
// a live session.
//
// Everything ELSE ChatView needs on mount is already provided by the preview: `api.tree()` (the
// hidden-path / @-mention refresh) is served by the global in-memory `fakeTransport`, and the theme
// tokens the chat chrome reads come from `settingsToCssVars(DEFAULTS)` — see .storybook/preview.ts.
// Nothing here hardcodes a color.
//
// The fake is installed as `globalThis.WebSocket` for the story's lifetime only, inside a wrapper
// component's `onMount` — which Solid flushes BEFORE <ChatView>'s own `onMount` calls `connect()` —
// and restored in the wrapper's `onCleanup`. Same install-then-restore shape Terminal.stories.tsx
// uses for its PTY socket. Restoring is mandatory: a leaked global would corrupt every story loaded
// afterward in the same Storybook session.
import { onCleanup, onMount } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { ChatView } from './ChatView'
import { forgetChatSession } from './chatSessionStore'
import { expectProseFace } from './ui/_proseFace'
import type { ChatFrame, ChatManifest } from '../../core/src/chat'

// --- Fake WebSocket, matching only the surface ChatView.tsx actually touches -------------------
// The on* handler properties, `.send()`, `.close()`, `.readyState`, and the OPEN/etc numeric
// statics (ChatView's `sendJson` guards on `ws.readyState !== WebSocket.OPEN`; since we replace the
// global, the bare `WebSocket` identifier there resolves to THIS class, so the statics must exist).
//
// Unlike the terminal's binary PTY stream, /chat frames are JSON TEXT: `onFrame(JSON.parse(ev.data
// as string))`. So each frame goes down as its own stringified message, exactly as core/src/chat.ts
// pushes them.
function makeFakeChatSocketClass(frames: readonly ChatFrame[]) {
    return class FakeChatSocket {
        static readonly CONNECTING = 0
        static readonly OPEN = 1
        static readonly CLOSING = 2
        static readonly CLOSED = 3

        readyState = FakeChatSocket.CONNECTING
        binaryType: 'blob' | 'arraybuffer' = 'blob'
        onopen: ((ev: Event) => void) | null = null
        onmessage: ((ev: MessageEvent) => void) | null = null
        onclose: ((ev: CloseEvent) => void) | null = null
        onerror: ((ev: Event) => void) | null = null

        constructor(public url: string) {
            // Defer past the current microtask: ChatView assigns onopen/onmessage/onclose synchronously
            // right after `new WebSocket(...)` returns, and a real WebSocket never opens synchronously
            // inside its own constructor either — firing here guarantees the handlers are attached.
            queueMicrotask(() => {
                this.readyState = FakeChatSocket.OPEN
                // ChatView's onopen sends `{type:"open", provider}` to spawn the session; a real backend
                // then streams the session's frames back. Pushing them straight after preserves that order.
                this.onopen?.(new Event('open'))
                for (const frame of frames) {
                    this.onmessage?.({
                        data: JSON.stringify(frame),
                    } as unknown as MessageEvent)
                }
            })
        }

        send(..._args: unknown[]): void {
            // Ignore everything the composer sends (open / user / set_model / permission_response / …):
            // there is no session on the other end, and these stories are a spec for RENDERING a
            // transcript, not for round-tripping a turn.
        }

        close(): void {
            // Deliberately does NOT fire `onclose` — ChatView's onclose schedules a backoff reconnect,
            // which would respawn the socket (and replay every frame) after the story unmounts.
            this.readyState = FakeChatSocket.CLOSED
        }
    }
}

/** Installs the fake as `globalThis.WebSocket`; returns a restore function. */
function installFakeChatSocket(frames: readonly ChatFrame[]): () => void {
    const original = globalThis.WebSocket
    globalThis.WebSocket = makeFakeChatSocketClass(
        frames,
    ) as unknown as typeof WebSocket
    return () => {
        globalThis.WebSocket = original
    }
}

/** Wraps <ChatView> with the fake socket's install/restore lifecycle, scoped to exactly this story
 *  instance. Also clears any session id a previous run of this story left in localStorage: ChatView's
 *  `onMount` resumes a REMEMBERED conversation over HTTP instead of connecting fresh, and a story
 *  must always take the fresh-connect path. */
function FakeSocketChat(props: {
    chatId: string
    frames: readonly ChatFrame[]
}) {
    let restore: () => void = () => {}
    onMount(() => {
        forgetChatSession(props.chatId)
        restore = installFakeChatSocket(props.frames)
    })
    onCleanup(() => restore())
    return (
        <ChatView
            chatId={props.chatId}
            noteNames={() => []}
            memoryNames={() => []}
            tagNames={() => []}
        />
    )
}

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
                        text: 'claude-opus-4-8 · 28.4k/200k tokens (14%)\n\n  system prompt    2.1k\n  tools           11.8k\n  messages        14.5k',
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
}

/** The empty state: a session that has opened (its manifest and models populate the header) but has
 *  no turns yet — what the user sees the instant a fresh chat tab opens. */
export const Empty: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <FakeSocketChat chatId="story-chat-empty" frames={SESSION_OPEN} />
        </div>
    ),
}

/** A markdown table inside an assistant message. `TextBubble` renders assistant prose through the
 *  SAME `renderNoteBody` pipeline notes use, onto `.chat-bubble` — so a `| … |` pipe table renders
 *  as a real `<table>`, and TABLES ARE PROSE here too (2026-08-31, matching Editor.css and
 *  BlockEditor.module.css): a table is the message's own content, not chrome, so it must render in
 *  the same face as the paragraph around it. Asserted against `--prose-font` rather than a literal
 *  family name, same as Editor.stories.tsx's MixedTypography — the token is the source of truth. */
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
                        text: "Here's the roster:\n\n| Name | Role | Status |\n| --- | --- | --- |\n| Ada | Engineer | Active |\n| Grace | Design | Active |\n",
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
    },
}
