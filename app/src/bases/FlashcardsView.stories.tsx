// Visual spec for <FlashcardsView> — the spaced-repetition review UI. Unlike the other Bases
// views it takes a flat `rows: Row[]` (not a `ViewResult`) plus a `BaseConfig` whose
// `view` carries the flashcards field config (frontField/backField/dueField/...). `rows`
// need real front/back/due columns, which `_baseFixtures`' curated dataset doesn't carry, so
// this story mints its own small deck (real FileMeta shape).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { spyApi } from './_apiSpy'
import { toasts, ToastHost } from '../Toast'
import { dismissToast } from '../toastStore'
import type { BaseConfig, Row } from '../../../core/src/bases/types'
import { FlashcardsView } from './FlashcardsView'
import { saveSession } from './flashcardsQueue'
import { todayISO, addDaysISO } from '../../../core/src/dates'
import { settings, setSettings } from '../settings'

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

/** How many times the host was told to refetch (`onReviewed`) — module state the stories reset in
 *  `beforeEach`, because a story's `render` closes over nothing per-run. */
const reviewed = { n: 0 }

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
    view: { type: 'flashcards' },
}

/** Walks the deck end to end, grading each card "easy" via the keyboard shortcut, and returns
 *  each card's FRONT text in the order it was shown. No story in this file passes a `basePath`
 *  to `Default`/`CramMode`, so `persisted` (FlashcardsView.tsx) is always false here and grading
 *  never awaits a row write — the loop is synchronous card-to-card, no network involved.
 *
 *  WHY THIS IS HOW `Default` AND `CramMode` PROVE THEMSELVES (queue item 14). The `// cram` text,
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
        const front = canvasElement.querySelector('[data-face="front"]') as HTMLElement | null
        if (!front) break
        const shown = front.textContent ?? ''
        seen.push(shown)
        await userEvent.click(front)
        await userEvent.keyboard('3') // the "easy" grade key (GRADE_KEYS) — advances the queue
        await waitFor(() => {
            const next = canvasElement.querySelector('[data-face="front"]') as HTMLElement | null
            const nextText = next ? next.textContent ?? '' : null
            // Either the deck finished (no more `[data-face=front]`) or a DIFFERENT card is now shown —
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
    beforeEach: () => {
        reviewed.n = 0
    },
    render: () => (
        <Pane w="1100px">
            <FlashcardsView
                rows={DECK}
                config={config}
                onReviewed={() => reviewed.n++}
            />
        </Pane>
    ),
    play: async ({ canvasElement }) => {
        const seen = await reviewAllFronts(canvasElement)
        expect(seen).toHaveLength(3)
        expect(seen.some(t => t.includes('Iceland'))).toBe(false)
        // Every normal-mode grade tells the host to refetch — once per graded card.
        expect(reviewed.n).toBe(3)
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
 *  the full account. In short: the `// cram` marker, CRAM's active state and the 4-vs-3 count all
 *  moved into the HOST's view bar, which this file's stories don't render, so for a while the two
 *  stories opened identically and this one asserted nothing. What survives on the STAGE is the
 *  deck: cram ignores due dates, so walking it visits the future-dated "Iceland" card that
 *  `Default`'s walk never reaches. */
