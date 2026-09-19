// Visual spec for <BaseView> — the unified view host that resolves ANY source (base file /
// inline ```query source / notes / tasks) into rows and picks the right renderer (table, cards,
// kanban, list, bullets, map, heatmap, bar, line, stat, calendar, flashcards). Individual
// renderers already have their own stories (TableView, KanbanView, CardsView, …) driven directly
// off `sampleViewResult()`; THIS file is the one place that exercises the resolution pipeline
// itself — `props.source` (inline YAML, same shape a ```query fence holds) parsed by
// `parseBase()`, resolved via `POST /rows` (fakeTransport, seeded with SAMPLE_ROWS) — end to
// end, the same path a real embedded/base-file view takes.
import { createSignal, onCleanup, onMount, Show, Suspense } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { BaseView } from './BaseView'
import { setTransport } from '../api'
import {
    fakeTransport,
    type FakeTransportSeed,
} from '../ui/_fakeTransport'
import { SAMPLE_ROWS } from '../ui/_baseFixtures'
import type { Row, SourceSpec } from '../../../core/src/bases/types'
import { taskToRow } from '../../../core/src/bases/taskRow'
import type { Task } from '../../../core/src/tasks'
import { saveSession } from './flashcardsQueue'
import { todayISO, addDaysISO } from '../../../core/src/dates'
import { toasts } from '../toastStore'
import taskRowStyles from './TaskRow.module.css'
import tableViewStyles from './TableView.module.css'
import cardsViewStyles from './CardsView.module.css'
import { syntheticBaseFile } from '../../../core/src/bases/types'
import { currentView } from '../calendar/state'
import { taskRow } from '../ui/_calendarAssertions'
import { start as startServerVersion } from '../serverVersion'

const meta = {
    title: 'Bases/BaseView',
    component: BaseView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof BaseView>

export default meta
type Story = StoryObj<typeof meta>

/** Seeds `/rows` with the shared curated dataset (ui/_baseFixtures.ts) so every view kind below
 *  has the same real vocabulary (status/priority/done/due/tags) to render. */
function seedRows(): void {
    setTransport(fakeTransport({ rows: SAMPLE_ROWS }))
}

/** No `path`/`view` — an inline `source` YAML, exactly what an embedded ```query block with a
 *  full config holds. No explicit `source:` key, so BaseView defaults it to `{kind: "notes"}`
 *  and resolves via `POST /rows`. */
export const Table: Story = {
    render: () => {
        seedRows()
        return <BaseView source={'views:\n  - type: table\n'} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(
                canvas.getByText('Draft the roadmap'),
            ).toBeInTheDocument()
        })
    },
}

/** The cards renderer — proves the view-type switch in `activeType()`/the render `<Switch>`
 *  actually routes to `<CardsView>`, not just `<TableView>` with different data. */
export const Cards: Story = {
    render: () => {
        seedRows()
        return <BaseView source={'views:\n  - type: cards\n'} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(
                canvas.getByText('Ship storybook coverage'),
            ).toBeInTheDocument()
        })
    },
}

/** The kanban renderer, grouped by `status` — the one view kind that needs a `groupBy` to be
 *  meaningful, so this is also the only story here exercising grouped resolution. */
export const Kanban: Story = {
    render: () => {
        seedRows()
        return (
            <BaseView
                source={
                    'views:\n  - type: kanban\n    groupBy: status\n'
                }
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // Column headers come from the grouped status values, not the row titles.
        await waitFor(() => {
            expect(canvas.getByText('Todo')).toBeInTheDocument()
            expect(canvas.getByText('Doing')).toBeInTheDocument()
            expect(canvas.getByText('Done')).toBeInTheDocument()
        })
    },
}

/** A `type: base` md FILE (not an inline source) with no rows of its own — a "query base"
 *  (filters/views over the vault) that BaseView defaults to `{kind: "notes"}` when the config
 *  declares no explicit source and the file's own GFM table is empty. `body` is handed in
 *  pre-fetched (as FileView always does), so no `/file` round-trip is needed for this story. */
export const FromBaseFile: Story = {
    render: () => {
        seedRows()
        return (
            <BaseView
                path="boards/tasks.md"
                body={'---\ntype: base\nviews:\n  - type: table\n---\n'}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(
                canvas.getByText('Write onboarding docs'),
            ).toBeInTheDocument()
        })
    },
}

/** A distinct row set for the PerViewSource story below — deliberately NOT part of SAMPLE_ROWS,
 *  so a story assertion that finds this text can only have come from resolving the SECOND
 *  view's own `source: tasks`, never a stale render of the first view's `source: notes`. */
const TASKS_VIEW_ROW: Row = {
    file: {
        name: 'Distinct tasks-sourced row',
        basename: 'Distinct tasks-sourced row',
        path: 'tasks/distinct.md',
        folder: 'tasks',
        ext: 'md',
        size: 0,
        ctime: 0,
        mtime: 0,
        tags: [],
        links: [],
    },
    note: {},
    formula: {},
}

/** Two views over ONE base, each with its OWN `source:` — the gap this fixes: `ViewConfig.source`
 *  was parsed and typed but BaseView only ever resolved the base-level `config.source`, so a
 *  per-view override was silently ignored. `fakeTransport`'s /rows resolver returns different
 *  rows per spec.kind, so switching tabs proves the SECOND view's own source actually resolved
 *  (not a stale render of the first view's rows). */
export const PerViewSource: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                rows: (spec: SourceSpec) =>
                    spec.kind === 'tasks' ? [TASKS_VIEW_ROW] : SAMPLE_ROWS,
            }),
        )
        return (
            <BaseView
                path="boards/multi.md"
                body={
                    '---\ntype: base\nviews:\n' +
                    '  - type: table\n    name: Notes\n    source:\n      kind: notes\n' +
                    '  - type: table\n    name: Tasks\n    source:\n      kind: tasks\n' +
                    '---\n'
                }
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // First view (its own `source: notes`) resolves the notes-sourced fixture rows.
        await waitFor(() => {
            expect(canvas.getByText('Draft the roadmap')).toBeInTheDocument()
        })
        // Click the second view's tab — it must resolve ITS OWN source, not reuse the first's.
        await userEvent.click(canvas.getByText('Tasks'))
        await waitFor(() => {
            expect(
                canvas.getByText('Distinct tasks-sourced row'),
            ).toBeInTheDocument()
            expect(
                canvas.queryByText('Draft the roadmap'),
            ).not.toBeInTheDocument()
        })
    },
}

/** An embedded ```query fence's own header — the one bar with `embeddedSource` set, which is what
 *  puts the "query" mark in `identity` beside the SOURCE + EDIT QUERY buttons in `actions` and
 *  flushes the bar to the block edges (`.embeddedBar`). `onEditQuery` is set here so the pencil
 *  (queryBlock.ts wires it up only when `isBuilderRepresentable` holds) is visible, proving it
 *  renders before SOURCE without overflowing the bar. */
export const EmbeddedQueryHeader: Story = {
    render: () => {
        seedRows()
        return (
            <BaseView
                source={'views:\n  - type: table\n'}
                embeddedSource={{ onReveal: () => {}, onEditQuery: () => {} }}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(canvas.getByText('query')).toBeInTheDocument()
        })
        expect(canvas.getByLabelText('Edit query')).toBeInTheDocument()
        expect(canvas.getByLabelText('Source')).toBeInTheDocument()
    },
}

// ── Flashcards: the view kind that contributes SLOTS to the base's bar ─────────────────────────
// A flashcards base is always a `type: base` md FILE, so `editPath()` is always set and BaseView's
// <Show> always renders its 36px ViewBar. FlashcardsView used to draw its OWN content-sized
// `.revhead` directly underneath — ~96px of stacked chrome for one view, the worst in the app.
// These stories are the standing proof that there is exactly ONE bar, and they are the only place
// the flashcards controls are rendered at all now, since <FlashcardsView> alone draws no header.
//
// The deck needs real front/back/due columns, which `_baseFixtures`' curated SAMPLE_ROWS does not
// carry, so this mints its own (same shape as FlashcardsView.stories.tsx's).
function cardRow(name: string, note: Record<string, unknown>): Row {
    return {
        file: {
            name,
            basename: name,
            path: `vocab/${name}.md`,
            folder: 'vocab',
            ext: 'md',
            size: 256,
            ctime: 0,
            mtime: 0,
            tags: [],
            links: [],
        },
        note,
        formula: {},
    }
}

