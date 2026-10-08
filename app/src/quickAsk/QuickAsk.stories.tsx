// Visual spec for <QuickAsk> — the Cmd+K popover. The popover is portaled to <body> and placed from
// a real CodeMirror caret (or a pane), so every story mounts a small fake "pane" with a one-line
// editor and anchors to the end of `the quick brown fox`. States are fed by a stub chat session
// whose transcript is the state: first user turn = the question already sent; assistant turn = the
// answer so far; later user turns are follow-ups. (A synthetic Enter cannot mint a chat id, so a play() never sends; the full
// send -> stream -> done flow is QuickAskHost's story.)
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { makeStubChatSession } from '../chat/_stubChatSession'
import type { TurnItem } from '../chat/chatTranscriptLogic'
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
                ? { kind: 'pane', leafId: 'story-pane' }
                : { kind: 'caret', view, pos: DOC.length, notePath: 'notes/fox.md' },
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
    onSubmit: fn(),
    onReply: fn(),
    onApply: fn(),
    onOpenInChat: fn(),
    onClose: fn(),
}

const ASKED: TurnItem = { role: 'user', text: 'what is a good synonym for quick?' }
const ANSWER =
    'A few options, depending on tone:\n\n- **swift** — neutral, slightly literary\n- **brisk** — suggests energy\n- `rapid` — more technical\n\n"The swift brown fox" reads best.'

/** Before sending: one row, `<face> <name> <input>`, input focused, placeholder `ask…`. */
export const Idle: Story = {
    render: () =>
        pane(anchor => (
            <QuickAsk anchor={anchor} session={undefined} daemonEnabled {...noop} />
        )),
    play: async () => {
        const input = within(document.body).getByPlaceholderText('ask…')
        await expect(input).toHaveFocus()
        await expect(within(document.body).getByText('ember')).toBeInTheDocument()
        await expect(within(document.body).queryByText('//')).toBeNull()
        await expect(within(document.body).queryByText('ask')).toBeNull()
    },
}

/** Daemon off: the name reads `chat` and the face is asleep. */
export const IdleDaemonOff: Story = {
    name: 'idle daemon off',
    render: () =>
        pane(anchor => (
            <QuickAsk
                anchor={anchor}
                session={undefined}
                daemonEnabled={false}
                {...noop}
                name="chat"
            />
        )),
    play: async () => {
        const body = within(document.body)
        await expect(body.getByPlaceholderText('ask…')).toBeInTheDocument()
        await expect(body.getByText('chat')).toBeInTheDocument()
        await expect(body.getByRole('img', { name: /chat/ })).toBeInTheDocument()
    },
}

/** No room above the caret line: the popover opens below it. */
export const IdleNearTop: Story = {
    name: 'idle below caret',
    render: () =>
        pane(
            anchor => (
                <QuickAsk anchor={anchor} session={undefined} daemonEnabled {...noop} />
            ),
            { gap: 12 },
        ),
    play: async () => {
        const input = within(document.body).getByPlaceholderText('ask…')
        const caretLine = document.querySelector('.cm-line')!.getBoundingClientRect()
        const panel = input.closest('[data-chat-surface]')!.getBoundingClientRect()
        // Opens BELOW the caret line, 6px clear of it.
        await expect(Math.round(panel.top - caretLine.bottom)).toBeGreaterThanOrEqual(5)
    },
}

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

/** Sent, nothing back yet: the thread holds the question; the chat's own working indicator. */
export const Thinking: Story = {
    render: () =>
        pane(anchor => (
            <QuickAsk
                anchor={anchor}
                session={makeStubChatSession({
                    transcript: [ASKED],
                    streaming: true,
                    awaitingReply: true,
                })}
                daemonEnabled
                {...noop}
            />
        )),
    play: async () => {
        const body = within(document.body)
        await expect(body.getByText('working')).toBeInTheDocument()
        await expect(body.getByText('> what is a good synonym for quick?')).toBeInTheDocument()
        await expect(body.queryByPlaceholderText('ask…')).toBeNull()
        await expect(body.getByRole('button', { name: 'apply' })).toBeDisabled()
    },
}

/** Mid-stream: markdown is rendering, apply is still disabled, the reply input is typeable. */
export const Streaming: Story = {
    render: () =>
        pane(anchor => (
            <QuickAsk
                anchor={anchor}
                session={makeStubChatSession({
                    transcript: [ASKED, reply(ANSWER.slice(0, 120), false)],
                    streaming: true,
                })}
                daemonEnabled
                {...noop}
            />
        )),
    play: async () => {
        const body = within(document.body)
        await expect(body.getByRole('button', { name: 'apply' })).toBeDisabled()
        const input = body.getByPlaceholderText('reply…')
        await userEvent.type(input, 'hold on')
        await expect(input).toHaveValue('hold on')
        // Enter does nothing while the reply streams.
        await userEvent.type(input, '{Enter}')
        await expect(noop.onReply).not.toHaveBeenCalled()
    },
}

