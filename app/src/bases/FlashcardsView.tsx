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
import { TextButton } from '../ui/TextButton'
import { IconButton } from '../ui/IconButton'
import { Icon } from '../icons/Icon'
import EmptyState from '../ui/EmptyState'
import { Modal } from '../ui/Modal'
import { TextInput } from '../ui/TextInput'
import { VBtn, type ViewBarSlots } from '../ui/ViewBar'
import BarLabel from '../ui/BarLabel'
import { renderMarkdown } from './markdown'
import { EditCardsModal } from './EditCardsModal'
import Heading from '../ui/Heading'
import styles from './Flashcards.module.css'
import type { BaseConfig, Row } from '../../../core/src/bases/types'
import { fileBasename } from '../../../core/src/pathUtils'
import { todayISO } from '../../../core/src/dates'

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
    backField as revScheduleCol,
    type QueueItem,
    type CardDir,
} from './flashcardsQueue'
export { buildQueue, nextPosAfterGrade, type QueueItem, type CardDir }

/** Grade → digit shown on the key badge / bound to the number keys (1-3). */
const GRADE_KEYS: {
    response: 'hard' | 'good' | 'easy'
    key: string
    cls: string
}[] = [
    { response: 'hard', key: '1', cls: 'hard' },
    { response: 'good', key: '2', cls: 'good' },
    { response: 'easy', key: '3', cls: 'easy' },
]

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
 * PROGRESS IS NOT ONE OF THEM — see `.fcprogress` in Flashcards.module.css. The 30-cell AsciiMeter
 * the old header carried is ~210px of glyphs, which no 36px band can hold beside a tally, and it
 * would have forced a new collapse tier of its own. It becomes a 1px rule instead, drawn by the
 * view rather than by the bar: an absolutely positioned child of `.viewbar` would escape to the
 * initial containing block, because `container-type` has not implied layout containment since the
 * CSSWG removed it in 2024 (shipped Chrome 129, Firefox, Safari). That is settled cross-browser
 * behaviour, not a bug to re-test — the measured evidence and the fix are in `.fcprogress`.
 */
