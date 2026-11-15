import { createSignal, For, onCleanup, Show, type Component } from 'solid-js'
import PlainButton from '../ui/PlainButton'
import { IconButton } from '../ui/IconButton'
import { IconTextButton } from '../ui/IconTextButton'
import RemoveRowButton from '../ui/RemoveRowButton'
import EmptyState from '../ui/EmptyState'
import Text from '../ui/Text'
import { matchesKeybinding } from '../keybindings'
import { isDismissKey } from '../ui/widgetKeys'
import { edgeScrollStep, moveTarget, pastThreshold, slotForTile } from './pageSortDrag'
import CardCell from './CardCell'
import styles from './CardsListEditor.module.css'

export type CardsListEditorProps = {
    cards: Record<string, unknown>[]
    frontField: string
    backField: string
    /** A write is in flight: the row actions disable so a second one cannot interleave. */
    busy: boolean
    onCommit: (index: number, field: string, value: string) => void
    onRemove: (index: number) => void
    onReset: (index: number) => void
    /** Returns true when the move happened, so the handle can keep keyboard focus on the card. */
    onMove: (from: number, to: number) => boolean
    /** Resolves true once the card was created, which clears the draft row. */
    onAdd: (front: string, back: string) => Promise<boolean>
}

const text = (n: Record<string, unknown>, field: string) =>
    String(n[field] ?? '')

/** The Cards mode of EditCardsModal: a reorderable list of Front/Back rows with live markdown,
 *  an inline draft row to add one, per-row reset + delete. The `#` handle drags with the pointer
 *  (Escape cancels) and moves with Up/Down from the keyboard. */
