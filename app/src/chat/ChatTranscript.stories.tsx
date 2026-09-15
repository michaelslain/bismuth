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
    IMAGE_TURN_ITEMS,
    INLINE_PROMPT_ITEMS,
    QUEUED_ITEMS,
    SYSTEM_NOTE_ITEMS,
    THINKING_ITEMS,
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

// CONVERSATION_ITEMS[1] is the assistant turn's sole text part — the exact string a bubble
// right-click "Reply" must quote.
const conversationAssistantText =
    CONVERSATION_ITEMS[1].role === 'assistant' &&
    CONVERSATION_ITEMS[1].parts[0].kind === 'text'
        ? CONVERSATION_ITEMS[1].parts[0].text
        : ''

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
        // Right-click the assistant's prose bubble → Reply, and confirm onReply fires with its
        // exact text (not just "was called").
        const bubble = canvas.getByText(/A few things landed/)
        await fireEvent.contextMenu(bubble)
        const replyRow = await canvas.findByText('Reply')
        await userEvent.click(replyRow)
        await expect(noop.onReply).toHaveBeenCalledWith(conversationAssistantText)
        // Inline code must not break mid-token (design #8) — `.chat-bubble`'s prose
        // `overflow-wrap: anywhere` was splitting `--since` into `-`/`-since` across the line.
        const code = canvas.getByText('--since')
        const codeStyle = getComputedStyle(code)
        await expect(codeStyle.overflowWrap).toBe('normal')
        await expect(codeStyle.wordBreak).toBe('keep-all')
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
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Grep')).toBeInTheDocument()
        await expect(canvas.getByText('Bash')).toBeInTheDocument()
        await expect(canvas.getByText('Read')).toBeInTheDocument()
    },
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
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('/context')).toBeInTheDocument()
        await expect(canvas.getByText('tokens')).toBeInTheDocument()
    },
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
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('Ask bismuth anything.'),
        ).toBeInTheDocument()
    },
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
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(/working/)).toBeInTheDocument()
    },
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
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('Lost connection to the daemon — retrying…'),
        ).toBeInTheDocument()
    },
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
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(/A few things landed/)).toBeInTheDocument()
    },
}

/** A turn that reasoned before answering (ChatThinkingBlock, collapsed by default) followed by a
 *  non-error system notice (ChatSystemNote, BUG #87) — neither part kind had a story before. */
export const ThinkingAndSystemNote: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={[...THINKING_ITEMS, ...SYSTEM_NOTE_ITEMS]}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Thinking')).toBeInTheDocument()
        await expect(
            canvas.getByText('Browser control enabled for this turn.'),
        ).toBeInTheDocument()
    },
}

/** `inset="flush"` (the daemon page's usage): zero inline padding on the scroll list, so the turn
 *  column's left edge lands flush with the host's own left edge — no gap most other callers get
 *  from the default `inset="pane"`. */
export const Flush: Story = {
    render: () => (
        <div style={{ width: '520px', height: '400px', display: 'flex' }}>
            <ChatTranscript
                items={CONVERSATION_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                inset="flush"
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const wrap = canvasElement.querySelector(
            '[class*="chat-list-wrap"]',
        ) as HTMLElement
        const bubble = canvas.getAllByText(/A few things landed/)[0]
        // The reading column's left edge sits at the wrap's own left edge — no inline padding.
        await expect(
            Math.round(bubble.getBoundingClientRect().left),
        ).toBe(Math.round(wrap.getBoundingClientRect().left))
    },
}

/** A user turn that arrives with sent images attached, no text. */
export const Images: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={IMAGE_TURN_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByAltText('attachment')).toBeInTheDocument()
        await expect(
            canvas.getByText('Got the screenshot — looking now.'),
        ).toBeInTheDocument()
    },
}