const fcToday = todayISO()
const FLASHCARD_DECK: Row[] = [
    cardRow('card-1', {
        front: 'capital of France',
        back: 'Paris',
        due: fcToday,
    }),
    cardRow('card-2', {
        front: 'capital of Japan',
        back: 'Tokyo',
        due: addDaysISO(fcToday, -3),
    }),
    cardRow('card-3', {
        front: 'capital of Kenya',
        back: 'Nairobi',
        due: null,
    }),
    cardRow('card-4', {
        front: 'capital of Iceland',
        back: 'Reykjavik',
        due: addDaysISO(fcToday, 14),
    }),
]

const FLASHCARD_BASE_BODY =
    '---\ntype: base\nviews:\n  - type: flashcards\n    name: Vocabulary\n---\n'

/** A sized stand-in for a real editor pane. BaseView fills its host, and the flashcards stage only
 *  lays out inside a bounded box — and the bar's collapse ladder is a CONTAINER query on the bar
 *  itself, so the WIDTH here is what selects a tier. Hence one fixed-width story per tier: the
 *  probe's viewport is hardcoded 1280x900 and cannot be resized. `basePath` differs per story
 *  because FlashcardsView keys its session store (flashcardsQueue.ts) by it — a shared path would
 *  leak one story's queue position into the next. */
function FlashcardsPane(props: { w: string; path: string }) {
    setTransport(fakeTransport({ rows: FLASHCARD_DECK }))
    return (
        <div
            data-testid="fc-pane"
            style={{
                width: props.w,
                height: '620px',
                display: 'flex',
                'flex-direction': 'column',
                overflow: 'hidden',
            }}
        >
            <BaseView path={props.path} body={FLASHCARD_BASE_BODY} />
        </div>
    )
}

/** THE HEADLINE ASSERTION, shared by every width below. Counting matters as much as measuring: two
 *  stacked bars that each measure 36px would sail through a height-only check on either one of
 *  them, which is exactly the shape of the defect this task removes. Returns the measured chrome so
 *  a story can log it.
 *
 *  THE BUDGET WAS REWORKED 2026-09-02, when the flashcards deck's AsciiMeter came back (queue item
 *  16's replacement — see FlashcardsView.module.css's `.fcmeter`). The gap between the pane's top and
 *  `.stage`'s top now has TWO legitimate occupants instead of one: the bar (`--h-band`, a fixed
 *  36px — ui.css:474) and the restored session-progress meter (one line of `--fs-ui` text plus its
 *  own `--sp-4` top padding, ~19.5px measured live, total chrome ~55.5px). Bumping the old flat
 *  `<= 36` to `<= 56` and stopping there would have been exactly the kind of loosened-until-it-
 *  passes assertion this whole plan keeps finding, so the two occupants are measured and bounded
 *  SEPARATELY instead of folded into one opaque ceiling:
 *    - the bar's OWN height must stay <= 36px — this is what the original assertion actually
 *      protected, and it still does, independent of anything else sharing the gap.
 *    - the meter's OWN height must stay <= 28px — comfortably above its current ~19.5px (font
 *      metrics can shift a pixel or two across environments) but nowhere near what a real second
 *      header would cost: the `.revhead` this view used to draw was 94px tall on its own, and even
 *      a second `--h-band` bar would be another 36px on top of the first.
 *    - `chrome` itself must not exceed bar + meter + 8px of slack for sub-pixel layout — nowhere
 *      near enough headroom to hide a third stacked element of any kind, named or not: a
 *      reintroduced `.revhead` (94px) or a second bar lacking `[data-viewbar]` (so the count check
 *      above misses it) both blow well past this total regardless of what the bar/meter measure
 *      individually.
 *
 *  ADDED THE SAME DAY, caught in review: none of the checks above can see the meter's glyph run
 *  overflow its own box. `.fcmeter` is `width: 100%` regardless of content and `.asc-meter` cannot
 *  wrap (`white-space: pre`), so an oversized cell count runs the glyphs off to the right WITHOUT
 *  moving `.fcmeter`'s own edges — every check above stays green through exactly that failure. The
 *  glyph run (`.asc-meter`, a global un-hashed class) is measured on its OWN box instead: it must
 *  have real width, and its right edge must not pass its container's. */
async function expectOneBar(canvasElement: HTMLElement): Promise<number> {
    const pane = canvasElement.querySelector(
        '[data-testid="fc-pane"]',
    ) as HTMLElement
    await waitFor(() => {
        expect(canvasElement.querySelectorAll('[data-viewbar]').length).toBe(1)
    })
    // `.revhead` was a CSS-MODULE local, so it is hashed — matching the bare literal would report a
    // confident zero whether or not the element is there. Match by prefix.
    expect(canvasElement.querySelectorAll('[class*="revhead"]').length).toBe(0)
    const bar = canvasElement.querySelector('[data-viewbar]') as HTMLElement
    const meter = canvasElement.querySelector(
        '[data-testid="fc-progress"]',
    ) as HTMLElement
    expect(meter).not.toBeNull()
    const stage = canvasElement.querySelector('[class*="stage"]') as HTMLElement
    expect(stage).not.toBeNull()
    const barHeight = bar.getBoundingClientRect().height
    const meterHeight = meter.getBoundingClientRect().height
    expect(barHeight).toBeLessThanOrEqual(36)
    expect(meterHeight).toBeLessThanOrEqual(28)
    // THE GLYPH RUN, NOT JUST ITS BOX. `.fcmeter`'s own CSS pins `width: 100%` regardless of what
    // is inside it, and the meter's glyphs (`.asc-meter`, `white-space: pre`) cannot wrap — so if a
    // bad `chPx` or a broken `fitMeterWidth` clamp ever produced too many cells, the glyph run would
    // overflow horizontally WITHOUT changing `.fcmeter`'s own width or height at all. Every check
    // above this line (barHeight, meterHeight, chrome) would stay green through exactly that
    // failure — a box structurally incapable of reflecting its content's overflow, which is this
    // plan's signature defect one level removed from a zero-size box. So the glyph run's OWN
    // rendered box is what actually gets checked for containment, not its container's.
    // SETTLE, THEN waitFor — not waitFor alone. `meterCells` starts at a default of 30 (which
    // never overflows any of these panes) and is corrected asynchronously by a ResizeObserver
    // (FlashcardsView.tsx). `waitFor` stops polling the instant its callback does not throw, so
    // if the FIRST poll lands before that correction runs, it passes against the safe DEFAULT and
    // never looks again — masking a genuinely wrong SETTLED value. Caught in review by forcing
    // `fitMeterWidth` to always return 200: the plain `waitFor` version below still reported PASS,
    // because its one-and-only poll fired inside the pre-correction window. A ResizeObserver's
    // first callback is specified to run before paint, well inside one frame, so 200ms is not a
    // tight timing assumption — it is a hundred-plus frames of margin, not a guess at the exact
    // moment the correction lands.
    await new Promise(resolve => setTimeout(resolve, 200))
    await waitFor(() => {
        const glyphRun = meter.querySelector('.asc-meter') as HTMLElement
        expect(glyphRun).not.toBeNull()
        const glyphBox = glyphRun.getBoundingClientRect()
        expect(glyphBox.width).toBeGreaterThan(0)
        expect(glyphBox.right).toBeLessThanOrEqual(
            meter.getBoundingClientRect().right + 0.5,
        )
    })
    const chrome =
        stage.getBoundingClientRect().top - pane.getBoundingClientRect().top
    expect(chrome).toBeLessThanOrEqual(barHeight + meterHeight + 8)
    return chrome
}

/** True when an element is rendered but collapsed away by a `display: none` on it or an ancestor.
 *  `toBeVisible()` would also report false for a control merely scrolled out of a masked overflow,
 *  which is a different state and one the floor tier deliberately produces. */
const isLaidOut = (el: Element | null) =>
    !!el && !!(el as HTMLElement).offsetParent

/** The gap `justify-content: space-between` actually leaves between the bar's two groups.
 *
 *  THIS IS THE ASSERTION THE FIRST BUILD OF THIS BAR NEEDED AND DID NOT HAVE. At 502px the row fit
 *  the band, held one `[data-viewbar]`, kept every control inside the bar's right edge, and passed
 *  every check here — while rendering "1 / 3 HARD 0" with the two groups fused, because the
 *  separation between them had fallen below the intra-group gap used INSIDE each of them. A bar
 *  whose inter-group gap is smaller than its intra-group gap has stopped being two groups. */
