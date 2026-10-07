// Visual spec for <DayHeaderRow> — the weekday + date header shared by TimeGrid and
// TaskAllDayStrip. `today` is a prop, never read from the clock, so a story can pin it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import DayHeaderRow from './DayHeaderRow'
import { addDays } from '../../dates'
import { todayISO } from '../../../../../core/src/dates'

const meta = {
    title: 'Calendar/Views/DayHeaderRow',
    component: DayHeaderRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DayHeaderRow>

export default meta
type Story = StoryObj<typeof meta>

// Derived corners: a corner exists where both of its edges are drawn, and `data-edges` (the
// primitive's runtime hook) is the contract the count reads.
const corners = (root: ParentNode, v: 'top' | 'bottom', h: 'left' | 'right') =>
    root.querySelectorAll(`[data-edges~="${v}"][data-edges~="${h}"]`).length

const anchor = new Date(2026, 8, 1) // a Tuesday
const dates = Array.from({ length: 7 }, (_, i) => addDays(anchor, i))

/** 7 dates, today pinned to the 3rd — exercises the today-circle DayNumber renders inline. */
export const Week: Story = {
    render: () => <DayHeaderRow dates={dates} today={todayISO(addDays(anchor, 2))} />,
    play: async ({ canvasElement }) => {
        const heads = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="day-header"]')]
        expect(heads).toHaveLength(7)
        // Fails if DayNumber's today circle stops rendering one --row-h row square (a size change,
        // or the `inline`/`today` variant silently not applying) — exactly one header should carry
        // it. Width alone is ambiguous (the weekday name span sizes to its own text, ≈20px), so
        // also require the height (a non-circular badge would differ) and borderRadius: '50%' (a
        // square swatch of the same size would not).
        const rowH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h'))
        const withCircle = heads.filter(h => {
            const el = [...h.querySelectorAll<HTMLElement>('span')].find(s => {
                const rect = s.getBoundingClientRect()
                return (
                    Math.round(rect.width) === rowH &&
                    Math.round(rect.height) === rowH &&
                    getComputedStyle(s).borderRadius === '50%'
                )
            })
            return Boolean(el)
        })
        expect(withCircle).toHaveLength(1)
        // typed as an ASCII grid: every header types a top-left and a bottom-left corner (its
        // bottom is the heavy `=` under the labels), and only the LAST adds the right ones
        expect(corners(canvasElement, 'bottom', 'left')).toBe(7)
        expect(corners(canvasElement, 'bottom', 'right')).toBe(1)
        // the line under every label is the heavy `=`, one per header cell
        heads.forEach(h => expect(h.querySelector('[data-heavy~="bottom"]')).toBeTruthy())
        heads.forEach(h => expect(getComputedStyle(h).borderLeftWidth).toBe('0px'))
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
                <DayHeaderRow dates={dates} today={todayISO(addDays(anchor, 2))} />
            </div>
            <div>
                <p>gutter={'{false}'}</p>
                <DayHeaderRow dates={dates} today={todayISO(addDays(anchor, 2))} gutter={false} />
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
