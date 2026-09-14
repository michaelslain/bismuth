// Visual spec for <AllDayRow> — the shared all-day/tasks cell row under a DayHeaderRow.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import AllDayRow from './AllDayRow'
import { addDays } from '../../dates'

const meta = {
    title: 'Calendar/Views/AllDayRow',
    component: AllDayRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof AllDayRow>

export default meta
type Story = StoryObj<typeof meta>

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
    },
}
