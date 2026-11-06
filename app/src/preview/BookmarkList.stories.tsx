// Visual spec for <BookmarkList>: the reader's bookmarks section, in a book's panel and the PDF
// preview's panel alike.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import BookmarkList from './BookmarkList'
import type { Bookmark } from '../../../core/src/drawing/model'

const meta = {
    title: 'Preview/BookmarkList',
    component: BookmarkList,
} satisfies Meta<typeof BookmarkList>

export default meta
type Story = StoryObj<typeof meta>

const marks: Bookmark[] = [
    { id: 'a', page: 0, label: 'Page 1' },
    { id: 'b', page: 11, label: 'Limits' },
]

/** Two bookmarks; `+` adds one for the page on screen, a row jumps on click. */
export const Default: Story = {
    render: () => {
        const [list, setList] = createSignal(marks)
        const [jumped, setJumped] = createSignal<number>()
        return (
            <div style={{ width: '280px' }} data-jumped={jumped() ?? ''}>
                <BookmarkList
                    bookmarks={list()}
                    ready
                    onAdd={() => setList(l => [...l, { id: 'c', page: 20, label: 'Page 21' }])}
                    onJump={setJumped}
                    onRename={() => {}}
                    onRemove={id => setList(l => l.filter(b => b.id !== id))}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getAllByRole('listitem')).toHaveLength(2)
        await userEvent.click(c.getByRole('button', { name: 'Bookmark this page' }))
        await expect(c.getAllByRole('listitem')).toHaveLength(3)
    },
}

/** Nothing bookmarked yet, and the sidecar still loading: `+` is disabled. */
export const EmptyLoading: Story = {
    name: 'Empty, loading',
    render: () => (
        <div style={{ width: '280px' }}>
            <BookmarkList bookmarks={[]} ready={false} onAdd={() => {}} onJump={() => {}} onRename={() => {}} onRemove={() => {}} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('No bookmarks yet.')).toBeInTheDocument()
        await expect(c.getByRole('button', { name: 'Bookmark this page' })).toBeDisabled()
    },
}
