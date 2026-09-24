// Visual spec for <KanbanView> — the Trello-style board renderer. Exercises `sampleViewResult`
// end to end: real rows, run through the real query engine (core/src/bases/query.ts `runView`)
// with a `groupBy`, rendered by the real KanbanView component. `onChange` is a required prop
// (fired after a write); a no-op here since nothing in these stories persists.
//
// Board rendering + column colour/palette only — column add/rename/delete/reorder lives in
// KanbanColumns.stories.tsx, own-rows/row-write behaviour in KanbanStoredRows.stories.tsx.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { KanbanView } from './KanbanView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { kanbanViews } from '../ui/_kanbanProbes'
import { spiedTransport } from '../ui/_kanbanSpiedTransport'
import { PALETTE_NAMES } from './kanbanPalette'

const meta = {
    title: 'Bases/KanbanView',
    component: KanbanView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof KanbanView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** Grouped by `status` (required for kanban — without a `groupBy` the view renders a hint
 *  instead of a board) with `order` set so each card shows its `priority`/`tags` meta chips.
 *  No `basePath` -> read-only board (no drag/add composer), matching an embedded ```query
 *  kanban. */
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
        const hint = await canvas.findByText(/needs a "groupBy" property/)
        expect(hint.closest('[class*="callout"]')).not.toBeNull()
    },
}

// Captured by ColorPickerPickAndDismiss's render() and read back in its play().
let colorPickerPickAndDismissCalls: { path: string; body: unknown }[] = []

/** The column colour picker — Task 6: composes `ui/AnchoredPopover` (the same primitive
 *  KanbanColumnMenu's `…` menu uses), so its content is PORTALED, not a descendant of
 *  `canvasElement` — queries for it go through `body`, not `canvas`, same pattern
 *  KanbanColumnMenu.stories.tsx uses. Clicking a column's colour dot reveals the palette
 *  `Swatch`es (each aria-labelled by its colour name, e.g. "rose") plus the "Auto" option that
 *  clears an override. Needs `basePath` (`editable()`) for the dot button to be enabled at all.
 *  The first column ("Doing" — the data's own first-seen status value, no `groupOrder` pins it)
 *  has no override set, so no swatch shows the `selected` ring — only Auto reads pressed, exactly
 *  one control marked at a time.
 *
 *  play() proves: the panel opens anchored BELOW its trigger (not the old fixed backdrop popup),
 *  and stays open — this story's baseline shot IS the open panel. The picking/dismissing
 *  behaviour is proved by ColorPickerPickAndDismiss below, which leaves the panel closed. */
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
        const dot = canvas.getAllByTitle('Column color')[0]!

        await userEvent.click(dot)
        const panel = await body.findByTestId('kanban-color-picker')
        expect(panel).toBeVisible()
        // Anchored BELOW the trigger: the panel's top sits at/after the trigger's own bottom
        // edge — never overlapping or above it.
        const dotRect = dot.getBoundingClientRect()
        const panelRect = panel.getBoundingClientRect()
        expect(panelRect.top).toBeGreaterThanOrEqual(dotRect.bottom)

        const auto = await body.findByRole('button', { name: 'Auto' })
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
        const dot = canvas.getAllByTitle('Column color')[0]!

        await userEvent.click(dot)
        await body.findByTestId('kanban-color-picker')
        const violet = body.getByRole('button', { name: 'violet' })

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
            expect(body.queryByTestId('kanban-color-picker')).toBeNull(),
        )

        // Escape dismisses it too (AnchoredPopover's own window keydown listener).
        await userEvent.click(dot)
        await body.findByTestId('kanban-color-picker')
        await userEvent.keyboard('{Escape}')
        await waitFor(() =>
            expect(body.queryByTestId('kanban-color-picker')).toBeNull(),
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
        const dots = canvas.getAllByTitle('Column color')
        expect(dots.length).toBeGreaterThanOrEqual(3)
        await userEvent.click(dots[2]!)
        const auto = await body.findByRole('button', { name: 'Auto' })
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
 *  rather than growing past the board's own height. */
export const ManyCardsInOneColumn: Story = {
    render: () => {
        const views = kanbanViews()
        return (
            <KanbanView
                result={sampleViewResult(MANY_CARDS_ROWS, { views })}
                config={sampleBaseConfig({ views })}
                onChange={noop}
            />
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
        expect(
            canvas.getAllByTestId('kanban-card').length,
        ).toBe(MANY_CARDS_ROWS.length)
    },
}
