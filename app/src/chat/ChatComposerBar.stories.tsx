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

// A session's commands as the Claude backend reports them: names, plus each one's description and
// argument hint from the SDK's command list (a skill's `description` / `argument-hint`).
const COMMANDS = {
    slashCommands: [
        'compact',
        'clear',
        'chrome',
        'bust',
        'superpowers:brainstorming',
        'code-review',
    ],
    slashCommandDetails: {
        compact:
            'Clear conversation history but keep a summary in context. Optional: /compact [instructions for summarization]',
        clear: 'Clear conversation history and free up context',
        chrome: 'Claude in Chrome settings',
        bust: 'Use when the user types /bust, or hands over a goal to be built end to end on its own branch',
        'superpowers:brainstorming':
            'You MUST use this before any creative work - creating features, building components, adding functionality',
        'code-review':
            'Review the current diff, or a PR number/branch/path target, for correctness bugs',
    },
    slashCommandHints: {
        compact: '<optional custom summarization instructions>',
        bust: '[deep] [K] <goal>',
        'code-review': '[low|medium|high|xhigh|max] [target]',
    },
}

const labels = (root: Element) =>
    Array.from(
        root.querySelectorAll(
            `.${styles['slash-popover']} .bismuth-popover-label`,
        ),
    ).map(r => r.textContent?.trim())

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

/** Render-only: proves the chip renders and stays put for the screenshot — `RemoveAttachment`
 *  below is the one that clicks it away. Splitting these means the post-play screenshot this
 *  story is judged by actually shows an attachment chip. */
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
        await expect(
            within(canvasElement).getByLabelText('Remove attachment'),
        ).not.toBeNull()
    },
}

/** Clicking the remove button on an attachment chip drops it — the behavior `WithAttachments`
 *  above used to assert (and, by clicking mid-play, leave its own screenshot empty). */
