// Visual spec for <BookPageEditor> — the book's page sorter. Thumbnails are drawn here; nothing is saved.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import BookPageEditor, { type EditTile } from './BookPageEditor'
import type { Face } from './bookFaces'

const meta = {
    title: 'Bases/BookPageEditor',
    component: BookPageEditor,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof BookPageEditor>

export default meta
type Story = StoryObj<typeof meta>

/** A page picture: white paper, a heading and some lines of grey "text". */
const pageFace = (n: number, landscape = false): Face => {
    const c = document.createElement('canvas')
    c.width = landscape ? 260 : 200
    c.height = landscape ? 200 : 260
    const g = c.getContext('2d')!
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, c.width, c.height)
    g.fillStyle = '#1d1b18'
    g.font = 'bold 22px Georgia'
    g.fillText(`Page ${n}`, 20, 44)
    g.fillStyle = '#9a958d'
    for (let y = 70; y < c.height - 20; y += 14) g.fillRect(20, y, c.width - 40 - ((y * 7) % 50), 5)
    return { kind: 'ready', source: c }
}

const tiles = (n: number): EditTile[] =>
    Array.from({ length: n }, (_, i) => ({ key: `p${i}`, label: `${i + 1}`, face: async () => pageFace(i + 1, i === 3) }))

function Live(props: { n: number; pending?: boolean }) {
    const [list, setList] = createSignal<EditTile[]>([
        ...tiles(props.n),
        ...(props.pending ? [{ key: 'new', label: 'scan-0412.jpg', pending: true }, { key: 'blank', label: 'blank page', pending: true }] : []),
    ])
    const [dirty, setDirty] = createSignal(!!props.pending)
    return (
        <div style={{ width: '1000px', height: '640px', display: 'flex' }}>
            <BookPageEditor
                tiles={list()}
                canBlank
                dirty={dirty()}
                onMove={(from, to) => {
                    const next = [...list()]
                    const [m] = next.splice(from, 1)
                    next.splice(to, 0, m)
                    setList(next)
                    setDirty(true)
                }}
                onRemove={i => {
                    setList(list().filter((_, k) => k !== i))
                    setDirty(true)
                }}
                onAddFiles={() => {}}
                onAddBlank={at => {
                    const next = [...list()]
                    next.splice(at, 0, { key: `b${at}`, label: 'blank page', pending: true })
                    setList(next)
                    setDirty(true)
                }}
                onSave={() => setDirty(false)}
                onCancel={() => {}}
            />
        </div>
    )
}

/** Eight pages, one of them wide: the grid keeps each page's shape in a cell of one height. */
export const Pages: Story = {
    render: () => <Live n={8} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelectorAll('[data-book-edit-tile] canvas').length).toBe(8))
        // nothing changed yet: save waits
        await expect(within(canvasElement).getByRole('button', { name: 'save' })).toBeDisabled()
    },
}

/** Pages added since the sorter opened show by name until they are saved. */
export const WithAddedPages: Story = {
    name: 'With added pages',
    render: () => <Live n={4} pending />,
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getAllByText('scan-0412.jpg').length).toBeGreaterThan(0)
        await expect(within(canvasElement).getByRole('button', { name: 'save' })).toBeEnabled()
    },
}

/** `+ blank page` adds a page at the end; the [x] (shown on hover) removes one; the `[+]` tile after
 *  the last page is the add button. */
export const AddAndRemove: Story = {
    name: 'Add and remove',
    render: () => <Live n={3} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: '+ blank page' }))
        await waitFor(() => expect(canvasElement.querySelectorAll('[data-book-edit-tile]').length).toBe(4))
        c.getAllByRole('button', { name: 'remove page' })[0].click()
        await waitFor(() => expect(canvasElement.querySelectorAll('[data-book-edit-tile]').length).toBe(3))
        await expect(c.getByRole('button', { name: 'save' })).toBeEnabled()
        // the add tile is last, after every page
        const grid = canvasElement.querySelector('[data-book-edit-add]')!.parentElement!
        await expect(grid.lastElementChild!.hasAttribute('data-book-edit-add')).toBe(true)
        await expect(c.getByRole('button', { name: 'add pages' })).toHaveTextContent('+')
    },
}
