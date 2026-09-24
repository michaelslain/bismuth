// app/src/daemon/DaemonIdentity.stories.tsx
// The name + hidden personality card in isolation: resting shows only the name, hovering/focusing
// it reveals the blurb + [ edit ].
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import DaemonIdentity from './DaemonIdentity'

const meta = {
    title: 'Daemon/DaemonIdentity',
    component: DaemonIdentity,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof DaemonIdentity>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

function cardOf(canvasElement: HTMLElement): HTMLElement {
    return canvasElement.querySelector<HTMLElement>(
        '[data-testid="daemon-identity-card"]',
    )!
}

export const Resting: Story = {
    render: () => (
        <DaemonIdentity
            name="daemon"
            blurb="keeps a living model of the vault + reviews it every few hours"
            onEdit={noop}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('daemon')).toBeInTheDocument()
        const card = cardOf(canvasElement)
        // Hidden at rest — the whole point of the redesign: no blurb, no [ edit ] in view.
        await expect(getComputedStyle(card).visibility).toBe('hidden')
        await expect(getComputedStyle(card).opacity).toBe('0')
    },
}

export const FocusedReveal: Story = {
    render: () => (
        <DaemonIdentity
            name="daemon"
            blurb="keeps a living model of the vault + reviews it every few hours"
            onEdit={noop}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const name = canvas.getByRole('button', { name: 'daemon' })
        name.focus()
        const card = cardOf(canvasElement)
        await expect(getComputedStyle(card).visibility).toBe('visible')
        await expect(getComputedStyle(card).opacity).toBe('1')
        await expect(
            canvas.getByText(/keeps a living model/),
        ).toBeInTheDocument()
        await expect(
            canvas.getByRole('button', { name: 'edit' }),
        ).toBeInTheDocument()
    },
}

export const NoBlurb: Story = {
    render: () => <DaemonIdentity name="daemon" blurb="" onEdit={noop} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const name = canvas.getByRole('button', { name: 'daemon' })
        name.focus()
        const card = cardOf(canvasElement)
        await expect(getComputedStyle(card).visibility).toBe('visible')
        // Empty blurb: the card still holds [ edit ], nothing else.
        await expect(
            canvas.getByRole('button', { name: 'edit' }),
        ).toBeInTheDocument()
        await expect(
            canvasElement.querySelector('[data-testid="daemon-identity-blurb"]'),
        ).toBeNull()
    },
}

/** A blurb longer than the card's 40ch cap wraps instead of overflowing. */
export const LongBlurb: Story = {
    render: () => (
        <DaemonIdentity
            name="daemon"
            blurb="a persistent personal-assistant daemon for this vault, consolidating memory hourly and reviewing the whole tree every four hours to keep a living model of the person who owns it"
            onEdit={noop}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const name = canvas.getByRole('button', { name: 'daemon' })
        name.focus()
        const blurb = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-identity-blurb"]',
        )!
        // Wraps across multiple lines rather than clipping to one — scrollHeight exceeds a
        // single line's height once it has wrapped.
        const lineHeight = parseFloat(getComputedStyle(blurb).lineHeight)
        await expect(blurb.scrollHeight).toBeGreaterThan(lineHeight * 1.5)
    },
}
