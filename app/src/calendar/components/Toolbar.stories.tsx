// Visual spec for <Toolbar> — the calendar header bar (Today / prev-next / date-range label /
// view switcher / Categories toggle / + Event). It takes NO props at all — every bit of it
// (currentView, currentDate, showCategoryPanel) is read from calendar/state.ts module-level
// signals, so a story sets those directly instead of passing props.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Toolbar } from './Toolbar'
import ViewBar, { Crumb, ViewBarSpacer } from '../../ui/ViewBar'
import IconButton from '../../ui/IconButton'
import { currentView, currentDate, showCategoryPanel } from '../state'
import '../Calendar.module.css'

const meta = {
    title: 'Calendar/Toolbar',
    component: Toolbar,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof Toolbar>

export default meta
type Story = StoryObj<typeof meta>

/** Month view, mid-January — the crumb reads "January 2026". */
export const Default: Story = {
    render: () => {
        currentDate.value = new Date(2026, 0, 12)
        currentView.value = 'month'
        showCategoryPanel.value = false
        return <Toolbar />
    },
}

/** Week view with the Categories panel toggled open — the crumb switches to a date-range
 *  label and both the segmented view toggle and the Categories button show their active
 *  (pressed) state. */
export const WeekViewActive: Story = {
    render: () => {
        currentDate.value = new Date(2026, 0, 14)
        currentView.value = 'week'
        showCategoryPanel.value = true
        return <Toolbar />
    },
}

/** INLINE — the shape a calendar base actually renders. BaseView owns the single <ViewBar> and
 *  drops the calendar's controls into it (`<Toolbar inline />`), instead of the calendar rendering
 *  a second bar underneath BaseView's own. This story reproduces BaseView's composition — crumb and
 *  view tabs on the left, the calendar's controls, then the spacer and the gear/source buttons — so
 *  the merged bar has coverage even though BaseView itself has no story.
 *
 *  Compare against Default above: that is the STANDALONE bar, which is what you would get without
 *  base chrome around it. The two used to be stacked on top of each other. */
export const InlineInABaseBar: Story = {
    render: () => {
        currentDate.value = new Date(2026, 0, 14)
        currentView.value = 'week'
        showCategoryPanel.value = false
        return (
            <ViewBar>
                <Crumb icon="Table">Calendar</Crumb>
                <Toolbar inline />
                <ViewBarSpacer />
                <IconButton icon="Settings" label="Settings" size="sm" />
                <IconButton icon="Code" label="Source" size="sm" />
            </ViewBar>
        )
    },
}
