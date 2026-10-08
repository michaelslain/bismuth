// Visual spec for <QuickAsk> — the Cmd+K popover, a chat floating beside the caret. The popover is
// portaled to <body> and placed from a real CodeMirror caret (or a pane), so every story mounts a
// small fake "pane" with a one-line editor and anchors to the end of `the quick brown fox`. States
// are fed by a stub chat session whose transcript is the state, rendered through the chat's own
// ChatSessionBody: tool rows, thinking, cards, the composer and the model // mode // history //
// new chat row. The open -> ask -> apply -> resume flow is QuickAskHost's story.
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, fn, waitFor, within } from 'storybook/test'
import { makeStubChatSession } from '../chat/_stubChatSession'
import type { TurnItem } from '../chat/chatTranscriptLogic'
import type { ChatManifest } from '../../../core/src/chat'
import { TOOL_CALL_ITEMS } from '../chat/_transcriptFixtures'
import QuickAsk from './QuickAsk'
import { applyMessage } from './quickAskLogic'
import type { QuickAskAnchor } from './quickAskState'

const meta = {
    title: 'QuickAsk/QuickAsk',
    component: QuickAsk,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof QuickAsk>

export default meta
type Story = StoryObj<typeof meta>

const DOC = 'the quick brown fox'

/** A 720x640 fake pane holding a one-line editor `gap` px below its top; renders `children` once
 *  the editor is mounted and anchored. `pane` anchors to the pane instead of the caret. */
function pane(
    children: (anchor: QuickAskAnchor) => JSX.Element,
    opts: { gap?: number; pane?: boolean } = {},
): JSX.Element {
    const [anchor, setAnchor] = createSignal<QuickAskAnchor | null>(null)
    let host!: HTMLDivElement
    onMount(() => {
        const view = new EditorView({
            state: EditorState.create({ doc: DOC }),
            parent: host,
        })
        onCleanup(() => view.destroy())
        setAnchor(
            opts.pane
                ? { kind: 'pane', leafId: 'story-pane', key: 'notes/fox.pdf' }
                : {
                      kind: 'caret',
                      view,
                      pos: DOC.length,
                      notePath: 'notes/fox.md',
                      key: 'notes/fox.md',
                  },
        )
    })
    return (
        <div
            data-pane-leaf="story-pane"
            style={{
                position: 'relative',
                width: '720px',
                height: '640px',
                margin: '24px',
                border: 'var(--rule)',
                'padding-top': `${opts.gap ?? 340}px`,
                'box-sizing': 'border-box',
                background: 'var(--bg)',
                color: 'var(--fg)',
            }}
        >
            <div ref={host} style={{ padding: '0 24px' }} />
            <Show when={anchor()} keyed>
                {a => children(a)}
            </Show>
        </div>
    )
}

const noop = {
    name: 'ember',
    chatId: 'quick-story',
    noteNames: () => [],
    memoryNames: () => [],
    tagNames: () => [],
    onApply: fn(),
    onOpenInChat: fn(),
    onClose: fn(),
}

const MANIFEST: ChatManifest = {
    model: 'claude-opus-4-8',
    permissionMode: 'default',
    slashCommands: ['compact', 'clear'],
    tools: ['Read', 'Write', 'Bash'],
    mcpServers: [{ name: 'bismuth', status: 'connected' }],
}

const MODELS = [
    {
        value: 'opus',
        label: 'Opus 4.8',
        description: 'Most capable',
        effortLevels: ['low', 'medium', 'high'],
    },
    {
        value: 'sonnet',
        label: 'Sonnet 4.8',
        description: 'Fast',
        effortLevels: ['low', 'medium', 'high'],
    },
]

/** A stub session with the model row filled in, like a connected chat. */
const session = (init: Parameters<typeof makeStubChatSession>[0] = {}) =>
    makeStubChatSession({
        manifest: MANIFEST,
        models: MODELS,
        displayModel: 'opus',
        displayModelValue: 'opus',
        permMode: 'default',
        ...init,
    })

const ASKED: TurnItem = {
    role: 'user',
    text: 'what is a good synonym for quick?',
}
const ANSWER =
    'A few options, depending on tone:\n\n- **swift** — neutral, slightly literary\n- **brisk** — suggests energy\n- `rapid` — more technical\n\n"The swift brown fox" reads best.'

const reply = (text: string, footer = true): TurnItem => ({
    role: 'assistant',
    footer: footer ? { numTurns: 1, costUsd: 0.002 } : null,
    parts: [{ kind: 'text', text }],
})

const THREAD: TurnItem[] = [
    ASKED,
    reply(ANSWER),
    { role: 'user', text: 'make it even shorter' },
    reply('"The swift fox" — three words, same picture.'),
]

const panel = () => document.querySelector<HTMLElement>('[data-quick-ask]')!

/** A fresh chat: header, the chat composer (focused) and the model // mode // history // new chat
 *  row. No transcript until something is said. */
export const Idle: Story = {
    render: () =>
        pane(anchor => (
            <QuickAsk
                {...noop}
                anchor={anchor}
                session={session()}
                daemonEnabled
            />
        )),
    play: async () => {
        const body = within(document.body)
        await expect(body.getByText('ember')).toBeInTheDocument()
        await expect(
            body.getByRole('button', { name: /new chat/ }),
        ).toBeInTheDocument()
        await expect(body.queryByRole('button', { name: 'apply' })).toBeNull()
        await expect(
            body.getByRole('button', { name: 'open in chat' }),
        ).toBeInTheDocument()
        await waitFor(() =>
            expect(panel().contains(document.activeElement)).toBe(true),
        )
    },
}

/** Daemon off: the name reads `chat` and the face is asleep. */
export const IdleDaemonOff: Story = {
    name: 'idle daemon off',
    render: () =>
        pane(anchor => (
            <QuickAsk
                {...noop}
                anchor={anchor}
                session={session()}
                daemonEnabled={false}
                name="chat"
            />
        )),
    play: async () => {
        const body = within(document.body)
        await expect(
            body.getByRole('img', { name: /chat/ }),
        ).toBeInTheDocument()
    },
}

/** No session yet (the frame before App retains it): the composer already renders. */
export const BeforeSession: Story = {
    name: 'before session',
    render: () =>
        pane(anchor => (
            <QuickAsk
                {...noop}
                anchor={anchor}
                session={undefined}
                daemonEnabled
            />
        )),
    play: async () => {
        await expect(panel().querySelector('.cm-content')).not.toBeNull()
    },
}

/** Room below the caret line: the popover opens below it, 6px clear. */
export const OpensBelowCaret: Story = {
    name: 'opens below caret',
    render: () =>
        pane(
            anchor => (
                <QuickAsk
                    {...noop}
                    anchor={anchor}
                    session={session()}
                    daemonEnabled
                />
            ),
            {
                gap: 12,
            },
        ),
    play: async () => {
        const caretLine = document
            .querySelector('.cm-line')!
            .getBoundingClientRect()
        // CARET_GAP is 6px off the caret's own coords; the line box can sit a pixel away from them.
        await waitFor(() => {
            const gap = panel().getBoundingClientRect().top - caretLine.bottom
            expect(gap).toBeGreaterThanOrEqual(4)
            expect(gap).toBeLessThanOrEqual(8)
        })
    },
}

/** Little room below, more above: the popover opens above the caret line. */
export const OpensAboveCaret: Story = {
    name: 'opens above caret',
    render: () =>
        pane(
            anchor => (
                <QuickAsk
                    {...noop}
                    anchor={anchor}
                    session={session({ transcript: THREAD })}
                    daemonEnabled
                />
            ),
            { gap: 560 },
        ),
    play: async () => {
        const caretLine = document
            .querySelector('.cm-line')!
            .getBoundingClientRect()
        // CARET_GAP is 6px off the caret's own coords; the line box can sit a pixel away from them.
        await waitFor(() => {
            const gap = caretLine.top - panel().getBoundingClientRect().bottom
            expect(gap).toBeGreaterThanOrEqual(4)
            expect(gap).toBeLessThanOrEqual(8)
        })
    },
}

/** Sent, nothing back yet: the chat's own working state; no apply until there is a reply. */
export const Thinking: Story = {
    render: () =>
        pane(anchor => (
            <QuickAsk
                {...noop}
                anchor={anchor}
                session={session({
                    transcript: [ASKED],
                    streaming: true,
                    awaitingReply: true,
                })}
                daemonEnabled
            />
        )),
    play: async () => {
        const body = within(document.body)
        await expect(
            body.getByText('what is a good synonym for quick?'),
        ).toBeInTheDocument()
        // Nothing to apply yet: the control is not offered.
        await expect(body.queryByRole('button', { name: 'apply' })).toBeNull()
    },
}

/** The agent runs commands: every tool call is a row, exactly as in the chat tab. */
export const ToolCalls: Story = {
    name: 'tool calls',
    render: () =>
        pane(anchor => (
            <QuickAsk
                {...noop}
                anchor={anchor}
                session={session({
                    transcript: [...TOOL_CALL_ITEMS],
                    streaming: true,
                })}
                daemonEnabled
            />
        )),
    play: async () => {
        const body = within(document.body)
        await expect(
            body.getByText(/bun test app\/src\/chat\/ChatComposer\.test\.ts/),
        ).toBeInTheDocument()
        await expect(body.getByRole('button', { name: 'apply' })).toBeDisabled()
    },
}

/** Two rounds, finished: apply is live. The transcript scrolls inside the popover's max height. */
export const ThreadWithFollowUp: Story = {
    name: 'thread with follow-up',
    render: () =>
        pane(anchor => (
            <QuickAsk
                {...noop}
                anchor={anchor}
                session={session({ transcript: THREAD })}
                daemonEnabled
            />
        )),
    play: async () => {
        const body = within(document.body)
        await expect(body.getByText('make it even shorter')).toBeInTheDocument()
        await expect(body.getByRole('button', { name: 'apply' })).toBeEnabled()
        await expect(
            panel().getBoundingClientRect().height,
        ).toBeLessThanOrEqual(560)
    },
}

/** After [ apply ]: the apply message is the latest turn; the agent is editing the file. */
export const Applying: Story = {
    render: () =>
        pane(anchor => (
            <QuickAsk
                {...noop}
                anchor={anchor}
                session={session({
                    transcript: [
                        ASKED,
                        reply(ANSWER),
                        { role: 'user', text: applyMessage('notes/fox.md') },
                    ],
                    streaming: true,
                    awaitingReply: true,
                })}
                daemonEnabled
            />
        )),
    play: async () => {
        await expect(
            within(document.body).getByRole('button', { name: 'apply' }),
        ).toBeDisabled()
    },
}

/** The agent asks for permission mid-thread: the chat's own card, inline. */
export const PermissionRequest: Story = {
    name: 'permission request in thread',
    render: () =>
        pane(anchor => (
            <QuickAsk
                {...noop}
                anchor={anchor}
                session={session({
                    transcript: [
                        ASKED,
                        reply(ANSWER),
                        { role: 'user', text: 'tidy up the draft note' },
                        {
                            role: 'assistant',
                            footer: null,
                            parts: [
                                {
                                    kind: 'permission',
                                    id: 'perm-1',
                                    toolName: 'Write',
                                    input: { file_path: 'notes/draft.md' },
                                    answered: null,
                                },
                            ],
                        },
                    ],
                    streaming: true,
                })}
                daemonEnabled
            />
        )),
    play: async () => {
        await expect(
            within(document.body).getByRole('button', { name: 'allow' }),
        ).toBeInTheDocument()
    },
}

/** A non-note pane: centred at the top of the pane, no `[ apply ]`. */
export const PaneAnchor: Story = {
    name: 'pane anchor (no apply)',
    render: () =>
        pane(
            anchor => (
                <QuickAsk
                    {...noop}
                    anchor={anchor}
                    session={session({ transcript: [ASKED, reply(ANSWER)] })}
                    daemonEnabled
                />
            ),
            { pane: true },
        ),
    play: async () => {
        const body = within(document.body)
        await expect(body.queryByRole('button', { name: 'apply' })).toBeNull()
        await expect(
            body.getByRole('button', { name: 'open in chat' }),
        ).toBeInTheDocument()
    },
}

/** An in-app drag (a sidebar row, a tab) is over the popover: the chat's drop cue. */
export const DragOver: Story = {
    name: 'drag over',
    render: () =>
        pane(anchor => (
            <QuickAsk
                {...noop}
                anchor={anchor}
                session={session()}
                daemonEnabled
                dragOver
            />
        )),
    play: async () => {
        await expect(panel().getAttribute('data-chat-drop')).toBe('quick-story')
    },
}

/** A click outside closes; a press that moves (a drag starting in the sidebar) does not. */
export const OutsideClickVsDrag: Story = {
    name: 'outside click vs drag',
    render: () =>
        pane(anchor => (
            <QuickAsk
                {...noop}
                anchor={anchor}
                session={session()}
                daemonEnabled
            />
        )),
    play: async () => {
        noop.onClose.mockClear()
        const line = document.querySelector<HTMLElement>('.cm-line')!
        fireEvent.pointerDown(line, { clientX: 40, clientY: 40 })
        fireEvent.pointerUp(line, { clientX: 140, clientY: 90 })
        await expect(noop.onClose).not.toHaveBeenCalled()
        fireEvent.pointerDown(line, { clientX: 40, clientY: 40 })
        fireEvent.pointerUp(line, { clientX: 41, clientY: 41 })
        await expect(noop.onClose).toHaveBeenCalledTimes(1)
    },
}

/** No agent is set up: the chat's own setup dead end, the composer still below it. */
export const SetupError: Story = {
    name: 'setup error',
    render: () =>
        pane(anchor => (
            <QuickAsk
                {...noop}
                anchor={anchor}
                session={session({ transcript: [ASKED], setupError: 'claude' })}
                daemonEnabled
            />
        )),
    play: async () => {
        await expect(panel().querySelector('.cm-content')).not.toBeNull()
    },
}

/** The send gate refused (e.g. the agent binary is missing): its message, inline. */
export const GateRefusal: Story = {
    name: 'gate refusal',
    render: () =>
        pane(anchor => (
            <QuickAsk
                {...noop}
                anchor={anchor}
                session={session({
                    transcript: [ASKED],
                    gateRefusal: {
                        binary: 'claude',
                        message: 'claude is not installed',
                    },
                })}
                daemonEnabled
            />
        )),
    play: async () => {
        await expect(
            within(document.body).getByText(/claude is not installed/),
        ).toBeInTheDocument()
    },
}

/** [ history ] from the popover: the history dialog opens OVER it, never behind it. */
export const HistoryOpen: Story = {
    name: 'history open',
    render: () =>
        pane(anchor => (
            <QuickAsk
                {...noop}
                anchor={anchor}
                session={session({ transcript: THREAD, historyOpen: true })}
                daemonEnabled
            />
        )),
    play: async () => {
        await waitFor(() => {
            const r = panel().getBoundingClientRect()
            const top = document.elementFromPoint(
                r.left + r.width / 2,
                r.top + r.height / 2,
            )
            expect(top).not.toBeNull()
            expect(panel().contains(top)).toBe(false)
        })
    },
}
