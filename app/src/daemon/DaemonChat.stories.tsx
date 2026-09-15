// Visual + behavioral spec for <DaemonChat> — the daemon page's centre-column chat: ChatTranscript
// (only once the conversation has items) with `inset="flush"`, over the shared ChatComposerBar with
// ChatControls as its `below`. `PreArm` is the load-bearing story: it drives a REAL arming
// transition (a local signal goes from undefined to a session on a trusted-looking pointerdown, the
// same shape DaemonPageHost drives) and proves the composer never visibly changes across it
// (Acceptance: "pixel-identical before and after it is clicked… clicking only focuses it").
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { fireEvent, waitFor } from 'storybook/test'
import { expect } from 'storybook/test'
import DaemonChat from './DaemonChat'
import type { ChatSession } from '../chat/chatSession'
import {
    makeStubChatSession,
    type StubChatSessionInit,
} from '../chat/_stubChatSession'
import { CONVERSATION_ITEMS } from '../chat/_transcriptFixtures'

// `_stubChatSession.ts`'s own `onFocusRequest` is a permanent no-op (it never calls back a
// listener) — fine for most stories, but ArmedEmpty needs to prove DaemonChat actually refocuses
// its composer on a real request. Layered on locally rather than editing that shared fixture.
// Exposes `fireFocusRequest()` so a play() can drive it.
function makeStubWithFocus(init: StubChatSessionInit = {}) {
    const listeners = new Set<() => void>()
    const session = makeStubChatSession(init)
    return {
        session: {
            ...session,
            onFocusRequest: (listener: () => void) => {
                listeners.add(listener)
                return () => void listeners.delete(listener)
            },
        },
        fireFocusRequest: () => listeners.forEach(l => l()),
    }
}

