// Visual spec for <Toolbar> — the calendar's controls inside a view bar (time nav / date / view
// switcher / Categories / + Event). It takes ONE prop; everything it shows (currentView,
// currentDate, showCategoryPanel) is read from calendar/state.ts module-level signals, so a story
// sets those directly instead of passing props.
//
// WIDTH IS A STORY DIMENSION HERE, not a detail. The bar collapses through container queries
// against its own block — `.toolbar` in Toolbar.module.css — so it responds to the PANE, not the
// window, and Storybook's viewport addon cannot exercise that. Each `Narrow*` story pins a real
// width instead. The widths are chosen to sit just inside each tier: 900 (nothing collapsed),
// 780 (action labels gone), 560 (view names abbreviated, short date), 460 (the floor: Today and
// Categories shed), 420 (below the floor: the row scrolls).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Toolbar } from './Toolbar'
import ViewBar, { Crumb } from '../../ui/ViewBar'
import IconButton from '../../ui/IconButton'
import { currentView, currentDate, showCategoryPanel } from '../state'
import { ViewType } from '../types'
import '../Calendar.module.css'

const meta = {
    title: 'Calendar/Toolbar',
    component: Toolbar,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Toolbar>

export default meta
type Story = StoryObj<typeof meta>

function setState(date: Date, view: ViewType, categories: boolean): void {
    currentDate.value = date
    currentView.value = view
    showCategoryPanel.value = categories
}

/** BaseView's composition, which is the ONLY one that ships: the base owns the single <ViewBar>
 *  and the calendar drops its controls into it. `width` stands in for the pane. */
function InBaseBar(props: { width: number }) {
    return (
        <div style={{ width: `${props.width}px`, 'max-width': '100%' }}>
            <ViewBar
                identity={<Crumb icon="Table">Calendar</Crumb>}
                locus={<Toolbar inline />}
                actions={
                    <>
                        <IconButton
                            icon="Settings"
                            label="Settings"
                            size="sm"
                        />
                        <IconButton icon="Code" label="Source" size="sm" />
                    </>
                }
            />
        </div>
    )
}

/** The shipping shape at a comfortable width. Time nav and the date sit left, the view switcher
 *  and actions right, and the base's own name keeps its full label on the far left. */
export const Default: Story = {
    render: () => {
        setState(new Date(2026, 0, 12), 'month', false)
        return <InBaseBar width={1100} />
    },
}

/** Week view with the Categories panel open. Both "on" controls — the current view and the
 *  Categories toggle — carry the SAME accent outline, and Today carries none, because it is a
 *  one-shot jump rather than a state. Previously all three looked different and Today looked
 *  permanently selected. */
export const WeekViewCategoriesOpen: Story = {
    render: () => {
        setState(new Date(2026, 0, 14), 'week', true)
        return <InBaseBar width={1100} />
    },
}

/** A week that crosses a month boundary, then one that crosses a year. The label names only the
 *  components its two ends disagree on — see `rangeLabel` in calendar/dates.ts. */
export const RangeCrossesYear: Story = {
    render: () => {
        setState(new Date(2025, 11, 31), 'week', false)
        return <InBaseBar width={1100} />
    },
}

/** 3-day view — the label that used to read "2026-01-12 — 2026-01-18", and the view name ("3 Day")
 *  that used to wrap onto a second line and push itself out of the 36px band. */
export const ThreeDayView: Story = {
    render: () => {
        setState(new Date(2026, 0, 12), '3day', false)
        return <InBaseBar width={1100} />
    },
}

/** TIER 0 — 900px. Everything still spelled out; nothing has collapsed yet. */
export const Narrow900: Story = {
    render: () => {
        setState(new Date(2026, 0, 14), 'week', false)
        return <InBaseBar width={900} />
    },
}

/** TIER 1 — 780px. "Categories" and "Event" drop to their icons; both keep a tooltip. */
export const Narrow780: Story = {
    render: () => {
        setState(new Date(2026, 0, 14), 'week', true)
        return <InBaseBar width={780} />
    },
}

/** TIER 2 — 560px. View names abbreviate to M/W/3D/D and the date drops its year. This is the
 *  width that used to erase the base's name entirely and truncate the date to "2026-…". */
export const Narrow560: Story = {
    render: () => {
        setState(new Date(2026, 0, 14), 'week', false)
        return <InBaseBar width={560} />
    },
}

/** TIER 3 — 460px, the measured FLOOR: the narrowest pane where every remaining control still
 *  fits with nothing clipped. "Today" sheds its word for its mark, and Categories drops out
 *  entirely — it toggles a side panel that has no room to render at this width either. */
export const Narrow460Floor: Story = {
    render: () => {
        setState(new Date(2026, 0, 12), 'day', false)
        return <InBaseBar width={460} />
    },
}

/** BELOW THE FLOOR — 420px. A pane has no minimum width, so this state is always reachable and
 *  has to be designed rather than avoided: the row scrolls, and its right edge fades so the cut
 *  reads as "more this way" instead of as a sliced button. The date never scrolls away, because
 *  it is the one thing the bar exists to tell you. */
export const Narrow420BelowFloor: Story = {
    render: () => {
        setState(new Date(2026, 0, 12), 'day', false)
        return <InBaseBar width={420} />
    },
}

/** STANDALONE — the toolbar rendering its own <ViewBar> (`inline` unset). Nothing in the app takes
 *  this path today, since a calendar is a Bases view kind and always arrives through BaseView. It
 *  is kept as a story because it is the reason the old rules were invisible: they hung off the
 *  standalone bar's class, so they styled THIS and not the one above. It must now look like the
 *  inline bar minus the base chrome — if it drifts, the split has come back. */
export const Standalone: Story = {
    render: () => {
        setState(new Date(2026, 0, 12), 'month', false)
        return (
            <div style={{ width: '1100px', 'max-width': '100%' }}>
                <Toolbar />
            </div>
        )
    },
}

/** With no calendar controls, BaseView's own bar still pins the gear and source right — the trail
 *  group does that by construction now, with no spacer to place. Included so a change to Toolbar's
 *  `flex: 1` region cannot silently break the bar for every OTHER view kind. */
export const NonCalendarBaseBarForComparison: Story = {
    render: () => (
        <div style={{ width: '1100px', 'max-width': '100%' }}>
            <ViewBar
                identity={<Crumb icon="Table">Reading list</Crumb>}
                actions={
                    <>
                        <IconButton
                            icon="Settings"
                            label="Settings"
                            size="sm"
                        />
                        <IconButton icon="Code" label="Source" size="sm" />
                    </>
                }
            />
        </div>
    ),
}
