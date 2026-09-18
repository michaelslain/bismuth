// Visual spec for <ChatTextBubble> — one turn's prose, rendered through the same note markdown
// pipeline every note uses, so a message reads exactly like a note. Shared by ChatUserTurn's
// bubble and ChatAssistantTurn's text parts (see their own stories for the composed shapes); this
// one isolates the bubble itself, including the boxed "command output" register (#28) and the
// empty-text no-render case.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, fn, within } from 'storybook/test'
import ChatTextBubble from './ChatTextBubble'

const meta = {
    title: 'Chat/ChatTextBubble',
    component: ChatTextBubble,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatTextBubble>

export default meta
type Story = StoryObj<typeof meta>

const proseText = [
    'A few things landed:',
    '',
    '- **Faster startup** — the daemon now boots in under a second',
    '- `bismuth daemon logs` now supports `--since`',
].join('\n')

/** Assistant prose — headings, a bulleted list and a bold run render as real markdown. */
export const Assistant: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatTextBubble text={proseText} role="assistant" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(/Faster startup/)).toBeInTheDocument()
        const code = canvas.getByText('--since')
        // Inline code must not break mid-token (design #8).
        await expect(getComputedStyle(code).overflowWrap).toBe('normal')
    },
}

/** A plain sent message — the user role carries the same prose register (bubbles dissolve; both
 *  roles share `.chat-bubble`). */
export const User: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatTextBubble text="Summarize the vault." role="user" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Summarize the vault.')).toBeInTheDocument()
    },
}

/** A slash-command result — the boxed monospace "Command output" panel instead of loose prose
 *  (#28); the body still renders through the same markdown pipeline (here, a table). */
export const CommandOutput: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatTextBubble
                text={['| tokens | budget |', '| --- | --- |', '| 42,318 | 200,000 |'].join(
                    '\n',
                )}
                role="assistant"
                command
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(/Command output/)).toBeInTheDocument()
        await expect(canvas.getByText('tokens')).toBeInTheDocument()
    },
}

/** Blank text (e.g. an image-only turn) renders nothing at all — no empty bubble shell. The
 *  caption is the story's own marker (so the canvas isn't literally blank pixels), not part of
 *  ChatTextBubble; the assertion below is what actually proves the component renders nothing. */
export const Empty: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <p>blank text below renders no bubble:</p>
            <div data-testid="empty-host">
                <ChatTextBubble text="   " role="user" />
            </div>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const host = canvas.getByTestId('empty-host')
        await expect(host.querySelector('[data-chat-bubble-wrap]')).toBeNull()
    },
}

/** Right-click a bubble fires `onContextMenu` — the transcript owns the actual Reply/Copy menu. */
export const ContextMenu: Story = {
    render: args => (
        <div style={{ width: '600px' }}>
            <ChatTextBubble
                text="Right-click me."
                role="assistant"
                onContextMenu={args.onContextMenu}
            />
        </div>
    ),
    args: { onContextMenu: fn() },
    play: async ({ canvasElement, args }) => {
        const canvas = within(canvasElement)
        const bubble = canvas.getByText('Right-click me.')
        await fireEvent.contextMenu(bubble)
        await expect(args.onContextMenu).toHaveBeenCalled()
    },
}
