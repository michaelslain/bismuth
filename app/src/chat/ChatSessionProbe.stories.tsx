// Behaviour spec for the chat session controller (chatSession.ts + the chatSessions.ts registry),
// proven through the dev-only <ChatSessionProbe> before any real view composes a session.
//
// The session is REAL; only the socket is faked (_fakeChatSocket.ts replays a static ChatFrame[]).
// Order is the whole trick: a session connects the moment it is created, so each story clears this
// chat id's persisted mode/model prefs (a deterministic seed, not whatever a prior browser run left
// behind), installs the fake socket, forgets any conversation a previous run remembered under its id
// (a remembered one is resumed over HTTP instead of opened fresh), and only THEN retains the session.
// Cleanup releases the session before restoring the real WebSocket, so nothing leaks into the next
// story.
//
// Each play() drives the session through its public API (`chatSession(id)`) and asserts on the
// probe's readouts — which is also what proves the readouts are reactive to the session's signals.
import { onCleanup } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import ChatSessionProbe from './ChatSessionProbe'
import { chatSession, retainChatSessions } from './chatSessions'
import { installFakeChatSocket } from './_fakeChatSocket'
import { forgetChatSession } from '../chatSessionStore'
import { LAST_MODE_KEY } from './chatSessionPrefs'
import { modelStorageKeys } from '../chatProvider'
import type { ChatFrame, ChatManifest } from '../../../core/src/chat'