export function flashcardsSlots(state: FlashcardsBarState): ViewBarSlots {
    return {
        locus: (
            <div class={styles['count']} data-testid="fc-count">
                <b>{state.position()}</b> / {state.total()}
                <Show when={state.direction()}>
                    {d => (
                        <>
                            {' · '}
                            <span class={styles['card-dir']}>{d()}</span>
                        </>
                    )}
                </Show>
                <Show when={state.cram()}> · cram</Show>
            </div>
        ),
        readouts: (
            /* FIRST TO GO, and the only thing here tagged at all. It is the widest control in the
               bar (~173px), it is a recap rather than something you act on, and every number in it
               is still on screen at the end of the session. `data-bar-drop='1'` is the ONLY level
               ui/ui.css's ladder defines, and a control tagged "2" would keep its attribute, keep
               rendering, and fail nothing.

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
                <span class={styles['a']}>
                    <BarLabel long="HARD" short="H" /> <b>{state.hard()}</b>
                </span>
                <span class={styles['g']}>
                    <BarLabel long="GOOD" short="G" /> <b>{state.good()}</b>
                </span>
                <span class={styles['e']}>
                    <BarLabel long="EASY" short="E" /> <b>{state.easy()}</b>
                </span>
            </div>
        ),
        config: (
            <VBtn
                icon="Zap"
                iconSize={13}
                title="Cram: review every card, no scheduling changes"
                active={state.cram()}
                onClick={() => state.onToggleCram()}
            >
                {/* LATE, not early. A lightning bolt does not say "cram" — it is the same case as
                    the calendar's TODAY, whose calendar glyph does not say "today". */}
                <BarLabel long="CRAM" drop="late" />
            </VBtn>
        ),
        actions: (
            <Show when={state.canEditCards()}>
                <VBtn
                    icon="Layers"
                    iconSize={13}
                    title="Browse, add, edit, and delete every card in this deck"
                    onClick={() => state.onCards()}
                >
                    <BarLabel long="CARDS" drop="early" />
                </VBtn>
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
    const promptCol = (it: QueueItem) =>
        it.dir === 'fwd' ? frontField() : backField()
    const answerCol = (it: QueueItem) =>
        it.dir === 'fwd' ? backField() : frontField()
    const promptHtml = (it: QueueItem) =>
        renderMarkdown(String(it.r.note[promptCol(it)] ?? ''))
    const answerHtml = (it: QueueItem) =>
        renderMarkdown(String(it.r.note[answerCol(it)] ?? ''))

    // Which scheduling columns a direction advances: forward uses the base triple,
    // reverse uses the `*Back` companions so each direction is scheduled independently.
    const scheduleFields = (dir: CardDir) =>
        dir === 'fwd'
            ? { due: dueField(), ease: easeField(), interval: intervalField() }
            : {
                  due: revScheduleCol(dueField()),
                  ease: revScheduleCol(easeField()),
                  interval: revScheduleCol(intervalField()),
              }

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
                        scheduleFields(c.dir),
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

    // Delete the current card and advance: rowDelete drops it from the base, the
    // onReviewed refetch shrinks the queue, and the next card shifts into this pos
    // (so we stay put — same as grading a card out of the due queue).
    //
    // In cram the positional "stay put" isn't enough: the refetch reindexes every
    // higher row, and our cram bookkeeping (the index-keyed `retired` pool, the
    // frozen deck-size total, and `pos`) would otherwise go stale — reading as a
    // premature "Cram complete" or resurfacing an already-mastered card. So we
    // reconcile it against the post-delete deck BEFORE the refetch lands.
    const deleteCurrent = async () => {
        const c = current()
        if (!c || !props.basePath) return
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
        await api.rowDelete(props.basePath, c.index)
        props.onReviewed()
    }

    // Edit/delete icons rendered on BOTH card faces so they flip with the card.
    // stopPropagation keeps a click on them from triggering the card's reveal flip.
    // `hidden` marks the face the user cannot currently see: both faces stay mounted for the CSS
    // 3D flip, and backface-visibility hides the back VISUALLY only — without this a keyboard
    // user tabs into the invisible face's buttons.
    // `hidden` is an ACCESSOR, not a boolean, and it must stay one: this call sits inside <Show>,
    // which compiles to a getter read synchronously inside Show's own tracked createMemo. Calling
    // revealed() here (instead of passing it down) would make cardActions() itself a dependency of
    // THAT memo, so every reveal would tear down and remount both IconButtons instead of just
    // flipping aria-hidden on a persistent node — the exact "destroys focusable buttons" shape this
    // task exists to prevent. Reading hidden() only inside the JSX attribute position below gets
    // the compiler's fine-grained createRenderEffect treatment instead, same as `inert` above it.
    const cardActions = (hidden: () => boolean) => (
        <div
            class={styles['card-actions']}
            onClick={e => e.stopPropagation()}
            aria-hidden={hidden() || undefined}
        >
            <IconButton
                icon="Pencil"
                label="Edit this card"
                iconSize={13}
                onClick={openCardEdit}
            />
            <IconButton
                icon="Trash2"
                label="Delete this card"
                iconSize={13}
                onClick={deleteCurrent}
            />
        </div>
    )

    // ── Keyboard: Space reveals, 1/2/3 grade. Ignored while the edit modal is
    // open or focus is in a text field, so it never fights typing. ──────────
    const onKey = (e: KeyboardEvent) => {
        if (editing() || editingCard()) return
        const el = e.target as HTMLElement | null
        if (
            el &&
            (el.isContentEditable ||
                /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
        )
            return
        if (!current()) return
        if (e.code === 'Space') {
            e.preventDefault()
            if (!revealed()) setRevealed(true)
            return
        }
        if (revealed()) {
            const g = GRADE_KEYS.find(x => x.key === e.key)
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
            {/* Session progress: a 1px accent rule across the top of the deck's own surface, so it
                reads as a tinted continuation of the bar's bottom border — the browser-tab-loading
                idiom. role=progressbar rather than glyphs, because the <AsciiMeter> it replaces
                rendered "[####......]" as literal text a screen reader spells out character by
                character. */}
            <div
                class={styles['fcprogress']}
                style={{ '--fc-progress': `${Math.round(progressPct())}%` }}
                role="progressbar"
                aria-label="Session progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progressPct())}
                data-testid="fc-progress"
            />

            <Show when={editing() && props.basePath}>
                <EditCardsModal
                    rows={props.rows}
                    basePath={props.basePath!}
                    deckName={fileBasename(props.basePath!)}
                    frontField={frontField()}
                    backField={backField()}
                    onClose={() => setEditing(false)}
                    onChanged={() => props.onReviewed()}
                />
            </Show>

            <div class={styles['stage']}>
                <Show
                    when={queue().length > 0}
                    fallback={
                        <EmptyState
                            title={
                                cram()
                                    ? 'No cards in this deck'
                                    : 'No cards due'
                            }
                        >
                            <Show
                                when={!cram()}
                                fallback={
                                    <>
                                        Add rows with <code>front</code> /{' '}
                                        <code>back</code> columns.
                                    </>
                                }
                            >
                                Hit the{' '}
                                <span class={styles['inline-bolt']}>
                                    <Icon value="Zap" size={14} />
                                </span>{' '}
                                button to review everything anyway.
                            </Show>
                        </EmptyState>
                    }
                >
                    <Show
                        when={current() !== null}
                        fallback={
                            <div class={styles['done']}>
                                <div class={styles['big']}>
                                    {cram() ? 'Cram complete' : 'Deck complete'}
                                </div>
                                <div class={styles['sub']}>
                                    <Show
                                        when={cram()}
                                        fallback={
                                            <>
                                                You reviewed <b>{graded()}</b>{' '}
                                                {graded() === 1
                                                    ? 'card'
                                                    : 'cards'}
                                                <Show when={goodCount() > 0}>
                                                    {' '}
                                                    ·{' '}
                                                    <span
                                                        class={
                                                            styles['good-text']
                                                        }
                                                    >
                                                        good
                                                    </span>{' '}
                                                    on most
                                                </Show>
                                                .
                                            </>
                                        }
                                    >
                                        Every card is{' '}
                                        <span class={styles['good-text']}>
                                            easy
                                        </span>{' '}
                                        — you mastered <b>{total()}</b>{' '}
                                        {total() === 1 ? 'card' : 'cards'} in{' '}
                                        <b>{graded()}</b>{' '}
                                        {graded() === 1 ? 'review' : 'reviews'}.
                                    </Show>
                                </div>
                                <TextButton size="lg" onClick={restart}>
                                    REVIEW AGAIN
                                </TextButton>
                            </div>
                        }
                    >
                        <div class={styles['cardwrap']}>
                            {/*
                Keyed by row index + direction via <For> over a single-element array: <For> reconciles
                by item value, so when the current card's index OR direction changes the element is
                disposed and a fresh one is created (instant reset to front + entrance anim). Keying on
                direction too means a bidirectional row's forward→reverse hand-off remounts cleanly
                instead of flipping backward. When only the row data refreshes (same index+dir) the
                value is unchanged, so it does NOT remount. The flip is a transform transition on the
                persistent element, so it only animates when toggling `revealed` on the SAME card.
              */}
                            <For
                                each={[`${current()!.index}:${current()!.dir}`]}
                            >
                                {() => (
                                    <div
                                        class={`${styles['flip-card']} ${styles['card-appear']} ${revealed() ? styles['flipped'] : ''}`}
                                        onClick={() =>
                                            !revealed() && setRevealed(true)
                                        }
                                    >
                                        <div class={styles['flip-inner']}>
                                            {/* .flip-front has no CSS rule of its own (only .flip-back overrides the
                                            shared .flip-face) — left as a bare literal per Flashcards.module.css's header. */}
                                            <div
                                                class={`${styles['flip-face']} flip-front`}
                                                inert={revealed() || undefined}
                                            >
                                                <Show when={props.basePath}>
                                                    {cardActions(() => revealed())}
                                                </Show>
                                                <div
                                                    class={styles['card-md']}
                                                    innerHTML={promptHtml(
                                                        current()!,
                                                    )}
                                                />
                                                <div class={styles['fliphint']}>
                                                    <span class="asc-kbd">
                                                        <span class="asc-key">
                                                            SPACE
                                                        </span>
                                                    </span>{' '}
                                                    to reveal answer
                                                </div>
                                            </div>
                                            <div
                                                class={`${styles['flip-face']} ${styles['flip-back']}`}
                                                inert={!revealed() || undefined}
                                            >
                                                <Show when={props.basePath}>
                                                    {cardActions(() => !revealed())}
                                                </Show>
                                                <div
                                                    class={styles['qcaption']}
                                                    innerHTML={promptHtml(
                                                        current()!,
                                                    )}
                                                />
                                                <div class={styles['fcdiv']} />
                                                <div
                                                    class={`${styles['card-md']} ${styles['abody']}`}
                                                    innerHTML={answerHtml(
                                                        current()!,
                                                    )}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </For>
                        </div>

                        <Show when={revealed()}>
                            <div class={styles['grade-row']}>
                                <For each={GRADE_KEYS}>
                                    {g => (
                                        <button
                                            class={`${styles['grade']} ${styles[g.cls]}`}
                                            onClick={() => grade(g.response)}
                                        >
                                            <span class={styles['g-name']}>
                                                {g.response}
                                            </span>
                                            <span class="asc-kbd">
                                                <span class="asc-key">
                                                    {g.key}
                                                </span>
                                            </span>
                                        </button>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </Show>
                </Show>
            </div>

            <Show when={editingCard() && props.basePath}>
                <Modal
                    onClose={() => setEditingCard(false)}
                    class={`${styles['cards-modal']} ${styles['card-edit-one']}`}
                >
                    <div class={styles['cards-head']}>
                        <Heading level={2} class={styles['cards-title']}>
                            Edit card
                        </Heading>
                        <div class={styles['sp']} />
                        <IconButton
                            icon="X"
                            label="Close"
                            onClick={() => setEditingCard(false)}
                        />
                    </div>
                    <div class={styles['card-edit-one-body']}>
                        <label class={styles['card-edit-labeled']}>
                            <span>Front</span>
                            <TextInput
                                multiline
                                class={styles['card-edit-field']}
                                value={cardFront()}
                                placeholder="Front / prompt…"
                                onInput={setCardFront}
                            />
                        </label>
                        <label class={styles['card-edit-labeled']}>
                            <span>Back</span>
                            <TextInput
                                multiline
                                class={styles['card-edit-field']}
                                value={cardBack()}
                                placeholder="Back / answer…"
                                onInput={setCardBack}
                            />
                        </label>
                        <div class={styles['card-edit-one-actions']}>
                            <TextButton onClick={() => setEditingCard(false)}>
                                CANCEL
                            </TextButton>
                            <TextButton
                                variant="selected"
                                onClick={saveCardEdit}
                            >
                                SAVE
                            </TextButton>
                        </div>
                    </div>
                </Modal>
            </Show>
        </div>
    )
}
