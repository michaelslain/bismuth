// The trailing "+ column" ghost column at the end of a kanban board's column row. Click overlays
// a text input on the ghost header (KanbanColumnNameInput, shared with KanbanColumnMenu's
// rename field); Enter adds (refusing a duplicate name inline, matching `appendColumnKey`'s own
// refusal so the two never disagree), Escape or a blur while empty cancels back to the ghost. The
// trigger stays mounted (hidden) under the input so the swap never moves text or reflows the board,
// and the input is placed from the trigger's own measured glyph (kanbanAddColumnOverlay.ts) so its
// text lands on the "column" glyph whatever the trigger's leading geometry is.
// Presentational only — KanbanView owns persisting the new column (optimistic `columns` order +
// the `properties.options` append) via `onAdd`.
import { createSignal, Show, type Component } from 'solid-js'
import IconTextButton from '../ui/IconTextButton'
import KanbanColumnNameInput from './KanbanColumnNameInput'
import { overlayOrigin, type OverlayOrigin } from './kanbanAddColumnOverlay'
import styles from './KanbanAddColumn.module.css'

export type KanbanAddColumnProps = {
    /** Existing column keys — a name matching one of these (after trim) is refused. */
    existing: string[]
    onAdd: (name: string) => void
    className?: string
}

const KanbanAddColumn: Component<KanbanAddColumnProps> = props => {
    const [editing, setEditing] = createSignal(false)
    const [origin, setOrigin] = createSignal<OverlayOrigin | null>(null)
    let ghost: HTMLDivElement | undefined
    let overlay: HTMLDivElement | undefined

    /** Reads the resting "column" glyph box (a Range over the trigger's one text node — the
     *  brackets are pseudo-elements and the icon an svg, so it is the only one) and the input's own
     *  text inset, both off this component's own tree by tag, and places the overlay from them. */
    function placeOverlay(): void {
        const button = ghost?.querySelector('button')
        const input = overlay?.querySelector('input')
        if (!ghost || !button || !input) return
        const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT, {
            acceptNode: n =>
                n.textContent?.trim()
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP,
        })
        const text = walker.nextNode()
        if (!text) return
        const range = document.createRange()
        range.selectNodeContents(text)
        const cs = getComputedStyle(input)
        const px = (v: string) => parseFloat(v) || 0
        const top = px(cs.paddingTop) + px(cs.borderTopWidth)
        const bottom = px(cs.paddingBottom) + px(cs.borderBottomWidth)
        setOrigin(
            overlayOrigin(
                ghost.getBoundingClientRect(),
                range.getBoundingClientRect(),
                {
                    left: px(cs.paddingLeft) + px(cs.borderLeftWidth),
                    top,
                    contentHeight:
                        input.getBoundingClientRect().height - top - bottom,
                },
            ),
        )
    }

    return (
        <div
            ref={ghost}
            class={[styles.ghost, props.className].filter(Boolean).join(' ')}
            data-editing={editing() ? '' : undefined}
            data-testid="kanban-add-column"
        >
            {/* The trigger stays mounted while editing — hidden, not removed — so the ghost
                keeps its exact rest footprint and the board never reflows; the input overlays
                it out of flow (KanbanAddColumn.module.css's `.addField`). */}
            <IconTextButton
                icon="Plus"
                class={styles.trigger}
                onClick={() => {
                    // Show mounts the input synchronously, so the overlay is placed before paint.
                    setEditing(true)
                    placeOverlay()
                }}
            >
                column
            </IconTextButton>
            <Show when={editing()}>
                <div
                    ref={overlay}
                    class={styles.addField}
                    style={
                        origin()
                            ? {
                                  left: `${origin()!.left}px`,
                                  top: `${origin()!.top}px`,
                              }
                            : undefined
                    }
                >
                    <KanbanColumnNameInput
                        placeholder="name"
                        className={styles.nameInput}
                        existing={props.existing}
                        onSubmit={name => {
                            props.onAdd(name)
                            setEditing(false)
                        }}
                        onCancel={() => setEditing(false)}
                    />
                </div>
            </Show>
        </div>
    )
}

export default KanbanAddColumn
