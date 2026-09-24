// app/src/daemon/DaemonHub.stories.tsx
// Visual spec for <DaemonHub> — the daemon page's left column in isolation: the face, its
// identity (name / blurb / [ edit ]), and its own chat slot. The composer LOOK itself is
// DaemonPage.stories.tsx's `ChatStub` (the real ChatComposerBar) / `Host` story's concern; this
// file only proves the column's own layout — resting vs compact, blurb present/absent/long, off.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import type { JSX } from 'solid-js'
import DaemonHub from './DaemonHub'
import Text from '../ui/Text'

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

/** Resting cluster (Acceptance 12): the composer is well above the frame floor, and the gap from
 *  the identity name's own bottom to the chat region's top is `.faceRegion`'s `padding-block`
 *  bottom alone (`--sp-6`, ~16px) — `.chatRegion` carries no margin-top any more. Shared by every
 *  story that rests (Resting, LongBlurb, NoBlurb, IdentityFocused). */
async function expectRestingCluster(canvasElement: HTMLElement) {
    const frame = canvasElement.querySelector<HTMLElement>(
        '[data-testid="story-frame"]',
    )!
    const frameRect = frame.getBoundingClientRect()
    const chat = canvasElement.querySelector<HTMLElement>(
        '[data-testid="daemon-page-chat"]',
    )!
    const chatRect = chat.getBoundingClientRect()
    await expect(frameRect.bottom - chatRect.bottom).toBeGreaterThanOrEqual(
        frameRect.height * 0.25,
    )
    const name = within(canvasElement).getByRole('button', { name: 'daemon' })
    const nameRect = name.getBoundingClientRect()
    const faceRegion = canvasElement.querySelector<HTMLElement>(
        '[data-testid="daemon-face-region"]',
    )!
    const spSix = parseFloat(getComputedStyle(faceRegion).paddingBottom)
    await expect(chatRect.top - nameRect.bottom).toBeLessThanOrEqual(spSix + 4)
}

/** Stands in for the real composer (proven elsewhere, see the header note above) — just enough
 *  height to show the chat region actually gets space under the identity block. */
function ChatStub(props: { tall?: boolean }) {
    return (
        <div
            data-testid="chat-stub"
            style={{
                display: 'flex',
                'flex-direction': 'column',
                height: props.tall ? '100%' : 'auto',
                'min-height': '0',
                border: 'var(--rule)',
                'border-radius': 'var(--r-0)',
                padding: 'var(--sp-4)',
            }}
        >
            <Text size="ui" tone="muted">
                Message daemon…
            </Text>
        </div>
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
        // At rest the hub shows ONLY the face + name — the blurb + [ edit ] live in a card
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
        await expectRestingCluster(canvasElement)
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
        await expectRestingCluster(canvasElement)
    },
}

/** Conversing: the face collapses to a one-line header (small glyph + name, left-aligned) and
 *  the chat takes the rest of the column — blurb and [ edit ] drop out, there's no room next to
 *  a one-line header. */
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
        const face = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face"]',
        )!
        await expect(
            parseFloat(getComputedStyle(face).fontSize),
        ).toBeLessThan(30)
        const canvas = within(canvasElement)
        await expect(canvas.getByText('daemon')).toBeInTheDocument()
        // Compact: no blurb, no [ edit ] — nowhere for them to go next to a one-line header.
        await expect(canvas.queryByText(/keeps a living model/)).toBeNull()
        await expect(canvas.queryByRole('button', { name: 'edit' })).toBeNull()
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
        // Conversing keeps the composer on the floor — unlike the resting cluster, its bottom
        // stays flush with the frame bottom.
        const frame = canvasElement.querySelector<HTMLElement>(
            '[data-testid="story-frame"]',
        )!
        await expect(
            Math.abs(
                frame.getBoundingClientRect().bottom -
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
            canvasElement.querySelector('[data-testid="daemon-identity-blurb"]'),
        ).toBeNull()
        await expectRestingCluster(canvasElement)
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
        await expectRestingCluster(canvasElement)
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
            canvas.getByText('set daemon.enabled: true in .settings to wake it'),
        ).toBeInTheDocument()
        await expect(canvas.queryByRole('button', { name: 'edit' })).toBeNull()
        await expect(
            canvasElement.querySelector('[data-testid="chat-stub"]'),
        ).toBeNull()
    },
}
