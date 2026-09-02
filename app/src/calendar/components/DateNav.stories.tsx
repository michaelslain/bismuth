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
//
// THE ONE EXCEPTION is the `*Abbreviated` / `*CrossingYear` pair below, which mount at 600px on
// purpose: `rangeLabel` special-cases MONTH and a year-crossing WEEK, and at 900px neither branch
// produces output that differs from the general case, so the wide stories cannot cover them.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
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

/** Same composition as `nav()`, at 600px instead of 900px — a 564px `.viewbar` content box (600
 *  minus the bar's 36px of padding, see ui/ui.css's own note on this). That sits under the 640px
 *  ABBREVIATE tier (measured against `.viewbar`'s content box, ui/ui.css:520-536) and above the
 *  480px tier that starts dropping whole words next, so the range label is shortened here and
 *  nothing else in the bar has moved yet — exactly the band `*Abbreviated`/`*CrossingYear` need. */
function navNarrow(date: Date, view: ViewType) {
    currentDate.value = date
    currentView.value = view
    return (
        <div style={{ width: '600px', 'max-width': 'none' }}>
            <ViewBar locus={<DateNav />} />
        </div>
    )
}

const shown = (el: Element | null) =>
    !!el && !!(el as HTMLElement).getClientRects().length

/** What the range label is actually SHOWING. Both lengths sit in the DOM at every width — BarLabel
 *  renders `long` and `short` unconditionally and lets CSS pick one — so `range.textContent` reads
 *  "January 2026Jan 2026" forever, concatenated, regardless of which tier is active. Reading only
 *  the span with a client rect is Calendar/Toolbar.stories.tsx's own fix for the identical trap
 *  (see its `visible()`), reproduced here because it is one function and not worth importing a
 *  test-only helper across component files for. */
const visibleRange = (canvasElement: HTMLElement) =>
    [...canvasElement.querySelectorAll('[data-testid="range"] [data-bar-abbr]')]
        .filter(shown)
        .map(n => n.textContent)
        .join('')

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

/** ABBREVIATED OUTPUT, ON PURPOSE (queue item 9). Every other story here is 900px so its labels
 *  render in full — see the header. That widening removed the ACCIDENTAL coverage the old 520px
 *  wrapper used to give `rangeLabel`'s two special-cased shapes, so this pair restores it
 *  deliberately, at one width, with the dates pinned rather than derived from today.
 *
 *  600px pane = 564px content box, which is under the 640px abbreviate tier and above the 480px
 *  late-word tier — the band in which the label is shortened but nothing has been dropped, which is
 *  the state these two branches produce their special output in.
 *
 *  MONTH is the branch where `long`/`short` differ in the MONTH NAME, not in whether a year shows —
 *  unlike week/3day/day, which share one `spanLabel()` where long/short differ only in the year.
 *  Pinned to 12 Jan 2026: `rangeLabel` gives `{ long: "January 2026", short: "Jan 2026" }`. */
export const MonthAbbreviated: Story = {
    render: () => navNarrow(new Date(2026, 0, 12), 'month'),
    play: async ({ canvasElement }) => {
        const range = canvasElement.querySelector<HTMLElement>(
            '[data-testid="range"]',
        )!
        expect(range.clientWidth).toBeGreaterThan(0)
        await waitFor(() =>
            expect(visibleRange(canvasElement)).toBe('Jan 2026'),
        )
    },
}

/** The year-crossing WEEK branch of `spanLabel()`. Pinned to the week of 29 Dec 2025 – 4 Jan 2026
 *  (Monday-first, the default): `rangeLabel` gives
 *  `{ long: "29 Dec 2025 – 4 Jan 2026", short: "29 Dec – 4 Jan" }`. The SHORT form drops the year
 *  from BOTH ends unconditionally — `spanLabel`'s `withYear` flag gates every `year()` call, so the
 *  crossing is only visible in the long form; short reads identically to any other cross-month week.
 *  That asymmetry is why this story has to pin the LONG form's dates too (see `WeekAcrossYears`
 *  above) rather than any week straddling two years — the short string this asserts is what proves
 *  the abbreviate tier actually fired, not what proves the year boundary. */
export const WeekCrossingYear: Story = {
    render: () => navNarrow(new Date(2025, 11, 31), 'week'),
    play: async ({ canvasElement }) => {
        const range = canvasElement.querySelector<HTMLElement>(
            '[data-testid="range"]',
        )!
        expect(range.clientWidth).toBeGreaterThan(0)
        await waitFor(() =>
            expect(visibleRange(canvasElement)).toBe('29 Dec – 4 Jan'),
        )
    },
}