function groupGap(canvasElement: HTMLElement): number {
    const count = canvasElement.querySelector(
        '[data-testid="fc-count"]',
    ) as HTMLElement
    const trail = canvasElement.querySelector('.vb-trail') as HTMLElement
    return (
        trail.getBoundingClientRect().left -
        count.getBoundingClientRect().right
    )
}

/** The bar's inter-group gap, read from the design system rather than copied out of it.
 *  `--bar-crumb-gap` is `var(--sp-5)` (12px today) and is the gap `.vb-lead` and `.vb-trail` put
 *  between their own children, so it is simultaneously the INTRA-group spacing — which is exactly
 *  what makes it the right threshold here: a bar whose inter-group gap has fallen to its intra-group
 *  gap has stopped reading as two groups. Hardcoding 12 kept that assertion passing after the token
 *  moved, measuring a number the layout no longer used. */
function crumbGap(): number {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(
        '--bar-crumb-gap',
    )
    const px = parseFloat(raw)
    // An unregistered custom property that failed to resolve returns '' → NaN. Fail loudly rather
    // than silently comparing against NaN, which makes every >= assertion below FALSE and would be
    // read as a layout regression.
    expect(
        Number.isFinite(px),
        `--bar-crumb-gap did not resolve to a length (got ${JSON.stringify(raw)})`,
    ).toBe(true)
    return px
}

/** Full width — every control the flashcards bar contributes is present at once, none collapsed,
 *  and a mid-session progress rule with real width (a fresh deck's is legitimately 0%, which would
 *  make "the rule renders" indistinguishable from "the rule is missing"). */
const WIDE_BASE_PATH = 'decks/vocab-wide.md'
saveSession(WIDE_BASE_PATH, {
    cram: false,
    pos: 1,
    good: 1,
    hard: 0,
    easy: 0,
    retired: [],
})

export const Flashcards: Story = {
    render: () => <FlashcardsPane w="1100px" path={WIDE_BASE_PATH} />,
    play: async ({ canvasElement }) => {
        await expectOneBar(canvasElement)
        const canvas = within(canvasElement)
        expect(isLaidOut(canvas.getByText('CARDS'))).toBe(true)
        expect(isLaidOut(canvas.getByText('CRAM'))).toBe(true)
        // The tally at full length, not its abbreviation.
        expect(isLaidOut(canvas.getByText('HARD'))).toBe(true)
        expect(isLaidOut(canvas.getByText('H'))).toBe(false)
        expect(groupGap(canvasElement)).toBeGreaterThanOrEqual(crumbGap())

        // The progress meter — replaces the old 1px hairline this same story used to assert
        // against (queue item 16's replacement, restored 2026-09-02: "i liked that flashcards
        // ascii meter"). The OUTER box no longer encodes the percentage in its own width — it is
        // now sized in CELLS from the measured pane (FlashcardsView.tsx's fitMeterWidth), not a
        // fraction of anything, so a width-as-percentage assertion no longer describes what this
        // element does. What has to be asserted instead is the FILL, and it is asserted on the
        // semantic value (`aria-valuenow`) rather than a pixel ratio — which is exactly what Task
        // 2 added `role=progressbar` for, and is more robust than the ratio it replaces: the
        // original ratio check existed because a PERCENTAGE WIDTH could resolve against the wrong
        // containing block and still land in a plausible-looking band by coincidence (see the
        // history above this file's `.fcmeter` predecessor in FlashcardsView.module.css). A count of
        // literal `#` glyphs can't drift the same way, and `aria-valuenow` is the value a screen
        // reader actually hears, so it is the more honest thing to pin.
        const pane = canvasElement.querySelector(
            '[data-testid="fc-pane"]',
        ) as HTMLElement
        const bar = canvasElement.querySelector('[data-viewbar]') as HTMLElement
        const meterEl = canvas.getByTestId('fc-progress')
        const rule = meterEl.getBoundingClientRect()
        const paneBox = pane.getBoundingClientRect()
        // Still flush left, directly under the bar, full pane width — the meter replaced the
        // hairline in the same slot, just with real height now instead of zero.
        expect(Math.round(rule.left)).toBe(Math.round(paneBox.left))
        expect(
            Math.abs(rule.top - bar.getBoundingClientRect().bottom),
        ).toBeLessThanOrEqual(1)
        expect(Math.round(rule.width)).toBe(Math.round(paneBox.width))
        // One line of chrome — not collapsed to 0, and nowhere near a stacked header's worth (see
        // expectOneBar's own comment for why 28 is the ceiling).
        expect(rule.height).toBeGreaterThan(10)
        expect(rule.height).toBeLessThanOrEqual(28)
        // 1 graded of a 4-card session (WIDE_BASE_PATH's seeded session, above) = 25%.
        expect(meterEl.getAttribute('aria-valuenow')).toBe('25')
    },
}

/** ONE STORY PER TIER, because a container query reads the BAR's width and the probe's viewport is
 *  hardcoded — the wrapper is the only place a width can be set.
 *
 *  502px pane = 466px content box (the bar's `padding: 0 18px` is outside the query), which sits
 *  between the ladder's late-words tier (480) and its drop-1 tier (465): CRAM and CARDS are down to
 *  their icons, the tally is abbreviated, and `data-bar-drop="1"` has NOT fired yet. That last part
 *  is the half of the pair that makes the next story mean something — and this is also the exact
 *  width at which the un-abbreviated tally fused the two groups together. */
export const FlashcardsTight: Story = {
    render: () => <FlashcardsPane w="502px" path="decks/vocab-tight.md" />,
    play: async ({ canvasElement }) => {
        await expectOneBar(canvasElement)

        // WHY 502 AND NOT 510 (queue item 17). 502px pane = 466px content box, ONE PIXEL above the
        // 465 drop-1 boundary — deliberate, because 502 is the width at which the un-abbreviated
        // tally fuses, and that fusion is what this story exists to show. The cost is that any change
        // to --h-band or to the bar's 18px padding slides the content box across 465 and turns this
        // story into a confusing failure inside the DROP-1 tier's territory, one tier away from
        // anything this story is about. So it asserts where it sits, and says so when it moves.
        // Measured after expectOneBar (above), which has already proven `[data-viewbar]` exists —
        // `.viewbar` is rendered behind BaseView's async `createResource` + `<Show>`, so reading
        // `.clientWidth` before that resolves would risk a null dereference instead of this guard's
        // own deliberately clear message.
        const bar = canvasElement.querySelector('.viewbar') as HTMLElement
        const content = bar.clientWidth - 36 // `padding: 0 18px`, outside the container query
        expect(
            content,
            `FlashcardsTight measured a ${content}px content box. It is pinned just ABOVE the 465px ` +
                `drop-1 tier on purpose; below it, this story is exercising the drop-1 tier instead of ` +
                `the tally fusion it was written for. Re-measure the fusion width and move the pane, ` +
                `do not just nudge the number.`,
        ).toBeGreaterThan(465)
        expect(content).toBeLessThan(480) // and still inside the tier it means to test

        const canvas = within(canvasElement)
        expect(isLaidOut(canvas.getByTestId('fc-tally'))).toBe(true)
        // Abbreviated, not whole: the swap tier (640) fired, the drop tier (465) did not.
        expect(isLaidOut(canvas.getByText('HARD'))).toBe(false)
        expect(isLaidOut(canvas.getByText('H'))).toBe(true)
        // Late words are gone at 480 — CRAM's own label, not the whole control.
        expect(isLaidOut(canvas.getByText('CRAM'))).toBe(false)
        expect(canvas.getByTitle(/^Cram:/)).toBeInTheDocument()
        // The two groups still read as two groups. Without the abbreviation this is ~9px.
        expect(groupGap(canvasElement)).toBeGreaterThanOrEqual(crumbGap())
    },
}

