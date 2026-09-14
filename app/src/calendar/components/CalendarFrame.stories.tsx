// Visual spec for <CalendarFrame> — the calendar's root column (was `.calendar-app`). The
// frame's button rules are TAG selectors (`.frame button`), not a class reach, and the
// "selected" highlight keys off VBtn's own GLOBAL `.active` class (`:global(.active)`) rather
// than anything the frame defines itself. This story exists to prove that reach still matches
// real VBtn markup now that the rule lives here instead of Calendar.module.css.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import CalendarFrame from './CalendarFrame'
import { VBtn } from '../../ui/ViewBar'

const meta = {
    title: 'Calendar/Components/CalendarFrame',
    component: CalendarFrame,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CalendarFrame>

export default meta
type Story = StoryObj<typeof meta>

/** A 300px-tall frame holding one active and one inactive VBtn — the frame's own button look
 *  (borderless, muted) plus the neutral highlight `:global(.active)` adds on top of it. */
export const Default: Story = {
    render: () => (
        <div style={{ height: '300px' }}>
            <CalendarFrame>
                <VBtn active>ON</VBtn>
                <VBtn>OFF</VBtn>
            </CalendarFrame>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const buttons = [...canvasElement.querySelectorAll('button')]
        const on = buttons.find(b => b.textContent?.trim() === 'ON')!
        const off = buttons.find(b => b.textContent?.trim() === 'OFF')!
        // Fails if the frame's `:global(.active)` rule stops matching VBtn's `.active` class —
        // the "on" and "off" buttons would render with identical backgrounds.
        expect(getComputedStyle(on).backgroundColor).not.toBe(
            getComputedStyle(off).backgroundColor,
        )
    },
}
