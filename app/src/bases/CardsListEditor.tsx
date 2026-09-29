import { createSignal, For, Show, type Component } from 'solid-js'
import PlainButton from '../ui/PlainButton'
import { IconButton } from '../ui/IconButton'
import { IconTextButton } from '../ui/IconTextButton'
import RemoveRowButton from '../ui/RemoveRowButton'
import EmptyState from '../ui/EmptyState'
import Text from '../ui/Text'
import { matchesKeybinding } from '../keybindings'
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
 *  and moves with Up/Down from the keyboard. */
const CardsListEditor: Component<CardsListEditorProps> = props => {
    let wrap: HTMLDivElement | undefined
    let draftBackRef: HTMLTextAreaElement | undefined
    const [dragFrom, setDragFrom] = createSignal<number | null>(null)
    const [dropTo, setDropTo] = createSignal<number | null>(null)
    const [draftFront, setDraftFront] = createSignal('')
    const [draftBack, setDraftBack] = createSignal('')

    const drop = (to: number) => {
        const from = dragFrom()
        setDragFrom(null)
        setDropTo(null)
        if (from !== null && from !== to) props.onMove(from, to)
    }

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
                        class={`${styles['cards-row']} ${dropTo() === i() ? styles['dropbefore'] : ''} ${dragFrom() === i() ? styles['dragging'] : ''}`}
                        onDragOver={e => {
                            e.preventDefault()
                            setDropTo(i())
                        }}
                        onDrop={e => {
                            e.preventDefault()
                            drop(i())
                        }}
                    >
                        <PlainButton
                            class={styles['cards-num']}
                            title="Drag to reorder, or press Up / Down"
                            aria-label={`move card ${i() + 1}`}
                            data-card-handle={i()}
                            draggable={true}
                            onDragStart={() => setDragFrom(i())}
                            onDragEnd={() => {
                                setDragFrom(null)
                                setDropTo(null)
                            }}
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
