// Visual spec for <ChatTranscript> — the scrollable message list. Covers the shapes Acceptance
// calls out (lowercase turn labels, tool-row layout, bold-not-larger prose, no dead empty band)
// plus the transient rows (awaiting reply, turn error) and narrow layout. `play()` stories prove
// the callback wiring the interface promises: cancel-queued, a permission answer, and the bubble
// context menu's Reply.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, fn, userEvent, within } from 'storybook/test'
import ChatTranscript from './ChatTranscript'
import EmptyState from '../ui/EmptyState'
import {
    COMMAND_OUTPUT_ITEMS,
    CONVERSATION_ITEMS,
    INLINE_PROMPT_ITEMS,
    QUEUED_ITEMS,
    TOOL_CALL_ITEMS,
} from './_transcriptFixtures'

const meta = {
    title: 'Chat/ChatTranscript',
    component: ChatTranscript,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ChatTranscript>

export default meta
type Story = StoryObj<typeof meta>

const noop = {
    onAnswerPermission: fn(),
    onAnswerQuestion: fn(),
    onCancelQueued: fn(),
    onReply: fn(),
}

/** A prose conversation, including a bulleted list with a bold run. */
export const Conversation: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={CONVERSATION_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // Right-click the assistant's prose bubble → Reply, and confirm onReply fires with its text.
        const bubble = canvas.getByText(/A few things landed/)
        await fireEvent.contextMenu(bubble)
        const replyRow = await canvas.findByText('Reply')
        await userEvent.click(replyRow)
        await expect(noop.onReply).toHaveBeenCalled()
    },
}

/** Tool calls in every state: settled ok, settled error, still pending. */
export const ToolCalls: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={TOOL_CALL_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
}

/** An unanswered permission, an already-answered one, and an AskUserQuestion card. */
export const InlinePrompts: Story = {
    render: args => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={INLINE_PROMPT_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                onAnswerPermission={args.onAnswerPermission}
                onAnswerQuestion={noop.onAnswerQuestion}
                onCancelQueued={noop.onCancelQueued}
                onReply={noop.onReply}
            />
        </div>
    ),
    args: { onAnswerPermission: fn() },
    play: async ({ canvasElement, args }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getAllByRole('button', { name: 'ALLOW' })[0])
        await expect(args.onAnswerPermission).toHaveBeenCalledWith(
            'perm-1',
            'allow',
            false,
        )
    },
}

/** A slash-command result — boxed monospace panel, not loose prose. */
export const CommandOutput: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={COMMAND_OUTPUT_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
}

/** No items — the caller's `empty` JSX centred, no dead band below it. */
export const Empty: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={[]}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                empty={<EmptyState>Ask bismuth anything.</EmptyState>}
                {...noop}
            />
        </div>
    ),
}

/** Pre-first-delta — the "working" indicator under the persona's label. */
export const AwaitingReply: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={[{ role: 'user', text: 'Summarize the vault.' }]}
                persona="bismuth"
                awaitingReply
                turnError={null}
                {...noop}
            />
        </div>
    ),
}

/** A recoverable per-turn error, shown after the last turn. */
export const TurnError: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={CONVERSATION_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError="Lost connection to the daemon — retrying…"
                {...noop}
            />
        </div>
    ),
}

/** A queued (staged) user turn, dimmed, with a cancel button. */
export const Queued: Story = {
    render: args => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={QUEUED_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                onAnswerPermission={noop.onAnswerPermission}
                onAnswerQuestion={noop.onAnswerQuestion}
                onCancelQueued={args.onCancelQueued}
                onReply={noop.onReply}
            />
        </div>
    ),
    args: { onCancelQueued: fn() },
    play: async ({ canvasElement, args }) => {
        const canvas = within(canvasElement)
        await userEvent.click(
            canvas.getByRole('button', { name: 'Cancel queued message' }),
        )
        await expect(args.onCancelQueued).toHaveBeenCalledWith('q-abc')
    },
}

/** A narrow (360px) viewport — proves the reading column still reads at phone width. */
export const Narrow360: Story = {
    render: () => (
        <div style={{ width: '360px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={CONVERSATION_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
}
