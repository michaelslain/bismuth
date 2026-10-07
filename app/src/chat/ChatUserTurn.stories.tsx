// Visual spec for <ChatUserTurn> — one user turn: the "you" label (+ a queued note/cancel while
// staged), the prose bubble, and any sent images. Reuses the same fixtures
// ChatTranscript.stories.tsx composes from — one user turn, isolated.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import ChatUserTurn from './ChatUserTurn'
import type { UserItem } from './chatTranscriptLogic'
import { IMAGE_TURN_ITEMS, QUEUED_ITEMS } from './_transcriptFixtures'

const meta = {
    title: 'Chat/ChatUserTurn',
    component: ChatUserTurn,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatUserTurn>

export default meta
type Story = StoryObj<typeof meta>

const noop = { onCancelQueued: fn(), onBubbleContextMenu: fn() }

const plainItem: UserItem = { role: 'user', text: 'Summarize the vault.' }
// QUEUED_ITEMS[2] is the staged (queued) user turn; [0]/[1] are an already-sent pair ahead of it.
const queuedItem = QUEUED_ITEMS[2] as UserItem
const imageItem = IMAGE_TURN_ITEMS[0] as UserItem

/** A plain sent message — the "you" label + prose bubble. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatUserTurn item={plainItem} {...noop} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('you')).toBeInTheDocument()
        await expect(canvas.getByText('Summarize the vault.')).toBeInTheDocument()
    },
}

/** A staged (not yet sent) message — settled in muted INK, never faded (no state by opacity), with a "queued" note and a cancel button that fires
 *  `onCancelQueued` with the turn's queue id. */
export const Queued: Story = {
    render: args => (
        <div style={{ width: '600px' }}>
            <ChatUserTurn
                item={queuedItem}
                onCancelQueued={args.onCancelQueued}
                onBubbleContextMenu={noop.onBubbleContextMenu}
            />
        </div>
    ),
    args: { onCancelQueued: fn() },
    play: async ({ canvasElement, args }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('queued')).toBeInTheDocument()
        // QUEUED IS INK, NOT OPACITY: the bubble and every ancestor up to the canvas paint at full
        // opacity (it used to fade to .55), and its text reads in --text-muted.
        const text = canvas.getByText('Also check the daemon logs for errors.')
        for (let el: Element | null = text; el && el !== canvasElement.parentElement; el = el.parentElement)
            await expect(getComputedStyle(el).opacity).toBe('1')
        const probe = document.createElement('span')
        probe.style.color = 'var(--text-muted)'
        canvasElement.appendChild(probe)
        const muted = getComputedStyle(probe).color
        probe.remove()
        await expect(getComputedStyle(text).color).toBe(muted)
        await userEvent.click(
            canvas.getByRole('button', { name: 'Cancel queued message' }),
        )
        await expect(args.onCancelQueued).toHaveBeenCalledWith('q-abc')
    },
}

/** A turn that arrives with sent images attached, no text. */
export const Images: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatUserTurn item={imageItem} {...noop} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByAltText('attachment')).toBeInTheDocument()
    },
}
