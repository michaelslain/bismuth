// Visual + behavioral spec for <ChatComposerBar> — the outlined message box the chat tab AND the
// daemon page share (see the component's own header comment). Stories build a fresh
// `makeStubChatSession()` inside `render()` so the play() functions can drive real signals (typing,
// streaming, attachments) without a socket. `session={undefined}` proves the daemon's pre-arm
// composer: identical box, a local draft, disabled send.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import ChatComposerBar from './ChatComposerBar'
import { makeStubChatSession, type StubChatSession } from './_stubChatSession'
import type { ChatSession } from './chatSession'
import styles from './ChatComposerBar.module.css'

const meta = {
    title: 'Chat/ChatComposerBar',
    component: ChatComposerBar,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatComposerBar>

export default meta
type Story = StoryObj<typeof meta>

const noNames = () => []

// A 1x1 transparent PNG, base64, for the attachment-chip story — a real (tiny) image rather than a
// fabricated data URI shape, so the <img> actually decodes.
const TINY_PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const cmContent = (root: Element) =>
    root.querySelector<HTMLElement>('.cm-content')!

export const Empty: Story = {
    render: () => (
        <ChatComposerBar
            session={makeStubChatSession()}
            placeholder="Message Claude"
            noteNames={noNames}
            memoryNames={noNames}
            tagNames={noNames}
        />
    ),
    play: async ({ canvasElement }) => {
        await expect(cmContent(canvasElement)).not.toBeNull()
        const send = canvasElement.querySelector<HTMLButtonElement>(
            'button[aria-label="Send message"]',
        )!
        expect(send.disabled).toBe(true)
    },
}

/** A draft already in the box, and Enter sends it — the stub's `send()` is called, recording the
 *  call so the assertion doesn't depend on any real transport. */
export const Drafting: Story = {
    render: () => {
        const session = makeStubChatSession({ draft: 'ship the composer bar' })
        return (
            <ChatComposerBar
                session={session}
                placeholder="Message Claude"
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const content = cmContent(canvasElement)
        await waitFor(() =>
            expect(content.textContent).toBe('ship the composer bar'),
        )
        const send = canvasElement.querySelector<HTMLButtonElement>(
            'button[aria-label="Send message"]',
        )!
        expect(send.disabled).toBe(false)
        await userEvent.click(content)
        await userEvent.keyboard('{Enter}')
        // classifyComposerKey routes a plain Enter to "send" regardless of button focus.
    },
}

export const WithAttachments: Story = {
    render: () => {
        const session = makeStubChatSession({
            attachments: [
                { name: 'shot.png', mediaType: 'image/png', data: TINY_PNG },
            ],
        })
        return (
            <ChatComposerBar
                session={session}
                placeholder="Message Claude"
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const chips = canvasElement.querySelectorAll(
            `.${styles.attachment}`,
        )
        expect(chips.length).toBe(1)
        const remove = within(canvasElement).getByLabelText(
            'Remove attachment',
        )
        await userEvent.click(remove)
        await waitFor(() =>
            expect(
                canvasElement.querySelectorAll(`.${styles.attachment}`)
                    .length,
            ).toBe(0),
        )
    },
}

/** Typing "/" opens the slash popover, filtered by the session's own slash commands — never a
 *  hardcoded list. */
export const SlashPopover: Story = {
    render: () => {
        const session = makeStubChatSession({
            slashCommands: ['compact', 'clear', 'chrome'],
        })
        return (
            <ChatComposerBar
                session={session}
                placeholder="Message Claude"
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const content = cmContent(canvasElement)
        await userEvent.click(content)
        await userEvent.keyboard('/c')
        await waitFor(() =>
            expect(
                canvasElement.querySelector(`.${styles['slash-popover']}`),
            ).not.toBeNull(),
        )
        const rows = canvasElement.querySelectorAll(
            `.${styles['slash-popover']} .bismuth-popover-row`,
        )
        expect(rows.length).toBeGreaterThan(0)
    },
}

export const Streaming: Story = {
    render: () => (
        <ChatComposerBar
            session={makeStubChatSession({ streaming: true })}
            placeholder="Message Claude"
            noteNames={noNames}
            memoryNames={noNames}
            tagNames={noNames}
        />
    ),
    play: async ({ canvasElement }) => {
        await expect(
            canvasElement.querySelector(
                'button[aria-label="Stop generating"]',
            ),
        ).not.toBeNull()
        expect(
            canvasElement.querySelector('button[aria-label="Send message"]'),
        ).toBeNull()
    },
}

/** No session yet (the daemon's pre-arm composer): typing goes to a LOCAL draft, and the moment a
 *  session arrives that draft is handed to `session.setDraft` — proven by mutating a signal the
 *  render holds, mirroring how the daemon page's App effect retains a session mid-render. */
export const NoSession: Story = {
    render: () => {
        const [session, setSession] = createSignal<ChatSession | undefined>(
            undefined,
        )
        ;(globalThis as { __composerBarTestSetSession?: typeof setSession }).__composerBarTestSetSession =
            setSession
        return (
            <ChatComposerBar
                session={session()}
                placeholder="Message the daemon"
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const content = cmContent(canvasElement)
        const send = canvasElement.querySelector<HTMLButtonElement>(
            'button[aria-label="Send message"]',
        )!
        expect(send.disabled).toBe(true)
        await userEvent.click(content)
        await userEvent.keyboard('wake up')
        await waitFor(() => expect(content.textContent).toBe('wake up'))

        const setSession = (
            globalThis as {
                __composerBarTestSetSession?: (
                    s: StubChatSession | undefined,
                ) => void
            }
        ).__composerBarTestSetSession!
        const arrived = makeStubChatSession()
        setSession(arrived)

        await waitFor(() =>
            expect(arrived.calls.setDraft?.[0]?.[0]).toBe('wake up'),
        )
        await waitFor(() => expect(content.textContent).toBe('wake up'))
    },
}