/** Two rounds: `> ` user lines, markdown replies, reply input at the bottom. */
export const ThreadWithFollowUp: Story = {
    name: 'thread with follow-up',
    render: () =>
        pane(anchor => (
            <QuickAsk
                anchor={anchor}
                session={makeStubChatSession({ transcript: THREAD })}
                daemonEnabled
                {...noop}
            />
        )),
    play: async () => {
        const body = within(document.body)
        await expect(body.getByText('> what is a good synonym for quick?')).toBeInTheDocument()
        await expect(body.getByText('> make it even shorter')).toBeInTheDocument()
        await waitFor(() => expect(body.getByPlaceholderText('reply…')).toHaveFocus())
        await expect(body.getByRole('button', { name: 'apply' })).toBeEnabled()
    },
}

/** Finished reply in a note: the footer reads `[ apply ] [ open in chat ] [ esc ]`. */
export const ApplyReady: Story = {
    name: 'apply ready',
    render: () =>
        pane(anchor => (
            <QuickAsk
                anchor={anchor}
                session={makeStubChatSession({ transcript: [ASKED, reply(ANSWER)] })}
                daemonEnabled
                {...noop}
            />
        )),
    play: async () => {
        const body = within(document.body)
        await waitFor(() => expect(body.getByRole('button', { name: 'apply' })).toBeEnabled())
        await expect(body.getByRole('button', { name: 'open in chat' })).toBeEnabled()
        await expect(body.getByRole('button', { name: 'esc' })).toBeEnabled()
        await expect(body.queryByRole('button', { name: 'insert' })).toBeNull()
    },
}

/** After [ apply ]: the wire message reads `> apply`; the agent is editing the file. */
export const Applying: Story = {
    render: () =>
        pane(anchor => (
            <QuickAsk
                anchor={anchor}
                session={makeStubChatSession({
                    transcript: [
                        ASKED,
                        reply(ANSWER),
                        { role: 'user', text: applyMessage('notes/fox.md') },
                    ],
                    streaming: true,
                    awaitingReply: true,
                })}
                daemonEnabled
                {...noop}
            />
        )),
    play: async () => {
        const body = within(document.body)
        await expect(body.getByText('> apply')).toBeInTheDocument()
        await expect(body.getByText('working')).toBeInTheDocument()
        await expect(body.getByRole('button', { name: 'apply' })).toBeDisabled()
    },
}

/** The agent asks for permission mid-thread: the chat's own card, inline. */
export const PermissionRequest: Story = {
    name: 'permission request in thread',
    render: () =>
        pane(anchor => (
            <QuickAsk
                anchor={anchor}
                session={makeStubChatSession({
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
                {...noop}
            />
        )),
    play: async () => {
        await expect(within(document.body).getByRole('button', { name: 'allow' })).toBeInTheDocument()
    },
}

/** A non-note pane: centred at the top of the pane, no `[ apply ]`. */
export const PaneAnchor: Story = {
    name: 'pane anchor (no apply)',
    render: () =>
        pane(
            anchor => (
                <QuickAsk
                    anchor={anchor}
                    session={makeStubChatSession({ transcript: [ASKED, reply(ANSWER)] })}
                    daemonEnabled
                    {...noop}
                />
            ),
            { pane: true },
        ),
    play: async () => {
        const body = within(document.body)
        await expect(body.queryByRole('button', { name: 'apply' })).toBeNull()
        await expect(body.getByRole('button', { name: 'open in chat' })).toBeInTheDocument()
    },
}

/** No agent is set up: a danger note instead of a hanging `working`. */
export const SetupError: Story = {
    name: 'setup error',
    render: () =>
        pane(anchor => (
            <QuickAsk
                anchor={anchor}
                session={makeStubChatSession({ transcript: [ASKED], setupError: 'claude' })}
                daemonEnabled
                {...noop}
            />
        )),
    play: async () => {
        await expect(
            within(document.body).getByText('no agent set up — open in chat to set one up'),
        ).toBeInTheDocument()
        await expect(within(document.body).queryByText('working')).toBeNull()
    },
}

/** The send gate refused (e.g. the agent binary is missing): its message, inline. */
export const GateRefusal: Story = {
    name: 'gate refusal',
    render: () =>
        pane(anchor => (
            <QuickAsk
                anchor={anchor}
                session={makeStubChatSession({
                    transcript: [ASKED],
                    gateRefusal: { binary: 'claude', message: 'claude is not installed' },
                })}
                daemonEnabled
                {...noop}
            />
        )),
    play: async () => {
        await expect(within(document.body).getByText('claude is not installed')).toBeInTheDocument()
    },
}
