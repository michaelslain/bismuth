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
/** Set by Default's render() to its `currentPage` signal's setter, so play() can prove the
 *  current-section marker (Task 6 acceptance 1) actually reacts to the page changing, rather than
 *  only being computed once at mount. */
let setCurrentPage: ((page: number) => void) | undefined

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
        // A real signal, not a fixed `() => 4` closure — Task 6 acceptance 1 requires the
        // current-section marker to react to the page changing, and play() drives it via
        // `setCurrentPage`.
        const [currentPage, setPage] = createSignal(4)
        setCurrentPage = setPage
        return frame(
            <BookmarksPanel
                store={store}
                outline={() => OUTLINE}
                currentPage={currentPage}
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
            'button[aria-label="Collapse Introduction"]',
        ) as HTMLButtonElement
        toggle.click()
        await expect(outlineRows(canvasElement).length).toBe(3)
        await expect(
            byTitle('Introduction').getAttribute('aria-expanded'),
        ).toBe('false')
        await expect(jumps).toEqual([6, 3])
        ;(
            byTitle('Introduction').querySelector(
                'button[aria-label="Expand Introduction"]',
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
            // Task 6 acceptance 9: the new bookmark's label defaults to the outline's title for
            // the current page (page index 4 falls under "Sampling"), not "Page 5".
            expect.stringContaining('Sampling'),
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

        // --- Polish Task 6 acceptance, numeric ----------------------------------------------
        // 1. Current-section marker: at currentPage=4 (index), "Sampling" (page index 3) is the
        //    deepest outline node whose page <= 4 — the only row carrying aria-current, painted
        //    with the SAME background FileTree uses for the open file (--state-selected-bg).
        const currentBgProbe = document.createElement('div')
        currentBgProbe.style.background = 'var(--state-selected-bg)'
        canvasElement.appendChild(currentBgProbe)
        const expectedCurrentBg =
            getComputedStyle(currentBgProbe).backgroundColor
        currentBgProbe.remove()
        await expect(samplingRow.getAttribute('aria-current')).toBe(
            'location',
        )
        await expect(
            outlineRows(canvasElement)
                .filter(r => r !== samplingRow)
                .every(r => r.getAttribute('aria-current') !== 'location'),
        ).toBe(true)
        await expect(getComputedStyle(samplingRow).backgroundColor).toBe(
            expectedCurrentBg,
        )
        // ...and it changes as `currentPage` changes, not just once at mount.
        setCurrentPage!(6)
        await waitFor(() =>
            expect(byTitle('Findings').getAttribute('aria-current')).toBe(
                'location',
            ),
        )
        await expect(samplingRow.getAttribute('aria-current')).not.toBe(
            'location',
        )

        // 3. A bookmark row's accessible name: "Jump to <label>, page N". `bmRow` is, by this
        //    point, the renamed "Results" bookmark (originally "Definitions" was deleted above).
        await expect(bmRow.getAttribute('aria-label')).toBe(
            'Jump to Results, page 5',
        )

        // 4. Connectors + page numbers clear WCAG 1.4.3's 4.5:1 text-contrast floor against the
        //    panel background, computed from the ACTUAL resolved colours (not the token names).
        const panelRoot = canvasElement.firstElementChild!
            .firstElementChild as HTMLElement
        const panelBg = getComputedStyle(panelRoot).backgroundColor
        const parseRgb = (s: string) => {
            const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/)
            return [Number(m?.[1]), Number(m?.[2]), Number(m?.[3])]
        }
        const relLuminance = ([r, g, b]: number[]) => {
            const lin = (c?: number) => {
                const v = (c ?? 0) / 255
                return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
            }
            return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
        }
        const contrastRatio = (a: string, b: string) => {
            const [la, lb] = [
                relLuminance(parseRgb(a)),
                relLuminance(parseRgb(b)),
            ]
            const [hi, lo] = la > lb ? [la, lb] : [lb, la]
            return (hi + 0.05) / (lo + 0.05)
        }
        await expect(
            contrastRatio(getComputedStyle(prefixEl(olRow)).color, panelBg),
        ).toBeGreaterThanOrEqual(4.5)
        await expect(
            contrastRatio(getComputedStyle(olPage).color, panelBg),
        ).toBeGreaterThanOrEqual(4.5)
        await expect(
            contrastRatio(getComputedStyle(bmPage).color, panelBg),
        ).toBeGreaterThanOrEqual(4.5)

        // 5. The disabled header "+" visibly differs from its own enabled state — this story has
        //    it enabled (opacity 1); NotReadyDisablesEdits proves the disabled side (~0.4).
        const plusBtn = canvasElement.querySelector(
            'button[aria-label="Bookmark this page"]',
        ) as HTMLButtonElement
        await expect(Number(getComputedStyle(plusBtn).opacity)).toBe(1)

        // 6. Character-cell columns (fix 2 — the chevron was glued to the connector,
        //    `|--⌄Introduction`): `|-- ⌄ Introduction` for a parent, `|--   Background` for a
        //    leaf. Exactly one cell between the connector and the chevron slot, a one-cell slot,
        //    one cell before the title — measured in the connector's own font, every row.
        const chProbe = document.createElement('span')
        chProbe.style.cssText = 'position:absolute;visibility:hidden;width:1ch'
        prefixEl(olRow).appendChild(chProbe)
        const oneCh = chProbe.getBoundingClientRect().width
        chProbe.remove()
        await expect(oneCh).toBeGreaterThan(4)
        const slotEl = (row: HTMLElement) => row.children[1] as HTMLElement
        for (const [name, row] of [
            ['Introduction', olRow],
            ['Background', backgroundRow],
            ['Method', methodRow],
            ['Sampling', samplingRow],
            ['Findings', findingsRow],
        ] as const) {
            const p = prefixEl(row).getBoundingClientRect()
            const s = slotEl(row).getBoundingClientRect()
            const t = titleEl(row).getBoundingClientRect()
            expect(
                Math.abs(s.left - p.right - oneCh),
                `${name}: connector → slot is one cell`,
            ).toBeLessThanOrEqual(1)
            expect(
                Math.abs(s.width - oneCh),
                `${name}: slot is one cell wide`,
            ).toBeLessThanOrEqual(1)
            expect(
                Math.abs(t.left - s.right - oneCh),
                `${name}: slot → title is one cell`,
            ).toBeLessThanOrEqual(1)
        }
        // The chevron glyph is painted IN its slot (centred on it), and its click target is at
        // least the row's height in both directions even though the visual column is one cell.
        const rowH = backgroundRow.getBoundingClientRect().height
        for (const row of [olRow, methodRow]) {
            const s = slotEl(row).getBoundingClientRect()
            const glyph = slotEl(row).querySelector('svg')!.getBoundingClientRect()
            expect(
                Math.abs((glyph.left + glyph.right) / 2 - (s.left + s.right) / 2),
            ).toBeLessThanOrEqual(1)
            const hit = slotEl(row).querySelector('button')!.getBoundingClientRect()
            expect(hit.height).toBeGreaterThanOrEqual(rowH - 0.5)
            expect(hit.width).toBeGreaterThanOrEqual(rowH - 0.5)
            expect(hit.top).toBeGreaterThanOrEqual(row.getBoundingClientRect().top - 0.5)
            expect(hit.bottom).toBeLessThanOrEqual(row.getBoundingClientRect().bottom + 0.5)
        }

        // 7. The header "+" lines up with the page-number column below it.
        await expect(
            Math.abs(
                plusBtn.getBoundingClientRect().right -
                    bmPage.getBoundingClientRect().right,
            ),
        ).toBeLessThanOrEqual(2)

        // 8. A dead outline node (no resolvable destination) still shows a page cell: `p.?`.
        await expect(findByText(brokenRow, /^p\.\?$/)).toBeTruthy()

        // 2. Outline keyboard tree: ONE tab stop (the `role="tree"` container), roving tabindex
        //    (every row is tabindex="-1"), and the full WAI-ARIA tree-view arrow-key map.
        const outlineTreeEl = canvasElement.querySelector(
            '[role="tree"]',
        ) as HTMLElement
        await expect(outlineTreeEl.getAttribute('tabindex')).toBe('0')
        await expect(
            outlineRows(canvasElement).every(
                r => r.getAttribute('tabindex') === '-1',
            ),
        ).toBe(true)
        const pressKey = (key: string) =>
            (document.activeElement as HTMLElement)?.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key,
                    bubbles: true,
                    cancelable: true,
                }),
            )
        outlineTreeEl.focus()
        pressKey('ArrowDown')
        await expect(document.activeElement).toBe(byTitle('Introduction'))
        pressKey('ArrowDown')
        await expect(document.activeElement).toBe(byTitle('Background'))
        pressKey('ArrowDown')
        await expect(document.activeElement).toBe(byTitle('Method'))
        // Method is open — ArrowRight steps INTO its child.
        pressKey('ArrowRight')
        await expect(document.activeElement).toBe(byTitle('Sampling'))
        // Sampling is a leaf — ArrowLeft walks OUT to its parent.
        pressKey('ArrowLeft')
        await expect(document.activeElement).toBe(byTitle('Method'))
        // Method is open — ArrowLeft collapses it; focus stays on Method.
        pressKey('ArrowLeft')
        await expect(document.activeElement).toBe(byTitle('Method'))
        await expect(byTitle('Method').getAttribute('aria-expanded')).toBe(
            'false',
        )
        await expect(outlineRows(canvasElement).length).toBe(5)
        // Re-open it (ArrowRight on a closed node) so the tree is whole again.
        pressKey('ArrowRight')
        await expect(byTitle('Method').getAttribute('aria-expanded')).toBe(
            'true',
        )
        await expect(outlineRows(canvasElement).length).toBe(6)
        pressKey('Home')
        await expect(document.activeElement).toBe(byTitle('Introduction'))
        pressKey('End')
        await expect(document.activeElement).toBe(
            byTitle('Broken destination'),
        )
        // Enter jumps, same as a click.
        byTitle('Findings').focus()
        pressKey('Enter')
        await expect(jumps).toContain(5)
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

        // Task 6 acceptance 5: the disabled "+" is visibly dimmed, not merely inert — the
        // Default story's own plusBtn check proves the enabled side is opacity 1.
        const plusBtn = canvasElement.querySelector(
            'button[aria-label="Bookmark this page"]',
        ) as HTMLButtonElement
        await expect(plusBtn.disabled).toBe(true)
        await expect(Number(getComputedStyle(plusBtn).opacity)).toBeCloseTo(
            0.4,
            1,
        )

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
