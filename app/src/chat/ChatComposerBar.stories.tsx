// Visual + behavioral spec for <ChatComposerBar> — the outlined message box the chat tab AND the
// daemon page share (see the component's own header comment). Stories build a fresh
// `makeStubChatSession()` inside `render()` so the play() functions can drive real signals (typing,
// streaming, attachments) without a socket. `session={undefined}` proves the daemon's pre-arm
// composer: identical box, a local draft, disabled send.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'
import ChatComposerBar from './ChatComposerBar'
import { makeStubChatSession, type StubChatSession } from './_stubChatSession'
import type { ChatSession } from './chatSession'
import { settings, setSettings } from '../settings'
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
export const Drafting: Story = (() => {
    // Declared outside `render()` so `play()` can reach the same stub instance and assert on its
    // recorded calls — `render()` runs first and assigns it before `play()` ever reads it.
    let session: StubChatSession
    return {
        render: () => {
            session = makeStubChatSession({ draft: 'ship the composer bar' })
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
            // classifyComposerKey routes a plain Enter to "send" regardless of button focus — the
            // assertion this story exists for: pressing Enter must actually call session.send(),
            // exactly once, not merely fail to throw.
            await waitFor(() => expect(session.calls.send?.length).toBe(1))
        },
    }
})() satisfies Story

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
        // Exactly the commands starting with "c": all three of this session's slash commands
        // (compact, clear, chrome) qualify — a `> 0` check would pass even if the filter dropped
        // "chrome" or matched something that doesn't start with the query.
        expect(rows.length).toBe(3)
        expect(Array.from(rows).map(r => r.textContent?.trim())).toEqual([
            '/compact',
            '/clear',
            '/chrome',
        ])
        // CodeMirror's own block-insert `/` menu (To-do/Quote/Callout/…) must NOT also open —
        // it raced the chat's own popover on the same keystroke and clipped (storyAudit clip-x on
        // `.cm-tooltip-autocomplete`, 384px content in a 258px box). `slashMenu: false` on the
        // composer's `vaultCompletion` call is what suppresses it now.
        expect(
            canvasElement.ownerDocument.querySelector('.cm-tooltip-autocomplete'),
        ).toBeNull()
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

/** The composer squeezed into a 320px-wide column (a narrow sidebar/split pane) — proves the slash
 *  popover neither clips horizontally nor truncates a row's command name, and that CodeMirror's own
 *  `/` block menu still does not race it here either (storyAudit clip-x lead on
 *  `chat-chatcomposerbar--slash-popover`, 384px content in a 258px box). */
export const SlashPopoverNarrow: Story = {
    render: () => {
        const session = makeStubChatSession({
            slashCommands: ['compact', 'clear', 'chrome'],
        })
        return (
            <div style={{ width: '320px' }} data-testid="narrow-col">
                <ChatComposerBar
                    session={session}
                    placeholder="Message Claude"
                    noteNames={noNames}
                    memoryNames={noNames}
                    tagNames={noNames}
                />
            </div>
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
        const popover = canvasElement.querySelector<HTMLElement>(
            `.${styles['slash-popover']}`,
        )!
        const popoverRect = popover.getBoundingClientRect()
        const rootRect = canvasElement
            .querySelector<HTMLElement>('[data-testid="narrow-col"]')!
            .getBoundingClientRect()
        expect(popoverRect.left).toBeGreaterThanOrEqual(rootRect.left)
        expect(popoverRect.right).toBeLessThanOrEqual(rootRect.right)
        const rows = canvasElement.querySelectorAll<HTMLElement>(
            `.${styles['slash-popover']} .bismuth-popover-row`,
        )
        expect(rows.length).toBe(3)
        for (const row of Array.from(rows)) {
            expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
        }
        expect(
            canvasElement.ownerDocument.querySelector('.cm-tooltip-autocomplete'),
        ).toBeNull()
    },
}

/** THE assertion final-review C1 exists for: `chat-send` must be READ from
 *  `.settings.keybindings` on every keystroke, not resolved once from the hardcoded catalog
 *  defaults. Proves both halves in one story — the default combo (Enter) sends, and once rebound
 *  to `Mod+Enter`, plain Enter stops sending (it falls through to CodeMirror's own newline
 *  handling, proven by a second `.cm-line` appearing) while the NEW combo does send. A regression
 *  to the old two-argument `classifyComposerKey(e, state)` call (which silently falls back to
 *  `DEFAULT_COMPOSER_KEY_COMBOS`) fails this story at the second half: the rebind would do
 *  nothing, plain Enter would keep sending, and no second `.cm-line` would ever appear. */
export const RebindingChatSendMovesIt: Story = (() => {
    let session: StubChatSession
    return {
        render: () => {
            session = makeStubChatSession({ draft: 'hello' })
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
            await waitFor(() => expect(content.textContent).toBe('hello'))
            await userEvent.click(content)

            // Default Enter sends.
            fireEvent.keyDown(content, {
                key: 'Enter',
                code: 'Enter',
                bubbles: true,
                cancelable: true,
            })
            await waitFor(() => expect(session.calls.send?.length).toBe(1))

            const restore = settings.keybindings['chat-send']
            try {
                setSettings('keybindings', 'chat-send', 'Mod+Enter')

                // Plain Enter no longer sends — it falls through to CodeMirror's own newline
                // handling, which we prove happened by waiting for a second `.cm-line` (a real
                // condition, not a timer) rather than merely asserting an absence.
                fireEvent.keyDown(content, {
                    key: 'Enter',
                    code: 'Enter',
                    bubbles: true,
                    cancelable: true,
                })
                await waitFor(() =>
                    expect(
                        canvasElement.querySelectorAll('.cm-line').length,
                    ).toBe(2),
                )
                expect(session.calls.send?.length).toBe(1)

                // The NEW combo (Mod+Enter) does send.
                fireEvent.keyDown(content, {
                    key: 'Enter',
                    code: 'Enter',
                    metaKey: true,
                    bubbles: true,
                    cancelable: true,
                })
                await waitFor(() => expect(session.calls.send?.length).toBe(2))
            } finally {
                // The settings store is module-level and shared by every story in the run.
                setSettings('keybindings', 'chat-send', restore)
            }
        },
    }
})() satisfies Story

/** Shift+Enter must keep inserting a newline no matter what `chat-send` is bound to — it is
 *  CodeMirror's own default Enter behaviour, not a rebindable action (see chatComposerKeys.ts's
 *  header comment: there is no distinct "newline" action, only send-vs-pass, and Shift+Enter never
 *  matches `chat-send` since chat-send's combos never carry Shift). */
export const ShiftEnterStillInsertsNewline: Story = {
    render: () => {
        const session = makeStubChatSession({ draft: 'hello' })
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
        await waitFor(() => expect(content.textContent).toBe('hello'))
        await userEvent.click(content)
        fireEvent.keyDown(content, {
            key: 'Enter',
            code: 'Enter',
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        })
        await waitFor(() =>
            expect(canvasElement.querySelectorAll('.cm-line').length).toBe(2),
        )
    },
}
