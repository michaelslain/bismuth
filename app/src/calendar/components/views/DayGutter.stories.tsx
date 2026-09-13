// Visual spec for <DayGutter> — the 54px left gutter column that aligns a day view's
// header/all-day rows with TimeGrid's hour labels (was `.time-gutter`).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import DayGutter from './DayGutter'

const meta = {
    title: 'Calendar/Views/DayGutter',
    component: DayGutter,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DayGutter>

export default meta
type Story = StoryObj<typeof meta>

/** Mounted in a flex row, same as every real caller — proves the fixed 54px width holds under
 *  flex layout rather than only in isolation. */
export const Default: Story = {
    render: () => (
        <div style={{ display: 'flex' }} data-testid="row">
            <DayGutter />
            <div style={{ flex: 1 }}>content</div>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector<HTMLElement>('[data-testid="row"]')!
        const gutter = row.firstElementChild as HTMLElement
        // Fails if the gutter's fixed width rule is dropped, changed, or overridden by the
        // flex row it sits in.
        expect(Math.round(gutter.getBoundingClientRect().width)).toBe(54)
    },
}
