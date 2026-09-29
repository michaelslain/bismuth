import {
    createSignal,
    createMemo,
    createEffect,
    untrack,
    onMount,
    onCleanup,
    Show,
    For,
} from 'solid-js'
import { api } from '../api'
import { pushToast } from '../Toast'
import { TextButton } from '../ui/TextButton'
import { IconButton } from '../ui/IconButton'
import { TextInput } from '../ui/TextInput'
import Text from '../ui/Text'
import FormModal from '../ui/FormModal'
import ModalHeader from '../ui/ModalHeader'
import ModalBody from '../ui/ModalBody'
import ModalFooter from '../ui/ModalFooter'
import SettingsGrid from '../ui/SettingsGrid'
import SettingsField from '../ui/SettingsField'
import { type ViewBarSlots } from '../ui/ViewBar'
import { IconTextButton } from '../ui/IconTextButton'
import BarLabel from '../ui/BarLabel'
import IconBar from '../ui/IconBar'
import { parseCombo } from '../ui/ascii/parseCombo'
import { renderMarkdown } from './markdown'
import { EditCardsModal } from './EditCardsModal'
import FlipCard from './FlipCard'
import FlashcardsSummary from './FlashcardsSummary'
import FlashcardsProgress from './FlashcardsProgress'
import {
    answerColumn,
    promptColumn,
    resetKeys,
    scheduleColumns,
    stripSchedule,
} from './flashcardsActions'
import styles from './FlashcardsView.module.css'
import type { BaseConfig, Row } from '../../../core/src/bases/types'
import { fileBasename } from '../../../core/src/pathUtils'
import { todayISO } from '../../../core/src/dates'
import { settings } from '../settings'
import { matchesKeybinding } from '../keybindings'
import type { KeybindingId } from '../../../core/src/keybindings'

// Pure review-queue logic lives in its own module so it can be unit-tested headlessly
// without importing this component (Solid client-only code, Solid client-only code). Import
// for local use, and re-export to preserve the existing `./FlashcardsView` public surface.
import {
    buildQueue,
    nextPosAfterGrade,
    nextCramPos,
    reindexRetiredAfterDelete,
    itemKey,
    canGrade,
    progressTotal,
    loadSession,
    saveSession,
    type QueueItem,
    type CardDir,
} from './flashcardsQueue'

export { buildQueue, nextPosAfterGrade, type QueueItem, type CardDir }

/** Grade → keybinding id, matched via `matchesKeybinding` and shown on the key badge
 *  (`settings.keybindings[id]`) so a rebind changes both the match and the display. */
const GRADE_KEYS: {
    response: 'hard' | 'good' | 'easy'
    id: KeybindingId
}[] = [
    { response: 'hard', id: 'flashcard-hard' },
    { response: 'good', id: 'flashcard-good' },
    { response: 'easy', id: 'flashcard-easy' },
]

/** Plain-text rendering of a grade button's live keybinding, for its `title` — reuses
 *  `parseCombo` (Kbd's own combo parser) rather than re-deriving the Mod/Shift/etc. glyphs, and
 *  takes only the FIRST alternative and its first cap: a grade key is always a single key
 *  ("1"/"2"/"3" by default, or whatever a rebind sets it to), never a chord. */
function gradeKeyLabel(id: KeybindingId): string {
    return parseCombo(settings.keybindings[id])[0]?.[0] ?? ''
}

/** Everything the deck's contribution to the view bar reads, as ACCESSORS. Plain values would be
 *  read once at construction and never again — the slots are built exactly once per mounted deck
 *  (see `onBarSlots` below), so a snapshot would freeze the count at "1 / 3" forever. */
export type FlashcardsBarState = {
    /** Normal mode: the 1-indexed card you are on. Cram: cards mastered so far. */
    position: () => number
    total: () => number
    /** 'front → back' / 'back → front' on a bidirectional deck; undefined otherwise. */
    direction: () => string | undefined
    cram: () => boolean
    hard: () => number
    good: () => number
    easy: () => number
    /** False for a deck with no base file to write edits back to (an embedded ```query), where
     *  CARDS has nothing to open. An ACCESSOR like the rest — a deck's base path arrives with the
     *  host's row resolution and a plain boolean would latch whatever it was at construction. */
    canEditCards: () => boolean
    onCards: () => void
    onToggleCram: () => void
}