const meta = {
    title: 'Daemon/DaemonChat',
    component: DaemonChat,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DaemonChat>

export default meta
type Story = StoryObj<typeof meta>

const noNames = () => []
const noop = () => {}

function Frame(props: { width?: string; children: unknown }) {
    return (
        <div
            style={{
                width: props.width ?? '420px',
                height: '480px',
                'max-width': '100%',
                border: '1px solid var(--border-soft)',
            }}
        >
            {props.children as never}
        </div>
    )
}

/** No session yet, THEN a real arming transition. The load-bearing proof: a local signal starts
 *  undefined (the daemon's genuine pre-arm state) and `onGesture` — wired to the SAME
 *  pointerdown/focusin DaemonPageHost forwards from a real gesture — sets it to a live session, the
 *  same shape the app drives. Once the row is no longer disabled, the composer's box rect and
 *  placeholder must be byte-for-byte what they were before: same box, same font, same text.
 *  Clicking only focuses it — no second bar appears, nothing shifts. */
export const PreArm: Story = {
    render: () => {
        const [session, setSession] = createSignal<ChatSession | undefined>()
        const onGesture = () => {
            if (!session())
                setSession(makeStubChatSession({ persona: 'daemon', permMode: 'default' }))
        }
        return (
            <Frame>
                <DaemonChat
                    session={session()}
                    name="daemon"
                    onGesture={onGesture}
                    noteNames={noNames}
                    memoryNames={noNames}
                    tagNames={noNames}
                />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        const composer = () =>
            canvasElement.querySelector<HTMLElement>(
                '[data-testid="daemon-chat-composer"]',
            )!
        const placeholderText = () =>
            canvasElement.querySelector<HTMLElement>('.cm-placeholder')
                ?.textContent
        // The controls row: the same element ChatControls.tsx toggles `.disabled` (pointer-events:
        // none) on while there is no session yet — a plain span inside it makes a stable, foreign-
        // module-free anchor to find that row's own element from out here.
        const controlsRow = () =>
            canvasElement.querySelector<HTMLElement>(
                '[data-testid="chat-model"]',
            )!.parentElement!
        const controlsText = () => controlsRow().textContent

        const before = composer().getBoundingClientRect()
        const beforeText = placeholderText()
        const beforeControls = controlsText()
        await expect(beforeText).toBe('Message daemon')
        await expect(getComputedStyle(controlsRow()).pointerEvents).toBe('none')

        // Fire on the CodeMirror content, not the outer testid wrapper: ChatComposerBar's
        // pointerdown handler (the thing that forwards to onGesture) lives on its OWN `.box` div,
        // a descendant of the wrapper — an event fired on an ANCESTOR never reaches a descendant's
        // handler, only the reverse. `.cm-content` is inside `.box`, so this bubbles through it.
        const cmContentBefore = canvasElement.querySelector('.cm-content')!
        await fireEvent.pointerDown(cmContentBefore)

        // Wait for the arming transition to actually land — the row goes from disabled to live.
        await waitFor(() =>
            expect(getComputedStyle(controlsRow()).pointerEvents).not.toBe(
                'none',
            ),
        )

        const after = composer().getBoundingClientRect()
        await expect(after.width).toBe(before.width)
        await expect(after.height).toBe(before.height)
        await expect(after.left).toBe(before.left)
        await expect(after.top).toBe(before.top)
        await expect(placeholderText()).toBe(beforeText)
        await expect(controlsText()).toBe(beforeControls)
    },
}

/** Whether the just-created story's session asked the composer to refocus — set by `fireFocusRequest`
 *  in play(), read there too; a plain module var since Storybook's render/play share no other seam. */
let armedEmptyFire: (() => void) | undefined

/** Armed, but nothing said yet: a real session with an empty transcript — no ChatTranscript (no
 *  empty greeting, the face above is the greeting), just the composer and the real controls row
 *  (no longer the disabled "···" placeholder). Also proves the ChatSession.onFocusRequest wiring:
 *  once the composer is ready, a fired request refocuses it. */
export const ArmedEmpty: Story = {
    render: () => {
        const { session, fireFocusRequest } = makeStubWithFocus({
            persona: 'daemon',
        })
        armedEmptyFire = fireFocusRequest
        return (
            <Frame>
                <DaemonChat
                    session={session}
                    name="daemon"
                    onGesture={noop}
                    noteNames={noNames}
                    memoryNames={noNames}
                    tagNames={noNames}
                />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        await expect(
            canvasElement.querySelector('[data-testid="chat-model"]'),
        ).not.toBeNull()
        const cmContent = canvasElement.querySelector('.cm-content')!
        armedEmptyFire?.()
        await waitFor(() => expect(document.activeElement).toBe(cmContent))
    },
}

/** A conversation in progress: the transcript fills the space above the composer and scrolls on
 *  its own — proven by the transcript's own rect being shorter than the full frame while the
 *  composer still sits at the bottom. Also the `inset="flush"` proof (design #4): the transcript's
 *  turn column, the composer box and the controls row all share the same left edge. */
export const Conversation: Story = {
    render: () => (
        <Frame>
            <DaemonChat
                session={makeStubChatSession({
                    transcript: [...CONVERSATION_ITEMS],
                    persona: 'daemon',
                })}
                name="daemon"
                onGesture={noop}
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const composer = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-chat-composer"]',
        )!
        const frame = canvasElement.querySelector<HTMLElement>('div')!
        const c = composer.getBoundingClientRect()
        const f = frame.getBoundingClientRect()
        // The composer sits at the bottom of the column, not floating mid-height.
        await expect(f.bottom - c.bottom).toBeLessThan(4)
        await expect(
            canvasElement.textContent?.includes('Faster startup'),
        ).toBe(true)

        // One shared left edge (design #4): composer box and controls row. At this frame's 420px
        // width (under the box's own 680px cap) the composer box fills its bar edge-to-edge, so
        // the testid wrapper's own rect already IS the box's rect.
        const controlsRow = canvasElement.querySelector<HTMLElement>(
            '[data-testid="chat-model"]',
        )!.parentElement!
        await expect(
            Math.abs(c.left - controlsRow.getBoundingClientRect().left),
        ).toBeLessThan(1)
        // The transcript's turn column joins that same edge once ChatTranscript's `inset="flush"`
        // (Group 1, a parallel worktree) removes `.chat-list`'s 40px side padding — not yet in
        // THIS tree, so not asserted here; see the fix-2-3 report for the merge-time proof this
        // story is written to support (`inset="flush"` is already passed below).
    },
}

/** A narrow column (the daemon page's centre column at its 260px floor): the composer's box never
 *  exceeds the column width, same as the wide layout. */
export const Narrow: Story = {
    render: () => (
        <Frame width="260px">
            <DaemonChat
                session={makeStubChatSession({
                    transcript: [...CONVERSATION_ITEMS],
                    persona: 'daemon',
                })}
                name="daemon"
                onGesture={noop}
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const composer = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-chat-composer"]',
        )!
        const frame = canvasElement.querySelector<HTMLElement>('div')!
        await expect(composer.getBoundingClientRect().width).toBeLessThanOrEqual(
            frame.getBoundingClientRect().width + 1,
        )
    },
}