/** 480px pane = 444px content box: past drop-1 (465), still above the floor (430). The tally goes,
 *  and its REGION goes with it — `.vb-trail` gaps every region, so one left standing over a hidden
 *  only child still charges the bar 12px for a control that is not there. What hides it is
 *  ui.css's `[class^='vb-']:has(> *):not(:has(> :not([data-bar-drop='N'])))` — one copy per tier.
 *  It hides a region whose every element child is dropping at this tier, so the tally does NOT have
 *  to be the only thing in `readouts`; it has to be the only thing not dropping. (The earlier
 *  `:only-child` form did require that, and this comment used to say so. The `:has(> *)` guard is
 *  separate: without it the rule is vacuously true for a region with NO element children and would
 *  hide an empty one — including a slot holding only text.)
 *
 *  The progress meter is not that second child and never was — it lives outside the bar entirely,
 *  as FlashcardsView's own first child (`.fcmeter` in FlashcardsView.module.css, restored 2026-09-02
 *  in place of the `.fcprogress` hairline that used to hold this spot), so it neither participates
 *  in this rule nor sheds with the tally. That is the whole point of the deviation.
 *
 *  THIS IS THE STORY THAT PROVES THE TAG IS LIVE. A control tagged with a level that has no rule
 *  keeps its attribute, keeps rendering, and fails NOTHING — no typecheck error, no test failure,
 *  because nothing typechecks a `data-` attribute.
 *
 *  RETAG THE TALLY `"5"` — NOT `"2"`. The ladder defines 1-4 (465 / 500 / 570 / 650), and levels are
 *  WIDTHS counted up from the floor, so every level's range CONTAINS every lower one. At this story's
 *  444px content box all four fire, and retagging to 2, 3 or 4 would still hide the tally and still
 *  pass. Widening the story does not rescue the proof either: above 465 the tally stops dropping at
 *  all and the story's own primary assertion fails. Only an UNDEFINED level isolates the tag, which
 *  is why this says 5. (It said "2" until 2026-09-02, when task 6 added levels 2-4 and silently
 *  killed this proof — the two tasks shared no file, so only the merge could see it.) */
export const FlashcardsFloor: Story = {
    render: () => <FlashcardsPane w="480px" path="decks/vocab-floor.md" />,
    play: async ({ canvasElement }) => {
        await expectOneBar(canvasElement)
        const canvas = within(canvasElement)
        expect(isLaidOut(canvas.getByTestId('fc-tally'))).toBe(false)
        // The region wrapper too, not just its contents: `.vb-trail` gaps every region, so one
        // left standing over a hidden only child still charges the bar 12px for nothing.
        const region = canvasElement.querySelector('.vb-readouts')
        expect(isLaidOut(region)).toBe(false)
        // What survives: the progress rule (it costs no width, so it never sheds), the count
        // (where am I), and every control still reachable by icon.
        expect(isLaidOut(canvas.getByTestId('fc-progress'))).toBe(true)
        expect(isLaidOut(canvas.getByTitle(/^Cram:/))).toBe(true)
        expect(isLaidOut(canvas.getByTitle(/^Browse, add/))).toBe(true)
        // And the row still fits the band — no control pushed out of the 36px bar.
        const bar = canvasElement.querySelector('[data-viewbar]') as HTMLElement
        const trail = canvasElement.querySelector('.vb-trail') as HTMLElement
        expect(trail.getBoundingClientRect().right).toBeLessThanOrEqual(
            bar.getBoundingClientRect().right,
        )
    },
}

// ── Tasks mode, every row view kind, both origins ─────────────────────────────────────────
//
// `mode: tasks` says every row IS a task, whatever the view KIND and wherever the rows came
// from. These stories are the only place that claim is actually exercised end to end, because
// the WRITE SEAM lives in BaseView: a row scanned out of a note carries `note.line` and toggles
// through `POST /tasks/toggle`; a row stored as YAML in the base's own body carries `row.index`
// and toggles through `POST /row/update`. Rendering a view component directly (the way
// ListView.stories.tsx does) cannot reach either branch.
//
// So each kind gets BOTH: a stored-origin story and a query-origin story. They take different
// branches, and a story covering only one leaves the other untested.

/** A transport that RECORDS every POST while otherwise behaving exactly like the shared fake.
 *  Asserting on the request is the only way to prove a toggle "went out": the write is fire-
 *  and-forget, the refetch behind it re-reads the unchanged seed, and a story that asserted on
 *  the re-rendered DOM would therefore assert nothing at all. */
function recordingTransport(seed: FakeTransportSeed): {
    posts: { path: string; body: unknown }[]
} {
    const inner = fakeTransport(seed)
    const posts: { path: string; body: unknown }[] = []
    setTransport({
        ...inner,
        post: async (path: string, body: unknown) => {
            posts.push({ path, body })
            return inner.post(path, body)
        },
        // PUT as well as POST: a toggle is a POST, but "+ task" on a query-origin view appends a
        // checkbox LINE through `api.write`, which is a PUT /file. Recording only POSTs would
        // make that half of the create action silently unassertable.
        put: async (path: string, body: unknown) => {
            posts.push({ path, body })
            return inner.put(path, body)
        },
    })
    return { posts }
}

// One posts log per story, read by the shared play() helpers below. A module-level handle
// rather than a story arg because `render()` is where the transport is installed.
let taskPosts: { path: string; body: unknown }[] = []

const TASK_DATES = (() => {
    const today = todayISO()
    return { today, overdue: addDaysISO(today, -3), future: addDaysISO(today, 10) }
})()

/** Two tasks, both TODO so the first checkbox in DOM order is deterministic whatever the kind
 *  groups by, and the first one overdue so the table's `due` column has something to paint. */
const STORED_BODY = (kind: string, extra = '') =>
    `---\ntype: base\nmode: tasks\nview: ${kind}\n${extra}` +
    'order:\n  - description\n  - status\n  - due\n---\n\n' +
    `- description: ship the parser\n  status: todo\n  due: ${TASK_DATES.overdue}\n` +
    `- description: fix the flake\n  status: todo\n  due: ${TASK_DATES.future}\n`

/** The SAME two tasks, scanned out of a note's checkbox lines instead — built through the real
 *  `taskToRow`, so a drift between the two producers shows up here rather than being papered
 *  over by a hand-written fixture. */
const QUERY_ROWS: Row[] = [
    { description: 'ship the parser', line: 1, due: TASK_DATES.overdue },
    { description: 'fix the flake', line: 2, due: TASK_DATES.future },
].map(t =>
    taskToRow({
        path: 'tasks.md',
        indent: '',
        raw: `- [ ] ${t.description}`,
        status: 'todo',
        statusChar: ' ',
        priority: 'none',
        tags: [],
        ...t,
    } as Task),
)

const QUERY_BODY = (kind: string, extra = '') =>
    `---\ntype: base\nmode: tasks\nview: ${kind}\ntaskFile: tasks.md\n${extra}` +
    'source:\n  kind: tasks\norder:\n  - description\n  - status\n  - due\n---\n'

function storedBase(kind: string, extra = '') {
    const path = `boards/stored-${kind}.md`
    const body = STORED_BODY(kind, extra)
    taskPosts = recordingTransport({ files: { [path]: body } }).posts
    return <BaseView path={path} body={body} />
}

function queryBase(kind: string, extra = '') {
    const path = `boards/query-${kind}.md`
    const body = QUERY_BODY(kind, extra)
    taskPosts = recordingTransport({
        files: { [path]: body },
        rows: QUERY_ROWS,
    }).posts
    return <BaseView path={path} body={body} />
}

/** The two fixture tasks, in the order they are written into the base. Their POSITION on
 *  screen is NOT that order everywhere — a kanban sorts its cards — so the helper below reads
 *  back WHICH task it ticked rather than assuming it ticked the first one. That also makes the
 *  assertion stronger than a hardcoded index would be: it proves the write landed on the row
 *  whose box was clicked, which is exactly the class of bug (`splice(0,1)` on a missing index,
 *  an append instead of an update) the write seam's guards exist for. */
const TASK_NAMES = ['ship the parser', 'fix the flake']

/** Which fixture task a checkbox belongs to: walk up until an ancestor contains exactly ONE of
 *  the two descriptions. Stopping at "exactly one" is what keeps a shared container — the list
 *  wrapper, the kanban column — from answering for both. Kind-agnostic, so the same helper
 *  serves a task LINE (list/bullets/cards/kanban) and a table ROW. */
function taskOfBox(box: Element): string {
    let el: Element | null = box
    while (el) {
        const text = el.textContent ?? ''
        const hits = TASK_NAMES.filter(d => text.includes(d))
        if (hits.length === 1) return hits[0]
        if (hits.length > 1) break
        el = el.parentElement
    }
    return ''
}

/** Click the first checkbox on screen, and return both the POST it produced and the task it
 *  belongs to. Shared so ten stories cannot drift into asserting ten slightly different things. */
