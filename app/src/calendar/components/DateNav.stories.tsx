// Visual spec for <DateNav> — the calendar toolbar's time cluster (prev/next, Today, and the
// range label). Like Toolbar it reads calendar/state.ts signals rather than props, so a story sets
// them directly.
//
// These stories mount it WITHOUT the toolbar's container, which is deliberate: with no
// `caltoolbar` container in the ancestry no container query matches, so every story here shows the
// full, uncollapsed cluster. That is also the guarantee the `.short { display: none }` default in
// DateNav.module.css buys — a bare mount renders the long label, never the abbreviation. The
// collapsed states are covered by Calendar/Toolbar's Narrow* stories, which supply the container.
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
        <div style={{ width: '520px', 'max-width': '100%' }}>
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
