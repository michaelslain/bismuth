// Visual spec for the calendar's view-bar controls (time nav / date / period switcher / Categories
// / + Event). `calendarSlots()` returns REGIONS rather than a block, so these stories compose it
// into a <ViewBar> exactly as bases/BaseView.tsx does. Everything it shows (currentView,
// currentDate, showCategoryPanel) is read from calendar/state.ts module-level signals, so a story
// sets those directly instead of passing props.
//
// WIDTH IS A STORY DIMENSION HERE, not a detail. The bar collapses through container queries
// against `.viewbar` itself, so it responds to the PANE, not the window, and neither Storybook's
// viewport addon nor bench/probeStory.ts (hardcoded 1280x900, no --width) can exercise that. Each
// `Narrow*` story pins a real width instead. The widths sit just inside each measured tier — see
// the ladder's own comment in ui/ui.css for the measurement.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { createSignal } from 'solid-js'
import { calendarSlots, Toolbar } from './Toolbar'
import ViewBar, { Crumb } from '../../ui/ViewBar'
import IconButton from '../../ui/IconButton'
import { SegmentedToggle } from '../../ui/SegmentedToggle'
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

/** BaseView's composition, which is the ONLY one that ships: the base owns the single <ViewBar> and
 *  the calendar drops its controls into its named regions. `width` stands in for the pane. */
