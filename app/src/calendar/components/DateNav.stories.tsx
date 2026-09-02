// Visual spec for <DateNav> — the calendar toolbar's time cluster (prev/next, Today, and the
// range label). Like Toolbar it reads calendar/state.ts signals rather than props, so a story sets
// them directly.
//
// EVERY STORY HERE IS DELIBERATELY WIDE, and that is now load-bearing. These used to mount at 520px
// and rely on there being no `caltoolbar` container in the ancestry for nothing to collapse. The
// container is `.viewbar` itself now — the bar these stories already render — so 520px put them
// four tiers down and every one showed the ABBREVIATED label. That is the exact opposite of what
// they document: WeekAcrossYears exists to show each end carrying its own year, and the short form
// has no years in it at all. 900px clears the first tier (800px + the bar's 36px of padding), so
// the long form is what renders. The collapsed states are Calendar/Toolbar's Narrow* stories.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import DateNav from './DateNav'
import ViewBar from '../../ui/ViewBar'
import { currentView, currentDate } from '../state'
import { ViewType } from '../types'
import '../Calendar.module.css'

const meta = {
    title: 'Calendar/DateNav',
    component: DateNav,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DateNav>

export default meta
type Story = StoryObj<typeof meta>

function nav(date: Date, view: ViewType) {
    currentDate.value = date
    currentView.value = view
    return (
        <div style={{ width: '900px', 'max-width': 'none' }}>
            <ViewBar locus={<DateNav />} />
        </div>
    )
}

/** Month — the full month name and year. */
export const Month: Story = {
    render: () => nav(new Date(2026, 0, 12), 'month'),
}

/** Week — a day span, with the month named once because both ends agree on it. */
export const Week: Story = { render: () => nav(new Date(2026, 0, 14), 'week') }

/** A week straddling two months: both ends name their month, the year still appears once. */
export const WeekAcrossMonths: Story = {
    render: () => nav(new Date(2026, 0, 28), 'week'),
}

/** A week straddling two years: each end carries its own year. */
export const WeekAcrossYears: Story = {
    render: () => nav(new Date(2025, 11, 31), 'week'),
}

/** 3-day — the same span form over three days. */
export const ThreeDay: Story = {
    render: () => nav(new Date(2026, 0, 12), '3day'),
}

/** Day — the weekday is named, since a single date without it is hard to place. */
export const Day: Story = { render: () => nav(new Date(2026, 0, 12), 'day') }