export const CramMode: Story = {
    beforeEach: () => {
        reviewed.n = 0
    },
    render: () => (
        <Pane w="1100px">
            <FlashcardsView
                rows={DECK}
                config={config}
                basePath={CRAM_BASE_PATH}
                onReviewed={() => reviewed.n++}
            />
        </Pane>
    ),
    play: async ({ canvasElement }) => {
        const seen = await reviewAllFronts(canvasElement)
        expect(seen).toHaveLength(4)
        expect(seen.some(t => t.includes('Iceland'))).toBe(true)
        // Cram is practice, not review: it writes no scheduling and never asks for a refetch.
        expect(reviewed.n).toBe(0)
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

/** Every scrolling overflow seen on ANY frame of a flip, per element and axis, plus how many frames
 *  carried `data-flipping`. A flip lasts 0.5s and its scrollbars lived only mid-turn, so sampling
 *  before and after (what this file's stories used to do) passed while the user watched a
 *  scrollbar flash on every flip. This runs a rAF loop across the whole flip instead.
 *
 *  Watched: the card, `.flip-inner`, everything inside it (both faces, the answer body), and every
 *  ancestor up to <html> — which covers `.cardwrap`, the element that actually overflowed (and
 *  that also flashed a horizontal bar during a NEW card's slide-in entrance, which a sample
 *  spanning a grade catches too). A 3D
 *  rotateY projects the card's near edge LARGER than the card under perspective, and ANY ancestor
 *  whose overflow is auto can turn that into a scrollbar, so the whole chain is checked, not only
 *  the faces. `[data-face=front]` is a `data-` runtime hook (FlipCard.tsx); everything else is reached
 *  through the DOM from it, never by a hashed module class. */
async function sampleFlip(
    front: HTMLElement,
    start: () => Promise<unknown>,
    ms = 750,
): Promise<{ overflows: string[]; flippingFrames: number; frames: number }> {
    const inner = front.parentElement as HTMLElement
    const card = inner.parentElement as HTMLElement
    // Inside the card, a scrolling overflow is only wrong DURING the turn — at rest the showing
    // face's long answer is supposed to scroll, and the hidden face is never painted. Above the
    // card (`.cardwrap` and up), no frame may overflow at all.
    const own: HTMLElement[] = [
        card,
        inner,
        ...Array.from(inner.querySelectorAll<HTMLElement>('*')),
    ]
    const ancestors: HTMLElement[] = []
    for (let a = card.parentElement; a; a = a.parentElement) ancestors.push(a)
    const scrolls = (v: string) => v === 'auto' || v === 'scroll'
    const label = (el: HTMLElement) =>
        el === card
            ? 'flip-card'
            : el === inner
              ? 'flip-inner'
              : `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`
    const overflows = new Set<string>()
    let flippingFrames = 0
    let frames = 0
    const t0 = performance.now()
    const done = new Promise<void>(resolve => {
        const tick = () => {
            frames++
            const turning = inner.hasAttribute('data-flipping')
            if (turning) flippingFrames++
            for (const el of turning ? [...own, ...ancestors] : ancestors) {
                const cs = getComputedStyle(el)
                const dx = el.scrollWidth - el.clientWidth
                const dy = el.scrollHeight - el.clientHeight
                if (scrolls(cs.overflowX) && dx > 0) overflows.add(`${label(el)} x`)
                if (scrolls(cs.overflowY) && dy > 0) overflows.add(`${label(el)} y`)
            }
            if (performance.now() - t0 < ms) requestAnimationFrame(tick)
            else resolve()
        }
        requestAnimationFrame(tick)
    })
    await start()
    await done
    return { overflows: [...overflows], flippingFrames, frames }
}

const reducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

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
        // Both faces stay mounted for the CSS 3D flip, and the back's caption echoes the prompt, so
        // a canvas-wide text query is ambiguous between two real elements. Scope to the front face
        // (`data-face`, the runtime hook FlipCard.tsx sets) — the one a user can actually see and
        // hit before the reveal.
        const front = canvasElement.querySelector('[data-face="front"]') as HTMLElement
        // `[data-face=front]` is a direct child of `.flip-inner`, the element `data-flipping` +
        // the `animationend` listener live on (FlipCard.tsx) — reach it via the DOM
        // parent, not a class query, since `.flip-inner` is a hashed module local.
        const flipInner = front.parentElement as HTMLElement
        // Flip scrollbars, sampled on EVERY frame of the flip (see `sampleFlip`): no element in
        // the card or anywhere above it may show a scrollbar at any point of the turn.
        const flip = await sampleFlip(front, () =>
            userEvent.click(within(front).getByText('capital of France')),
        )
        await expect(flip.overflows).toEqual([])
        // ...and the loop really did straddle the animation, rather than proving nothing by
        // sampling a card at rest (the flip is skipped outright under reduced motion).
        if (!reducedMotion())
            await expect(flip.flippingFrames).toBeGreaterThan(5)

        // No "SPACE to reveal answer" hint any more — deleted along with `.fliphint`
        // (bases-polish Task 6). Space still reveals; this just removes the on-card text.
        await expect(
            canvasElement.textContent?.includes('to reveal answer'),
        ).toBe(false)

        // Once the flip's `animationend` fires, `data-flipping` clears and a long answer can
        // scroll again.
        await waitFor(
            () => {
                expect(flipInner.hasAttribute('data-flipping')).toBe(false)
            },
            { timeout: 2000 },
        )
        await expect(getComputedStyle(front).overflowY).toBe('auto')

        // Grading row: three same-tone TextButtons, no `hard` danger colour and no boxed Kbd
        // chips (both removed by bases-polish Task 6) — each button's title carries the live
        // keybinding instead.
        const hard = await within(canvasElement).findByRole('button', {
            name: 'hard',
        })
        await expect(hard.getAttribute('title')).toBe('hard (1)')
        await expect(
            canvasElement.querySelector('.asc-kbd'),
        ).toBeNull()
    },
}

