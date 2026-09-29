// Visual spec for <BulkCardsEditor> — the Bulk add mode of the deck editor. The interactive stories
// hold the paste text and separator in signals (as the modal does) and assert the parsed preview.
import { createMemo, createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import BulkCardsEditor from './BulkCardsEditor'
import { parseBulk } from './cardsEdit'

const meta = {
    title: 'Bases/BulkCardsEditor',
    component: BulkCardsEditor,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof BulkCardsEditor>

export default meta
type Story = StoryObj<typeof meta>

function Host(props: { initial: string; delim?: string }) {
    const [text, setText] = createSignal(props.initial)
    const [delim, setDelim] = createSignal(props.delim ?? 'auto')
    const parsed = createMemo(() => parseBulk(text(), delim()))
    return (
        <div style={{ width: '820px', height: '420px', display: 'flex', 'flex-direction': 'column' }}>
            <BulkCardsEditor
                text={text()}
                onText={setText}
                delim={delim()}
                onDelim={setDelim}
                parsed={parsed()}
            />
        </div>
    )
}

const rows = (root: ParentNode) => root.querySelectorAll('[data-testid="bulk-preview-row"]')
const warnings = (root: ParentNode) => root.querySelectorAll('[data-testid="bulk-preview-warning"]')

/** Nothing pasted: the preview says so. */
export const Empty: Story = {
    render: () => <Host initial="" />,
    play: async ({ canvasElement }) => {
        expect(rows(canvasElement)).toHaveLength(0)
        expect(canvasElement.textContent).toContain('parsed cards appear here')
        expect(canvasElement.querySelector('[data-testid="bulk-preview-count"]')!.textContent).toBe(
            '0 cards',
        )
    },
}

/** Three lines, one without a separator: three preview rows, one flagged "no back". */
export const WithWarning: Story = {
    render: () => <Host initial={'casa :: house\nhola : hello\nno separator here'} />,
    play: async ({ canvasElement }) => {
        expect(rows(canvasElement)).toHaveLength(3)
        expect(warnings(canvasElement)).toHaveLength(1)
        expect(warnings(canvasElement)[0].textContent).toContain('no back')
        expect(canvasElement.querySelector('[data-testid="bulk-preview-count"]')!.textContent).toBe(
            '3 cards',
        )
    },
}

/** Picking a separator re-parses the same paste: `auto` sniffs `::`, `|` splits on the pipe. */
export const SeparatorChangesParse: Story = {
    render: () => <Host initial="a :: b | c" />,
    play: async ({ canvasElement }) => {
        // Auto: `::` wins, so the back is everything after it.
        expect(rows(canvasElement)[0].textContent).toContain('b | c')
        await userEvent.click(within(canvasElement).getByRole('button', { name: '|' }))
        // Pipe: the front is everything before it, the back is `c`.
        await waitFor(() => expect(rows(canvasElement)[0].textContent).toContain('a :: b'))
        expect(warnings(canvasElement)).toHaveLength(0)
    },
}

/** Typing into the paste box updates the preview live. */
export const TypingUpdatesPreview: Story = {
    render: () => <Host initial="" />,
    play: async ({ canvasElement }) => {
        const ta = canvasElement.querySelector('textarea') as HTMLTextAreaElement
        await userEvent.click(ta)
        await userEvent.type(ta, 'one : 1')
        await waitFor(() => expect(rows(canvasElement)).toHaveLength(1))
        expect(warnings(canvasElement)).toHaveLength(0)
    },
}
