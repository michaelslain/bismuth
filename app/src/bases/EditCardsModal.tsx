import { createSignal, createMemo, onCleanup, Show } from 'solid-js'
import { TextButton } from '../ui/TextButton'
import { IconTextButton } from '../ui/IconTextButton'
import { SegmentedToggle } from '../ui/SegmentedToggle'
import { Icon } from '../icons/Icon'
import Badge from '../ui/Badge'
import Text from '../ui/Text'
import FormModal from '../ui/FormModal'
import ModalHeader from '../ui/ModalHeader'
import ModalBody from '../ui/ModalBody'
import ModalFooter from '../ui/ModalFooter'
import styles from './EditCardsModal.module.css'
import type { Row } from '../../../core/src/bases/types'
import { api } from '../api'
import { pushToast } from '../toastStore'
import { parseBaseFile } from '../../../core/src/bases/parse'
import { fileBasename } from '../../../core/src/pathUtils'
import CardsListEditor from './CardsListEditor'
import BulkCardsEditor from './BulkCardsEditor'
import { resetKeys, stripSchedule } from './flashcardsActions'
import {
    deletedLabel,
    insertAt,
    moveItem,
    parseBulk,
    removeAt,
    validCards,
} from './cardsEdit'

type Note = Record<string, unknown>
type Mode = 'list' | 'bulk'

/**
 * Deck-wide card manager (the review view's "Cards" button). Two modes:
 *  • Cards — a reorderable list of Front/Back rows with live markdown, inline add, delete.
 *  • Bulk add — paste many cards at once (Tab / :: / : / | / , / – or auto-detect) with a preview.
 *
 * A local `cards` array (full note objects) mirrors the base 1:1 — array position IS the backend
 * row index — so edits/adds/deletes/reorders stay in lockstep with the row API without a
 * jarring refetch per keystroke. `onChanged` fires on close to refresh the review queue. The two
 * modes are CardsListEditor and BulkCardsEditor; this component owns the state and the writes.
 */