/** The hidden face must be inert, and the card's actions must not sit inside its reveal button.
 *  Both faces stay mounted for the CSS 3D flip (see FlipCard.module.css's .flip-inner), and
 *  `backface-visibility: hidden` hides the back VISUALLY without removing it from the tab order —
 *  `inert` removes exactly that, and (unlike `display:none`) does not disturb the transform the flip
 *  animates. The actions (edit / reset / delete) are ONE set outside the card button: a control
 *  inside another control is not valid, and a click on one must never flip the card. */
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
        const front = canvasElement.querySelector(
            '[data-face="front"]',
        ) as HTMLElement
        const back = canvasElement.querySelector(
            '[data-face="back"]',
        ) as HTMLElement
        await expect(front).not.toBeNull()
        await expect(back).not.toBeNull()

        // Not revealed: the front is live, the back is inert.
        await expect(front.hasAttribute('inert')).toBe(false)
        await expect(back.hasAttribute('inert')).toBe(true)

        // Exactly one "Edit this card", reachable, and not nested inside the reveal button.
        const edits = canvasElement.querySelectorAll('[aria-label="Edit this card"]')
        await expect(edits.length).toBe(1)
        await expect(edits[0].closest('[inert]')).toBeNull()
        await expect(edits[0].parentElement?.closest('button')).toBeNull()

        // A click on an action must not reveal the card.
        const card = front.closest('button') as HTMLElement
        await expect(card.getAttribute('aria-pressed')).toBe('false')
    },
}

/** Acceptance 5: the flip card is a real button — Tab-reachable, and Enter reveals it. Space is
 *  the deck's own rebindable `flashcard-flip` key (KeyboardDefaultsRevealAndGrade below), so Enter
 *  is what proves the native button semantics. No focus ring is drawn. */
export const FlipCardRevealsOnEnter: Story = {
    render: () => (
        <Pane w="1100px">
            <FlashcardsView rows={DECK} config={config} onReviewed={() => {}} />
        </Pane>
    ),
    play: async ({ canvasElement }) => {
        const card = canvasElement.querySelector(
            'button[aria-pressed]',
        ) as HTMLElement
        await expect(card).not.toBeNull()
        await userEvent.tab()
        await expect(document.activeElement).toBe(card)
        await expect(card.getAttribute('aria-pressed')).toBe('false')
        await userEvent.keyboard('{Enter}')
        await waitFor(() =>
            expect(card.getAttribute('aria-pressed')).toBe('true'),
        )
        await expect(getComputedStyle(card).outlineStyle).toBe('none')
        await expect(
            canvasElement
                .querySelector('[data-face="back"]')!
                .hasAttribute('inert'),
        ).toBe(false)
    },
}

/** Space on a focused action button activates THAT button. The global flip key must not swallow it:
 *  Edit opens the single-card modal and the card stays face-down. */
export const SpaceActivatesFocusedActionButton: Story = {
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
        const card = canvasElement.querySelector(
            'button[aria-pressed]',
        ) as HTMLElement
        const edit = (await within(canvasElement).findByLabelText(
            'Edit this card',
        )) as HTMLElement
        edit.focus()
        await expect(document.activeElement).toBe(edit)
        await userEvent.keyboard(' ')
        await waitFor(() =>
            expect(
                within(document.body).getByPlaceholderText('Front / prompt…'),
            ).toHaveValue('capital of France'),
        )
        await expect(card.getAttribute('aria-pressed')).toBe('false')
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
        // ONE set of card actions, outside the reveal button (see HiddenFaceIsInert), so the query
        // is unambiguous. Clicking Edit opens the single-card modal seeded from the current card.
        await userEvent.click(
            await within(canvasElement).findByLabelText('Edit this card'),
        )
        await waitFor(() =>
            expect(
                within(document.body).getByPlaceholderText('Front / prompt…'),
            ).toHaveValue('capital of France'),
        )
    },
}