async function tickFirstBox(
    canvasElement: HTMLElement,
    route: string,
): Promise<{ post: { path: string; body: unknown }; task: string }> {
    const canvas = within(canvasElement)
    const boxes = await waitFor(() =>
        canvas.getAllByTitle('Toggle task — right-click to set status'),
    )
    expect(boxes.length).toBe(2)
    const task = taskOfBox(boxes[0])
    expect(TASK_NAMES).toContain(task)
    await userEvent.click(boxes[0])
    const post = await waitFor(() => {
        const p = taskPosts.find(x => x.path === route)
        expect(p).toBeTruthy()
        return p!
    })
    return { post, task }
}

/**
 * The STORED branch: `POST /row/update` addressed BY INDEX, carrying the row as it should now
 * be stored — and NOT the computed columns.
 *
 * That last assertion is the one that matters. `serializeRows` does not strip, so a write built
 * from `row.note` instead of `storedNote(row)` persists all seven derived columns into the
 * user's own base file, where they then go stale. Nothing else in the repo notices: the file
 * still parses, the view still renders, and the values are even correct on the day they land.
 */
async function expectStoredToggle({
    canvasElement,
}: {
    canvasElement: HTMLElement
}): Promise<void> {
    const { post, task } = await tickFirstBox(canvasElement, '/row/update')
    const body = post.body as {
        file: string
        index: number
        note: Record<string, unknown>
    }
    // The row's index in the base's own body — derived from WHICH task was ticked, so this
    // fails if the write addresses the other row.
    expect(body.index).toBe(TASK_NAMES.indexOf(task))
    expect(body.note.description).toBe(task)
    expect(body.note.status).toBe('done')
    expect(body.note.done).toBe(TASK_DATES.today)
    const leaked = [
        'statusChar',
        'resolved',
        'placed',
        'recurring',
        'priority',
        'tags',
    ].filter(k => k in body.note)
    expect(leaked).toEqual([])
}

/** The QUERY branch: `POST /tasks/toggle` addressed by the SOURCE LINE the row was scanned
 *  from — no index anywhere, because a scanned task has no row to rewrite. */
async function expectQueryToggle({
    canvasElement,
}: {
    canvasElement: HTMLElement
}): Promise<void> {
    const { post, task } = await tickFirstBox(canvasElement, '/tasks/toggle')
    // The fixture's two tasks sit on lines 1 and 2 of tasks.md, in TASK_NAMES order.
    expect(post.body).toEqual({
        path: 'tasks.md',
        line: TASK_NAMES.indexOf(task) + 1,
    })
}

/** The list also carries the "+ task" assertions for BOTH origins, since the action is the
 *  bar's, not the kind's — it is identical for bullets, cards, kanban and table, and asserting
 *  it ten times would only prove the bar renders ten times. */
export const TasksListStored: Story = {
    render: () => storedBase('list'),
    play: async ({ canvasElement }) => {
        await expectStoredToggle({ canvasElement })
        // "+ task" on a base that owns its rows appends a ROW.
        await userEvent.click(within(canvasElement).getByTitle('New task'))
        const created = await waitFor(() => {
            const p = taskPosts.find(
                x =>
                    x.path === '/row/update' &&
                    (x.body as { index: number | null }).index === null,
            )
            expect(p).toBeTruthy()
            return p!
        })
        expect((created.body as { note: unknown }).note).toEqual({
            description: 'New task',
            status: 'todo',
        })
    },
}
export const TasksListQuery: Story = {
    render: () => queryBase('list'),
    play: async ({ canvasElement }) => {
        await expectQueryToggle({ canvasElement })
        // "+ task" on a SOURCED base appends a checkbox LINE to its declared `taskFile` —
        // the same `appendTaskLine` the calendar's own "+ task" calls.
        await userEvent.click(within(canvasElement).getByTitle('New task'))
        const written = await waitFor(() => {
            const p = taskPosts.find(x => x.path === '/file')
            expect(p).toBeTruthy()
            return p!
        })
        const body = written.body as { path: string; contents: string }
        expect(body.path).toBe('tasks.md')
        expect(body.contents.endsWith('- [ ] New task\n')).toBe(true)
    },
}

export const TasksBulletsStored: Story = {
    render: () => storedBase('bullets'),
    play: expectStoredToggle,
}
export const TasksBulletsQuery: Story = {
    render: () => queryBase('bullets'),
    play: expectQueryToggle,
}

export const TasksCardsStored: Story = {
    render: () => storedBase('cards'),
    play: expectStoredToggle,
}
export const TasksCardsQuery: Story = {
    render: () => queryBase('cards'),
    play: expectQueryToggle,
}

// ── The density stress case: the two-task fixtures above prove the write seam, but they can
// never show whether the compact `.taskCard` box actually holds up under a realistic task
// list — mixed line lengths, every status, a priority ladder, an overdue date and a
// recurrence all landing on screen at once. A SEPARATE path/rows pair from QUERY_ROWS/
// queryBase('cards') above, so this story cannot perturb their play() assertions.

/** Query-origin (scanned checkbox lines), twelve tasks, every status/priority/date signifier
 *  the compact register renders — the stress case `TasksCardsQuery`'s two tidy tasks cannot
 *  show. Line numbers are 1-indexed and sequential, matching how `taskToRow` expects a real
 *  scan to number them. */
const DENSE_TASK_DEFS: Array<{
    description: string
    status: 'todo' | 'done' | 'in-progress' | 'cancelled'
    priority?: Task['priority']
    due?: string
    recurrence?: string
}> = [
    { description: 'ship the release notes', status: 'todo', priority: 'high' },
    { description: 'fix the flake in CI', status: 'todo', due: TASK_DATES.overdue },
    {
        description: 'review PR #482 for the ascii graph renderer',
        status: 'todo',
        priority: 'medium',
    },
    { description: 'write onboarding docs for new hires', status: 'in-progress' },
    {
        description: 'respond to the security disclosure',
        status: 'todo',
        priority: 'highest',
        due: TASK_DATES.overdue,
    },
    { description: 'archive Q1 planning notes', status: 'cancelled' },
    { description: 'sync calendar with gcal', status: 'done' },
    { description: 'water the office plants', status: 'todo', recurrence: 'every week' },
    { description: 'pay rent', status: 'done', recurrence: 'every month' },
    { description: 'draft the changelog entry', status: 'todo', priority: 'low' },
    { description: 'triage inbox to zero', status: 'in-progress', priority: 'medium' },
    { description: 'clean up abandoned worktrees', status: 'cancelled', priority: 'lowest' },
]

const DENSE_TASKS_PATH = 'dense-tasks.md'
const DENSE_ROWS: Row[] = DENSE_TASK_DEFS.map((t, i) =>
    taskToRow({
        path: DENSE_TASKS_PATH,
        indent: '',
        raw: `- [ ] ${t.description}`,
        line: i + 1,
        status: t.status,
        statusChar:
            t.status === 'done'
                ? 'x'
                : t.status === 'cancelled'
                  ? '-'
                  : t.status === 'in-progress'
                    ? '/'
                    : ' ',
        description: t.description,
        priority: t.priority ?? 'none',
        tags: [],
        due: t.due,
        recurrence: t.recurrence,
    } as Task),
)

export const TasksCardsDense: Story = {
    render: () => {
        const path = 'boards/dense-tasks-cards.md'
        const body =
            '---\ntype: base\nmode: tasks\nview: cards\n' +
            `taskFile: ${DENSE_TASKS_PATH}\n` +
            'source:\n  kind: tasks\norder:\n  - description\n  - status\n  - due\n---\n'
        setTransport(fakeTransport({ files: { [path]: body }, rows: DENSE_ROWS }))
        return <BaseView path={path} body={body} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const boxes = await waitFor(() =>
            canvas.getAllByTitle('Toggle task — right-click to set status'),
        )
        expect(boxes.length).toBe(DENSE_TASK_DEFS.length)
        // Every status the compact register renders differently actually landed on screen.
        expect(canvas.getAllByText('[x]').length).toBeGreaterThan(0)
        expect(canvas.getAllByText('[-]').length).toBeGreaterThan(0)
        expect(canvas.getAllByText('[/]').length).toBeGreaterThan(0)
        expect(canvas.getAllByText('[ ]').length).toBeGreaterThan(0)
    },
}

