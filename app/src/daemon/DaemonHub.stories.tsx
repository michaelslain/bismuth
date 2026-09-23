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

function Frame(props: { children: JSX.Element }) {
    return (
        <div style={{ width: '420px', height: '640px', 'max-width': '100%' }}>
            {props.children}
        </div>
    )
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
        <Frame>
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
        await expect(
            canvas.getByText(/keeps a living model/),
        ).toBeInTheDocument()
        await expect(canvas.getByText('[ edit ]')).toBeInTheDocument()
        const face = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face"]',
        )!
        await expect(
            parseFloat(getComputedStyle(face).fontSize),
        ).toBeGreaterThan(40)
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
        await expect(canvas.queryByText('[ edit ]')).toBeNull()
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
    },
}

export const NoBlurb: Story = {
    render: () => (
        <Frame>
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
        await expect(canvas.getByText('[ edit ]')).toBeInTheDocument()
    },
}

/** A blurb longer than the column ellipsizes to one line instead of wrapping or overflowing. */
export const LongBlurb: Story = {
    render: () => (
        <Frame>
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
        const blurb = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face-caption"] span',
        )
        await expect(blurb).not.toBeNull()
        const overflowing =
            blurb!.scrollWidth > blurb!.clientWidth ||
            getComputedStyle(blurb!).textOverflow === 'ellipsis'
        await expect(overflowing).toBe(true)
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
        await expect(
            canvas.getByRole('heading', { level: 2 }),
        ).toHaveTextContent(/wake it up/i)
        await expect(canvas.queryByText('[ edit ]')).toBeNull()
        await expect(
            canvasElement.querySelector('[data-testid="chat-stub"]'),
        ).toBeNull()
    },
}