// ── Keyboard shortcuts are rebindable settings (FlashcardsView.tsx's `onKey` + `GRADE_KEYS`,
// matched via matchesKeybinding against settings.keybindings — never a hardcoded key literal).
// These two stories are the pair that actually proves it, not just that keys "work": the first
// exercises the REAL keyboard path at the shipped defaults (every story above reveals by
// clicking `[data-face=front]`, which never reaches onKey's flip branch at all), the second rebinds
// both flip and grade-hard and proves the OLD combos go dead while the NEW ones take over — the
// half that catches an onKey a rebind never reaches.

/** Defaults, via the keyboard: Space (flashcard-flip) reveals, then '1' (flashcard-hard)
 *  grades and advances. No basePath, so — same as `Default`/`CramMode` above — `persisted` is
 *  false and grading never awaits a row write. */
export const KeyboardDefaultsRevealAndGrade: Story = {
    render: () => (
        <Pane w="1100px">
            <FlashcardsView rows={DECK} config={config} onReviewed={() => {}} />
        </Pane>
    ),
    play: async ({ canvasElement }) => {
        // Not revealed yet — the grade row only renders when `revealed()` is true.
        expect(
            canvasElement.querySelector('[class*="grade-row"]'),
        ).toBeNull()

        const before = canvasElement.querySelector(
            '[data-face="front"]',
        ) as HTMLElement
        const shownBefore = before.textContent ?? ''

        await userEvent.keyboard(' ')
        await waitFor(() => {
            expect(
                canvasElement.querySelector('[class*="grade-row"]'),
            ).not.toBeNull()
        })

        // Space still reveals with the "SPACE to reveal answer" hint gone (bases-polish Task 6
        // deleted `.fliphint`), and the grade row carries no boxed Kbd chip any more — the
        // keybinding now lives only in each button's `title`.
        await expect(
            canvasElement.textContent?.includes('to reveal answer'),
        ).toBe(false)
        await expect(canvasElement.querySelector('.asc-kbd')).toBeNull()
        const hardBtn = await within(canvasElement).findByRole('button', {
            name: 'hard',
        })
        await expect(hardBtn.getAttribute('title')).toBe('hard (1)')

        await userEvent.keyboard('1')
        await waitFor(() => {
            const next = canvasElement.querySelector(
                '[data-face="front"]',
            ) as HTMLElement | null
            const nextText = next ? next.textContent ?? '' : null
            expect(nextText === null || nextText !== shownBefore).toBe(true)
        })
    },
}

/** Graded BEFORE the flip finished — Space, then '1' straight away. The card is disposed
 *  mid-animation, so its `animationend` never fires; when `flipping` lived on the view rather than
 *  the card it stayed set and the NEXT card mounted with `data-flipping` stuck on, its faces
 *  pinned to `overflow: hidden` so a long answer could never scroll. The flag now belongs to the
 *  keyed card, so the next card must mount at rest. */
export const GradedMidFlipStartsAtRest: Story = {
    render: () => (
        <Pane w="1100px">
            <FlashcardsView rows={DECK} config={config} onReviewed={() => {}} />
        </Pane>
    ),
    play: async ({ canvasElement }) => {
        const first = canvasElement.querySelector('[data-face="front"]') as HTMLElement
        const shownBefore = first.textContent ?? ''
        // Sampled across the aborted flip AND the next card's slide-in entrance, which shares
        // `.cardwrap` (the one ancestor that ever overflowed) with the card it replaces.
        const run = await sampleFlip(first, () => userEvent.keyboard(' 1'))
        await expect(run.overflows).toEqual([])
        let next: HTMLElement | null = null
        await waitFor(() => {
            next = canvasElement.querySelector('[data-face="front"]') as HTMLElement | null
            expect(next).not.toBeNull()
            expect(next!.textContent).not.toBe(shownBefore)
        })
        const nextInner = next!.parentElement as HTMLElement
        await expect(nextInner.hasAttribute('data-flipping')).toBe(false)
        await expect(getComputedStyle(next!).overflowY).toBe('auto')
        // And it stays at rest past the length of the flip it never started.
        await new Promise(r => setTimeout(r, 700))
        await expect(nextInner.hasAttribute('data-flipping')).toBe(false)
    },
}

