// Visual spec for <FlashcardsView> — the spaced-repetition review UI. Unlike the other Bases
// views it takes a flat `rows: Row[]` (not a `ViewResult`) plus a `BaseConfig` whose
// `views[0]` carries the flashcards field config (frontField/backField/dueField/...). `rows`
// need real front/back/due columns, which `_baseFixtures`' curated dataset doesn't carry, so
// this story mints its own small deck (real FileMeta shape).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { BaseConfig, Row } from '../../../core/src/bases/types'
import { FlashcardsView } from './FlashcardsView'
import { saveSession } from './flashcardsQueue'
import { todayISO, addDaysISO } from '../../../core/src/dates'

const meta = {
    title: 'Bases/FlashcardsView',
    component: FlashcardsView,
    // fullscreen + an explicitly sized Pane wrapper below. Under `layout: "padded"` the host
    // got no height, so `.stage` collapsed and the card floated at the top — the story showed
    // a layout the app never renders.
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FlashcardsView>

export default meta
type Story = StoryObj<typeof meta>

/** A sized stand-in for a real editor pane: FlashcardsView is `height: 100%`, so every story
 *  needs a bounded box or the vertical layout it's built for never happens. */
function Pane(props: { w: string; h?: string; children: any }) {
    return (
        <div
            style={{
                width: props.w,
                height: props.h ?? '620px',
                position: 'relative',
                overflow: 'hidden',
            }}
        >
            {props.children}
        </div>
    )
}

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

const today = todayISO()
const DECK: Row[] = [
    cardRow('card-1', {
        front: 'capital of France',
        back: 'Paris',
        due: today,
    }),
    cardRow('card-2', {
        front: 'capital of Japan',
        back: 'Tokyo',
        due: addDaysISO(today, -3),
    }), // overdue
    cardRow('card-3', {
        front: 'capital of Kenya',
        back: 'Nairobi',
        due: null,
    }), // new card, always due
    cardRow('card-4', {
        front: 'capital of Iceland',
        back: 'Reykjavik',
        due: addDaysISO(today, 14),
    }), // future — excluded from the normal queue
]

const config: BaseConfig = {
    views: [{ type: 'flashcards', name: 'Vocabulary' }],
}

/** Walks the deck end to end, grading each card "easy" via the keyboard shortcut, and returns
 *  each card's FRONT text in the order it was shown. No story in this file passes a `basePath`
 *  to `Default`/`CramMode`, so `persisted` (FlashcardsView.tsx) is always false here and grading
 *  never awaits a row write — the loop is synchronous card-to-card, no network involved.
 *
 *  WHY THIS IS HOW `Default` AND `CramMode` PROVE THEMSELVES (queue item 14). The `· cram` text,
 *  CRAM's active state and the 4-vs-3 count used to live in this view's own header and made the
 *  two stories visibly different at a glance. All three moved into the HOST's view bar when
 *  flashcards became a bar-slot contributor (`flashcardsSlots()` above), and this file's stories
 *  render the stage without a host bar — so for a while `Default` and `CramMode` opened
 *  identically and asserted nothing. The difference that survives on the STAGE is the deck
 *  itself: cram ignores due dates, so the future-dated "Iceland" card (due +14 days, see DECK
 *  above) is reachable in cram and is not reachable in the normal queue. Walking the deck and
 *  recording which fronts appear is what still shows that on the stage. */
async function reviewAllFronts(canvasElement: HTMLElement): Promise<string[]> {
    const seen: string[] = []
    // Bounded well past either queue length (3 normal / 4 cram) so a stuck queue fails the
    // length assertion below instead of hanging the play function.
    for (let i = 0; i < 8; i++) {
        const front = canvasElement.querySelector('.flip-front') as HTMLElement | null
        if (!front) break
        const shown = front.textContent ?? ''
        seen.push(shown)
        await userEvent.click(front)
        await userEvent.keyboard('3') // the "easy" grade key (GRADE_KEYS) — advances the queue
        await waitFor(() => {
            const next = canvasElement.querySelector('.flip-front') as HTMLElement | null
            const nextText = next ? next.textContent ?? '' : null
            // Either the deck finished (no more `.flip-front`) or a DIFFERENT card is now shown —
            // never the same text twice in a row, which is what a stuck grade would look like.
            expect(nextText === null || nextText !== shown).toBe(true)
        })
    }
    return seen
}

/** Normal mode: only cards due today or earlier (3 of the 4 sample cards — the 14-days-out
 *  "Iceland" card is excluded until cram). Paired with `CramMode` below — this story asserts the
 *  future-dated card is EXCLUDED, that one asserts it is included. Neither is meaningful alone;
 *  together they are what "cram ignores due dates" means. */
export const Default: Story = {
    render: () => (
        <Pane w="1100px">
            <FlashcardsView rows={DECK} config={config} onReviewed={() => {}} />
        </Pane>
    ),
    play: async ({ canvasElement }) => {
        const seen = await reviewAllFronts(canvasElement)
        expect(seen).toHaveLength(3)
        expect(seen.some(t => t.includes('Iceland'))).toBe(false)
    },
}

// A distinct basePath keys the module-level session store (flashcardsQueue.ts's `sessions`
// map), so seeding `cram: true` there before mount is picked up by FlashcardsView's own
// `loadSession()` call on render — the same restore path a real tab-switch-and-back exercises,
// not a fabricated prop.
const CRAM_BASE_PATH = 'stories/flashcards-cram-demo.md'
saveSession(CRAM_BASE_PATH, {
    cram: true,
    pos: 0,
    good: 0,
    hard: 0,
    easy: 0,
    retired: [],
})

/** Cram mode, seeded through the REAL session store (flashcardsQueue.ts's `sessions` map), which
 *  is the same restore path a tab-switch-and-back exercises — not a fabricated prop.
 *
 *  WHAT MAKES THIS STORY DIFFER FROM `Default` (queue item 14) — see `reviewAllFronts` above for
 *  the full account. In short: the `· cram` marker, CRAM's active state and the 4-vs-3 count all
 *  moved into the HOST's view bar, which this file's stories don't render, so for a while the two
 *  stories opened identically and this one asserted nothing. What survives on the STAGE is the
 *  deck: cram ignores due dates, so walking it visits the future-dated "Iceland" card that
 *  `Default`'s walk never reaches. */
export const CramMode: Story = {
    render: () => (
        <Pane w="1100px">
            <FlashcardsView
                rows={DECK}
                config={config}
                basePath={CRAM_BASE_PATH}
                onReviewed={() => {}}
            />
        </Pane>
    ),
    play: async ({ canvasElement }) => {
        const seen = await reviewAllFronts(canvasElement)
        expect(seen).toHaveLength(4)
        expect(seen.some(t => t.includes('Iceland'))).toBe(true)
    },
}

/** A narrow pane. This view no longer draws a header of its own — the count, tally, CARDS and CRAM
 *  go up into the HOST's view bar through `onBarSlots` (see `flashcardsSlots` in FlashcardsView.tsx
 *  and the Bases/BaseView `Flashcards*` stories, which are where that bar is exercised). What is
 *  left here is the stage, so this story now covers the card's own narrow-pane layout: it is the
 *  width at which the card stops having horizontal slack. The two regressions it was cut for — an
 *  AsciiMeter breaking across three lines, and the card sliding left over that meter — are both
 *  gone with the strip that held them. */
export const NarrowPane: Story = {
    render: () => (
        <Pane w="900px" h="560px">
            <FlashcardsView rows={DECK} config={config} onReviewed={() => {}} />
        </Pane>
    ),
}

/** A split pane — narrower than the card's own 680px, so the card is sized by `.stage` rather than
 *  by its own max and fills the pane end to end. */
export const SplitPane: Story = {
    render: () => (
        <Pane w="420px" h="560px">
            <FlashcardsView rows={DECK} config={config} onReviewed={() => {}} />
        </Pane>
    ),
}

/** Narrow enough to push the ASCII meter below its default 30 cells (queue item 16's restored
 *  meter — see the `.fcmeter` comment in FlashcardsView.tsx). `fitMeterWidth()`
 *  (ui/ascii/asciiMeterMath.ts) sizes the meter in CELLS from the measured `.fcmeter` box, clamped
 *  to `[6, 30]`; every other story in this file is wide enough that the meter sits at the 30-cell
 *  ceiling, so nothing here previously rendered the shrink path — only `asciiMeterMath.test.ts`
 *  exercised it, headlessly. `.fcmeter` has `padding: var(--sp-4) var(--sp-5) 0` (12px each side),
 *  so a ~230px pane leaves under 210px for the glyph run — comfortably under the ~256px
 *  (32 cells * ~8px) needed to hold the full 30 cells, and comfortably above the 6-cell floor, so
 *  this is a genuine shrink rather than a clamp to the minimum.
 *
 *  TWO TRAPS, both hit for real elsewhere in this plan (see BaseView.stories.tsx's
 *  `expectOneBar`, which guards the SAME meter from BaseView's side):
 *  (1) `meterCells` starts at a safe DEFAULT of 30 and is corrected asynchronously by a
 *      ResizeObserver + `document.fonts.ready`. A bare `waitFor` stops polling on its first
 *      non-throwing check, so it can pass against the pre-correction default before the narrow
 *      value ever lands — SETTLE (a fixed delay past one frame), THEN `waitFor`, not `waitFor`
 *      alone.
 *  (2) `.fcmeter` is `width: 100%` regardless of content and `.asc-meter` is `white-space: pre`
 *      (cannot wrap), so neither box reflects an oversized glyph run. Measure the glyph run's OWN
 *      box (`.asc-meter` inside `[data-testid="fc-progress"]`), not its container's, and check it
 *      has real width — a zero-width box would make the "fewer than 30 cells" comparison
 *      vacuously true. */
export const MeterShrinksNarrow: Story = {
    render: () => (
        <Pane w="230px" h="560px">
            <FlashcardsView rows={DECK} config={config} onReviewed={() => {}} />
        </Pane>
    ),
    play: async ({ canvasElement }) => {
        const meter = canvasElement.querySelector(
            '[data-testid="fc-progress"]',
        ) as HTMLElement
        await expect(meter).not.toBeNull()

        // Settle past the ResizeObserver + font-ready correction before polling — see the trap
        // note above. 200ms is a hundred-plus frames of margin past a callback specified to run
        // before paint, not a tight timing guess.
        await new Promise(resolve => setTimeout(resolve, 200))

        await waitFor(() => {
            const glyphRun = meter.querySelector('.asc-meter') as HTMLElement
            expect(glyphRun).not.toBeNull()
            const glyphBox = glyphRun.getBoundingClientRect()
            // Non-vacuity: a zero-width box would satisfy "fewer than 30 cells" for the wrong
            // reason (nothing rendered at all).
            expect(glyphBox.width).toBeGreaterThan(0)
            // One line — checked by Y-coordinate spread across the glyph run's own fragments, NOT
            // by `getClientRects().length`. `.asc-meter` wraps a bracket text node, a `#`-filled
            // span and a `.`-filled span, and Chrome fragments `getClientRects()` at every one of
            // those child-element boundaries even on a single visual line — this story's 0%-filled
            // meter (an empty `#` span) genuinely reports 4 rects at rest, which would make a
            // rect-count check fail on CORRECT single-line output. The rects' Y coordinates are
            // what actually distinguishes "one line" from "wrapped": identical Y means one line
            // regardless of how many child-element fragments compose it.
            const ys = [...glyphRun.getClientRects()].map(r => r.y)
            expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1)
            // Contained within its own meter box, not run off the right edge (see trap 2 above).
            expect(glyphBox.right).toBeLessThanOrEqual(
                meter.getBoundingClientRect().right + 0.5,
            )
            // The actual demonstration: strip the `[`/`]` brackets AsciiMeter always draws and
            // what remains is exactly `width` glyphs (`#`/`.`) — see AsciiMeter.tsx.
            const cells = (glyphRun.textContent ?? '').length - 2
            expect(cells).toBeLessThan(30)
            expect(cells).toBeGreaterThanOrEqual(6)
        })
    },
}

