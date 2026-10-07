// app/src/daemon/DaemonHub.stories.tsx
// Visual spec for <DaemonHub> — the daemon page's left box in isolation: header (identity +
// mood word), the face, and its own chat slot. The composer LOOK itself is
// DaemonChat.stories.tsx's concern; the chat slot here is the real DaemonChat over a stub session,
// and this file only proves the column's own layout — resting vs conversing, blurb present/absent/long, off.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import type { JSX } from 'solid-js'
import DaemonHub from './DaemonHub'
import DaemonChat from './DaemonChat'
import { makeStubChatSession } from '../chat/_stubChatSession'
import { CONVERSATION_ITEMS } from '../chat/_transcriptFixtures'

const meta = {
    title: 'Daemon/DaemonHub',
    component: DaemonHub,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DaemonHub>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

function Frame(props: { children: JSX.Element; tall?: boolean }) {
    return (
        <div
            data-testid="story-frame"
            style={{
                width: '420px',
                height: props.tall ? '900px' : '640px',
                'max-width': '100%',
            }}
        >
            {props.children}
        </div>
    )
}

/** Resting box: the composer sits on the box's bottom edge, the face is centred in the space
 *  between the header row and the chat, and the header carries the faint mood word. Shared by
 *  every story that rests (Resting, LongBlurb, NoBlurb, IdentityFocused). */
async function expectRestingBox(canvasElement: HTMLElement) {
    const hub = canvasElement.querySelector<HTMLElement>(
        '[data-testid="daemon-page-hub"]',
    )!
    const hubRect = hub.getBoundingClientRect()
    const hs = getComputedStyle(hub)
    const inset =
        parseFloat(hs.paddingBottom) + parseFloat(hs.borderBottomWidth)
    const chat = canvasElement.querySelector<HTMLElement>(
        '[data-testid="daemon-page-chat"]',
    )!
    await expect(
        Math.abs(hubRect.bottom - inset - chat.getBoundingClientRect().bottom),
    ).toBeLessThanOrEqual(2)
    const faceRegion = canvasElement.querySelector<HTMLElement>(
        '[data-testid="daemon-face-region"]',
    )!
    const face = canvasElement.querySelector<HTMLElement>(
        '[data-testid="daemon-face"]',
    )!
    const fr = faceRegion.getBoundingClientRect()
    const f = face.getBoundingClientRect()
    await expect(
        Math.abs(fr.left + fr.width / 2 - (f.left + f.width / 2)),
    ).toBeLessThanOrEqual(2)
    await expect(
        Math.abs(fr.top + fr.height / 2 - (f.top + f.height / 2)),
    ).toBeLessThanOrEqual(2)
    await expect(
        canvasElement.querySelector('[data-testid="daemon-face-caption"]'),
    ).toBeNull()
    await expect(within(canvasElement).getByText('resting')).toBeInTheDocument()
}

/** The hub's chat slot: the REAL `DaemonChat` (composer bar, controls row and, once there are
 *  messages, the real `ChatTranscript`) over a stub session — so the conversing frame holds a
 *  genuine transcript above a genuine composer rather than a blank bordered box. `tall` seeds a
 *  short conversation. */
function ChatStub(props: { tall?: boolean }) {
    return (
        <DaemonChat
            session={makeStubChatSession({
                transcript: props.tall ? [...CONVERSATION_ITEMS] : [],
                persona: 'daemon',
            })}
            name="daemon"
            onGesture={noop}
            noteNames={() => []}
            memoryNames={() => []}
            tagNames={() => []}
        />
    )
}

export const Resting: Story = {
    render: () => (
        <Frame tall>
            <DaemonHub
                name="daemon"
                blurb="keeps a living model of the vault + reviews it every few hours"
                mood="idle"
                enabled
                conversing={false}
                chatFills={false}
                chat={<ChatStub />}
                onEditIdentity={noop}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('daemon')).toBeInTheDocument()
        // At rest the box shows the face + name header — the blurb + [ edit ] live in a card
        // hidden until the name is hovered/focused (see DaemonIdentity.stories.tsx for that
        // reveal in isolation).
        const card = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-identity-card"]',
        )!
        await expect(getComputedStyle(card).visibility).toBe('hidden')
        await expect(getComputedStyle(card).opacity).toBe('0')
        const face = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face"]',
        )!
        // Resting = the full face, never the one-line compact header (whose glyph caps at 26px).
        await expect(
            parseFloat(getComputedStyle(face).fontSize),
        ).toBeGreaterThan(26)
        await expectRestingBox(canvasElement)
    },
}

/** Focusing the name reveals the card holding the blurb + [ edit ] — nothing else in the column
 *  moves, since the card is absolutely positioned over whatever sits below it. */
export const IdentityFocused: Story = {
    render: () => (
        <Frame tall>
            <DaemonHub
                name="daemon"
                blurb="keeps a living model of the vault + reviews it every few hours"
                mood="idle"
                enabled
                conversing={false}
                chatFills={false}
                chat={<ChatStub />}
                onEditIdentity={noop}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const name = canvas.getByRole('button', { name: 'daemon' })
        name.focus()
        const card = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-identity-card"]',
        )!
        await expect(getComputedStyle(card).visibility).toBe('visible')
        await expect(getComputedStyle(card).opacity).toBe('1')
        await expect(
            canvas.getByText(/keeps a living model/),
        ).toBeInTheDocument()
        await expect(
            canvas.getByRole('button', { name: 'edit' }),
        ).toBeInTheDocument()
        await expectRestingBox(canvasElement)
    },
}