/**
 * Kanban groups by `status`, which is also what a tick CHANGES — so this is the one kind where
 * the mode's rendering and the mode's write interact. Both fixture tasks start todo, so the
 * board opens as one column.
 *
 * FIXED: each card now resolves to its OWN row via `rowId` (path + index — see
 * `rowIdentity.ts`), so the two cards below show their own descriptions instead of both
 * collapsing onto the last one. Before the fix, `KanbanView` keyed every card by
 * `row.file.path`, and every row stored in ONE base's body shares ONE synthetic file path — so
 * the map collapsed them and both cards rendered the last row (`fix the flake`, twice). That had
 * nothing to do with tasks mode specifically: an own-rows kanban always rendered this way, in
 * normal mode too. Tasks mode was simply the first thing that made an own-rows kanban worth
 * opening — which is also why the fix (`rowIdentity.ts` + the re-key across drag, drop, reorder,
 * add, delete and image-drop in `KanbanView.tsx`) is not tasks-mode-specific either.
 *
 * `play()` asserts the two cards differ BEFORE ticking anything — the regression this guards
 * against is exactly "both cards read the same", which a toggle-only assertion could pass even
 * while the collapse were back — then reuses `expectStoredToggle` to confirm a tick still writes
 * to the INDEX of the row whose own box was clicked.
 */
export const TasksKanbanStored: Story = {
    render: () => storedBase('kanban', 'groupBy: status\n'),
    play: async ({ canvasElement }) => {
        const texts = [
            ...canvasElement.querySelectorAll('[data-testid="kanban-card"]'),
        ].map(el => (el.textContent ?? '').trim())
        expect(texts).toHaveLength(2)
        // The whole bug in one line: before re-keying, both cards resolved to the last row
        // and this was ['fix the flake', 'fix the flake'].
        expect(new Set(texts).size).toBe(2)
        await expectStoredToggle({ canvasElement })
    },
}
export const TasksKanbanQuery: Story = {
    render: () => queryBase('kanban', 'groupBy: status\n'),
    play: expectQueryToggle,
}

/** The table is the ONE kind that does not become a task line: it keeps its columns and gains
 *  two cell affordances instead. `play()` therefore checks BOTH — that the `status` cell's
 *  checkbox writes, and that the `due` cell of the past-due row (and only that one) carries
 *  the overdue class. */
export const TasksTableStored: Story = {
    render: () => storedBase('table'),
    play: async ({ canvasElement }) => {
        const overdueCells = canvasElement.querySelectorAll(
            `td.${tableViewStyles.cellOverdue}`,
        )
        expect(overdueCells.length).toBe(1)
        expect(overdueCells[0].textContent).toContain(TASK_DATES.overdue)
        // …and the class actually PAINTS. A class-only assertion is what the list view's due
        // chip uses, and it is not enough here: `.table td` sets `color: var(--fg)` at a higher
        // specificity, so the first version of this rule landed on the cell and changed nothing
        // — correct binding, white text. Comparing the two due cells RELATIVELY rather than
        // against a literal keeps it theme-independent (four themes, four --danger values)
        // while still catching a rule the cascade has defeated.
        const dueCells = [...canvasElement.querySelectorAll('td')].filter(td =>
            /^\d{4}-\d{2}-\d{2}$/.test((td.textContent ?? '').trim()),
        )
        expect(dueCells.length).toBe(2)
        const colors = dueCells.map(td => getComputedStyle(td).color)
        expect(colors[0]).not.toBe(colors[1])
        await expectStoredToggle({ canvasElement })
    },
}
export const TasksTableQuery: Story = {
    render: () => queryBase('table'),
    play: expectQueryToggle,
}

// ── The three cases the first ten stories do not reach ────────────────────────────────────

/** A SECOND base's own rows, as `POST /rows` returns them for `source: {kind: base, ref: …}`:
 *  `parseRows` stamps BOTH `index` and `file: syntheticBaseFile(<that base's path>)`, and
 *  `resolveBaseRows` hands them through verbatim. The two handles belong together — which is
 *  the whole point of the story below. */
const CROSS_BASE_PATH = 'boards/tasks-source.md'
const CROSS_BASE_ROWS: Row[] = [
    { description: 'ship the parser', status: 'todo' },
    { description: 'fix the flake', status: 'todo' },
].map((note, index) => ({
    file: syntheticBaseFile(CROSS_BASE_PATH),
    note,
    formula: {},
    index,
}))

/**
 * A tasks view whose rows come from ANOTHER base — `source: {kind: base, ref: "[[Tasks]]"}` —
 * over a base that also holds rows of its own.
 *
 * This is the case where the write's two handles come from DIFFERENT FILES. `row.index` is a
 * position in the SOURCE base; the open base is a different file entirely. Pairing the index
 * with the open base's path writes a task over the reader's own row N — silent data loss into
 * a file they were only reading from — and never touches the file they ticked.
 *
 * `play()` ticks the SECOND task, because index 1 is where the two spellings diverge
 * destructively: the open base has a row at 1 for the write to land on and destroy.
 */
export const TasksFromAnotherBase: Story = {
    render: () => {
        const path = 'boards/projects.md'
        const body =
            '---\ntype: base\nviews:\n' +
            '  - type: table\n    name: Projects\n' +
            '  - type: list\n    name: Tasks\n    mode: tasks\n' +
            '    source:\n      kind: base\n      ref: "[[Tasks]]"\n' +
            '---\n\n- name: Rebuild the graph\n- name: Ship tasks mode\n'
        taskPosts = recordingTransport({
            files: { [path]: body },
            rows: (spec: SourceSpec) =>
                spec.kind === 'base' ? CROSS_BASE_ROWS : [],
        }).posts
        return <BaseView path={path} body={body} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(await waitFor(() => canvas.getByText('Tasks')))
        const boxes = await waitFor(() => {
            const b = canvas.getAllByTitle(
                'Toggle task — right-click to set status',
            )
            expect(b.length).toBe(2)
            return b
        })
        await userEvent.click(boxes[1])
        const post = await waitFor(() => {
            const p = taskPosts.find(x => x.path === '/row/update')
            expect(p).toBeTruthy()
            return p!
        })
        const body = post.body as { file: string; index: number }
        // The write goes to the base the ROW came from, at that row's index.
        expect(body.file).toBe(CROSS_BASE_PATH)
        expect(body.index).toBe(1)
    },
}

/**
 * `source: tasks` with NO `mode:` — an ordinary cards base over the vault's checkbox lines,
 * exactly the one `docs/bases/sources.md` ships. It must render exactly as it always has: a
 * cover, the configured columns, and click-to-open.
 *
 * Tasks mode is a DECLARATION, not a shape the renderer sniffs for. Branching a card body on
 * "does this row look like a task" instead of "is this view in tasks mode" silently rewrites
 * every existing `source: tasks` cards/kanban/bullets base in every vault — and on kanban it
 * takes rename, meta editing, delete/undo and the edit modal with it.
 */
export const TaskShapedRowsInNormalMode: Story = {
    render: () => {
        const path = 'boards/normal-cards.md'
        const body =
            '---\ntype: base\nview: cards\nsource:\n  kind: tasks\n---\n'
        taskPosts = recordingTransport({
            files: { [path]: body },
            rows: QUERY_ROWS,
        }).posts
        return <BaseView path={path} body={body} />
    },
    play: async ({ canvasElement }) => {
        // The cards renderer, untouched: a cover per row and a click-to-open card…
        await waitFor(() => {
            expect(
                canvasElement.querySelectorAll(`.${cardsViewStyles.cardCover}`)
                    .length,
            ).toBe(2)
        })
        expect(
            canvasElement.querySelectorAll('[role="button"][tabindex]').length,
        ).toBe(2)
        // …and NOT a task line, which carries neither.
        expect(
            canvasElement.querySelectorAll(`.${taskRowStyles.taskItem}`).length,
        ).toBe(0)
    },
}

/**
 * Tasks mode with NO `order:` — the DEFAULT a user hits first, and the one shape none of the
 * ten stories above reach, because every one of them declares its columns.
 *
 * With no `order:` and no declared `properties:`, `deriveColumns` unions `Object.keys(r.note)`
 * across the rows. Normalization runs BEFORE that, so without the guard a three-column base
 * renders nine — including a `statusChar` column showing a literal " " or "x" box character.
 */
