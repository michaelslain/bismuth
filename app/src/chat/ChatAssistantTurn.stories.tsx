// Visual spec for <ChatAssistantTurn> — one whole assistant turn: the persona label, its parts
// (prose / thinking / tool call / permission / question) in arrival order, and a muted footer once
// the turn's `result` frame lands. Reuses the same fixtures ChatTranscript.stories.tsx composes
// from — one assistant turn, isolated, so a part-kind regression here doesn't need the whole
// scrollable transcript to reproduce.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, within } from 'storybook/test'
import ChatAssistantTurn from './ChatAssistantTurn'
import type { AssistantItem } from '../chatTranscript'
import {
    COMMAND_OUTPUT_ITEMS,
    CONVERSATION_ITEMS,
    THINKING_ITEMS,
    TOOL_CALL_ITEMS,
} from './_transcriptFixtures'

const meta = {
    title: 'Chat/ChatAssistantTurn',
    component: ChatAssistantTurn,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatAssistantTurn>

export default meta
type Story = StoryObj<typeof meta>

const noop = {
    onAnswerPermission: fn(),
    onAnswerQuestion: fn(),
    onBubbleContextMenu: fn(),
}

// Index [1] in each fixture is the assistant turn — [0] is the user turn that leads it.
const proseItem = CONVERSATION_ITEMS[1] as AssistantItem
const toolItem = TOOL_CALL_ITEMS[1] as AssistantItem
const commandItem = COMMAND_OUTPUT_ITEMS[1] as AssistantItem
const thinkingItem = THINKING_ITEMS[1] as AssistantItem

/** Prose with a bulleted list and a bold run, plus a muted turns/cost footer. */
export const Prose: Story = {
    render: () => (
        <div style={{ width: '760px' }}>
            <ChatAssistantTurn item={proseItem} persona="bismuth" {...noop} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('bismuth')).toBeInTheDocument()
        await expect(canvas.getByText(/A few things landed/)).toBeInTheDocument()
        await expect(canvas.getByText(/\$0\.0142/)).toBeInTheDocument()
    },
}

/** Prose interleaved with tool calls in every state a chip can be in: settled ok, settled error,
 *  still pending. */
export const ToolCalls: Story = {
    render: () => (
        <div style={{ width: '760px' }}>
            <ChatAssistantTurn item={toolItem} persona="bismuth" {...noop} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Grep')).toBeInTheDocument()
        await expect(canvas.getByText('Bash')).toBeInTheDocument()
        await expect(canvas.getByText('Read')).toBeInTheDocument()
    },
}

/** A slash-command result — the boxed monospace "Command output" panel, not loose prose (#28). */
export const CommandOutput: Story = {
    render: () => (
        <div style={{ width: '760px' }}>
            <ChatAssistantTurn item={commandItem} persona="bismuth" {...noop} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(/Command output/)).toBeInTheDocument()
        await expect(canvas.getByText('tokens')).toBeInTheDocument()
    },
}

/** A turn that reasoned before answering — ChatThinkingBlock renders collapsed by default,
 *  alongside the turn's final prose part. */
export const Thinking: Story = {
    render: () => (
        <div style={{ width: '760px' }}>
            <ChatAssistantTurn item={thinkingItem} persona="bismuth" {...noop} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Thinking')).toBeInTheDocument()
        await expect(
            canvas.getByText(
                'The build ran the full test suite instead of the fast subset.',
            ),
        ).toBeInTheDocument()
    },
}