const LONG_ANSWER = Array.from(
    { length: 40 },
    (_, i) => `${i + 1}. step ${i + 1} of the long answer`,
).join('\n')

/** A long answer: the flip shows no scrollbar on any frame (the faces go `overflow: hidden` for
 *  the turn and the turn's geometry keeps `.cardwrap` clear), and once it settles the answer
 *  scrolls again — the one overflow that is supposed to exist. */
export const LongAnswerScrollsAfterFlip: Story = {
    render: () => (
        <Pane w="1100px">
            <FlashcardsView
                rows={[
                    cardRow('card-long', {
                        front: 'the forty steps',
                        back: LONG_ANSWER,
                        due: null,
                    }),
                ]}
                config={config}
                onReviewed={() => {}}
            />
        </Pane>
    ),
    play: async ({ canvasElement }) => {
        const front = canvasElement.querySelector('[data-face="front"]') as HTMLElement
        const inner = front.parentElement as HTMLElement
        const back = front.nextElementSibling as HTMLElement
        const flip = await sampleFlip(front, () => userEvent.keyboard(' '))
        await expect(flip.overflows).toEqual([])
        if (!reducedMotion())
            await expect(flip.flippingFrames).toBeGreaterThan(5)
        await waitFor(
            () => expect(inner.hasAttribute('data-flipping')).toBe(false),
            { timeout: 2000 },
        )
        // Settled: SOMETHING in the back face scrolls the answer, and actually moves.
        const scroller = [back, ...Array.from(back.querySelectorAll<HTMLElement>('*'))].find(
            el =>
                getComputedStyle(el).overflowY === 'auto' &&
                el.scrollHeight > el.clientHeight,
        )
        await expect(scroller).toBeDefined()
        scroller!.scrollTop = 60
        await expect(scroller!.scrollTop).toBeGreaterThan(0)
    },
}

/** Rebinds flashcard-flip to 'f' and flashcard-hard to 'j', proves the OLD combos (Space, '1')
 *  now do nothing, and that the NEW combos do exactly what Space/'1' used to. Lowercase letters
 *  only — `userEvent.keyboard` presses Shift for an uppercase letter, and matching is EXACT on
 *  modifiers, so a capital combo here would silently never match. `settings` is a module-level
 *  store shared by every story in the run (same pattern as Editor.stories.tsx's rebind stories),
 *  so the rebind is restored in `finally` regardless of assertion outcome. */
export const RebindingKeysReplacesTheOldOnes: Story = {
    render: () => (
        <Pane w="1100px">
            <FlashcardsView rows={DECK} config={config} onReviewed={() => {}} />
        </Pane>
    ),
    play: async ({ canvasElement }) => {
        const restoreFlip = settings.keybindings['flashcard-flip']
        const restoreHard = settings.keybindings['flashcard-hard']
        setSettings('keybindings', 'flashcard-flip', 'f')
        setSettings('keybindings', 'flashcard-hard', 'j')
        try {
            // The OLD flip combo (Space) is now inert. A fixed wait, not a poll: the assertion
            // is that nothing ever happens, so there is no true condition to poll for (same
            // idiom as Editor.stories.tsx's TheOldComboStopsFiringAfterARebind).
            await userEvent.keyboard(' ')
            await new Promise(resolve => setTimeout(resolve, 200))
            expect(
                canvasElement.querySelector('[class*="grade-row"]'),
            ).toBeNull()

            // The NEW flip combo ('f') reveals.
            const before = canvasElement.querySelector(
                '[data-face="front"]',
            ) as HTMLElement
            const shownBefore = before.textContent ?? ''
            await userEvent.keyboard('f')
            await waitFor(() => {
                expect(
                    canvasElement.querySelector('[class*="grade-row"]'),
                ).not.toBeNull()
            })

            // The OLD grade combo ('1') is now inert — same card, still revealed.
            await userEvent.keyboard('1')
            await new Promise(resolve => setTimeout(resolve, 200))
            const stillFront = canvasElement.querySelector(
                '[data-face="front"]',
            ) as HTMLElement
            expect(stillFront.textContent ?? '').toBe(shownBefore)

            // The NEW grade combo ('j') grades hard and advances.
            await userEvent.keyboard('j')
            await waitFor(() => {
                const next = canvasElement.querySelector(
                    '[data-face="front"]',
                ) as HTMLElement | null
                const nextText = next ? next.textContent ?? '' : null
                expect(nextText === null || nextText !== shownBefore).toBe(
                    true,
                )
            })
        } finally {
            setSettings('keybindings', 'flashcard-flip', restoreFlip)
            setSettings('keybindings', 'flashcard-hard', restoreHard)
        }
    },
}

