// Visual spec for <ChatPermissionCard> — an inline allow/deny prompt. `AnswerAllow`'s play()
// clicks ALLOW and asserts the callback fires with the right args (the card itself stays
// controlled — a real session would flip `answered` and re-render as the outcome variant).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import ChatPermissionCard from './ChatPermissionCard'
import type { PermissionPart } from '../chatTranscript'

const meta = {
    title: 'Chat/ChatPermissionCard',
    component: ChatPermissionCard,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatPermissionCard>

export default meta
type Story = StoryObj<typeof meta>

const pendingPart: PermissionPart = {
    kind: 'permission',
    id: 'p1',
    toolName: 'Write',
    input: { file_path: 'notes/todo.md' },
    answered: null,
}

/** Awaiting an answer — allow / allow always / deny. */
export const Pending: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatPermissionCard part={pendingPart} onAnswer={fn()} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByRole('button', { name: 'ALLOW' }),
        ).toBeInTheDocument()
    },
}

/** Already allowed. */
export const Allowed: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatPermissionCard
                part={{
                    ...pendingPart,
                    answered: { behavior: 'allow', always: false },
                }}
                onAnswer={fn()}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Allowed')).toBeInTheDocument()
    },
}

/** Already denied. */
export const Denied: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatPermissionCard
                part={{
                    ...pendingPart,
                    answered: { behavior: 'deny', always: false },
                }}
                onAnswer={fn()}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Denied')).toBeInTheDocument()
    },
}

/** Orphaned by Stop — neither an allow nor a user denial. */
export const Cancelled: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatPermissionCard
                part={{ ...pendingPart, cancelled: true }}
                onAnswer={fn()}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Cancelled')).toBeInTheDocument()
    },
}

/** Clicking ALLOW calls onAnswer('allow', false). */
export const AnswerAllow: Story = {
    render: args => (
        <div style={{ width: '600px' }}>
            <ChatPermissionCard part={pendingPart} onAnswer={args.onAnswer} />
        </div>
    ),
    args: { onAnswer: fn() },
    play: async ({ canvasElement, args }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByRole('button', { name: 'ALLOW' }))
        await expect(args.onAnswer).toHaveBeenCalledWith('allow', false)
    },
}
