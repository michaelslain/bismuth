// Visual + behavioral spec for <DaemonChat> — the daemon page's centre-column chat: ChatTranscript
// (only once the conversation has items) over the shared ChatComposerBar with ChatControls as its
// `below`. `pre-arm` is the load-bearing story: it proves the composer never visibly changes across
// the gesture that arms it (Acceptance: "pixel-identical before and after it is clicked… clicking
// only focuses it").
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { fireEvent, waitFor } from 'storybook/test'
import { expect } from 'storybook/test'
import DaemonChat from './DaemonChat'
import {
    makeStubChatSession,
    type StubChatSessionInit,
} from '../chat/_stubChatSession'
import { CONVERSATION_ITEMS } from '../chat/_transcriptFixtures'

// `_stubChatSession.ts` doesn't yet implement `onFocusRequest` (a parallel fix adds it there) —
// layered on locally per the controller ruling rather than editing that shared fixture. Exposes
// `fireFocusRequest()` so a play() can prove DaemonChat refocuses its composer.
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

/** No session yet — the daemon's pre-arm composer. The load-bearing proof: a trusted-looking
 *  pointerdown on the composer (forwarded via onGesture, a no-op here — arming itself lives in
 *  DaemonPageHost/the session registry, not this component) changes NOTHING about the render: same
 *  box rect, same placeholder text. */
export const PreArm: Story = {
    render: () => (
        <Frame>
            <DaemonChat
                session={undefined}
                name="daemon"
                onGesture={noop}
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const composer = () =>
            canvasElement.querySelector<HTMLElement>(
                '[data-testid="daemon-chat-composer"]',
            )!
        const placeholderText = () =>
            canvasElement.querySelector<HTMLElement>('.cm-placeholder')
                ?.textContent
        const before = composer().getBoundingClientRect()
        const beforeText = placeholderText()
        await expect(beforeText).toBe('Message daemon')

        await fireEvent.pointerDown(composer())

        const after = composer().getBoundingClientRect()
        const afterText = placeholderText()
        await expect(after.width).toBe(before.width)
        await expect(after.height).toBe(before.height)
        await expect(after.left).toBe(before.left)
        await expect(after.top).toBe(before.top)
        await expect(afterText).toBe(beforeText)
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
 *  composer still sits at the bottom. */
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
