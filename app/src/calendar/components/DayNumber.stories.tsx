// Visual spec for <DayNumber> — a day-of-month number, shared by MonthView's cell header,
// TimeGrid's day header and TaskAllDayStrip's day header (was `.cal-today-circle`). `today`
// draws the 20px accent circle; `inline` makes that circle sit inside a run of text (the
// time-grid header's "Sun 9/5" shape) instead of standing alone.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import DayNumber from './DayNumber'

const meta = {
    title: 'Calendar/Components/DayNumber',
    component: DayNumber,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DayNumber>

export default meta
type Story = StoryObj<typeof meta>

/** Four shapes: a plain number (no box at all — an ordinary day), the `today` circle standing
 *  alone (the month cell's header), `today inline` sitting inside a line of text (the
 *  time-grid header's "Sun 9/5" shape), and a plain number carrying a caller's own class
 *  (proves `class` merges onto the root instead of replacing it). */
export const States: Story = {
    render: () => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
            <DayNumber day={5} />
            <DayNumber day={9} today />
            <span>
                Sun 9/<DayNumber day={9} today inline />
            </span>
            <DayNumber day={12} class="caller-class" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const [plain, today, inline] = [
            ...canvasElement.querySelectorAll<HTMLElement>('span'),
        ].filter(s => /^\d+$/.test(s.textContent ?? ''))
        // Fails if the plain number picks up a fixed width/circle it should not have.
        expect(plain.getBoundingClientRect().width).toBeLessThan(20)
        // Fails if the today circle loses its fixed 20x20 size.
        expect(Math.round(today.getBoundingClientRect().width)).toBe(20)
        expect(Math.round(today.getBoundingClientRect().height)).toBe(20)
        // Fails if `.root.today` stops drawing a circle.
        expect(getComputedStyle(today).borderRadius).toBe('50%')
        // Fails if the inline variant reverts to block `display: grid`, which would break the
        // header's text line instead of sitting inside it.
        expect(getComputedStyle(inline).display).toBe('inline-grid')
    },
}