/**
 * The deck's contribution to whichever view bar it lands in. Four REGIONS, not one block — the
 * same shape calendar/components/Toolbar.tsx's `calendarSlots()` returns, and for the same reason:
 * a flashcards base is always a `type: base` md FILE, so BaseView's bar is ALWAYS drawn, and a
 * second header of the view's own stacked straight underneath it. That measured 36 + 94 = 130px of
 * chrome above the card, the worst in the app.
 *
 *   locus    — the count. "where am I inside this deck", which is exactly what `locus` asks.
 *   readouts — the session tally.
 *   config   — CRAM: it governs what this session reviews and whether it writes scheduling.
 *   actions  — CARDS: the one thing here that opens something.
 *
 * PROGRESS IS NOT ONE OF THEM — it is the `.fcmeter` AsciiMeter drawn on the deck's own STAGE
 * (below, in the render body), not in the bar. The 30-cell meter is ~210px of glyphs, which no
 * 36px band can hold beside a tally and which would force a new collapse tier of its own; the
 * stage has the room the bar does not. It briefly became a 1px `.fcprogress` rule instead
 * (2026-08), out of flow and drawn by the view rather than the bar for the same containing-block
 * reason an absolutely positioned bar child would have failed — but the user asked for the meter
 * back (2026-09-02: "i liked that flashcards ascii meter"), so `.fcprogress` is gone and the
 * meter lives on the stage again, sized from its measured slot (ui/ascii/asciiMeterMath.ts's
 * fitMeterWidth) rather than the deleted rule's `42vw`.
 */
export function flashcardsSlots(state: FlashcardsBarState): ViewBarSlots {
    return {
        locus: (
            <div class={styles['count']} data-testid="fc-count">
                <Text as="span" inherit weight="bold" tone="default">
                    {state.position()}
                </Text>{' '}
                / {state.total()}
                <Show when={state.direction()}>
                    {d => (
                        <>
                            {' // '}
                            <Text
                                as="span"
                                inherit
                                class={styles['card-dir']}
                            >
                                {d()}
                            </Text>
                        </>
                    )}
                </Show>
                <Show when={state.cram()}> // cram</Show>
            </div>
        ),
        readouts: (
            /* LAST TO GO (see the level note below), and the only thing here tagged at all. It is the widest control in the
               bar (~173px), it is a recap rather than something you act on, and every number in it
               is still on screen at the end of the session. Level 1 is the NARROWEST tier and so
               the LAST to go — the ladder counts up from the floor, and a level names a measured
               WIDTH, not a rank. Do not reuse a level you have not measured this bar against: the
               numbers 2-4 were measured against the CHAT bar, and nothing typechecks a `data-`
               attribute, so a wrong one drops this control at someone else's width in silence.

               IT ALSO ABBREVIATES ON THE WAY DOWN, and that is what saves this bar from needing a
               tier of its own. Whole and un-abbreviated the tally is ~173px — by far the largest
               single thing in the row — and measuring the states the way the ladder's comment
               prescribes puts "everything present, late words gone" at 457px of content, i.e. 8px
               under the drop-1 tier at 465. The bar technically FITS there and still reads wrong:
               `justify-content: space-between` has ~9px left to separate the two groups, which is
               less than the 12px gap INSIDE each of them, so the count and the tally fuse into one
               string ("1 / 3 HARD 0"). No numeric probe saw that; the screenshot did. Abbreviating
               at the existing 640 tier takes the tally to ~62px and the same state to 410px, which
               clears 465 by 55px — so the shared ladder absorbs this bar with no near-duplicate
               tier bolted on 4px from an existing one. */
            <div class={styles['tally']} data-bar-drop="1" data-testid="fc-tally">
                <Text
                    as="span"
                    inherit
                    class={styles['a']}
                >
                    <BarLabel long="HARD" short="H" />{' '}
                    <Text as="span" inherit weight="bold" class={styles['tally-n']}>
                        {state.hard()}
                    </Text>
                </Text>
                <Text
                    as="span"
                    inherit
                    class={styles['g']}
                >
                    <BarLabel long="GOOD" short="G" />{' '}
                    <Text as="span" inherit weight="bold" class={styles['tally-n']}>
                        {state.good()}
                    </Text>
                </Text>
                <Text
                    as="span"
                    inherit
                    class={styles['e']}
                >
                    <BarLabel long="EASY" short="E" />{' '}
                    <Text as="span" inherit weight="bold" class={styles['tally-n']}>
                        {state.easy()}
                    </Text>
                </Text>
            </div>
        ),
        config: (
            <IconTextButton
                icon="Zap"
                title="Cram: review every card, no scheduling changes"
                variant={state.cram() ? 'selected' : 'normal'}
                onClick={() => state.onToggleCram()}
            >
                {/* LATE, not early. A lightning bolt does not say "cram" — it is the same case as
                    the calendar's TODAY, whose calendar glyph does not say "today". */}
                <BarLabel long="cram" drop="late" />
            </IconTextButton>
        ),
        actions: (
            <Show when={state.canEditCards()}>
                <IconTextButton
                    icon="Layers"
                    title="Browse, add, edit, and delete every card in this deck"
                    onClick={() => state.onCards()}
                >
                    <BarLabel long="cards" drop="early" />
                </IconTextButton>
            </Show>
        ),
    }
}

