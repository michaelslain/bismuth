// Visual spec for <CalendarFrame> — the calendar's root column (was `.calendar-app`). It used to
// restyle every `<button>` inside it by tag, keyed on VBtn's own `data-active` hook; that reach is
// gone (one-button Task 2) now that every button in the calendar is a Button-family component with
// its own look. This story proves the frame adds nothing of its own: a selected and an unselected
// IconTextButton still read apart inside it, because Button's own state colours do, not because of
// anything CalendarFrame declares.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import CalendarFrame from './CalendarFrame'
import { IconTextButton } from '../../ui/IconTextButton'

const meta = {
    title: 'Calendar/Components/CalendarFrame',
    component: CalendarFrame,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CalendarFrame>

export default meta
type Story = StoryObj<typeof meta>

/** A 300px-tall frame holding one selected and one unselected IconTextButton. */
export const Default: Story = {
    render: () => (
        <div style={{ height: '300px' }}>
            <CalendarFrame>
                <IconTextButton icon="Tag" variant="selected">
                    on
                </IconTextButton>
                <IconTextButton icon="Tag" variant="unselected">
                    off
                </IconTextButton>
            </CalendarFrame>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const buttons = [...canvasElement.querySelectorAll('button')]
        const on = buttons.find(b => b.textContent?.trim() === 'on')!
        const off = buttons.find(b => b.textContent?.trim() === 'off')!
        // The selected/unselected colours come from Button.module.css, not from CalendarFrame —
        // proving they still differ here confirms the frame isn't clobbering Button's own look
        // (the defect the deleted `.frame button` tag rule would have reintroduced).
        expect(getComputedStyle(on).color).not.toBe(getComputedStyle(off).color)
    },
}