// `basePath` set so `cardActions()` renders (the ✎/🗑 buttons live on BOTH faces
// unconditionally — see FlashcardsView.tsx's `cardActions`), which every story above leaves
// unexercised since none of them pass a basePath.
const REVEAL_BASE_PATH = 'stories/flashcards-revealed-demo.md'

/** Answer revealed: click the front face, same as a user pressing Space. The CSS-module
 *  migration (2026-08) left every story above at rest, so `.flip-card.flipped`, the grade
 *  row (`.grade`/`.grade.hard`/`.good`/`.easy`), and `.qcaption`/`.card-md.abody`'s active
 *  layout had NO story reaching them at all — an unrendered state is an unprotected state. */
export const Revealed: Story = {
    render: () => (
        <Pane w="1100px">
            <FlashcardsView
                rows={DECK}
                config={config}
                basePath={REVEAL_BASE_PATH}
                onReviewed={() => {}}
            />
        </Pane>
    ),
    play: async ({ canvasElement }) => {
        // Not a Portal case (confirmed by probing: both hits report `inCanvas: true`). The
        // flip-card keeps BOTH faces mounted at once for the CSS 3D flip transform — the front's
        // `.card-md` prompt AND the back's `.qcaption` (which deliberately echoes the same prompt
        // as a caption, per this file's `<For>` comment above) both hold the literal text
        // "capital of France" simultaneously, so a canvas-wide query is genuinely ambiguous
        // between two real elements. Scope to `.flip-front` — a bare, un-hashed literal class
        // (FlashcardsView.tsx keeps it that way on purpose) — to click the face a real user can
        // actually see and hit before the reveal, rather than the back face sitting behind it.
        const front = canvasElement.querySelector('.flip-front') as HTMLElement
        await userEvent.click(await within(front).findByText('capital of France'))
    },
}