export const TasksNoDeclaredColumns: Story = {
    render: () => {
        const path = 'boards/no-order.md'
        const body =
            '---\ntype: base\nmode: tasks\nview: table\n---\n\n' +
            `- description: ship the parser\n  status: todo\n  due: ${TASK_DATES.overdue}\n` +
            `- description: fix the flake\n  status: todo\n  due: ${TASK_DATES.future}\n`
        taskPosts = recordingTransport({ files: { [path]: body } }).posts
        return <BaseView path={path} body={body} />
    },
    play: async ({ canvasElement }) => {
        const heads = await waitFor(() => {
            const th = [...canvasElement.querySelectorAll('th')].map(h =>
                (h.textContent ?? '').trim(),
            )
            expect(th.length).toBeGreaterThan(0)
            return th
        })
        // Exactly the columns the file stores — the derived ones are write-back bookkeeping,
        // not data, and must not become columns the user has to hide by hand.
        expect(heads).toEqual(['description', 'status', 'due'])
    },
}

/**
 * A stored write the server REJECTS. The guards that stop the index paths corrupting data all
 * end in a 400, so the remaining failure has to be legible: without a `.catch`, `api.rowUpdate`
 * rejects into nothing, the refetch puts the checkbox back, and the user sees an unexplained
 * flicker with no idea a write was refused.
 *
 * The transport below rejects `/row/update` the way the REAL one does — `httpTransport`'s
 * `request` throws `new Error(await r.text())` on `!r.ok`, so a rejected promise (not a 400
 * Response) is what the app actually sees.
 */
function rejectingTransport(
    seed: FakeTransportSeed,
    route: string,
    message: string,
): void {
    const inner = fakeTransport(seed)
    const fail = async (p: string, b: unknown) => {
        if (p === route) throw new Error(message)
        return p.startsWith('/file') ? inner.put(p, b) : inner.post(p, b)
    }
    setTransport({
        ...inner,
        post: (p: string, b: unknown) => fail(p, b),
        put: (p: string, b: unknown) => fail(p, b),
    })
}

/** Tick the first checkbox and assert ONE toast appeared carrying the server's own words. */
async function expectWriteToast(
    canvasElement: HTMLElement,
    message: string,
    click: (canvas: ReturnType<typeof within>) => Promise<void>,
): Promise<void> {
    const before = toasts().length
    await click(within(canvasElement))
    await waitFor(() => {
        expect(toasts().length).toBe(before + 1)
    })
    // The server's own words reach the user, not a generic "something went wrong".
    expect(toasts()[before].message).toContain(message)
}

const tickFirst = async (canvas: ReturnType<typeof within>) => {
    const boxes = await waitFor(() =>
        canvas.getAllByTitle('Toggle task — right-click to set status'),
    )
    await userEvent.click(boxes[0])
}

export const StoredWriteRejected: Story = {
    render: () => {
        const path = 'boards/rejected.md'
        const body = STORED_BODY('list')
        rejectingTransport(
            { files: { [path]: body } },
            '/row/update',
            'index out of range',
        )
        return <BaseView path={path} body={body} />
    },
    play: ({ canvasElement }) =>
        expectWriteToast(canvasElement, 'index out of range', tickFirst),
}

/** The QUERY branch of the same toggle. It is inherited from the merge-base ListView, where it
 *  was equally silent — but leaving two of four write paths mute beside two that speak is the
 *  forgotten-sibling shape this whole seam exists to remove. */
export const QueryToggleRejected: Story = {
    render: () => {
        const path = 'boards/rejected-query.md'
        const body = QUERY_BODY('list')
        rejectingTransport(
            { files: { [path]: body }, rows: QUERY_ROWS },
            '/tasks/toggle',
            'line 1 is not a task',
        )
        return <BaseView path={path} body={body} />
    },
    play: ({ canvasElement }) =>
        expectWriteToast(canvasElement, 'line 1 is not a task', tickFirst),
}

/** "+ task" is the path this diff genuinely introduced, and it is `async` behind an `onClick`
 *  — so before the catch, a failing append (a `taskFile` that does not exist, a read-only
 *  vault) left the button doing visibly nothing at all. */
export const AddTaskRejected: Story = {
    render: () => {
        const path = 'boards/rejected-add.md'
        const body = QUERY_BODY('list')
        rejectingTransport(
            { files: { [path]: body }, rows: QUERY_ROWS },
            '/file',
            'tasks.md is read-only',
        )
        return <BaseView path={path} body={body} />
    },
    play: ({ canvasElement }) =>
        expectWriteToast(canvasElement, 'tasks.md is read-only', async canvas =>
            userEvent.click(await waitFor(() => canvas.getByTitle('New task'))),
        ),
}

/**
 * A tasks base can create a task its own query cannot see. `taskFile` names the one note a new
 * task lands in, and nothing constrains that destination to the query's scope — so a view
 * filtered to `note.priority == "high"` accepts the write and then never shows the row, since a
 * fresh task is `priority: none`. The write is not prevented; the user is told where it went.
 */
export const AddTaskOutOfScope: Story = {
    render: () => {
        const path = 'boards/query-list-out-of-scope.md'
        const body = QUERY_BODY('list', 'filters: note.priority == "high"\n')
        taskPosts = recordingTransport({
            files: { [path]: body },
            rows: QUERY_ROWS,
        }).posts
        return <BaseView path={path} body={body} />
    },
    play: ({ canvasElement }) =>
        expectWriteToast(canvasElement, 'does not match this view', async canvas =>
            userEvent.click(await waitFor(() => canvas.getByTitle('New task'))),
        ),
}

/**
 * A hand-authored tasks base whose rows omit `status` — nobody has ticked anything yet, so
 * nothing wrote the field. Every task in it is implicitly todo, and the whole promise of the
 * mode is that you can tick them.
 *
 * `status` is filled by normalization like the other six, so a column set derived from the
 * rows would drop it and the table would render `description | due` — with no status column,
 * `isStatusColumn` never fires and there is no checkbox anywhere on the page. `status` is the
 * one of the seven that is a task's CORE FIELD rather than machine bookkeeping, so in tasks
 * mode it stays a column even when it was supplied rather than stored.
 */
export const TasksNoStoredStatus: Story = {
    render: () => {
        const path = 'boards/no-status.md'
        const body =
            '---\ntype: base\nmode: tasks\nview: table\n---\n\n' +
            `- description: ship the parser\n  due: ${TASK_DATES.overdue}\n` +
            `- description: fix the flake\n  due: ${TASK_DATES.future}\n`
        taskPosts = recordingTransport({ files: { [path]: body } }).posts
        return <BaseView path={path} body={body} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // There IS a checkbox, one per row, and ticking one writes.
        const boxes = await waitFor(() => {
            const b = canvas.getAllByTitle(
                'Toggle task — right-click to set status',
            )
            expect(b.length).toBe(2)
            return b
        })
        // `status` is a column; the four genuinely computed keys still are not.
        const heads = [...canvasElement.querySelectorAll('th')].map(h =>
            (h.textContent ?? '').trim(),
        )
        expect(heads).toEqual(['description', 'due', 'status'])
        await userEvent.click(boxes[0])
        const post = await waitFor(() => {
            const p = taskPosts.find(x => x.path === '/row/update')
            expect(p).toBeTruthy()
            return p!
        })
        const note = (post.body as { note: Record<string, unknown> }).note
        expect(note.status).toBe('done')
        // …and the row still does not gain the computed columns on its way to disk.
        expect(
            ['statusChar', 'resolved', 'placed', 'recurring'].filter(
                k => k in note,
            ),
        ).toEqual([])
    },
}

// Regression for "Task Manager showed Task Calendar's calendar": a BaseView torn down right after it
// mounted still finished its async document load and wrote the module-level docCache under ITS path.
// The next mount of that path at the same server version trusted the entry (`isFresh`) and rendered
// the dead instance's parse. Here the first instance is handed a WRONG body and disposed in the same
// flush; the second mounts a macrotask later with the RIGHT body. A unique path keeps other stories'
// cache entries out of it (docCache is module-level and shared by the whole Storybook tab).
const DISPOSED_PATH = 'regressions/disposed-mount.md'
const DISPOSED_WRONG = '---\ntype: base\nviews:\n  - type: table\n---\n\n- description: wrong-row-from-a-dead-mount\n'
const DISPOSED_RIGHT = '---\ntype: base\nviews:\n  - type: table\n---\n\n- description: right-row-for-this-path\n'

