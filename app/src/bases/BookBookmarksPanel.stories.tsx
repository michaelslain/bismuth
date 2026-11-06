// Visual spec for <BookBookmarksPanel> — the 280px bookmarks column beside a book.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { Bookmark } from '../../../core/src/drawing/model'
import BookBookmarksPanel from './BookBookmarksPanel'

const meta = {
    title: 'Bases/BookBookmarksPanel',
    component: BookBookmarksPanel,
    parameters: { layout: 'fullscreen' },
    decorators: [
        Story => (
            <div style={{ display: 'flex', 'justify-content': 'flex-end', height: '360px' }}>
                <Story />
            </div>
        ),
    ],
    args: {
        bookmarks: [],
        ready: true,
        onAdd: fn(),
        onJump: fn(),
        onRename: fn(),
        onRemove: fn(),
    },
} satisfies Meta<typeof BookBookmarksPanel>

export default meta
type Story = StoryObj<typeof meta>

const THREE: Bookmark[] = [
    { id: 'b1', page: 2, label: 'Page 3' },
    { id: 'b2', page: 11, label: 'Recipe for the sauce' },
    { id: 'b3', page: 30, label: 'Page 31' },
]

export const Empty: Story = {
    play: async ({ canvasElement, args }) => {
        const c = within(canvasElement)
        await expect(c.getByText('No bookmarks yet.')).toBeInTheDocument()
        await userEvent.click(c.getByRole('button', { name: 'Bookmark this page' }))
        await expect(args.onAdd).toHaveBeenCalledTimes(1)
    },
}

export const ThreeBookmarks: Story = {
    name: 'Three bookmarks',
    args: { bookmarks: THREE },
    play: async ({ canvasElement, args }) => {
        const c = within(canvasElement)
        await expect(c.getAllByRole('listitem')).toHaveLength(3)
        await expect(c.getByText('p.12')).toBeInTheDocument()
        await userEvent.click(c.getByText('Recipe for the sauce'))
        await expect(args.onJump).toHaveBeenCalledWith(11)
    },
}

export const Rename: Story = {
    render: args => {
        const [rows, setRows] = createSignal<Bookmark[]>(THREE)
        return (
            <BookBookmarksPanel
                {...args}
                bookmarks={rows()}
                onRename={(id, label) => {
                    args.onRename(id, label)
                    setRows(r => r.map(b => (b.id === id ? { ...b, label } : b)))
                }}
            />
        )
    },
    play: async ({ canvasElement, args }) => {
        const c = within(canvasElement)
        await userEvent.dblClick(c.getByText('Page 3'))
        const input = c.getByLabelText('Bookmark name')
        await userEvent.clear(input)
        await userEvent.type(input, 'Opening scene{Enter}')
        await expect(args.onRename).toHaveBeenCalledWith('b1', 'Opening scene')
        await expect(c.getByText('Opening scene')).toBeInTheDocument()
    },
}