/** The hidden face must be inert. Both faces stay mounted for the CSS 3D flip (see
 *  Flashcards.module.css's .flip-inner), and `backface-visibility: hidden` hides the back
 *  VISUALLY without removing it from the tab order — so the Edit/Delete buttons `cardActions()`
 *  renders on both faces used to give a keyboard user two invisible tab stops, and a screen
 *  reader four buttons where there are two. `inert` removes exactly that, and (unlike
 *  `display:none`) does not disturb the transform the flip animates. */
const INERT_BASE_PATH = 'stories/flashcards-inert-demo.md'

export const HiddenFaceIsInert: Story = {
    render: () => (
        <Pane w="1100px">
            <FlashcardsView
                rows={DECK}
                config={config}
                basePath={INERT_BASE_PATH}
                onReviewed={() => {}}
            />
        </Pane>
    ),
    play: async ({ canvasElement }) => {
        // `.flip-front` is a bare, un-hashed literal class kept that way on purpose — see
        // Flashcards.module.css's header and the Revealed story's note. `.flip-back` IS a
        // module local, so match it by prefix rather than by the hashed name.
        const front = canvasElement.querySelector('.flip-front') as HTMLElement
        await expect(front).not.toBeNull()
        const back = canvasElement.querySelector(
            '[class*="flip-back"]',
        ) as HTMLElement
        await expect(back).not.toBeNull()

        // Not revealed: the front is live, the back is inert.
        await expect(front.hasAttribute('inert')).toBe(false)
        await expect(back.hasAttribute('inert')).toBe(true)

        // Exactly one REACHABLE "Edit this card". Both faces still render one — that is
        // deliberate, so the buttons flip with the card (FlashcardsView.tsx's cardActions
        // comment) — but only the visible face's may be reachable. CardEditModalOpen's own
        // comment documents the ambiguity this removes.
        const liveEdits = [
            ...canvasElement.querySelectorAll('[aria-label="Edit this card"]'),
        ].filter(el => !el.closest('[inert]'))
        await expect(liveEdits.length).toBe(1)
        await expect(front.contains(liveEdits[0]!)).toBe(true)
    },
}

