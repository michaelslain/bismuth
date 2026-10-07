// Visual spec for <AllDayRow> — the shared all-day/tasks cell row under a DayHeaderRow.
import { For } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import AllDayRow from './AllDayRow'
import { addDays } from '../../dates'
import { todayISO } from '../../../../../core/src/dates'
import { EventChip } from '../EventChip'
import { EventStore, MemoryBackend } from '../../EventStore'
import Text from '../../../ui/Text'
import type { CalendarEvent } from '../../types'

const meta = {
    title: 'Calendar/Views/AllDayRow',
    component: AllDayRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof AllDayRow>

export default meta
type Story = StoryObj<typeof meta>

// Derived corners: a corner exists where both of its edges are drawn, and `data-edges` (the
// primitive's runtime hook) is the contract the count reads.
const corners = (root: ParentNode, v: 'top' | 'bottom', h: 'left' | 'right') =>
    root.querySelectorAll(`[data-edges~="${v}"][data-edges~="${h}"]`).length

const anchor = new Date(2026, 8, 1)
const dates = Array.from({ length: 5 }, (_, i) => addDays(anchor, i))

/** `fill` inside a 300px-tall flex column — the tasks register's only row, so it must grow to
 *  the bottom of its parent instead of sitting content-sized with a blank void below. */
export const FillsParent: Story = {
    render: () => (
        <div
            data-testid="parent"
            style={{ display: 'flex', 'flex-direction': 'column', height: '300px' }}
        >
            <AllDayRow fill dates={dates} cell={() => <div>task</div>} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const parent = canvasElement.querySelector<HTMLElement>('[data-testid="parent"]')!
        const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="allday-cell"]')]
        expect(cells).toHaveLength(5)
        const parentBottom = parent.getBoundingClientRect().bottom
        // Fails if `fill` stops growing the row (reverts to content-sized) — the row's bottom
        // would sit well above the parent's, leaving a blank void below it.
        expect(Math.abs(cells[0].parentElement!.getBoundingClientRect().bottom - parentBottom)).toBeLessThanOrEqual(1)
        // typed as an ASCII grid: this is the band's last row, so every cell closes its bottom, and
        // its top belongs to the header above (none here)
        expect(corners(canvasElement, 'bottom', 'left')).toBe(5)
        expect(corners(canvasElement, 'top', 'left')).toBe(0)
        expect(corners(canvasElement, 'bottom', 'right')).toBe(1)
        cells.forEach(c => expect(getComputedStyle(c).borderLeftWidth).toBe('0px'))
    },
}

/** With vs without the left time-gutter spacer, side by side — `gutter` defaults true (left)
 *  and the tasks strip is the caller that passes `false` (right), where there is no TimeGrid
 *  underneath to align to. */
export const GutterComparison: Story = {
    render: () => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '16px' }}>
            <div>
                <Text as="p">gutter (default)</Text>
                <AllDayRow dates={dates} cell={() => <div>task</div>} />
            </div>
            <div>
                <Text as="p">gutter={'{false}'}</Text>
                <AllDayRow dates={dates} cell={() => <div>task</div>} gutter={false} />
            </div>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const rows = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="allday-cell"]')]
        expect(rows).toHaveLength(10)
        const withGutter = canvasElement.querySelectorAll('[data-testid="allday-cell"]')[0]
            .parentElement!.children[0]
        const withoutGutter = canvasElement.querySelectorAll('[data-testid="allday-cell"]')[5]
            .parentElement!.children[0]
        // The gutter is the row's first child and is not itself an allday-cell — when omitted,
        // the first child IS the first cell instead.
        expect(withGutter.getAttribute('data-testid')).not.toBe('allday-cell')
        expect(withoutGutter.getAttribute('data-testid')).toBe('allday-cell')
    },
}

const store = new EventStore(new MemoryBackend())
const allDay = (id: string, date: string): CalendarEvent => ({ id, title: `All day ${id}`, date })

/** A real all-day chip in every column of a `backdrop`ed row (the sticky strip over the time grid).
 *  The NEXT cell's --bg ring hangs half a corner tile back over this cell, so a chip sitting closer
 *  than that to its own right edge had its 1px right border painted over — in every column but the
 *  last, which has no next cell (that asymmetry is the tell). Measured from the ring's own box, so it
 *  fails the moment the inset stops clearing it. */
export const ChipBordersClearTheNeighboursBackdrop: Story = {
    render: () => (
        <AllDayRow
            backdrop
            gutter={false}
            dates={dates}
            cell={ds => <EventChip event={allDay(ds, ds)} categories={[]} store={store} />}
        />
    ),
    play: async ({ canvasElement }) => {
        const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="allday-cell"]')]
        expect(cells).toHaveLength(5)
        cells.forEach((cell, i) => {
            const chip = cell.querySelector<HTMLElement>('[data-testid="event-chip"]')!
            expect(chip, `column ${i} has a chip`).toBeTruthy()
            const cs = getComputedStyle(chip)
            expect(cs.borderRightWidth, `column ${i} right border`).toBe('1px')
            expect(cs.borderRightStyle).toBe('solid')
            const next = cells[i + 1]
            // the last column has no next cell, so it never lost its border: ASSERT ON THE OTHERS
            if (!next) return
            const ring = next.querySelector<HTMLElement>('[data-backdrop]')!
            expect(ring, `column ${i + 1} paints a backdrop ring`).toBeTruthy()
            expect(
                chip.getBoundingClientRect().right,
                `column ${i}'s chip must end left of column ${i + 1}'s backdrop ring`,
            ).toBeLessThanOrEqual(ring.getBoundingClientRect().left)
        })
    },
}

/** A day with a dozen all-day events. The row is sticky above the hour grid, so left uncapped it
 *  would pin more chrome than the pane holds; instead the day's own column scrolls past six
 *  --row-h rows, and the other (empty) columns keep the row's minimum. */
export const CapsAtSixRowsAndScrolls: Story = {
    render: () => (
        <AllDayRow
            backdrop
            gutter={false}
            dates={dates}
            cell={ds => (
                <For each={ds === todayISO(dates[0]) ? Array.from({ length: 12 }, (_, n) => n) : []}>
                    {n => <EventChip event={allDay(`${n}`, ds)} categories={[]} store={store} />}
                </For>
            )}
        />
    ),
    play: async ({ canvasElement }) => {
        const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="allday-cell"]')]
        const busy = cells[0]
        const content = busy.firstElementChild as HTMLElement
        const rowH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h'))
        expect(rowH, '--row-h resolves').toBeGreaterThan(0)
        expect(busy.querySelectorAll('[data-testid="event-chip"]')).toHaveLength(12)
        // the content box is capped at a whole number of rows and scrolls itself
        expect(content.clientHeight).toBeLessThanOrEqual(6 * rowH + 0.5)
        expect(content.scrollHeight, 'twelve chips overflow the cap').toBeGreaterThan(content.clientHeight)
        expect(getComputedStyle(content).overflowY).toBe('auto')
        // ...and the whole row stays that short: a capped cell plus its padding, not twelve chips
        const row = busy.parentElement!.getBoundingClientRect()
        const pad = parseFloat(getComputedStyle(busy).paddingTop) + parseFloat(getComputedStyle(busy).paddingBottom)
        expect(row.height).toBeLessThanOrEqual(6 * rowH + pad + 0.5)
        // an empty day does not grow with its neighbour's scroll
        cells.slice(1).forEach(c => expect(c.getBoundingClientRect().height).toBeCloseTo(row.height, 0))
    },
}
