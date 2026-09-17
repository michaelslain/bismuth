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
        // Width alone is ambiguous: the weekday name span sizes to its own text at ≈20.7px,
        // which rounds to the same 20 — so also require the height (a non-circular badge would
        // differ) and borderRadius: '50%' (a square swatch that happens to be 20x20 would not).
        const withCircle = heads.filter(h => {
            const el = [...h.querySelectorAll<HTMLElement>('span')].find(s => {
                const rect = s.getBoundingClientRect()
                return (
                    Math.round(rect.width) === 20 &&
                    Math.round(rect.height) === 20 &&
                    getComputedStyle(s).borderRadius === '50%'
                )
            })
            return Boolean(el)
        })
        expect(withCircle).toHaveLength(1)
    },
}

/** With vs without the left time-gutter spacer, side by side — `gutter` defaults true (top,
 *  aligned over a TimeGrid) and the tasks strip is the caller that passes `false` (bottom),
 *  where there is no TimeGrid underneath to align to. */
export const GutterComparison: Story = {
    render: () => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '16px' }}>
            <div>
                <p>gutter (default)</p>
                <DayHeaderRow dates={dates} today={toDateStr(addDays(anchor, 2))} />
            </div>
            <div>
                <p>gutter={'{false}'}</p>
                <DayHeaderRow dates={dates} today={toDateStr(addDays(anchor, 2))} gutter={false} />
            </div>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const rows = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="day-header"]')]
        expect(rows).toHaveLength(14)
        const withGutterFirstChild = rows[0].parentElement!.children[0]
        const withoutGutterFirstChild = rows[7].parentElement!.children[0]
        // The gutter is the row's first child and is not itself a day-header — when omitted,
        // the first child IS the first header instead.
        expect(withGutterFirstChild.getAttribute('data-testid')).not.toBe('day-header')
        expect(withoutGutterFirstChild.getAttribute('data-testid')).toBe('day-header')
    },
}