const meta = {
    title: 'Chat/ChatSessionProbe',
    component: ChatSessionProbe,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatSessionProbe>

export default meta
type Story = StoryObj<typeof meta>

const MANIFEST: ChatManifest = {
    model: 'claude-opus-4-8',
    permissionMode: 'default',
    slashCommands: ['clear', 'compact'],
    tools: ['Read', 'Edit', 'Bash'],
    mcpServers: [{ name: 'bismuth', status: 'connected' }],
}

/** Opens a session without touching the transcript — so a New chat's replay leaves it empty. */
const SESSION_OPEN: ChatFrame[] = [{ type: 'manifest', manifest: MANIFEST }]

/** Clears this chat id's persisted mode + model prefs, so a story's seeded state is always the
 *  DEFAULT (bypassPermissions, no persisted model → adopts the manifest's) rather than whatever a
 *  prior run in this browser happened to leave in localStorage. */
function clearPersistedPrefs(chatId: string) {
    localStorage.removeItem(LAST_MODE_KEY)
    const keys = modelStorageKeys('claude', chatId)
    localStorage.removeItem(keys.perChat)
    localStorage.removeItem(keys.global)
}

/** Mounts the probe over a real session bound to a fake socket replaying `frames`. */
function SessionHarness(props: {
    chatId: string
    frames: readonly ChatFrame[]
}) {
    // Synchronous, in this order, before the probe's first read: clear prefs → fake socket → forget
    // → retain.
    clearPersistedPrefs(props.chatId)
    const restore = installFakeChatSocket(props.frames)
    forgetChatSession(props.chatId)
    retainChatSessions([props.chatId])
    onCleanup(() => {
        retainChatSessions([])
        forgetChatSession(props.chatId)
        restore()
    })
    return <ChatSessionProbe session={chatSession(props.chatId)} />
}

const readout = (root: HTMLElement, key: string) =>
    root.querySelector(`[data-testid="probe-${key}"]`)?.textContent ?? null

/** Wait for a readout to settle on `expected` (frames arrive a microtask after the socket opens). */
const expectReadout = (root: HTMLElement, key: string, expected: string) =>
    waitFor(() => expect(readout(root, key)).toBe(expected))

const live = (chatId: string) => {
    const session = chatSession(chatId)
    if (!session) throw new Error(`session ${chatId} not retained`)
    return session
}

/** Frames populate the transcript: a replayed user turn and a streamed reply (two deltas merge into
 *  one assistant item), plus the manifest in the model/mode readouts. */
export const FramesPopulateTranscript: Story = {
    args: { session: undefined },
    render: () => (
        <SessionHarness
            chatId="story-session-frames"
            frames={[
                ...SESSION_OPEN,
                { type: 'user-message', text: 'What is open today?' },
                { type: 'assistant-text', text: 'Two tasks ' },
                { type: 'assistant-text', text: 'are still open.' },
            ]}
        />
    ),
    play: async ({ canvasElement }) => {
        await expectReadout(canvasElement, 'transcript', '2')
        // No persisted model for this chat id (cleared by the harness) → the session ADOPTS the
        // manifest's resolved model exactly; no persisted mode → the seeded DEFAULT (bypassPermissions).
        await expectReadout(canvasElement, 'model', 'claude-opus-4-8')
        await expect(readout(canvasElement, 'permmode')).toBe('bypassPermissions')
        await expect(readout(canvasElement, 'streaming')).toBe('false')
        const items = live('story-session-frames').transcript
        await expect(items[0].role).toBe('user')
        await expect(items[1].role).toBe('assistant')
    },
}

/** send(): the draft becomes a user item, the draft clears, and the turn is streaming + awaiting. */
export const SendAppendsAndStreams: Story = {
    args: { session: undefined },
    render: () => (
        <SessionHarness chatId="story-session-send" frames={SESSION_OPEN} />
    ),
    play: async ({ canvasElement }) => {
        await waitFor(() =>
            expect(live('story-session-send').manifest()).not.toBeNull(),
        )
        const session = live('story-session-send')
        let appended: boolean | null = null
        const off = session.onAppend(force => (appended = force))
        session.setDraft('hello there')
        await expectReadout(canvasElement, 'draft', 'hello there')
        session.send()
        off()
        await expectReadout(canvasElement, 'transcript', '1')
        await expectReadout(canvasElement, 'streaming', 'true')
        await expectReadout(canvasElement, 'awaiting', 'true')
        await expectReadout(canvasElement, 'draft', '')
        await expect(appended).toBe(true)
        const item = session.transcript[0]
        await expect(item.role === 'user' && item.text).toBe('hello there')
    },
}

/** A send while streaming STAGES the turn: a queued user item, still one live turn. */
export const QueuedWhileStreaming: Story = {
    args: { session: undefined },
    render: () => (
        <SessionHarness chatId="story-session-queue" frames={SESSION_OPEN} />
    ),
    play: async ({ canvasElement }) => {
        await waitFor(() =>
            expect(live('story-session-queue').manifest()).not.toBeNull(),
        )
        const session = live('story-session-queue')
        session.setDraft('first')
        session.send()
        await expectReadout(canvasElement, 'streaming', 'true')
        session.setDraft('second')
        session.send()
        await expectReadout(canvasElement, 'transcript', '2')
        await expectReadout(canvasElement, 'queued', '1')
        await expectReadout(canvasElement, 'streaming', 'true')
        // The staged turn is not the current one: still awaiting the FIRST turn's reply.
        await expectReadout(canvasElement, 'awaiting', 'true')
        // Sent history excludes the queued turn.
        await expect(session.historyEntries()).toEqual(['first'])
    },
}

/** stop(): streaming ends, the queued bubble comes out, and its text is restored to the draft. */
export const StopRestoresQueued: Story = {
    args: { session: undefined },
    render: () => (
        <SessionHarness chatId="story-session-stop" frames={SESSION_OPEN} />
    ),
    play: async ({ canvasElement }) => {
        await waitFor(() =>
            expect(live('story-session-stop').manifest()).not.toBeNull(),
        )
        const session = live('story-session-stop')
        session.setDraft('first')
        session.send()
        session.setDraft('second')
        session.send()
        await expectReadout(canvasElement, 'queued', '1')
        session.stop()
        await expectReadout(canvasElement, 'streaming', 'false')
        await expectReadout(canvasElement, 'queued', '0')
        await expectReadout(canvasElement, 'transcript', '1')
        await expectReadout(canvasElement, 'draft', 'second')
        await expectReadout(canvasElement, 'error', '—')
    },
}

/** startNewChat(): transcript, streaming and draft-independent turn state reset; a fresh socket
 *  re-opens and its manifest lands again without re-populating the transcript. */
export const StartNewChatResets: Story = {
    args: { session: undefined },
    render: () => (
        <SessionHarness chatId="story-session-new" frames={SESSION_OPEN} />
    ),
    play: async ({ canvasElement }) => {
        await waitFor(() =>
            expect(live('story-session-new').manifest()).not.toBeNull(),
        )
        const session = live('story-session-new')
        session.setDraft('before reset')
        session.send()
        await expectReadout(canvasElement, 'transcript', '1')
        await expectReadout(canvasElement, 'streaming', 'true')
        await expectReadout(canvasElement, 'focus', '0')
        session.startNewChat()
        await expectReadout(canvasElement, 'transcript', '0')
        await expectReadout(canvasElement, 'streaming', 'false')
        await expectReadout(canvasElement, 'awaiting', 'false')
        // startNewChat() requests focus return to the composer (the view owns the actual focus()).
        await expectReadout(canvasElement, 'focus', '1')
        // The fresh socket opened and replayed the manifest: the session is live again.
        await waitFor(() => expect(session.manifest()).not.toBeNull())
        await expect(session.transcript.length).toBe(0)
    },
}