export const RemoveAttachment: Story = {
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
 *  hardcoded list. The popover opens ABOVE the box (`.slash-popover`'s `bottom: calc(100% + 6px)`),
 *  so with no headroom above the composer it lands off the top of the canvas (measured at
 *  y = -54) — this decorator gives it ~90px of top padding to render inside the frame, the same
 *  way a real page has toolbar/chrome above the composer. */
export const SlashPopover: Story = {
    decorators: [
        Story => (
            <div style={{ 'padding-top': '90px' }}>
                <Story />
            </div>
        ),
    ],
    render: () => {
        const session = makeStubChatSession(COMMANDS)
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
        // Names starting with "c" first, in list order, then a name that only contains it. Each
        // label carries its argument hint; the description sits in the next column.
        expect(labels(canvasElement)).toEqual([
            '/compact <optional custom summarization instructions>',
            '/clear',
            '/chrome',
            '/code-review [low|medium|high|xhigh|max] [target]',
        ])
        const details = Array.from(
            canvasElement.querySelectorAll<HTMLElement>(
                `.${styles['slash-popover']} .bismuth-popover-detail`,
            ),
        )
        expect(details[1].textContent).toBe(
            'Clear conversation history and free up context',
        )
        // Every description starts on one line down the list.
        expect(
            new Set(details.map(d => Math.round(d.getBoundingClientRect().left)))
                .size,
        ).toBe(1)
        // CodeMirror's own block-insert `/` menu (To-do/Quote/Callout/…) must NOT also open —
        // it raced the chat's own popover on the same keystroke and clipped (storyAudit clip-x on
        // `.cm-tooltip-autocomplete`, 384px content in a 258px box). `slashMenu: false` on the
        // composer's `vaultCompletion` call is what suppresses it now.
        expect(
            canvasElement.ownerDocument.querySelector('.cm-tooltip-autocomplete'),
        ).toBeNull()
    },
}

/** A skill namespaced by its plugin is found by its own name: typing `/brain` offers
 *  `/superpowers:brainstorming`, the way Claude Code's own list does. */
export const SlashMatchesSkillName: Story = {
    decorators: SlashPopover.decorators,
    render: SlashPopover.render,
    play: async ({ canvasElement }) => {
        await userEvent.click(cmContent(canvasElement))
        await userEvent.keyboard('/brain')
        await waitFor(() =>
            expect(labels(canvasElement)).toEqual([
                '/superpowers:brainstorming',
            ]),
        )
    },
}

/** Picking a command fills `/bust ` and greys its argument hint after the caret; typing the
 *  argument removes the hint, and deleting back to the bare command brings it back. The hint is
 *  never part of the draft. */
export const SlashArgumentHint: Story = (() => {
    let session: StubChatSession
    return {
        decorators: SlashPopover.decorators,
        render: () => {
            session = makeStubChatSession(COMMANDS)
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
            const hint = () =>
                canvasElement.querySelector<HTMLElement>('[data-arg-hint]')
            await userEvent.click(content)
            await userEvent.keyboard('/bu')
            await waitFor(() =>
                expect(labels(canvasElement)).toEqual([
                    '/bust [deep] [K] <goal>',
                ]),
            )
            await userEvent.keyboard('{Enter}')
            await waitFor(() => expect(session.draft()).toBe('/bust '))
            await waitFor(() =>
                expect(hint()?.textContent).toBe('[deep] [K] <goal>'),
            )
            await userEvent.keyboard('deep')
            await waitFor(() => expect(session.draft()).toBe('/bust deep'))
            expect(hint()).toBeNull()
            await userEvent.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}')
            await waitFor(() => expect(hint()).not.toBeNull())
        },
    }
})()

/** Ghost text is not the message, so it never adds a row. `/code-review ` carries a hint far wider
 *  than this column: the box stays the height it had empty, the hint ends in an ellipsis, and only
 *  real typed text wraps and grows the box. */
export const ArgumentHintInANarrowPane: Story = (() => {
    let session: StubChatSession
    return {
        render: () => {
            session = makeStubChatSession(COMMANDS)
            return (
                <div style={{ width: '240px', 'padding-top': '300px' }}>
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
            const box = content.closest<HTMLElement>(`.${styles.box}`)!
            const height = () => box.getBoundingClientRect().height
            const empty = height()
            await userEvent.click(content)
            await userEvent.keyboard('/code-review ')
            await waitFor(() => expect(session.draft()).toBe('/code-review '))
            const hint = await waitFor(() => {
                const el =
                    canvasElement.querySelector<HTMLElement>('[data-arg-hint]')
                expect(el).not.toBeNull()
                return el!
            })
            await expect(height()).toBe(empty)
            await expect(hint.scrollWidth).toBeGreaterThan(hint.clientWidth)
            const scroller =
                canvasElement.querySelector<HTMLElement>('.cm-scroller')!
            await expect(scroller.scrollWidth).toBe(scroller.clientWidth)
            await userEvent.keyboard(
                'a long argument that really does need a second row in this column',
            )
            await waitFor(() => expect(height()).toBeGreaterThan(empty))
            session.setDraft('/code-review ')
            await waitFor(() => expect(height()).toBe(empty))
            content.blur()
        },
    }
})()

/** The placeholder holds one row in a pane too narrow for it, ending in an ellipsis. */
export const PlaceholderInANarrowPane: Story = {
    render: () => (
        <div style={{ width: '120px' }}>
            <ChatComposerBar
                session={makeStubChatSession()}
                placeholder="Message a very long persona name"
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const placeholder = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>('.cm-placeholder')
            expect(el).not.toBeNull()
            return el!
        })
        const row = parseFloat(getComputedStyle(placeholder).lineHeight)
        await expect(placeholder.getBoundingClientRect().height).toBe(row)
        await expect(placeholder.scrollWidth).toBeGreaterThan(
            placeholder.clientWidth,
        )
        const scroller = canvasElement.querySelector<HTMLElement>('.cm-scroller')!
        await expect(scroller.scrollWidth).toBe(scroller.clientWidth)
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
        const session = makeStubChatSession(COMMANDS)
        return (
            <div
                style={{ width: '320px', 'padding-top': '300px' }}
                data-testid="narrow-col"
            >
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
        expect(rows.length).toBe(4)
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
/** Send and Stop each name the composer key that does the same thing; the TooltipHost renders the
 *  live combo as Kbd from this attribute. */
export const ButtonsCarryKeys: Story = {
    render: () => (
        <ChatComposerBar
            session={makeStubChatSession({ draft: 'hello' })}
            placeholder="Message Claude"
            noteNames={noNames}
            memoryNames={noNames}
            tagNames={noNames}
        />
    ),
    play: async ({ canvasElement }) => {
        const send = await waitFor(() => {
            const el = canvasElement.querySelector('[aria-label="Send message"]')
            if (!el) throw new Error('no send')
            return el
        })
        await expect(send.getAttribute('data-tooltip-keybinding')).toBe('chat-send')
        await expect(send.getAttribute('data-tooltip')).toBe('Send message')
    },
}

export const StopCarriesKey: Story = {
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
        const stop = await waitFor(() => {
            const el = canvasElement.querySelector('[aria-label="Stop generating"]')
            if (!el) throw new Error('no stop')
            return el
        })
        await expect(stop.getAttribute('data-tooltip-keybinding')).toBe('chat-stop')
    },
}

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
            // The Send button names the catalog id, so its hint follows the rebind below by
            // construction (the host resolves the id live).
            await expect(
                canvasElement
                    .querySelector('[aria-label="Send message"]')!
                    .getAttribute('data-tooltip-keybinding'),
            ).toBe('chat-send')
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
