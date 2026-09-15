// app/src/preview/BookmarksPanel.stories.tsx
// Visual + behavioural spec for <BookmarksPanel>, the PDF preview's bookmarks + outline column.
// The panel only needs the `AnnotationStore` TYPE, so these stories hand it a small in-story stub
// (a doc signal whose `edit` applies the function) rather than the real sidecar-backed store —
// what's under test is that every edit goes through `store.edit` and the rows follow the doc.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import BookmarksPanel from './BookmarksPanel'
import type {
    AnnotationLoadState,
    AnnotationStore,
    OutlineNode,
} from './annotationTypes'
import { emptyDoc, type DrawingDoc } from '../../../core/src/drawing/model'
import { outlinePrefix } from './outlinePrefix'

/** Records how many times `edit` ran, so a play can prove a gesture went THROUGH the store. */
let edits = 0
function stubStore(
    initial: DrawingDoc | null,
    loadState: AnnotationLoadState = 'ready',
): AnnotationStore {
    const [doc, setDoc] = createSignal<DrawingDoc | null>(initial)
    return {
        doc,
        loadState: () => loadState,
        edit: fn => {
            // Mirrors the real createAnnotationStore.ts: a no-op unless loadState is 'ready',
            // so a click that slips past the disabled UI still can't write.
            if (loadState !== 'ready') return
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

        // --- Polish Task 1 acceptance, numeric ---------------------------------------------
        const findByText = (root: Element, re: RegExp) =>
            Array.from(root.querySelectorAll('span')).find(el =>
                re.test(el.textContent?.trim() ?? ''),
            ) as HTMLElement
        const rightEdge = (row: HTMLElement) => {
            const r = row.getBoundingClientRect()
            const padRight = parseFloat(
                getComputedStyle(row).paddingRight || '0',
            )
            return r.right - padRight
        }

        // 1. Page-number right edges match in BOTH sections, and match the row's own content
        //    right edge (row's own right edge minus its padding).
        const bmRow = bookmarkRows(canvasElement)[0]!
        const olRow = byTitle('Introduction')
        const bmPage = findByText(bmRow, /^p\.\d+$/)
        const olPage = findByText(olRow, /^p\.\d+$/)
        await expect(
            Math.abs(bmPage.getBoundingClientRect().right - rightEdge(bmRow)),
        ).toBeLessThanOrEqual(1)
        await expect(
            Math.abs(olPage.getBoundingClientRect().right - rightEdge(olRow)),
        ).toBeLessThanOrEqual(1)
        await expect(
            Math.abs(
                bmPage.getBoundingClientRect().right -
                    olPage.getBoundingClientRect().right,
            ),
        ).toBeLessThanOrEqual(1)

        // 2. Rename/delete take ZERO layout width at rest: label + gap + page number exactly
        //    fill the row's content box. Before this fix the hidden icon pair (and its own gap)
        //    were still reserved by the flex layout, so this sum fell short.
        const actionsWrap = bmRow.querySelector(
            'button[aria-label="Rename bookmark"]',
        )!.parentElement as HTMLElement
        await expect(getComputedStyle(actionsWrap).position).toBe('absolute')
        await expect(Number(getComputedStyle(actionsWrap).opacity)).toBe(0)
        const bmLabel = findByText(bmRow, /^Results$/)
        const rowStyle = getComputedStyle(bmRow)
        const contentWidth =
            bmRow.getBoundingClientRect().width -
            parseFloat(rowStyle.paddingLeft || '0') -
            parseFloat(rowStyle.paddingRight || '0')
        const gapPx = parseFloat(rowStyle.columnGap || rowStyle.gap || '0')
        const usedWidth =
            bmLabel.getBoundingClientRect().width +
            gapPx +
            bmPage.getBoundingClientRect().width
        await expect(Math.abs(usedWidth - contentWidth)).toBeLessThanOrEqual(1)
        // On a real, programmatic focus (CSS `:hover` follows the physical pointer and cannot be
        // posed from a play() — see shell/TabRail.stories.tsx), the overlay reveals.
        const renameBtn = bmRow.querySelector(
            'button[aria-label="Rename bookmark"]',
        ) as HTMLButtonElement
        renameBtn.focus()
        await waitFor(() =>
            expect(Number(getComputedStyle(actionsWrap).opacity)).toBe(1),
        )
        renameBtn.blur()

        // 4. Bookmarks render no ASCII connector characters — a flat list, not a tree.
        await expect(
            bookmarkRows(canvasElement).every(
                r => !/[|`]/.test(r.textContent ?? ''),
            ),
        ).toBe(true)

        // 3. Outline: the connector is drawn WHOLE (never overwritten by the toggle — the prefix
        //    text node's own textContent is the full `outlinePrefix(...)` string, matching
        //    FileTree's own row shape of full-connector + a separate fixed-width icon slot).
        //    Row children, in order: [0] prefix text, [1] disclosure slot, [2] title, [3]? page.
        const prefixEl = (row: HTMLElement) => row.children[0] as HTMLElement
        const titleEl = (row: HTMLElement) => row.children[2] as HTMLElement
        const backgroundRow = byTitle('Background')
        const methodRow = byTitle('Method')
        const samplingRow = byTitle('Sampling')
        const findingsRow = byTitle('Findings')
        const brokenRow = byTitle('Broken destination')
        await expect(prefixEl(olRow).textContent).toBe(
            outlinePrefix([], false).trimEnd(),
        )
        await expect(prefixEl(backgroundRow).textContent).toBe(
            outlinePrefix([false], false).trimEnd(),
        )
        await expect(prefixEl(methodRow).textContent).toBe(
            outlinePrefix([false], true).trimEnd(),
        )
        await expect(prefixEl(samplingRow).textContent).toBe(
            outlinePrefix([false, true], true).trimEnd(),
        )
        await expect(prefixEl(findingsRow).textContent).toBe(
            outlinePrefix([], false).trimEnd(),
        )
        await expect(prefixEl(brokenRow).textContent).toBe(
            outlinePrefix([], true).trimEnd(),
        )

        // Sibling titles at the same depth align regardless of children (Method has a child,
        // Background doesn't — same depth, same connector length, same fixed disclosure slot).
        await expect(
            Math.abs(
                titleEl(backgroundRow).getBoundingClientRect().left -
                    titleEl(methodRow).getBoundingClientRect().left,
            ),
        ).toBeLessThanOrEqual(1)

        // A depth-1 title starts exactly one prefix-step right of its parent's: the disclosure
        // slot is the SAME fixed width at every depth, so it cancels out of this difference —
        // only the extra connector segment (one step) should remain.
        const introStepWidth =
            prefixEl(backgroundRow).getBoundingClientRect().width -
            prefixEl(olRow).getBoundingClientRect().width
        await expect(
            Math.abs(
                titleEl(backgroundRow).getBoundingClientRect().left -
                    titleEl(olRow).getBoundingClientRect().left -
                    introStepWidth,
            ),
        ).toBeLessThanOrEqual(1)
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

/** Before the sidecar has loaded, a bookmark's rename/delete are DISABLED, not merely inert
 *  (final review — docs/drawing/overview.md claims edits stay disabled until ready, and this row
 *  was the one place that wasn't true: the buttons rendered enabled and a click landed on
 *  `store.edit`, which silently did nothing with no snap-back). Jump still works, because it
 *  never edits. */
export const NotReadyDisablesEdits: Story = {
    render: () => {
        edits = 0
        jumps = []
        const store = stubStore(structuredClone(DOC), 'loading')
        return frame(
            <BookmarksPanel
                store={store}
                outline={() => []}
                currentPage={() => 4}
                onJump={p => jumps.push(p)}
            />,
        )
    },
    play: async ({ canvasElement }) => {
        // The "bookmark this page" add button is already proven disabled-before-ready
        // (`disabled={!ready()}` in BookmarksPanel.tsx) — this story is about the ROW's own
        // rename/delete, which is what regressed.
        const row = bookmarkRows(canvasElement)[0]!
        const renameBtn = row.querySelector(
            'button[aria-label="Rename bookmark"]',
        ) as HTMLButtonElement
        const deleteBtn = row.querySelector(
            'button[aria-label="Delete bookmark"]',
        ) as HTMLButtonElement
        await expect(renameBtn.disabled).toBe(true)
        await expect(deleteBtn.disabled).toBe(true)

        // A disabled button dispatches no click — prove the store is never even asked.
        renameBtn.click()
        deleteBtn.click()
        await expect(edits).toBe(0)
        await expect(
            canvasElement.querySelector('input[aria-label="Bookmark name"]'),
        ).toBeNull()

        // Double-click and F2 are the row's OTHER two ways into rename — both must stay inert too.
        row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        await expect(
            canvasElement.querySelector('input[aria-label="Bookmark name"]'),
        ).toBeNull()
        row.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'F2', bubbles: true }),
        )
        await expect(
            canvasElement.querySelector('input[aria-label="Bookmark name"]'),
        ).toBeNull()

        // Jump is not an edit, so it still works even before ready. `row` is the first-by-page
        // bookmark (bm-early, page 1 — "Definitions"), per Default's own "listed by page" note.
        row.click()
        await expect(jumps).toEqual([1])
    },
}