/**
 * Flashcards view over a base's rows. Cards are table rows (front/back/due/ease/interval).
 * Reviewing flips to the back (front kept as a small italic caption) and writes fixed-SM-2
 * scheduling back to the row. Cram mode reviews ALL cards ignoring due dates and never changes
 * scheduling. Faces render markdown (mono prose font; `code` monospace).
 *
 * NO HEADER OF ITS OWN. The count, tally, progress, CARDS and CRAM go UP to the host's view bar
 * through `onBarSlots` (see flashcardsSlots above); this component renders only the stage — the
 * flip card and its per-grade-accented grade row. Keyboard: Space reveals, 1/2/3 grade.
 *
 * Animation: the 3D flip (rotateY) only plays when revealing the SAME card (front -> back on
 * "Show answer"). Advancing to a NEW card remounts the card element (keyed by row index + dir),
 * so it resets to the front instantly and plays a crisp scale+fade entrance instead of flipping
 * backward.
 */
export function FlashcardsView(props: {
    rows: Row[]
    config: BaseConfig
    basePath?: string
    onReviewed: () => void
    /** Where this deck's bar controls go. The host owns the ONE view bar and hands the slots to
     *  it; called with `undefined` on unmount so the bar sheds them with the deck.
     *
     *  PUSHED UP RATHER THAN PULLED DOWN, unlike the calendar — `calendarSlots()` can be called
     *  from anywhere because the calendar's state is module-level signals (calendar/state.ts),
     *  whereas a deck's queue, tally and cram flag are per-instance and restored per basePath.
     *  Lifting them to a module store to match would be a much larger change than removing a
     *  header bar. Rendered without this prop (its own stories), the deck simply has no bar. */
    onBarSlots?: (slots: ViewBarSlots | undefined) => void
}) {
    const view = () => props.config.views[0] ?? { type: 'flashcards', name: '' }
    const frontField = () => view().frontField ?? 'front'
    const backField = () => view().backField ?? 'back'
    const dueField = () => view().dueField ?? 'due'
    const easeField = () => view().easeField ?? 'ease'
    const intervalField = () => view().intervalField ?? 'interval'
    const bidirectional = () => !!view().bidirectional

    // Restore any in-flight session for this deck: switching AWAY from the flashcards
    // tab unmounts this component, so without a restore the cram flag, queue position,
    // and per-grade tally would all reset to zero on return. Keyed by base path; a deck
    // with no base path (embedded query) simply starts fresh every mount.
    const restored = loadSession(props.basePath)
    const [cram, setCram] = createSignal(restored.cram)

    // The review queue: due cards normally; ALL cards in cram mode (order preserved).
    // Bidirectional decks emit a forward + reverse entry per row (see flashcardsQueue).
    // `today` is derived inside the memo via todayISO() so it's the LOCAL date and is
    // re-evaluated on every recompute (not captured once at mount, in UTC).
    const queue = createMemo(() =>
        buildQueue(props.rows, dueField(), todayISO(), cram(), bidirectional()),
    )

    const [pos, setPos] = createSignal(restored.pos)
    const [revealed, setRevealed] = createSignal(false)
    // In-flight lock: true while a grade's async row-write / refetch is settling, so a
    // second press can't advance a second card (see canGrade / the double-skip fix).
    const [grading, setGrading] = createSignal(false)

    // Per-session tally for the host bar's `readouts` region — one bucket per SM-2 grade so EASY
    // shows
    // distinctly (it used to be folded into GOOD, hiding it from the progress surface).
    const [hardCount, setHardCount] = createSignal(restored.hard)
    const [goodCount, setGoodCount] = createSignal(restored.good)
    const [easyCount, setEasyCount] = createSignal(restored.easy)

    // Cram-until-easy pool: the itemKey()s of cards already rated "easy" this cram
    // session. In cram mode a card graded good/hard stays IN the pool and resurfaces
    // until it's finally easy; only "easy" retires it (see nextCramPos). Empty in
    // normal mode. A new Set is assigned on each change so the signal stays reactive.
    const [retired, setRetired] = createSignal<Set<string>>(
        new Set(restored.retired),
    )

    // Persist the session on every state change so a tab switch (unmount) leaves the
    // latest position, tally, and cram pool in the module store for the next mount.
    createEffect(() => {
        saveSession(props.basePath, {
            cram: cram(),
            pos: pos(),
            good: goodCount(),
            hard: hardCount(),
            easy: easyCount(),
            retired: [...retired()],
        })
    })

    const current = () => (pos() < queue().length ? queue()[pos()] : null)
    const graded = () => hardCount() + goodCount() + easyCount()
    // Distinct cards mastered (rated "easy") this cram session — the cram progress
    // numerator, since re-reviews make the raw grade count (`graded`) exceed the deck.
    const mastered = () => retired().size

    // The progress denominator is ANCHORED ONCE per session and then frozen, so the
    // displayed total can never drift as you review. Computing it live (the old
    // `graded + queue.length`) made the count climb by one per grade in cram mode
    // (there the queue length is constant while `graded` grows) and flicker during
    // the post-grade refetch in normal mode — the reported "count changes between
    // cram and normal, and sometimes goes up randomly". `progressTotal` gives the
    // mode-correct starting size (cram = all cards; normal = due count, reconstructed
    // as graded + remaining so a mid-session resume still anchors correctly).
    const [sessionTotal, setSessionTotal] = createSignal<number | null>(null)
    createEffect(() => {
        const len = queue().length // reactive: re-anchors when a new session repopulates the queue
        if (sessionTotal() === null && len > 0) {
            setSessionTotal(progressTotal(len, untrack(graded), untrack(cram)))
        }
    })
    const total = () =>
        sessionTotal() ?? progressTotal(queue().length, graded(), cram())
    // Progress numerator: normal mode counts grades (each due card is graded once);
    // cram counts MASTERED (easy) cards, since cards loop until easy and the grade
    // count would otherwise blow past the deck size / 100%.
    const progressCount = () => (cram() ? mastered() : graded())
    const progressPct = () => {
        const t = total()
        return t === 0 ? 0 : (progressCount() / t) * 100
    }

    // Prompt = the side being asked; answer = the side revealed. For a reverse card the
    // back column is the prompt and the front column is the answer.
    const promptHtml = (it: QueueItem) =>
        renderMarkdown(
            String(
                it.r.note[promptColumn(it.dir, frontField(), backField())] ??
                    '',
            ),
        )
    const answerHtml = (it: QueueItem) =>
        renderMarkdown(
            String(
                it.r.note[answerColumn(it.dir, frontField(), backField())] ??
                    '',
            ),
        )

    // Which scheduling columns a direction advances (see flashcardsActions.ts).
    const baseSchedule = () => ({
        due: dueField(),
        ease: easeField(),
        interval: intervalField(),
    })

    const grade = async (response: 'hard' | 'good' | 'easy') => {
        const c = current()
        // Single-advance lock: bail unless the answer is revealed AND no prior grade is
        // still settling. Guarding on `revealed` alone left an async gap where a
        // re-reveal + re-press double-graded the same card ("skips it twice").
        if (!c || !canGrade({ revealed: revealed(), grading: grading() }))
            return
        setGrading(true)
        setRevealed(false)
        if (response === 'hard') setHardCount(n => n + 1)
        else if (response === 'easy') setEasyCount(n => n + 1)
        else setGoodCount(n => n + 1)
        // Cram mode never writes scheduling — it's practice, not review.
        const persisted = !cram() && !!props.basePath
        try {
            if (cram()) {
                // Cram-until-easy: only an "easy" grade retires the card from the pool; a
                // good/hard grade leaves it in so it resurfaces on a later wrap. nextCramPos
                // scans forward (wrapping) for the next still-unmastered card, or -1 when
                // every card is easy → out-of-range pos shows the "Cram complete" screen.
                const pool = new Set(retired())
                if (response === 'easy') pool.add(itemKey(c))
                setRetired(pool)
                const np = nextCramPos(queue(), pos(), pool)
                setPos(np === -1 ? queue().length : np)
            } else {
                // Track the card by its stable row index (c.index), not the positional queue
                // offset: reviewCardRow pushes the card's due date forward so it drops out of
                // the due-only queue on the onReviewed refetch. The shorter queue shifts the
                // next card into the current pos, so we stay put (mirrors deleteCurrent)
                // rather than incrementing into a queue whose membership just changed.
                if (persisted)
                    await api.reviewCardRow(
                        props.basePath!,
                        c.index,
                        response,
                        scheduleColumns(c.dir, baseSchedule()),
                    )
                setPos(nextPosAfterGrade(pos(), { cram: false, persisted }))
                props.onReviewed()
            }
        } finally {
            setGrading(false)
        }
    }

    const resetTally = () => {
        setPos(0)
        setRevealed(false)
        setHardCount(0)
        setGoodCount(0)
        setEasyCount(0)
        // Empty the cram-until-easy pool so a restarted / re-toggled session re-masters
        // every card from scratch.
        setRetired(new Set<string>())
        // Drop the frozen denominator so the next queue (new mode / restarted session)
        // re-anchors the total from scratch.
        setSessionTotal(null)
    }

    const restart = () => {
        resetTally()
        if (!cram()) props.onReviewed()
    }

    const toggleCram = () => {
        setCram(!cram())
        resetTally()
    }

    // ── Deck-wide "Cards" modal (browse / add / edit / delete every card) ──
    const [editing, setEditing] = createSignal(false)

    // ── Per-card actions, on the card itself: edit this card / delete this card ──
    const [editingCard, setEditingCard] = createSignal(false)
    const [cardFront, setCardFront] = createSignal('')
    const [cardBack, setCardBack] = createSignal('')

    const openCardEdit = () => {
        const c = current()
        if (!c) return
        setCardFront(String(c.r.note[frontField()] ?? ''))
        setCardBack(String(c.r.note[backField()] ?? ''))
        setEditingCard(true)
    }

    const saveCardEdit = async () => {
        const c = current()
        if (!c || !props.basePath) return
        await api.rowUpdate(props.basePath, c.index, {
            ...c.r.note,
            [frontField()]: cardFront(),
            [backField()]: cardBack(),
        })
        setEditingCard(false)
        props.onReviewed()
    }

    // Reset the current card's progress: strips its due/ease/interval columns (and, on a
    // bidirectional deck, their `*Back` companions) so it reviews as new again — front/back and
    // every other field are untouched. Mirrors EditCardsModal's per-card "reset progress".
    const resetCurrentCard = async () => {
        const c = current()
        if (!c || !props.basePath) return
        const next = stripSchedule(
            c.r.note,
            resetKeys(baseSchedule(), bidirectional()),
        )
        await api.rowUpdate(props.basePath, c.index, next)
        props.onReviewed()
    }

    // Delete the current card and advance: rowDelete drops it from the base, the
    // onReviewed refetch shrinks the queue, and the next card shifts into this pos
    // (so we stay put — same as grading a card out of the due queue).
    //
    // In cram the positional "stay put" isn't enough: the refetch reindexes every
    // higher row, and our cram bookkeeping (the index-keyed `retired` pool, the
    // frozen deck-size total, and `pos`) would otherwise go stale — reading as a
    // premature "Cram complete" or resurfacing an already-mastered card. So we
    // reconcile it against the post-delete deck BEFORE the refetch lands (the delete itself has
    // already succeeded by then, so a failure never touches the counters).
    const deleteCurrent = async () => {
        const c = current()
        if (!c || !props.basePath) return
        // Delete first: the counters below only move once the row is really gone, so a failed
        // delete leaves the session exactly as it was.
        try {
            await api.rowDelete(props.basePath, c.index)
        } catch (e) {
            pushToast(`Could not delete the card: ${(e as Error).message}`)
            return
        }
        setRevealed(false)
        if (cram()) {
            const perRow = bidirectional() ? 2 : 1 // fwd+rev entries a row contributes
            const newRetired = new Set(
                reindexRetiredAfterDelete(retired(), c.index),
            )
            // buildQueue is pure, so the cram queue after the row is removed can be
            // computed now (cram ignores due dates, so this matches the coming refetch).
            const newQueue = buildQueue(
                props.rows.filter((_, i) => i !== c.index),
                dueField(),
                todayISO(),
                true,
                bidirectional(),
            )
            setRetired(newRetired)
            // The frozen total drops by the entries this row contributed.
            setSessionTotal(t => (t === null ? t : Math.max(0, t - perRow)))
            // Reposition onto the next still-unmastered card in the shrunk deck (or the
            // completion sentinel when none remain). Scanning from pos()-1 makes the slot
            // the deleted card vacated the first candidate; nextCramPos never lands on a
            // retired card and reports -1 only when every survivor is mastered.
            const np =
                newQueue.length === 0
                    ? 0
                    : nextCramPos(newQueue, pos() - 1, newRetired)
            setPos(np === -1 ? newQueue.length : np)
        }
        props.onReviewed()
    }

    // Edit / reset / delete for the current card, handed to FlipCard's `actions` slot — which pins
    // them outside its reveal button, so a click on one never triggers the flip.
    const cardActions = () => (
        <IconBar label="Card actions">
            <IconButton
                icon="Pencil"
                label="Edit this card"
                onClick={openCardEdit}
                size="sm"
            />
            <IconButton
                icon="RotateCcw"
                label="Reset this card's progress"
                onClick={resetCurrentCard}
                size="sm"
            />
            <IconButton
                icon="Trash2"
                label="Delete this card"
                danger
                onClick={deleteCurrent}
                size="sm"
            />
        </IconBar>
    )

    // ── Keyboard: flashcard-flip reveals, flashcard-hard/good/easy grade — all
    // rebindable via settings.keybindings (core/src/keybindings.ts), matched via
    // matchesKeybinding. Ignored while the edit modal is open or focus is in a
    // text field, so it never fights typing. ──────────────────────────────────
    const onKey = (e: KeyboardEvent) => {
        if (editing() || editingCard()) return
        const el = e.target as HTMLElement | null
        if (
            el &&
            (el.isContentEditable ||
                /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
        )
            return
        // Space on a focused action/grade button must activate it; only the flip card (aria-pressed) flips.
        if (el?.tagName === 'BUTTON' && !el.hasAttribute('aria-pressed')) return
        if (!current()) return
        if (matchesKeybinding(e, settings.keybindings['flashcard-flip'])) {
            e.preventDefault()
            if (!revealed()) setRevealed(true)
            return
        }
        if (revealed()) {
            const g = GRADE_KEYS.find(x =>
                matchesKeybinding(e, settings.keybindings[x.id]),
            )
            if (g) {
                e.preventDefault()
                void grade(g.response)
            }
        }
    }
    onMount(() => window.addEventListener('keydown', onKey))
    onCleanup(() => window.removeEventListener('keydown', onKey))

    // Hand the bar controls to the host, ONCE, in an effect rather than in the body: the slots are
    // built inside this component's owner (so their closures stay live), but publishing them writes
    // a signal the host's own bar reads, and doing that mid-render would be a write inside another
    // computation. onMount runs after render and before paint, so the bar never paints without
    // them. Cleared on unmount, so switching the base to another view kind sheds them immediately.
    onMount(() =>
        props.onBarSlots?.(
            flashcardsSlots({
                // Normal mode: the 1-indexed card you're on. Cram: how many cards are mastered
                // (easy) so far — cards loop until easy, so a position index would be meaningless.
                position: () =>
                    cram() ? mastered() : Math.min(graded() + 1, total()),
                total,
                direction: () =>
                    bidirectional() && current()
                        ? current()!.dir === 'fwd'
                            ? 'front → back'
                            : 'back → front'
                        : undefined,
                cram,
                hard: hardCount,
                good: goodCount,
                easy: easyCount,
                // A deck with no base file has nothing to write edits back to, so CARDS has
                // nothing to open — the same `<Show when={props.basePath}>` the header used.
                canEditCards: () => !!props.basePath,
                onCards: () => setEditing(true),
                onToggleCram: toggleCram,
            }),
        ),
    )
    onCleanup(() => props.onBarSlots?.(undefined))

    return (
        <div class={styles['flashcards-host']}>
            <FlashcardsProgress percent={progressPct()} />

            <Show when={editing() && props.basePath}>
                <EditCardsModal
                    rows={props.rows}
                    basePath={props.basePath!}
                    deckName={fileBasename(props.basePath!)}
                    frontField={frontField()}
                    backField={backField()}
                    dueField={dueField()}
                    easeField={easeField()}
                    intervalField={intervalField()}
                    bidirectional={bidirectional()}
                    onClose={() => setEditing(false)}
                    onChanged={() => props.onReviewed()}
                />
            </Show>

            <div class={styles['stage']}>
                <Show
                    when={queue().length > 0}
                    fallback={
                        <FlashcardsSummary
                            variant="empty"
                            cram={cram()}
                            reviewed={graded()}
                            good={goodCount()}
                            total={total()}
                        />
                    }
                >
                    <Show
                        when={current() !== null}
                        fallback={
                            <FlashcardsSummary
                                variant="done"
                                cram={cram()}
                                reviewed={graded()}
                                good={goodCount()}
                                total={total()}
                                onRestart={restart}
                            />
                        }
                    >
                        <div class={styles['cardwrap']}>
                            {/*
                Keyed by row index + direction via <For> over a single-element array: <For> reconciles
                by item value, so when the current card's index OR direction changes the element is
                disposed and a fresh one is created (instant reset to front + entrance anim). Keying on
                direction too means a bidirectional row's forward→reverse hand-off remounts cleanly
                instead of flipping backward. When only the row data refreshes (same index+dir) the
                value is unchanged, so it does NOT remount. The flip is a keyframe animation on the
                persistent element, so it only animates when toggling `revealed` on the SAME card.
              */}
                            <For
                                each={[`${current()!.index}:${current()!.dir}`]}
                            >
                                {() => (
                                    <FlipCard
                                        revealed={revealed()}
                                        onReveal={() => setRevealed(true)}
                                        promptHtml={promptHtml(current()!)}
                                        answerHtml={answerHtml(current()!)}
                                        actions={
                                            props.basePath
                                                ? cardActions()
                                                : undefined
                                        }
                                    />
                                )}
                            </For>
                        </div>

                        <Show when={revealed()}>
                            <div class={styles['grade-row']}>
                                <For each={GRADE_KEYS}>
                                    {g => (
                                        <TextButton
                                            title={`${g.response} (${gradeKeyLabel(g.id)})`}
                                            onClick={() => grade(g.response)}
                                        >
                                            {g.response}
                                        </TextButton>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </Show>
                </Show>
            </div>

            <Show when={editingCard() && props.basePath}>
                <FormModal
                    onClose={() => setEditingCard(false)}
                    label="edit card"
                    width={420}
                >
                    <ModalHeader
                        title="edit card"
                        onClose={() => setEditingCard(false)}
                    />
                    <ModalBody>
                        <SettingsGrid>
                            <SettingsField label="front">
                                <TextInput
                                    multiline
                                    value={cardFront()}
                                    placeholder="Front / prompt…"
                                    onInput={setCardFront}
                                />
                            </SettingsField>
                            <SettingsField label="back">
                                <TextInput
                                    multiline
                                    value={cardBack()}
                                    placeholder="Back / answer…"
                                    onInput={setCardBack}
                                />
                            </SettingsField>
                        </SettingsGrid>
                    </ModalBody>
                    <ModalFooter>
                        <TextButton onClick={() => setEditingCard(false)}>
                            cancel
                        </TextButton>
                        <TextButton primary onClick={saveCardEdit}>
                            save
                        </TextButton>
                    </ModalFooter>
                </FormModal>
            </Show>
        </div>
    )
}