function InBaseBar(props: { width: number }) {
    // ONE call. Each one builds real DOM, so calling it again for `actions` would construct the
    // whole control set twice and discard one — the exact waste BaseView's viewSlots memo removes.
    const slots = calendarSlots()
    return (
        <div style={{ width: `${props.width}px`, 'max-width': 'none' }}>
            <ViewBar
                identity={<Crumb icon="Table">Calendar</Crumb>}
                {...slots}
                actions={
                    <>
                        {slots.actions}
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

const shown = (el: Element | null) =>
    !!el && !!(el as HTMLElement).getClientRects().length

/** What a label is SHOWING. Both lengths sit in the DOM at every width, so textContent reads
 *  "MonthM" forever and would grade a ladder that hides nothing as green. */
const visible = (root: Element, sel: string) =>
    [...root.querySelectorAll(`${sel} [data-bar-abbr]`)]
        .filter(shown)
        .map(n => n.textContent)
        .join('')

/** The four collapse facts, read off the rendered bar. Each Narrow* story asserts the full tuple
 *  rather than only the one thing its own tier changed — a tier that fires EARLY is just as wrong
 *  as one that never fires, and only the whole tuple can see that. */
const state = (root: Element) => ({
    actionWords: visible(root, '[title="Categories"]'),
    viewName: visible(root, '.segmented button:first-child'),
    todayWord: visible(root, '[title="Jump to today"]'),
    categoriesShown: shown(root.querySelector('[title="Categories"]')),
})

/** The shipping shape at a comfortable width. Time nav and the date sit left, the period switcher
 *  beside them, and the base's own name keeps its full label on the far left. */
export const Default: Story = {
    render: () => {
        setState(new Date(2026, 0, 12), 'month', false)
        return <InBaseBar width={1100} />
    },
    play: async ({ canvasElement }) => {
        expect(state(canvasElement)).toEqual({
            actionWords: 'CATEGORIES',
            viewName: 'Month',
            todayWord: 'TODAY',
            categoriesShown: true,
        })
    },
}

/** Week view with the Categories panel open. Both "on" controls — the current view and the
 *  Categories toggle — carry the SAME accent outline, and Today carries none, because it is a
 *  one-shot jump rather than a state. */
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
    play: async ({ canvasElement }) => {
        expect(state(canvasElement)).toEqual({
            actionWords: 'CATEGORIES',
            viewName: 'Month',
            todayWord: 'TODAY',
            categoriesShown: true,
        })
    },
}

/** TIER 1 — 780px. "CATEGORIES" and "EVENT" drop to their icons; both keep a tooltip. Nothing
 *  else has moved: the view names are still spelled out and TODAY still reads as a word. */
export const Narrow780: Story = {
    render: () => {
        setState(new Date(2026, 0, 14), 'week', true)
        return <InBaseBar width={780} />
    },
    play: async ({ canvasElement }) => {
        expect(state(canvasElement)).toEqual({
            actionWords: '',
            viewName: 'Month',
            todayWord: 'TODAY',
            categoriesShown: true,
        })
    },
}

/** TIER 2 — 620px (a 584px container). View names abbreviate to M/W/3D/D and the date drops its
 *  year. */
export const Narrow620: Story = {
    render: () => {
        setState(new Date(2026, 0, 14), 'week', false)
        return <InBaseBar width={620} />
    },
    play: async ({ canvasElement }) => {
        expect(state(canvasElement)).toEqual({
            actionWords: '',
            viewName: 'M',
            todayWord: 'TODAY',
            categoriesShown: true,
        })
    },
}

/** TIER 3 — 510px (a 474px container, inside the 480 tier and clear of the 465 one). TODAY sheds
 *  its word for the calendar mark it was holding out against; Categories is still here. */
export const Narrow510TodayIconOnly: Story = {
    render: () => {
        setState(new Date(2026, 0, 12), 'day', false)
        return <InBaseBar width={510} />
    },
    play: async ({ canvasElement }) => {
        expect(state(canvasElement)).toEqual({
            actionWords: '',
            viewName: 'M',
            todayWord: '',
            categoriesShown: true,
        })
    },
}

/** TIER 4 — 480px (a 444px container), the measured FLOOR: the narrowest pane where every remaining
 *  control still fits and the crumb and date are still whole. Categories drops out entirely — it
 *  toggles a side panel that has no room to render at this width either — and its region goes with
 *  it, so the bar stops paying a gap for a control that is not there.
 *  This story is why the tiers were re-cut against the DAY label rather than the month one: at 460
 *  the crumb read "Calend…" and the date "Mon 12 J…" while every numeric check still passed, since
 *  the regions were correctly sized and it was their children being eaten. */
export const Narrow480Floor: Story = {
    render: () => {
        setState(new Date(2026, 0, 12), 'day', false)
        return <InBaseBar width={480} />
    },
    play: async ({ canvasElement }) => {
        expect(state(canvasElement)).toEqual({
            actionWords: '',
            viewName: 'M',
            todayWord: '',
            categoriesShown: false,
        })
        expect(shown(canvasElement.querySelector('.vb-config'))).toBe(false)
        // Nothing clipped at the floor: the leading group still fits its own box.
        const lead = canvasElement.querySelector<HTMLElement>('.vb-lead')!
        expect(lead.scrollWidth).toBeLessThanOrEqual(lead.clientWidth + 1)
        // …and it has NOT switched on the scroll/mask treatment. Folded into this tier, the fade
        // sat on a perfectly-fitting bar and the healthy floor state shipped looking broken.
        expect(getComputedStyle(lead).overflowX).not.toBe('auto')
        // Nor is the elastic content being eaten: crumb and date are whole, not ellipsized. This is
        // the assertion the 460px version of this story passed while looking visibly broken.
        // THE DATE HALF MUST NAME THE RANGE BOX EXPLICITLY. `.vb-locus span` looks right and is
        // inert: the first span in document order is the ChevronLeft <Icon> wrapper, which carries
        // an inline `width: 14px`, so it compares 14 against 14 and can never fail — a guard
        // against the exact defect class this plan already shipped once (a chat title clipped to
        // zero width inside a correctly-sized region, which every numeric probe passed).
        for (const el of [
            canvasElement.querySelector<HTMLElement>('.crumb b')!,
            canvasElement.querySelector<HTMLElement>('[data-testid="range"]')!,
        ]) {
            // A zero-width box makes the comparison below vacuous, so prove there is a box first.
            expect(el.clientWidth).toBeGreaterThan(0)
            expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth + 1)
        }
    },
}

/** BELOW THE FLOOR — 340px. A pane has no minimum width, so this state is always reachable and has
 *  to be designed rather than avoided: the leading group scrolls, and its right edge fades so the
 *  cut reads as "more this way" instead of as a sliced button. The date never scrolls away first,
 *  because it is the one thing the bar exists to tell you. */
export const Narrow340BelowFloor: Story = {
    render: () => {
        setState(new Date(2026, 0, 12), 'day', false)
        return <InBaseBar width={340} />
    },
    play: async ({ canvasElement }) => {
        const lead = canvasElement.querySelector<HTMLElement>('.vb-lead')!
        expect(getComputedStyle(lead).overflowX).toBe('auto')
        expect(getComputedStyle(lead).maskImage).not.toBe('none')
        expect(lead.scrollWidth).toBeGreaterThan(lead.clientWidth)
        // + Event and the base's own gear/source stay pinned and on screen — the trailing group is
        // never what gets scrolled away.
        const bar = canvasElement.querySelector<HTMLElement>('.viewbar')!
        const trail = canvasElement.querySelector<HTMLElement>('.vb-trail')!
        expect(trail.getBoundingClientRect().right).toBeLessThanOrEqual(
            bar.getBoundingClientRect().right + 1,
        )
    },
}

/** TWO SEGMENTED TOGGLES OF DIFFERENT SCOPE IN ONE BAR — a calendar base with more than one view.
 *  Nothing else in the repo renders this, and it is the case the region vocabulary exists for: the
 *  base's view tabs and the calendar's period switcher are the same control at the same weight and
 *  can only be told apart by POSITION. So the base's tabs hold `facet` and the period switcher
 *  goes in `locus`, appended to DateNav — "which span of time is on screen" is the same question
 *  prev/next/range answer, and "which projection of the same data" is not. */
export const CalendarBaseWithTwoViews: Story = {
    render: () => {
        setState(new Date(2026, 0, 12), 'week', false)
        const [tab, setTab] = createSignal(1)
        const slots = calendarSlots()
        return (
            <div style={{ width: '1100px', 'max-width': 'none' }}>
                <ViewBar
                    identity={<Crumb icon="Table">Reading Log</Crumb>}
                    {...slots}
                    facet={
                        <SegmentedToggle
                            value={tab()}
                            onChange={setTab}
                            options={[
                                { id: 0, label: 'Table' },
                                { id: 1, label: 'Schedule' },
                            ]}
                        />
                    }
                    actions={
                        <>
                            {slots.actions}
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
    },
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector('.viewbar')!
        // Two toggles, and they are in DIFFERENT regions — that separation IS the design. If both
        // ever land in one region this reads 2 and 0, with nothing on screen to tell them apart.
        expect(bar.querySelectorAll('.vb-locus .segmented').length).toBe(1)
        expect(bar.querySelectorAll('.vb-facet .segmented').length).toBe(1)
        // The period switcher follows DateNav inside `locus`, not the other way round.
        const locus = bar.querySelector('.vb-locus')!
        const kids = [...locus.children]
        expect(kids[kids.length - 1]!.className).toContain('segmented')
    },
}

/** STANDALONE — <Toolbar> rendering its own <ViewBar>. Nothing in the app takes this path today,
 *  since a calendar is a Bases view kind and always arrives through BaseView. It is kept because
 *  it is the reason the old rules were invisible: they hung off the standalone bar's class, so
 *  they styled THIS and not the shipping one. Both paths now build from the same
 *  `calendarSlots()`, so it cannot drift again — if it looks different from the bar above minus
 *  the base chrome, the split has come back. */
export const Standalone: Story = {
    render: () => {
        setState(new Date(2026, 0, 12), 'month', false)
        return (
            <div style={{ width: '1100px', 'max-width': 'none' }}>
                <Toolbar />
            </div>
        )
    },
}

/** With no calendar controls, BaseView's own bar still pins the gear and source right — the trail
 *  group does that by construction. Included so a change to the calendar's regions cannot silently
 *  break the bar for every OTHER view kind. */
export const NonCalendarBaseBarForComparison: Story = {
    render: () => (
        <div style={{ width: '1100px', 'max-width': 'none' }}>
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