const CardsListEditor: Component<CardsListEditorProps> = props => {
    let wrap: HTMLDivElement | undefined
    let draftBackRef: HTMLTextAreaElement | undefined
    // The card being dragged by its `#` handle, and the slot a drop lands in (before card `at`;
    // cards.length = after the last). Pointer events: HTML5 drag-and-drop never reaches the app's
    // WKWebView.
    const [dragFrom, setDragFrom] = createSignal<number | null>(null)
    const [dropAt, setDropAt] = createSignal<number | null>(null)
    const [draftFront, setDraftFront] = createSignal('')
    const [draftBack, setDraftBack] = createSignal('')
    let press: { from: number; x: number; y: number; id: number } | null = null
    let pointerY = 0
    let pointerX = 0
    let scrollFrame = 0

    const slotAt = (x: number, y: number): number | null => {
        const el = document.elementFromPoint(x, y)
        if (!el || !wrap?.contains(el)) return dropAt()
        if (el.closest('[data-card-draft]')) return props.cards.length
        const row = el.closest<HTMLElement>('[data-card-row]')
        if (!row) return dropAt()
        const r = row.getBoundingClientRect()
        return slotForTile(r.top, r.height, y, Number(row.dataset.cardRow))
    }
    const track = () => {
        const w = wrap
        if (dragFrom() === null || !w) return
        const r = w.getBoundingClientRect()
        const step = edgeScrollStep(r.top, r.bottom, pointerY)
        if (step) {
            w.scrollTop += step
            setDropAt(slotAt(pointerX, pointerY))
        }
        scrollFrame = requestAnimationFrame(track)
    }
    const stop = () => {
        press = null
        cancelAnimationFrame(scrollFrame)
        setDragFrom(null)
        setDropAt(null)
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', stop)
        window.removeEventListener('keydown', onKey, true)
    }
    const onPointerMove = (e: PointerEvent) => {
        if (!press || e.pointerId !== press.id) return
        pointerX = e.clientX
        pointerY = e.clientY
        if (dragFrom() === null) {
            if (!pastThreshold(e.clientX - press.x, e.clientY - press.y)) return
            setDragFrom(press.from)
            scrollFrame = requestAnimationFrame(track)
        }
        e.preventDefault()
        setDropAt(slotAt(e.clientX, e.clientY))
    }
    const onUp = (e: PointerEvent) => {
        if (!press || e.pointerId !== press.id) return
        const from = dragFrom()
        const at = from === null ? null : slotAt(e.clientX, e.clientY)
        stop()
        if (from === null || at === null) return
        const to = moveTarget(from, at)
        if (to !== from) props.onMove(from, to)
    }
    const onKey = (e: KeyboardEvent) => {
        if (!isDismissKey(e) || dragFrom() === null) return
        e.preventDefault()
        e.stopPropagation()
        stop()
    }
    const onPress = (e: PointerEvent, i: number) => {
        if (e.button !== 0) return
        press = { from: i, x: e.clientX, y: e.clientY, id: e.pointerId }
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', stop)
        window.addEventListener('keydown', onKey, true)
    }
    onCleanup(stop)

    const addDraft = async () => {
        const ok = await props.onAdd(draftFront().trim(), draftBack().trim())
        if (!ok) return
        setDraftFront('')
        setDraftBack('')
    }

    // Up/Down on a focused handle moves that card one place. Focus follows the card: a reorder
    // re-keys the row, and a moved element drops focus.
    const moveByKey = (e: KeyboardEvent, index: number) => {
        const up = matchesKeybinding(e, 'ArrowUp')
        const down = matchesKeybinding(e, 'ArrowDown')
        if (!up && !down) return
        e.preventDefault()
        const to = up ? index - 1 : index + 1
        if (to < 0 || to >= props.cards.length) return
        if (props.onMove(index, to))
            wrap
                ?.querySelector<HTMLElement>(`[data-card-handle="${to}"]`)
                ?.focus()
    }

    return (
        <div ref={wrap} class={styles['cards-listwrap']}>
            <div class={styles['cards-collbl']}>
                <Text as="span" inherit>
                    #
                </Text>
                <Text as="span" inherit>
                    front
                </Text>
                <Text as="span" inherit>
                    back
                </Text>
                <div />
            </div>
            <Show when={props.cards.length === 0}>
                <EmptyState title="no cards yet">
                    add the first one below
                </EmptyState>
            </Show>
            <For each={props.cards}>
                {(n, i) => (
                    <div
                        data-testid="cards-row"
                        data-card-row={i()}
                        data-drop={dropAt() === i() ? 'before' : dropAt() === i() + 1 && i() === props.cards.length - 1 ? 'after' : undefined}
                        data-dragging={dragFrom() === i() ? '' : undefined}
                        class={styles['cards-row']}
                    >
                        <PlainButton
                            class={styles['cards-num']}
                            title="Drag to reorder, or press Up / Down"
                            aria-label={`move card ${i() + 1}`}
                            data-card-handle={i()}
                            onPointerDown={e => onPress(e, i())}
                            onKeyDown={e => moveByKey(e, i())}
                        >
                            <Text as="span" inherit>
                                {i() + 1}
                            </Text>
                        </PlainButton>
                        <CardCell
                            value={text(n, props.frontField)}
                            field="front"
                            placeholder="front…"
                            onCommit={v => props.onCommit(i(), props.frontField, v)}
                        />
                        <CardCell
                            value={text(n, props.backField)}
                            field="back"
                            placeholder="back…"
                            onCommit={v => props.onCommit(i(), props.backField, v)}
                        />
                        <div class={styles['cards-del']}>
                            <IconButton
                                icon="RotateCcw"
                                label="Reset this card's progress"
                                size="sm"
                                disabled={props.busy}
                                onClick={() => props.onReset(i())}
                            />
                            <RemoveRowButton
                                label="Delete card"
                                onClick={() => props.onRemove(i())}
                            />
                        </div>
                    </div>
                )}
            </For>

            <div
                data-testid="draft-row"
                data-card-draft
                class={`${styles['cards-row']} ${styles['cards-draft']}`}
            >
                <div class={styles['cards-mark']}>
                    <Text as="span" inherit>
                        +
                    </Text>
                </div>
                <CardCell
                    draft
                    field="front"
                    value={draftFront()}
                    placeholder="front of new card…"
                    onInput={setDraftFront}
                    onEnter={() => draftBackRef?.focus()}
                />
                <CardCell
                    draft
                    field="back"
                    value={draftBack()}
                    placeholder="back…"
                    onInput={setDraftBack}
                    onEnter={() => void addDraft()}
                    inputRef={el => {
                        draftBackRef = el
                    }}
                />
                <div class={styles['cards-del']} />
            </div>
            <div class={styles['cards-addrow']}>
                <IconTextButton
                    icon="Plus"
                    disabled={props.busy}
                    onClick={() => void addDraft()}
                >
                    add card
                </IconTextButton>
            </div>
        </div>
    )
}

export default CardsListEditor
