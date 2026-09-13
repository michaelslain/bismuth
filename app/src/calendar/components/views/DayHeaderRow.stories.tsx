// Visual spec for <DayHeaderRow> — the weekday + date header shared by TimeGrid and
// TaskAllDayStrip. `today` is a prop, never read from the clock, so a story can pin it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import DayHeaderRow from './DayHeaderRow'
import { toDateStr, addDays } from '../../dates'

const meta = {
    title: 'Calendar/Views/DayHeaderRow',
    component: DayHeaderRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DayHeaderRow>

export default meta
type Story = StoryObj<typeof meta>

const anchor = new Date(2026, 8, 1) // a Tuesday
const dates = Array.from({ length: 7 }, (_, i) => addDays(anchor, i))

/** 7 dates, today pinned to the 3rd — exercises the today-circle DayNumber renders inline. */
export const Week: Story = {
    render: () => <DayHeaderRow dates={dates} today={toDateStr(addDays(anchor, 2))} />,
    play: async ({ canvasElement }) => {
        const heads = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="day-header"]')]
        expect(heads).toHaveLength(7)
        // Fails if DayNumber's today circle stops rendering at 20px (a size change, or the
        // `inline`/`today` variant silently not applying) — exactly one header should carry it.
        const withCircle = heads.filter(h => {
            const el = [...h.querySelectorAll<HTMLElement>('span')].find(
                s => Math.round(s.getBoundingClientRect().width) === 20,
            )
            return Boolean(el)
        })
        expect(withCircle).toHaveLength(1)
    },
}
