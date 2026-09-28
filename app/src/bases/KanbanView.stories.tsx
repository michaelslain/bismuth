// Visual spec for <KanbanView> — the Trello-style board renderer. Exercises `sampleViewResult`
// end to end: real rows, run through the real query engine (core/src/bases/query.ts `runView`)
// with a `groupBy`, rendered by the real KanbanView component. `onChange` is a required prop
// (fired after a write); a no-op here since nothing in these stories persists.
//
// Board rendering + column colour/palette only — column add/rename/delete/reorder lives in
// KanbanColumns.stories.tsx, own-rows/row-write behaviour in KanbanStoredRows.stories.tsx.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { onCleanup } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { KanbanView } from './KanbanView'
import {
    SAMPLE_ROWS,
    sampleBaseConfig,
    sampleViewResult,
} from '../ui/_baseFixtures'
import { BaseView } from './BaseView'
import { setTransport } from '../api'
import { disarmFakeServerVersion, fakeTransport } from '../ui/_fakeTransport'
import { kanbanViews } from '../ui/_kanbanProbes'
import { spiedTransport } from '../ui/_kanbanSpiedTransport'

const meta = {
    title: 'Bases/KanbanView',
    component: KanbanView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof KanbanView>

export default meta
type Story = StoryObj<typeof meta>

// The ColorChip labels each palette entry by its token (`var(--graph-1)` reads `graph-1`).
const PALETTE_NAMES = [0, 1, 2, 3, 4].map(n => `graph-${n}`)

const noop = () => {}

/** Every column's card list (`[data-kbcol]`'s last child) must not overflow when its cards fit —
 *  a list whose scrollHeight exceeds its clientHeight paints a scrollbar with nothing to scroll.
 *  Round-2 item 8: the trailing collapsed drop placeholder's negative margin-bottom made a
 *  read-only two-card column measure 200 vs 193. */
async function expectNoPhantomScroll(canvasElement: HTMLElement) {
    await waitFor(() =>
        expect(
            canvasElement.querySelectorAll('[data-kbcol]').length,
        ).toBeGreaterThan(0),
    )
    const lists = [
        ...canvasElement.querySelectorAll<HTMLElement>('[data-kbcol]'),
    ].map(col => col.lastElementChild as HTMLElement)
    for (const list of lists) {
        expect(list.scrollHeight).toBeLessThanOrEqual(list.clientHeight)
        expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth)
    }
}

/** Grouped by `status` (required for kanban — without a `groupBy` the view renders a hint
 *  instead of a board) with `order` set so each card shows its `priority`/`tags` meta chips.
 *  No `basePath` -> read-only board (no drag/add composer, and no header `[✎][🗑]` — there is
 *  nothing it could write to), matching an embedded ```query kanban. */
