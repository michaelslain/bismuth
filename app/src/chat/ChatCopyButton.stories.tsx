// Visual spec for <ChatCopyButton> — the hover-revealed copy control on a message bubble.
// Regression coverage for the bug this fix round found: `ui.css`'s `.btn--icon.btn--normal
// { opacity: 1 }` (two global classes) out-specified this component's own `.chat-copy-btn
// { opacity: 0 }` (one class), so the icon showed AT REST on every message instead of only on
// hover/focus. Rendered inside a bare `[data-chat-bubble-wrap]` wrapper — the same hook
// ChatTextBubble.tsx provides, reproduced here with plain inline layout (not
// ChatTextBubble.module.css, which stays that component's only importer) since only the reveal
// hook itself matters to this test.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ChatCopyButton from './ChatCopyButton'

const meta = {
    title: 'Chat/ChatCopyButton',
    component: ChatCopyButton,
} satisfies Meta<typeof ChatCopyButton>

export default meta
type Story = StoryObj<typeof meta>

/** At rest, inside the bubble wrapper it actually lives in — opacity must be 0. */
export const AtRest: Story = {
    render: () => (
        <div
            data-chat-bubble-wrap
            style={{ position: 'relative', width: '200px', height: '60px' }}
        >
            <ChatCopyButton text="Some message text to copy." />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const btn = canvas.getByRole('button', { name: 'Copy message' })
        // The regression: this read 1 when ui.css's two-class rule won the specificity fight.
        await expect(getComputedStyle(btn).opacity).toBe('0')
    },
}