/** Conversing: the face region is gone — the face lives in the transcript then, as the avatar on
 *  its lowest assistant row — and the chat fills the box under the header, composer on its
 *  bottom edge. The header (name + mood word) stays. */
export const Conversing: Story = {
    render: () => (
        <Frame>
            <DaemonHub
                name="daemon"
                blurb="keeps a living model of the vault"
                mood="talking"
                enabled
                conversing
                chatFills
                chat={<ChatStub tall />}
                onEditIdentity={noop}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        // No hero face, no blurb, no [ edit ] until hovered — the transcript carries the face.
        await expect(
            canvasElement.querySelector('[data-testid="daemon-face-region"]'),
        ).toBeNull()
        // The face that remains is the transcript's avatar, inside the chat — never the hero.
        const avatar = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face"]',
        )
        await expect(
            canvasElement
                .querySelector('[data-testid="daemon-page-chat"]')!
                .contains(avatar),
        ).toBe(true)
        await expect(parseFloat(getComputedStyle(avatar!).fontSize)).toBeLessThan(26)
        const canvas = within(canvasElement)
        await expect(canvas.getByRole('button', { name: 'daemon' })).toBeInTheDocument()
        await expect(canvas.getByText('talking')).toBeInTheDocument()
        await expect(canvas.queryByRole('button', { name: 'edit' })).toBeNull()
        // The chat is the real thing, not a bordered box: a transcript turn above the composer.
        await expect(
            canvas.getByText('What changed in the last release?'),
        ).toBeInTheDocument()
        await expect(
            canvasElement.querySelector('[data-testid="daemon-chat-composer"]'),
        ).not.toBeNull()
        const hub = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-page-hub"]',
        )!
        const chat = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-page-chat"]',
        )!
        await expect(
            chat.getBoundingClientRect().height /
                hub.getBoundingClientRect().height,
        ).toBeGreaterThan(0.5)
        // The composer sits on the box's bottom edge, same as resting.
        const hs = getComputedStyle(hub)
        await expect(
            Math.abs(
                hub.getBoundingClientRect().bottom -
                    parseFloat(hs.paddingBottom) -
                    parseFloat(hs.borderBottomWidth) -
                    chat.getBoundingClientRect().bottom,
            ),
        ).toBeLessThanOrEqual(2)
    },
}

export const NoBlurb: Story = {
    render: () => (
        <Frame tall>
            <DaemonHub
                name="daemon"
                blurb=""
                mood="idle"
                enabled
                conversing={false}
                chatFills={false}
                chat={<ChatStub />}
                onEditIdentity={noop}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('daemon')).toBeInTheDocument()
        // [ edit ] is not in the accessibility tree at rest — it lives inside the hidden card.
        await expect(canvas.queryByRole('button', { name: 'edit' })).toBeNull()
        // Focusing the name still reveals the card, holding just [ edit ] (empty blurb).
        canvas.getByRole('button', { name: 'daemon' }).focus()
        await expect(
            canvas.getByRole('button', { name: 'edit' }),
        ).toBeInTheDocument()
        await expect(
            canvasElement.querySelector(
                '[data-testid="daemon-identity-blurb"]',
            ),
        ).toBeNull()
        await expectRestingBox(canvasElement)
    },
}

/** A blurb longer than the card's 40ch cap wraps across lines instead of overflowing. */
export const LongBlurb: Story = {
    render: () => (
        <Frame tall>
            <DaemonHub
                name="daemon"
                blurb="a persistent personal-assistant daemon for this vault, consolidating memory hourly and reviewing the whole tree every four hours to keep a living model of the person who owns it"
                mood="idle"
                enabled
                conversing={false}
                chatFills={false}
                chat={<ChatStub />}
                onEditIdentity={noop}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        canvas.getByRole('button', { name: 'daemon' }).focus()
        const blurb = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-identity-blurb"]',
        )
        await expect(blurb).not.toBeNull()
        const lineHeight = parseFloat(getComputedStyle(blurb!).lineHeight)
        await expect(blurb!.scrollHeight).toBeGreaterThan(lineHeight * 1.5)
        await expectRestingBox(canvasElement)
    },
}

export const Off: Story = {
    render: () => (
        <Frame>
            <DaemonHub
                name="daemon"
                blurb=""
                mood="asleep"
                enabled={false}
                conversing={false}
                chatFills={false}
                chat={<ChatStub />}
                onEditIdentity={noop}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // No title any more — the off line stands alone, lowercase, no trailing period.
        await expect(canvas.queryByRole('heading', { level: 2 })).toBeNull()
        await expect(
            canvas.getByText(
                'set daemon.enabled: true in .settings to wake it',
            ),
        ).toBeInTheDocument()
        await expect(canvas.queryByRole('button', { name: 'edit' })).toBeNull()
        await expect(
            canvasElement.querySelector('[data-testid="daemon-chat-composer"]'),
        ).toBeNull()
    },
}