// A distinct basePath, seeded via the real session store (same technique as CRAM_BASE_PATH
// above) with `pos` already past the last due card — the same restore path a tab-switch back
// to a finished deck exercises, not a fabricated prop.
const DONE_BASE_PATH = 'stories/flashcards-done-demo.md'
saveSession(DONE_BASE_PATH, {
    cram: false,
    pos: 3, // 3 of the 4 sample cards are due today or earlier — see DECK above
    good: 2,
    hard: 1,
    easy: 0,
    retired: [],
})

/** "Deck complete": `current()` is null once `pos` reaches the queue length, so this only
 *  renders `.done`/`.big`/`.sub`/`.good-text` on the LAST card of a session — no story above
 *  ever gets there. */
export const DeckComplete: Story = {
    render: () => (
        <Pane w="1100px">
            <FlashcardsView
                rows={DECK}
                config={config}
                basePath={DONE_BASE_PATH}
                onReviewed={() => {}}
            />
        </Pane>
    ),
}

/** The single-card edit modal (the card's own ✎ action) — `.card-edit-one`/
 *  `.card-edit-one-body`/`.card-edit-labeled`/`.card-edit-field`/`.card-edit-one-actions` have
 *  no other story reaching them, since it only opens via a click no other story performs. */
const CARD_EDIT_BASE_PATH = 'stories/flashcards-card-edit-demo.md'

export const CardEditModalOpen: Story = {
    render: () => (
        <Pane w="1100px">
            <FlashcardsView
                rows={DECK}
                config={config}
                basePath={CARD_EDIT_BASE_PATH}
                onReviewed={() => {}}
            />
        </Pane>
    ),
    play: async ({ canvasElement }) => {
        // Not a Portal case (confirmed by probing: both hits report `inCanvas: true`). Per
        // FlashcardsView.tsx's own comment on `cardActions`, the edit/delete icons are
        // deliberately rendered on BOTH flip-card faces "so they flip with the card" — both faces
        // stay mounted at once for the CSS 3D transform, so two real `aria-label="Edit this
        // card"` buttons exist in the DOM simultaneously and a canvas-wide query can't tell them
        // apart. (The back face's copy is now `inert` — see HiddenFaceIsInert above — but `inert`
        // only removes it from focus/pointer/the a11y tree, not from the DOM, so it is still a
        // real match here.) Scope to `.flip-front` — a bare, un-hashed literal class kept that
        // way on purpose in FlashcardsView.tsx — to click the copy on the face a real user can
        // actually see and hit, not the one on the face turned away behind it.
        const front = canvasElement.querySelector('.flip-front') as HTMLElement
        await userEvent.click(await within(front).findByLabelText('Edit this card'))
    },
}