// ── Bidirectional ─────────────────────────────────────────────────────────────────────────────
// A bidirectional deck queues a forward AND a reverse entry per row, each scheduled by its own
// column triple (`due` / `dueBack`). The rows live in a signal and the `reviewCardRow` spy moves the
// graded column into the future the way the server does, so grading really drops the entry from the
// due queue and the NEXT entry shows — real state, asserted in play().
const biConfig: BaseConfig = {
    view: { type: 'flashcards', bidirectional: true },
}
const BI_BASE_PATH = 'stories/flashcards-bidirectional-demo.md'
const [biRows, setBiRows] = createSignal<Row[]>(DECK)
let biSpy: ReturnType<typeof spyApi> | undefined

export const Bidirectional: Story = {
    beforeEach: () => {
        reviewed.n = 0
        setBiRows(DECK)
        biSpy = spyApi(['reviewCardRow'], {
            reviewCardRow: (...args) => {
                const [, index, , fields] = args as [
                    string,
                    number,
                    string,
                    { due: string },
                ]
                setBiRows(rows =>
                    rows.map((r, i) =>
                        i === index
                            ? {
                                  ...r,
                                  note: {
                                      ...r.note,
                                      [fields.due]: addDaysISO(today, 3),
                                  },
                              }
                            : r,
                    ),
                )
            },
        })
        return biSpy.restore
    },
    render: () => (
        <Pane w="1100px">
            <FlashcardsView
                rows={biRows()}
                config={biConfig}
                basePath={BI_BASE_PATH}
                onReviewed={() => reviewed.n++}
            />
        </Pane>
    ),
    play: async ({ canvasElement }) => {
        const shown = () =>
            (
                canvasElement.querySelector(
                    '[data-face="front"]',
                ) as HTMLElement | null
            )?.textContent ?? ''
        // Forward entry first: the prompt is the FRONT column.
        expect(shown()).toContain('capital of France')
        await userEvent.click(
            canvasElement.querySelector('[data-face="front"]') as HTMLElement,
        )
        await userEvent.keyboard('3')
        // The same row's reverse entry comes next: its prompt is the BACK column.
        await waitFor(() => expect(shown()).toContain('Paris'))
        await userEvent.click(
            canvasElement.querySelector('[data-face="front"]') as HTMLElement,
        )
        await userEvent.keyboard('3')
        await waitFor(() => expect(shown()).toContain('capital of Japan'))

        // Each direction wrote its OWN schedule columns, for the same row, and the host was told
        // twice.
        const calls = biSpy!.named('reviewCardRow')
        expect(calls).toHaveLength(2)
        const cols = calls.map(c => (c.args[3] as { due: string }).due)
        expect(cols).toEqual(['due', 'dueBack'])
        expect(calls.map(c => c.args[1])).toEqual([0, 0])
        expect(reviewed.n).toBe(2)
    },
}

const FAILED_DELETE_BASE_PATH = 'stories/flashcards-failed-delete-demo.md'
saveSession(FAILED_DELETE_BASE_PATH, { cram: true, pos: 0, good: 0, hard: 0, easy: 0, retired: [] })

/** A rejected rowDelete leaves the session untouched: the same card stays on screen (the counters
 *  that would have moved `pos` onto the next card never changed) and the base is not refetched. */
