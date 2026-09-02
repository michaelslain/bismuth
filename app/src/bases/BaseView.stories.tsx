// Visual spec for <BaseView> — the unified view host that resolves ANY source (base file /
// inline ```query source / notes / tasks) into rows and picks the right renderer (table, cards,
// kanban, list, bullets, map, heatmap, bar, line, stat, calendar, flashcards). Individual
// renderers already have their own stories (TableView, KanbanView, CardsView, …) driven directly
// off `sampleViewResult()`; THIS file is the one place that exercises the resolution pipeline
// itself — `props.source` (inline YAML, same shape a ```query fence holds) parsed by
// `parseBase()`, resolved via `POST /rows` (fakeTransport, seeded with SAMPLE_ROWS) — end to
// end, the same path a real embedded/base-file view takes.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import { BaseView } from './BaseView'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { SAMPLE_ROWS } from '../ui/_baseFixtures'
import type { Row } from '../../../core/src/bases/types'
import { saveSession } from './flashcardsQueue'
import { todayISO, addDaysISO } from '../../../core/src/dates'

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

/** An embedded ```query fence's own header — the one bar with `embeddedSource` set, which is what
 *  puts the "query" mark in `identity` beside the SOURCE button in `actions` and flushes the bar to
 *  the block edges (`.embeddedBar`). No story exercised this path before, so the mark's rendering
 *  was invisible to every visual check. */
export const EmbeddedQueryHeader: Story = {
    render: () => {
        seedRows()
        return (
            <BaseView
                source={'views:\n  - type: table\n'}
                embeddedSource={{ onReveal: () => {} }}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(canvas.getByText('query')).toBeInTheDocument()
        })
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
 *  16's replacement — see Flashcards.module.css's `.fcmeter`). The gap between the pane's top and
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
 *  separation between them had fallen below the 12px gap used INSIDE each of them. A bar whose
 *  inter-group gap is smaller than its intra-group gap has stopped being two groups. */
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
        expect(groupGap(canvasElement)).toBeGreaterThanOrEqual(12)

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
        // history above this file's `.fcmeter` predecessor in Flashcards.module.css). A count of
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
        const canvas = within(canvasElement)
        expect(isLaidOut(canvas.getByTestId('fc-tally'))).toBe(true)
        // Abbreviated, not whole: the swap tier (640) fired, the drop tier (465) did not.
        expect(isLaidOut(canvas.getByText('HARD'))).toBe(false)
        expect(isLaidOut(canvas.getByText('H'))).toBe(true)
        // Late words are gone at 480 — CRAM's own label, not the whole control.
        expect(isLaidOut(canvas.getByText('CRAM'))).toBe(false)
        expect(canvas.getByTitle(/^Cram:/)).toBeInTheDocument()
        // The two groups still read as two groups. Without the abbreviation this is ~9px.
        expect(groupGap(canvasElement)).toBeGreaterThanOrEqual(12)
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
 *  as FlashcardsView's own first child (`.fcmeter` in Flashcards.module.css, restored 2026-09-02
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