export const Default: Story = {
    render: () => {
        const views = kanbanViews()
        return (
            <KanbanView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        await expectNoPhantomScroll(canvasElement)
    },
}

/** A `basePath` makes the board editable (per-column "+" add-card composer, draggable cards/
 *  headers) and `columns` pins declared column keys as visible even when empty — "Blocked" has
 *  no cards here but stays on the board. */
export const EditableWithPinnedColumns: Story = {
    render: () => {
        const views = kanbanViews({
            groupOrder: ['Todo', 'Doing', 'Blocked', 'Done'],
        })
        return (
            <KanbanView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
                basePath="stories/kanban-demo.md"
                onChange={noop}
            />
        )
    },
}

/** Hovering a column reveals its header's `[✎]` rename and `[🗑]` delete (every column except
 *  the no-value "(empty)" lane) without moving the title or the count: the bar is hung off the
 *  count's left edge, so at rest the count sits flush against the header's right edge. The hover
 *  is the whole column, not just the header strip. `userEvent.hover` is synthetic (CSS `:hover`
 *  never sees it), so this exercises the `data-hover` half of the reveal; the `:hover` half was
 *  proven with real CDP pointer moves (round-2 item 9). */
const TRY_PATH = 'stories/kanban-try.md'
const TRY_BODY = [
    '---',
    'type: base',
    'views:',
    '  - type: kanban',
    '    name: Kanban',
    '    groupBy: status',
    '    order: [priority, tags]',
    '    columns: [Todo, Doing, Blocked, Done]',
    '---',
    '',
].join('\n')

export const HeaderActionsOnHover: Story = {
    // A real BaseView over a stateful fake store (the gallery's): rename, delete and Undo all
    // write, the version bumps, the board refetches — so trying the buttons by hand works.
    render: () => {
        setTransport(
            fakeTransport({
                rows: JSON.parse(JSON.stringify(SAMPLE_ROWS)),
                versioned: true,
                files: { [TRY_PATH]: TRY_BODY },
            }),
        )
        onCleanup(disarmFakeServerVersion)
        return (
            <div
                style={{
                    height: '520px',
                    display: 'flex',
                    'flex-direction': 'column',
                }}
            >
                <BaseView path={TRY_PATH} body={TRY_BODY} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const col = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>(
                '[data-kbcol="Blocked"]',
            )
            expect(el).not.toBeNull()
            return el!
        })
        // Measure after the UI font lands — a late font swap re-measures the count's digits.
        await document.fonts.ready
        const header = col.firstElementChild as HTMLElement
        const bar = within(col).getByRole('toolbar', { name: 'Column actions' })
        const count = within(header).getByText('00')
        const rect = (el: Element) => el.getBoundingClientRect()

        // At rest: hidden, and the count sits flush right (no gap reserved for the bar).
        expect(getComputedStyle(bar).opacity).toBe('0')
        expect(
            Math.abs(rect(header).right - rect(count).right),
        ).toBeLessThanOrEqual(1)
        const countLeft = rect(count).left

        await userEvent.hover(col)
        await waitFor(() => expect(getComputedStyle(bar).opacity).toBe('1'))
        expect(getComputedStyle(bar).pointerEvents).toBe('auto')
        expect(getComputedStyle(bar).visibility).toBe('visible')
        const rename = within(bar).getByLabelText('Rename column')
        const del = within(bar).getByLabelText('Delete column')
        for (const b of [rename, del]) {
            expect(rect(b).width).toBeGreaterThan(0)
            expect(rect(b).height).toBeGreaterThan(0)
        }
        // Revealing it moved nothing, and it sits left of the count, not over it.
        expect(Math.abs(rect(count).left - countLeft)).toBeLessThan(0.5)
        expect(rect(bar).right).toBeLessThanOrEqual(countLeft)

        await userEvent.unhover(col)
        await waitFor(() => expect(getComputedStyle(bar).opacity).toBe('0'))

        // A non-empty column offers BOTH rename and delete (round-3 item 3 — deleting it clears
        // the grouping value off its cards instead of refusing).
        const todo = canvasElement.querySelector<HTMLElement>(
            '[data-kbcol="Todo"]',
        )!
        await userEvent.hover(todo)
        const todoBar = within(todo).getByRole('toolbar', {
            name: 'Column actions',
        })
        await waitFor(() => expect(getComputedStyle(todoBar).opacity).toBe('1'))
        expect(within(todoBar).queryByLabelText('Delete column')).not.toBeNull()
        await userEvent.unhover(todo)
        await waitFor(() => expect(getComputedStyle(todoBar).opacity).toBe('0'))
        await expectNoPhantomScroll(canvasElement)
    },
}

/** No `groupBy` on the view — the board falls back to a `Callout` hint instead of columns.
 *  Asserted rather than left to a screenshot: the hint's copy renders, proving the fallback path
 *  is the real `Callout` component (its module class) and not a bare div. */