export function EditCardsModal(props: {
    rows: Row[]
    basePath: string
    frontField: string
    backField: string
    /** SM-2 scheduling columns (defaults match core/src/srs/reviewRow.ts's FORWARD_FIELDS) — read
     *  only to know which keys "reset progress" strips; this modal never schedules a review. */
    dueField?: string
    easeField?: string
    intervalField?: string
    /** A bidirectional deck also schedules a `*Back` companion triple (flashcardsQueue.ts's
     *  `backField`) for the reverse direction — reset clears those too. */
    bidirectional?: boolean
    deckName?: string
    onClose: () => void
    onChanged: () => void
}) {
    const ff = () => props.frontField
    const bf = () => props.backField
    const resetColumns = () =>
        resetKeys(
            {
                due: props.dueField ?? 'due',
                ease: props.easeField ?? 'ease',
                interval: props.intervalField ?? 'interval',
            },
            !!props.bidirectional,
        )

    const [cards, setCards] = createSignal<Note[]>(
        props.rows.map(r => ({ ...r.note })),
    )
    const [mode, setMode] = createSignal<Mode>('list')
    const [busy, setBusy] = createSignal(false)
    let dirty = false
    let closed = false

    const close = () => {
        closed = true
        if (dirty) props.onChanged()
        props.onClose()
    }

    /** Runs one write behind the busy lock; `dirty` marks that the queue needs a refresh. */
    const locked = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
        if (busy()) return undefined
        setBusy(true)
        try {
            const out = await fn()
            dirty = true
            return out
        } finally {
            setBusy(false)
        }
    }

    // ── List-mode mutations (array position === backend row index) ────────
    const commitCell = (index: number, field: string, value: string) =>
        locked(async () => {
            const next = cards().map((n, i) =>
                i === index ? { ...n, [field]: value } : n,
            )
            setCards(next)
            await api.rowUpdate(props.basePath, index, next[index])
        })

    // Deletes are immediate; the toast's `undo` re-appends the card and moves it back into place.
    const removeCard = (index: number) =>
        locked(async () => {
            const gone = cards()[index]
            await api.rowDelete(props.basePath, index)
            setCards(removeAt(cards(), index))
            pushToast(`deleted ${deletedLabel(gone, ff())}`, {
                label: 'undo',
                onClick: () => void restoreCard(index, gone),
            })
        })

    // The toast outlives the modal, so this must not lean on modal state: it counts the rows on
    // disk, waits for any in-flight write (a busy `locked` would silently do nothing), and once the
    // modal has closed it is the one to tell the review queue the deck changed.
    const restoreCard = async (index: number, note: Note) => {
        while (busy()) await new Promise(r => setTimeout(r, 25))
        return locked(async () => {
            const meta = {
                name: fileBasename(props.basePath),
                path: props.basePath,
            }
            const count = parseBaseFile(await api.read(props.basePath), meta)
                .rows.length
            await api.rowCreate(props.basePath, note)
            if (index < count)
                await api.rowReorder(props.basePath, count, index)
            setCards(insertAt(cards(), index, note))
            if (closed) props.onChanged()
        }).catch(e =>
            pushToast(
                `Could not undo: ${e instanceof Error ? e.message : String(e)}`,
            ),
        )
    }

    // Reset progress: drops a card's (or every card's) due/ease/interval columns so it reviews as
    // new again, without touching front/back or any other field.
    const resetCard = (index: number) =>
        locked(async () => {
            const stripped = stripSchedule(cards()[index], resetColumns())
            setCards(cards().map((n, i) => (i === index ? stripped : n)))
            await api.rowUpdate(props.basePath, index, stripped)
        })

    // "Reset all" is inline two-step: the first click just arms it (label flips to a
    // confirmation, auto-disarming after a few seconds); only the second click, while armed,
    // actually writes. No `confirm()`.
    const [confirmResetAll, setConfirmResetAll] = createSignal(false)
    let resetAllTimer: ReturnType<typeof setTimeout> | undefined
    onCleanup(() => clearTimeout(resetAllTimer))
    const resetAll = () => {
        clearTimeout(resetAllTimer)
        setConfirmResetAll(false)
        return locked(async () => {
            const stripped = cards().map(n => stripSchedule(n, resetColumns()))
            setCards(stripped)
            await api.rowUpdateMany(
                props.basePath,
                stripped.map((note, index) => ({ index, note })),
            )
        })
    }
    const onResetAllClick = () => {
        if (confirmResetAll()) {
            void resetAll()
            return
        }
        setConfirmResetAll(true)
        clearTimeout(resetAllTimer)
        resetAllTimer = setTimeout(() => setConfirmResetAll(false), 4000)
    }

    const addCard = async (front: string, back: string): Promise<boolean> => {
        if (!front && !back) return false
        const ok = await locked(async () => {
            const note: Note = { [ff()]: front, [bf()]: back }
            await api.rowCreate(props.basePath, note)
            setCards([...cards(), note])
            return true
        })
        return !!ok
    }

    // The list updates synchronously (so focus can follow the card); the write settles behind it.
    const moveCard = (from: number, to: number): boolean => {
        if (busy() || from === to) return false
        setCards(moveItem(cards(), from, to))
        void locked(() => api.rowReorder(props.basePath, from, to))
        return true
    }

    // ── Bulk mode ─────────────────────────────────────────────────────────
    const [bulkText, setBulkText] = createSignal('')
    const [delim, setDelim] = createSignal('auto')
    const parsed = createMemo(() => parseBulk(bulkText(), delim()))
    const validCount = () => validCards(parsed()).length
    const addBulk = () => {
        const valid = validCards(parsed())
        if (!valid.length) return
        return locked(async () => {
            const added: Note[] = []
            for (const c of valid) {
                const note: Note = { [ff()]: c.front, [bf()]: c.back }
                await api.rowCreate(props.basePath, note)
                added.push(note)
            }
            setCards([...cards(), ...added])
            setBulkText('')
            setMode('list')
        })
    }

    return (
        <FormModal onClose={close} label="edit cards" width={940}>
            <ModalHeader
                title="edit cards"
                subtitle={props.deckName}
                onClose={close}
            />

            <ModalBody>
                <div class={styles['cards-modebar']}>
                    <SegmentedToggle
                        value={mode()}
                        onChange={setMode}
                        size="sm"
                        options={[
                            {
                                id: 'list',
                                label: (
                                    <>
                                        <Icon value="List" /> cards
                                    </>
                                ),
                            },
                            {
                                id: 'bulk',
                                label: (
                                    <>
                                        <Icon value="LayoutGrid" /> bulk add
                                    </>
                                ),
                            },
                        ]}
                    />
                    <div class={styles.sp} />
                    <Show when={mode() === 'list'}>
                        <Text as="span" size="ui" tone="faint" class={styles.hint}>
                            drag # to reorder
                        </Text>
                    </Show>
                </div>

                <Show when={mode() === 'list'}>
                    <CardsListEditor
                        cards={cards()}
                        frontField={ff()}
                        backField={bf()}
                        busy={busy()}
                        onCommit={(i, field, v) => void commitCell(i, field, v)}
                        onRemove={i => void removeCard(i)}
                        onReset={i => void resetCard(i)}
                        onMove={moveCard}
                        onAdd={addCard}
                    />
                </Show>
                <Show when={mode() === 'bulk'}>
                    <BulkCardsEditor
                        text={bulkText()}
                        onText={setBulkText}
                        delim={delim()}
                        onDelim={setDelim}
                        parsed={parsed()}
                    />
                </Show>
            </ModalBody>

            <ModalFooter
                leading={
                    <>
                        <Badge tone="muted" class={styles['cards-count']}>
                            <Text
                                as="span"
                                inherit
                                weight="bold"
                                tone="default"
                            >
                                {cards().length}
                            </Text>{' '}
                            {cards().length === 1 ? 'card' : 'cards'} in deck
                        </Badge>
                        <Show when={cards().length > 0}>
                            <IconTextButton
                                icon="RotateCcw"
                                danger={confirmResetAll()}
                                disabled={busy()}
                                onClick={onResetAllClick}
                            >
                                {confirmResetAll()
                                    ? 'reset all — click again to confirm'
                                    : 'reset all progress'}
                            </IconTextButton>
                        </Show>
                    </>
                }
            >
                <Show
                    when={mode() === 'bulk'}
                    fallback={
                        <TextButton primary onClick={close}>
                            done
                        </TextButton>
                    }
                >
                    <TextButton onClick={() => setMode('list')}>
                        cancel
                    </TextButton>
                    <TextButton
                        primary
                        disabled={busy() || validCount() === 0}
                        onClick={() => void addBulk()}
                    >
                        add {validCount()} cards
                    </TextButton>
                </Show>
            </ModalFooter>
        </FormModal>
    )
}
