// app/src/preview/BookmarkRow.stories.tsx
// Visual + behavioural spec for <BookmarkRow> — one row in the PDF bookmarks panel. Jump fires on
// click/Enter regardless of readiness; rename (double-click or the pencil) and delete are
// disabled, not merely inert, until `ready` — see BookmarkRow.tsx's own doc comment for why.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import BookmarkRow from './BookmarkRow'
import type { Bookmark } from '../../../core/src/drawing/model'

const meta = {
    title: 'Preview/BookmarkRow',
    component: BookmarkRow,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof BookmarkRow>

export default meta
type Story = StoryObj<typeof meta>

const bookmark: Bookmark = { id: 'b1', page: 4, label: 'Executive summary' }

/** Ready: label + 1-based page number render, rename/delete are live, and a click jumps to the
 *  bookmark's (0-based) page. */
export const Ready: Story = {
    render: () => {
        const [jumped, setJumped] = createSignal<number | null>(null)
        return (
            <div style={{ width: '240px' }} role="list">
                <BookmarkRow
                    bookmark={bookmark}
                    ready
                    onJump={setJumped}
                    onRename={() => {}}
                    onRemove={() => {}}
                />
                <div data-testid="jumped">{jumped()}</div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Executive summary')).toBeInTheDocument()
        await expect(canvas.getByText('p.5')).toBeInTheDocument()
        await expect(canvas.getByLabelText('Rename bookmark')).not.toBeDisabled()
        await expect(canvas.getByLabelText('Delete bookmark')).not.toBeDisabled()
        const row = canvasElement.querySelector(
            '[data-bookmark-id="b1"]',
        ) as HTMLElement
        await fireEvent.click(row)
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-testid="jumped"]')
                    ?.textContent,
            ).toBe('4'),
        )
    },
}

/** Not ready (`store.loadState() !== 'ready'`): rename/delete disabled, and a double-click does
 *  nothing — no input appears — while jump alone stays live. */
export const NotReady: Story = {
    render: () => (
        <div style={{ width: '240px' }} role="list">
            <BookmarkRow
                bookmark={bookmark}
                ready={false}
                onJump={() => {}}
                onRename={() => {}}
                onRemove={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByLabelText('Rename bookmark')).toBeDisabled()
        await expect(canvas.getByLabelText('Delete bookmark')).toBeDisabled()
        const row = canvasElement.querySelector(
            '[data-bookmark-id="b1"]',
        ) as HTMLElement
        await fireEvent.dblClick(row)
        await expect(canvasElement.querySelector('input')).toBeNull()
    },
}

/** Renaming: double-click swaps the label for an InlineTextInput; Enter commits exactly once,
 *  calling `onRename` with the new label. */
export const Renaming: Story = {
    render: () => {
        const [renamed, setRenamed] = createSignal<string | null>(null)
        return (
            <div style={{ width: '240px' }} role="list">
                <BookmarkRow
                    bookmark={bookmark}
                    ready
                    onJump={() => {}}
                    onRename={(_id, label) => setRenamed(label)}
                    onRemove={() => {}}
                />
                <div data-testid="renamed">{renamed()}</div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector(
            '[data-bookmark-id="b1"]',
        ) as HTMLElement
        await fireEvent.dblClick(row)
        const input = (await waitFor(() => {
            const el = canvasElement.querySelector('input')
            if (!el) throw new Error('rename input not mounted yet')
            return el
        })) as HTMLInputElement
        input.value = 'Renamed section'
        await fireEvent.keyDown(input, { key: 'Enter' })
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-testid="renamed"]')
                    ?.textContent,
            ).toBe('Renamed section'),
        )
    },
}