function DisposedMountHarness() {
    const [phase, setPhase] = createSignal<'wrong' | 'gap' | 'right'>('wrong')
    onMount(() => {
        setPhase('gap')
        setTimeout(() => setPhase('right'), 0)
    })
    return (
        <div>
            <Show when={phase() === 'wrong'}>
                <BaseView path={DISPOSED_PATH} body={DISPOSED_WRONG} />
            </Show>
            <Show when={phase() === 'right'}>
                <BaseView path={DISPOSED_PATH} body={DISPOSED_RIGHT} />
            </Show>
        </div>
    )
}

export const DisposedMountNeverPoisonsTheNextMount: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [DISPOSED_PATH]: DISPOSED_RIGHT } }))
        return <DisposedMountHarness />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => expect(canvas.getByText('right-row-for-this-path')).toBeInTheDocument())
        expect(canvas.queryByText('wrong-row-from-a-dead-mount')).toBeNull()
    },
}

// ---- calendar pane stays mounted across a toggle-driven refetch -----------------------

/**
 * Wires the transport AND the `serverVersion` module (app/src/serverVersion.ts) so a
 * `/tasks/toggle` POST behaves the way it does against the real backend: `mutatingHandler`
 * bumps the server version and pushes it over SSE as part of handling the write, which is why
 * `BaseView.tsx`'s `docCache`/`rowCache` (both version-gated — see `RowCache.isFresh`) are
 * already stale by the time the write's own `.finally(() => onChange())` runs its refetch.
 *
 * Without this, `/version` never changes in Storybook (nothing calls `serverVersion.start()`
 * from `preview.ts`), so `rowCache.isFresh`/`docCache.isFresh` stay true forever and a refetch
 * after the FIRST load resolves straight from the module-level cache — no `POST /rows` round
 * trip at all, so no async gap for Suspense to ever show a fallback over. This was confirmed
 * empirically: an un-delayed AND a delayed `/rows` transport both left the refetch hitting the
 * cache instead of the network (a `rowsCallCount` probe stayed at 1 across the toggle either
 * way) — the "resolves synchronously" case the brief anticipated, just one level up from the
 * transport.
 *
 * `serverVersion.start()`'s `StartDeps` seam (built for exactly this — see its own doc comment)
 * lets a fake `/tasks/toggle` handler drive a version bump deterministically instead of via a
 * real timer: the "poll" here is a manually-invoked callback captured through `setIntervalFn`,
 * never a real `setInterval`. `eventSourceFactory` throws so `serverVersion` falls back to
 * that fake poll instead of trying a real `EventSource` against `fakeTransport`'s empty
 * `eventsUrl()`.
 */
// `startServerVersion`'s `setIntervalFn` seam is how a `/tasks/toggle` POST (below) drives a
// version bump — see `tasksCalendarToggleTransport`. Module-level (not a local closure) so the
// story's `play()` can assert it was actually captured: `serverVersion.start()` is idempotent
// (serverVersion.ts's `if (started) return dispose`), so if some earlier story in the same page
// already called it, THIS call is a no-op and `setIntervalFn` never runs — leaving `pollOnce`
// undefined, the toggle's version bump a silent no-op, and the story passing vacuously against
// unfixed code (the same trap FileView.stories.tsx's `expect(fakeEs).toBeDefined()` guards).
let toggleTransportPollOnce: (() => unknown) | undefined

function tasksCalendarToggleTransport(
    seed: FakeTransportSeed,
    delayMs = 40,
): () => void {
    let fakeVersion = 1
    toggleTransportPollOnce = undefined
    const disposeVersion = startServerVersion({
        eventSourceFactory: () => {
            throw new Error('no SSE in storybook')
        },
        fetchVersion: async () => ({ version: fakeVersion }),
        setIntervalFn: fn => {
            toggleTransportPollOnce = fn
            return 0 as unknown as ReturnType<typeof setInterval>
        },
        clearIntervalFn: () => {},
        setTimeoutFn: (fn, ms) =>
            setTimeout(fn, ms) as unknown as ReturnType<typeof setTimeout>,
        clearTimeoutFn: h => clearTimeout(h as unknown as number),
    })

    const inner = fakeTransport(seed)
    setTransport({
        ...inner,
        postJson: async <T,>(path: string, body: unknown): Promise<T> => {
            if (path.startsWith('/rows'))
                await new Promise(resolve => setTimeout(resolve, delayMs))
            return inner.postJson<T>(path, body)
        },
        post: async (path: string, body: unknown): Promise<Response> => {
            if (path === '/tasks/toggle') {
                // Simulate the server having already bumped the version by the time this
                // write's response reaches the client — the same race a fast SSE push wins
                // against the write's own POST promise in production.
                fakeVersion += 1
                await toggleTransportPollOnce?.()
            }
            return inner.post(path, body)
        },
    })

    return disposeVersion
}

/** Regression story for the calendar-toggle-flicker fix: ticking a task chip in the tasks
 *  register used to run `refetchAll` OUTSIDE `startRevalidate`'s transition (BaseView.tsx's
 *  `onChange={refetchAll}` at the `<CalendarView>` site), which suspends the rows resource and
 *  swaps the whole pane to `<Suspense>`'s fallback — unmounting `MonthView` (and every chip in
 *  it) and remounting it once the refetch lands, instead of the SSE path's stale-while-
 *  revalidate treatment (see the comment above `startRevalidate` in BaseView.tsx). Proven by a
 *  `MutationObserver` on the pane: it records whether `[data-testid="month-scroller"]` — the
 *  one stable root `MonthView.tsx` renders (see MonthView.stories.tsx's own use of the same
 *  testid for exactly this "did it get thrown away" question) — is EVER disconnected across a
 *  marker click, not just whether it is present again afterwards (a synchronous unmount +
 *  remount both settle before this play() ever reads the DOM). */
export const CalendarTasksToggleKeepsPane: Story = {
    render: () => {
        const path = 'boards/calendar-tasks.md'
        const body = '---\ntype: base\nmode: tasks\nview: calendar\nsource:\n  kind: tasks\n---\n'
        const today = todayISO()
        const disposeVersion = tasksCalendarToggleTransport({
            files: { [path]: body },
            rows: [
                taskRow('walk the dog', { line: 1, scheduled: today }),
                taskRow('water the plants', { line: 2, scheduled: today }),
            ],
        })
        const prevView = currentView.value
        onMount(() => {
            currentView.value = 'month'
        })
        onCleanup(() => {
            currentView.value = prevView
            disposeVersion()
        })
        // The real pane wraps BaseView (inside FileView) in a <Suspense> — PaneContent.tsx's
        // fallback around FileView. BaseView itself has no Suspense of its own, so mounting it
        // bare here would never observe the fallback swap this story exists to catch.
        return (
            <Suspense fallback={<div data-testid="story-suspense-fallback" />}>
                <BaseView path={path} body={body} />
            </Suspense>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const scroller = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>(
                '[data-testid="month-scroller"]',
            )
            expect(el).toBeTruthy()
            return el!
        })
        await waitFor(() =>
            expect(canvas.getByText('walk the dog')).toBeInTheDocument(),
        )

        // Anti-vacuous guard: `serverVersion.start()` is idempotent (serverVersion.ts's
        // `if (started) return dispose`), so if some earlier story already called it without
        // disposing (e.g. FileView.stories.tsx's remount stories), THIS render's `start()` call
        // is a no-op — `toggleTransportPollOnce` never gets captured, the toggle below never
        // bumps the fake version, `rowCache`/`docCache` stay "fresh," and the whole story would
        // pass without the toggle ever forcing a real refetch. Fail loudly instead of silently.
        expect(toggleTransportPollOnce).toBeDefined()

        let everDisconnected = false
        const observer = new MutationObserver(() => {
            if (!scroller.isConnected) everDisconnected = true
        })
        observer.observe(canvasElement, { childList: true, subtree: true })

        const marker = canvasElement.querySelector<HTMLElement>(
            '[data-testid="task-chip-marker"]',
        )
        expect(marker).toBeTruthy()
        await userEvent.click(marker!)

        // Settle past the delayed /rows refetch the toggle's onChange kicks off.
        await new Promise(resolve => setTimeout(resolve, 200))
        observer.disconnect()

        expect(
            everDisconnected,
            'month-scroller was unmounted during the refetch',
        ).toBe(false)
        expect(scroller.isConnected).toBe(true)
        expect(
            canvasElement.querySelector('[data-testid="month-scroller"]'),
        ).toBe(scroller)
    },
}
