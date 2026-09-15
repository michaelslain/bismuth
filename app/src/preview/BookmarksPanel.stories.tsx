// app/src/preview/BookmarksPanel.stories.tsx
// Visual + behavioural spec for <BookmarksPanel>, the PDF preview's bookmarks + outline column.
// The panel only needs the `AnnotationStore` TYPE, so these stories hand it a small in-story stub
// (a doc signal whose `edit` applies the function) rather than the real sidecar-backed store —
// what's under test is that every edit goes through `store.edit` and the rows follow the doc.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import BookmarksPanel from './BookmarksPanel'
import type { AnnotationStore, OutlineNode } from './annotationTypes'
import { emptyDoc, type DrawingDoc } from '../../../core/src/drawing/model'

/** Records how many times `edit` ran, so a play can prove a gesture went THROUGH the store. */
let edits = 0
function stubStore(initial: DrawingDoc | null): AnnotationStore {
    const [doc, setDoc] = createSignal<DrawingDoc | null>(initial)
    return {
        doc,
        loadState: () => 'ready',
        edit: fn => {
            edits++
            setDoc(d => fn(d ?? emptyDoc()))
        },
        undo: () => {},
        redo: () => {},
        resetHistory: () => {},
        flush: async () => {},
    }
}

const OUTLINE: OutlineNode[] = [
    {
        title: 'Introduction',
        page: 0,
        children: [
            { title: 'Background', page: 1, children: [] },
            {
                title: 'Method',
                page: 2,
                children: [{ title: 'Sampling', page: 3, children: [] }],
            },
        ],
    },
    { title: 'Findings', page: 5, children: [] },
    { title: 'Broken destination', page: null, children: [] },
]

const DOC: DrawingDoc = {
    ...emptyDoc(),
    bookmarks: [
        { id: 'bm-late', page: 6, label: 'Key table' },
        { id: 'bm-early', page: 1, label: 'Definitions' },
    ],
}

let jumps: number[] = []

const meta = {
    title: 'Preview/BookmarksPanel',
    component: BookmarksPanel,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof BookmarksPanel>

export default meta
type Story = StoryObj<typeof meta>

const frame = (children: ReturnType<typeof BookmarksPanel>) => (
    <div style={{ width: '260px', height: '420px' }}>{children}</div>
)

const bookmarkRows = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('[data-bookmark-id]')) as HTMLElement[]
const outlineRows = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('[role="treeitem"]')) as HTMLElement[]

/** Two bookmarks (stored out of order, listed by page) above a nested outline with one
 *  unresolvable node. Exercises jump, add, rename, delete and collapse. */
export const Default: Story = {
    render: () => {
        edits = 0
        jumps = []
        // Built ONCE, outside the JSX: an inline `store={stubStore(…)}` compiles to a prop GETTER,
        // and every `props.store` read inside the panel would mint a fresh store.
        const store = stubStore(structuredClone(DOC))
        return frame(
            <BookmarksPanel
                store={store}
                outline={() => OUTLINE}
                currentPage={() => 4}
                onJump={p => jumps.push(p)}
            />,
        )
    },
    play: async ({ canvasElement }) => {
        // Listed by page, not storage order.
        await expect(
            bookmarkRows(canvasElement).map(r => r.textContent),
        ).toEqual([
            expect.stringContaining('Definitions'),
            expect.stringContaining('Key table'),
        ])
        await expect(bookmarkRows(canvasElement)[0]!.textContent).toContain(
            'p.2',
        )
        // All five resolvable-or-not nodes are open by default.
        await expect(outlineRows(canvasElement).length).toBe(6)

        // Click a bookmark → jump to its page.
        bookmarkRows(canvasElement)[1]!.click()
        await expect(jumps).toEqual([6])

        // Click an outline node → jump; the dead one does nothing.
        const byTitle = (t: string) =>
            outlineRows(canvasElement).find(r => r.textContent?.includes(t))!
        byTitle('Sampling').click()
        byTitle('Broken destination').click()
        await expect(jumps).toEqual([6, 3])

        // Collapse "Introduction": its three descendants go, and the toggle does not jump.
        const toggle = byTitle('Introduction').querySelector(
            'button[aria-label="Collapse"]',
        ) as HTMLButtonElement
        toggle.click()
        await expect(outlineRows(canvasElement).length).toBe(3)
        await expect(
            byTitle('Introduction').getAttribute('aria-expanded'),
        ).toBe('false')
        await expect(jumps).toEqual([6, 3])
        ;(
            byTitle('Introduction').querySelector(
                'button[aria-label="Expand"]',
            ) as HTMLButtonElement
        ).click()
        await expect(outlineRows(canvasElement).length).toBe(6)

        // Add bookmarks the CURRENT page (index 4 → "Page 5"), through the store.
        ;(
            canvasElement.querySelector(
                'button[aria-label="Bookmark this page"]',
            ) as HTMLButtonElement
        ).click()
        await expect(edits).toBe(1)
        await expect(
            bookmarkRows(canvasElement).map(r => r.textContent),
        ).toEqual([
            expect.stringContaining('Definitions'),
            expect.stringContaining('Page 5'),
            expect.stringContaining('Key table'),
        ])

        // Rename in place: pencil → input → Enter.
        const renameRow = bookmarkRows(canvasElement)[1]!
        ;(
            renameRow.querySelector(
                'button[aria-label="Rename bookmark"]',
            ) as HTMLButtonElement
        ).click()
        const input = (await waitFor(() => {
            const el = canvasElement.querySelector(
                'input[aria-label="Bookmark name"]',
            ) as HTMLInputElement | null
            expect(el).not.toBeNull()
            return el
        }))!
        // A click on the row itself while its name is being edited must not jump away.
        renameRow.click()
        await expect(jumps).toEqual([6, 3])
        input.value = '  Results  '
        input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        )
        await waitFor(() =>
            expect(bookmarkRows(canvasElement)[1]!.textContent).toContain(
                'Results',
            ),
        )
        await expect(edits).toBe(2)
        await expect(jumps).toEqual([6, 3])

        // Delete through the store.
        ;(
            bookmarkRows(canvasElement)[0]!.querySelector(
                'button[aria-label="Delete bookmark"]',
            ) as HTMLButtonElement
        ).click()
        await expect(edits).toBe(3)
        await expect(
            bookmarkRows(canvasElement).map(r => r.textContent),
        ).toEqual([
            expect.stringContaining('Results'),
            expect.stringContaining('Key table'),
        ])
    },
}

/** A document with no sidecar yet and no outline: both sections show their empty state, and the
 *  first bookmark creates the doc through the store. */
export const Empty: Story = {
    render: () => {
        edits = 0
        const store = stubStore(null)
        return frame(
            <BookmarksPanel
                store={store}
                outline={() => []}
                currentPage={() => 0}
                onJump={() => {}}
            />,
        )
    },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain('No bookmarks yet.')
        await expect(canvasElement.textContent).toContain(
            'This document has no outline.',
        )
        await expect(outlineRows(canvasElement).length).toBe(0)
        ;(
            canvasElement.querySelector(
                'button[aria-label="Bookmark this page"]',
            ) as HTMLButtonElement
        ).click()
        await expect(edits).toBe(1)
        await expect(
            bookmarkRows(canvasElement).map(r => r.textContent),
        ).toEqual([expect.stringContaining('Page 1')])
        await expect(canvasElement.textContent).not.toContain(
            'No bookmarks yet.',
        )
    },
}