export const NoGroupBy: Story = {
    render: () => {
        const views = [
            {
                type: 'kanban' as const,
                name: 'Kanban',
            },
        ]
        return (
            <KanbanView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const hint = await canvas.findByText(/needs a "group by" property/)
        expect(hint.closest('[class*="callout"]')).not.toBeNull()
    },
}

// Captured by ColorPickerPickAndDismiss's render() and read back in its play().
let colorPickerPickAndDismissCalls: { path: string; body: unknown }[] = []

/** The column colour picker — `ui/ColorChip`: a swatch laid over the header's StatusDot opens a
 *  palette popover that is PORTALED (not a descendant of `canvasElement`), so queries for it go
 *  through `body`, not `canvas`. It lists an `auto` entry plus the five graph colours, each
 *  labelled by its token (`graph-1`). Needs `basePath` (`editable()`) for the trigger to exist.
 *  The first column ("Doing" — the data's own first-seen status value, no `groupOrder` pins it)
 *  has no override set, so no swatch shows the `selected` ring — only `auto` reads pressed.
 *
 *  play() proves: the panel opens anchored BELOW its trigger and stays open — this story's
 *  baseline shot IS the open panel. Picking and dismissing is ColorPickerPickAndDismiss below. */
export const ColorPickerOpen: Story = {
    render: () => {
        const views = kanbanViews()
        setTransport(fakeTransport())
        return (
            <KanbanView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
                basePath="stories/kanban-demo.md"
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        const dot = canvas.getAllByLabelText('Choose colour')[0]!

        await userEvent.click(dot)
        const panel = await body.findByTestId('category-palette')
        expect(panel).toBeVisible()
        // Anchored BELOW the trigger: the panel's top sits at/after the trigger's own bottom
        // edge — never overlapping or above it.
        const dotRect = dot.getBoundingClientRect()
        const panelRect = panel.getBoundingClientRect()
        expect(panelRect.top).toBeGreaterThanOrEqual(dotRect.bottom)

        const auto = await body.findByRole('button', { name: 'auto' })
        expect(auto).toBeVisible()
        expect(auto).toHaveAttribute('aria-pressed', 'true')
        const swatches = PALETTE_NAMES.map(name => {
            const el = body.getByRole('button', { name })
            expect(el).toBeVisible()
            expect(el).toHaveAttribute('title', name)
            return el
        })
        expect(swatches.length).toBe(5)
    },
}

/** Same board as ColorPickerOpen, but its play() carries the picker through to closed: picking
 *  a swatch calls the real column-colour setter (`api.setViewProperty` → POST `/set-property`,
 *  `groupColors`) and closes the popover, then reopening and pressing Escape dismisses it too
 *  (AnchoredPopover's own window keydown listener, not a handler KanbanView owns). Its baseline
 *  shot shows no picker — that is the point of this story, as opposed to ColorPickerOpen's. */
export const ColorPickerPickAndDismiss: Story = {
    render: () => {
        const views = kanbanViews()
        const { transport, calls } = spiedTransport()
        colorPickerPickAndDismissCalls = calls
        setTransport(transport)
        return (
            <KanbanView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
                basePath="stories/kanban-demo.md"
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        const dot = canvas.getAllByLabelText('Choose colour')[0]!

        await userEvent.click(dot)
        await body.findByTestId('category-palette')
        const violet = body.getByRole('button', { name: 'graph-1' })

        // Picking a swatch calls the real setter and closes the popover. The first column here
        // (no explicit `groupOrder`) is "Doing" — the data's own first-seen status value, not
        // alphabetical or declaration order (ColorPickerOpenThirdColumn below pins order via
        // `groupOrder` instead, which is why that one CAN name its column).
        await userEvent.click(violet)
        expect(colorPickerPickAndDismissCalls).toContainEqual({
            path: '/set-property',
            body: {
                path: 'stories/kanban-demo.md',
                viewIndex: 0,
                key: 'groupColors',
                value: { Doing: 'var(--graph-1)' },
            },
        })
        await waitFor(() =>
            expect(body.queryByTestId('category-palette')).toBeNull(),
        )

        // Escape dismisses it too (AnchoredPopover's own window keydown listener).
        await userEvent.click(dot)
        await body.findByTestId('category-palette')
        await userEvent.keyboard('{Escape}')
        await waitFor(() =>
            expect(body.queryByTestId('category-palette')).toBeNull(),
        )
    },
}

/** Same board, opened on the THIRD column ("Done") instead of the first — proves the popover
 *  anchors to the column it belongs to, not always the leftmost one. "Done" also matches a
 *  known status color (STATUS_COLOR), so no override is set yet none of the five swatches is
 *  "selected" either — that color didn't come from this palette. */
export const ColorPickerOpenThirdColumn: Story = {
    render: () => {
        const views = kanbanViews({ groupOrder: ['Todo', 'Doing', 'Done'] })
        return (
            <KanbanView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
                basePath="stories/kanban-demo.md"
                onChange={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        const dots = canvas.getAllByLabelText('Choose colour')
        expect(dots.length).toBeGreaterThanOrEqual(3)
        await userEvent.click(dots[2]!)
        const auto = await body.findByRole('button', { name: 'auto' })
        expect(auto).toBeVisible()
    },
}

// 12 rows, all in "Todo" — the count crosses into two digits (Acceptance 3's `padCount`) and
// the column itself grows taller than the board, so it scrolls its OWN `.kanbanCards` instead
// of the header moving (see KanbanView.module.css's `.kanbanCards` comment).
const MANY_CARDS_ROWS = Array.from({ length: 12 }, () => ({
    note: { status: 'Todo', priority: 1, tags: [] as string[] },
}))

/** A column with 12+ cards: the header count reads `12`, not `2` or `012` — `padCount` pads a
 *  single digit to two and leaves three-plus digits alone — and the column scrolls internally
 *  rather than growing past the board's own height. The host caps the board's height the way an
 *  editor pane does: without a cap the board grows to its tallest column and nothing ever
 *  overflows — this story's scroll assertion used to pass only on the 7px phantom overflow the
 *  trailing drop placeholder caused (round-2 item 8), not on real overflow. */
export const ManyCardsInOneColumn: Story = {
    render: () => {
        const views = kanbanViews()
        return (
            <div
                style={{
                    height: '420px',
                    display: 'flex',
                    'flex-direction': 'column',
                }}
            >
                <KanbanView
                    result={sampleViewResult(MANY_CARDS_ROWS, { views })}
                    config={sampleBaseConfig({ views })}
                    onChange={noop}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const col = canvasElement.querySelector<HTMLElement>(
            '[data-kbcol="Todo"]',
        )!
        expect(within(col).getByText('12')).toBeVisible()
        const cardsEl = col.querySelector<HTMLElement>(
            '[class*="kanbanCards"]',
        )!
        expect(cardsEl.scrollHeight).toBeGreaterThan(cardsEl.clientHeight)
        expect(canvas.getAllByTestId('kanban-card').length).toBe(
            MANY_CARDS_ROWS.length,
        )
    },
}