export const FailedDeleteLeavesCounters: Story = {
    render: () => (
        <Pane w="1100px">
            <FlashcardsView
                rows={DECK}
                config={config}
                basePath={FAILED_DELETE_BASE_PATH}
                onReviewed={() => reviewed.n++}
            />
        </Pane>
    ),
    beforeEach: () => {
        reviewed.n = 0
        const spy = spyApi(['rowDelete'], {
            rowDelete: () => Promise.reject(new Error('disk full')),
        })
        return spy.restore
    },
    play: async ({ canvasElement }) => {
        const front = () => canvasElement.querySelector('[data-face="front"]')?.textContent ?? ''
        const before = await waitFor(() => {
            const t = front()
            expect(t).not.toBe('')
            return t
        })
        await userEvent.click(await within(canvasElement).findByLabelText(/delete/i))
        await waitFor(() =>
            expect(toasts().some(t => t.message.includes('Could not delete the card'))).toBe(true),
        )
        expect(front()).toBe(before)
        expect(reviewed.n).toBe(0)
    },
}

const UNDO_DELETE_BASE_PATH = 'stories/flashcards-undo-delete-demo.md'
saveSession(UNDO_DELETE_BASE_PATH, { cram: true, pos: 0, good: 0, hard: 0, easy: 0, retired: [] })
// What the base file holds once the first card is deleted — undo re-counts rows from it.
const AFTER_DELETE =
    '---\ntype: base\n---\n\n| front | back |\n| --- | --- |\n| capital of Japan | Tokyo |\n| capital of Kenya | Nairobi |\n| capital of Iceland | Reykjavik |\n'

/** Deleting the current card is immediate and raises `deleted card <front>` with `[undo]`; undo
 *  writes the card back (a `rowCreate` of the same note, then a `rowReorder` to its old index) and
 *  the same card is on screen again. The rows are a signal the fake writes edit, standing in for
 *  the host's refetch. */
let setUndoRows: (r: Row[]) => void = () => {}
let undoSpy: ReturnType<typeof spyApi>

export const DeleteWithUndo: Story = {
    render: () => {
        const [rows, setRows] = createSignal(DECK)
        setUndoRows = setRows
        return (
            <>
                <Pane w="1100px">
                    <FlashcardsView
                        rows={rows()}
                        config={config}
                        basePath={UNDO_DELETE_BASE_PATH}
                        onReviewed={() => reviewed.n++}
                    />
                </Pane>
                <ToastHost />
            </>
        )
    },
    beforeEach: () => {
        reviewed.n = 0
        for (const t of toasts()) dismissToast(t.id)
        undoSpy = spyApi(['rowDelete', 'rowCreate', 'rowReorder', 'read'], {
            rowDelete: () => setUndoRows(DECK.slice(1)),
            rowCreate: () => {},
            rowReorder: () => setUndoRows(DECK),
            read: async () => AFTER_DELETE,
        })
        return undoSpy.restore
    },
    play: async ({ canvasElement }) => {
        const spy = undoSpy
        const front = () => canvasElement.querySelector('[data-face="front"]')?.textContent?.trim() ?? ''
        const before = await waitFor(() => {
            const t = front()
            expect(t).not.toBe('')
            return t
        })
        await userEvent.click(await within(canvasElement).findByLabelText(/delete this card/i))
        await waitFor(() => expect(front()).not.toBe(before))
        expect(spy.named('rowDelete')[0].args).toEqual([UNDO_DELETE_BASE_PATH, 0])
        const toast = toasts().at(-1)!
        expect(toast.message).toBe(`deleted card ${before}`)
        expect(toast.action?.label).toBe('undo')

        // Click the toast's own `[undo]` — the real affordance, not the store's callback.
        await userEvent.click(await within(document.body).findByRole('button', { name: /undo/i }))
        await waitFor(() => expect(front()).toBe(before))
        expect(spy.named('rowCreate')).toHaveLength(1)
        expect(spy.named('rowReorder')).toHaveLength(1)
        expect(spy.named('rowCreate')[0].args[1]).toMatchObject({ front: before })
        expect(spy.named('rowReorder')[0].args).toEqual([UNDO_DELETE_BASE_PATH, 3, 0])
    },
}
