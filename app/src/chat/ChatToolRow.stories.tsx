// Visual spec for <ChatToolRow> — a tool-call chip: icon + name + one-line argument summary +
// status mark, collapsed by default. `Expandable`'s play() clicks the row and asserts the raw
// input pre appears, proving the collapse/expand behaviour (not just the closed-state render).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import ChatToolRow from './ChatToolRow'
import type { ToolPart } from '../chatTranscript'

const meta = {
    title: 'Chat/ChatToolRow',
    component: ChatToolRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatToolRow>

export default meta
type Story = StoryObj<typeof meta>

const okPart: ToolPart = {
    kind: 'tool',
    id: 't1',
    name: 'Read',
    toolKind: 'read',
    input: { file_path: 'notes/roadmap.md' },
    result: '# Roadmap\n\n- ship the thing',
    isError: false,
    pending: false,
}

/** A settled, successful call — a check mark right after the argument text. */
export const Ok: Story = {
    render: () => (
        <div style={{ width: '680px' }}>
            <ChatToolRow part={okPart} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Read')).toBeInTheDocument()
    },
}

/** A failed call — the icon, name and status mark all pick up the danger tone. */
export const ErrorState: Story = {
    render: () => (
        <div style={{ width: '680px' }}>
            <ChatToolRow
                part={{
                    ...okPart,
                    id: 't2',
                    name: 'Bash',
                    toolKind: 'execute',
                    input: { command: 'bun test app/src/chat' },
                    result: 'error: 3 tests failed',
                    isError: true,
                }}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Bash')).toBeInTheDocument()
    },
}

/** Still running — a faint "…" mark in place of a check/x, no result yet. Was the shared blinking
 *  `.asc-caret` underscore, which read as a stray character rather than a pending mark (design
 *  #15). */
export const Pending: Story = {
    render: () => (
        <div style={{ width: '680px' }}>
            <ChatToolRow
                part={{
                    ...okPart,
                    id: 't3',
                    name: 'Grep',
                    toolKind: 'search',
                    input: { pattern: 'TODO', path: 'app/src' },
                    result: null,
                    pending: true,
                }}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Grep')).toBeInTheDocument()
        // Regression: this was `.asc-caret` (a blinking underscore, `color: var(--accent)`) — now
        // a plain "…" with no blink animation.
        const mark = canvas.getByText('…')
        await expect(mark.classList.contains('asc-caret')).toBe(false)
        await expect(getComputedStyle(mark).animationName).toBe('none')
    },
}

/** Clicking the row expands it to the raw input (and result, once present). */
export const Expandable: Story = {
    render: () => (
        <div style={{ width: '680px' }}>
            <ChatToolRow part={okPart} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByText('Read'))
        // "Input" only renders once expanded — unique, unlike the argument text (which already
        // shows once in the closed row's summary).
        await expect(canvas.getByText('Input')).toBeInTheDocument()
    },
}
