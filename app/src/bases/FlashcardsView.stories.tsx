// Visual spec for <FlashcardsView> — the spaced-repetition review UI. Unlike the other Bases
// views it takes a flat `rows: Row[]` (not a `ViewResult`) plus a `BaseConfig` whose
// `views[0]` carries the flashcards field config (frontField/backField/dueField/...). `rows`
// need real front/back/due columns, which `_baseFixtures`' curated dataset doesn't carry, so
// this story mints its own small deck (real FileMeta shape).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { BaseConfig, Row } from '../../../core/src/bases/types'
import { FlashcardsView } from './FlashcardsView'
import { saveSession } from './flashcardsQueue'
import { todayISO, addDaysISO } from '../../../core/src/dates'

const meta = {
    title: 'Bases/FlashcardsView',
    component: FlashcardsView,
    // fullscreen + an explicitly sized Pane wrapper below. Under `layout: "padded"` the host
    // got no height, so `.stage` collapsed and the card floated at the top — the story showed
    // a layout the app never renders, and hid the header/card collision this view actually had.
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

/** Normal mode: only cards due today or earlier (3 of the 4 sample cards — the 14-days-out
 *  "Iceland" card is excluded until cram). */
export const Default: Story = {
    render: () => (
        <Pane w="1100px">
            <FlashcardsView rows={DECK} config={config} onReviewed={() => {}} />
        </Pane>
    ),
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

/** Cram mode (seeded via the real session store): reviews every card regardless of due date,
 *  including the future-dated "Iceland" card the normal queue excludes. */
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
}

/** The width the header strip actually breaks at. Two regressions live here: the progress
 *  meter splitting `[`, its cells and `]` onto three lines (a global `.empty` rule turning
 *  the cell run into a block), and the card sliding left over the meter and the
 *  HARD/GOOD/EASY tally (the header used to be an absolute overlay on a full-height stage). */
export const NarrowPane: Story = {
    render: () => (
        <Pane w="900px" h="560px">
            <FlashcardsView rows={DECK} config={config} onReviewed={() => {}} />
        </Pane>
    ),
}

/** A split pane — narrower than the card's own 680px, so the card is at `92vw` and there is
 *  no horizontal slack at all between it and the header. */
export const SplitPane: Story = {
    render: () => (
        <Pane w="420px" h="560px">
            <FlashcardsView rows={DECK} config={config} onReviewed={() => {}} />
        </Pane>
    ),
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
