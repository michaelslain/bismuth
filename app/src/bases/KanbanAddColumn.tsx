// The trailing "+ column" ghost column at the end of a kanban board's column row. Click overlays
// a text input on the ghost header (KanbanColumnNameInput, shared with KanbanColumnMenu's
// rename field); Enter adds (refusing a duplicate name inline, matching `appendColumnKey`'s own
// refusal so the two never disagree), Escape or a blur while empty cancels back to the ghost. The
// trigger stays mounted (hidden) under the input so the swap never moves text or reflows the board.
// Presentational only — KanbanView owns persisting the new column (optimistic `columns` order +
// the `properties.options` append) via `onAdd`.
import { createSignal, Show, type Component } from 'solid-js'
import Text from '../ui/Text'
import PlainButton from '../ui/PlainButton'
import KanbanColumnNameInput from './KanbanColumnNameInput'
import styles from './KanbanAddColumn.module.css'

export type KanbanAddColumnProps = {
    /** Existing column keys — a name matching one of these (after trim) is refused. */
    existing: string[]
    onAdd: (name: string) => void
    className?: string
}

const KanbanAddColumn: Component<KanbanAddColumnProps> = props => {
    const [editing, setEditing] = createSignal(false)

    return (
        <div
            class={[styles.ghost, props.className].filter(Boolean).join(' ')}
            data-editing={editing() ? '' : undefined}
            data-testid="kanban-add-column"
        >
            {/* The trigger stays mounted while editing — hidden, not removed — so the ghost
                keeps its exact rest footprint and the board never reflows; the input overlays
                it out of flow (KanbanAddColumn.module.css's `.addField`). */}
            <PlainButton
                class={styles.trigger}
                onClick={() => setEditing(true)}
            >
                <Text as="span" size="inherit" tone="muted" weight="inherit">
                    + column
                </Text>
            </PlainButton>
            <Show when={editing()}>
                <KanbanColumnNameInput
                    placeholder="name"
                    className={styles.addField}
                    existing={props.existing}
                    onSubmit={name => {
                        props.onAdd(name)
                        setEditing(false)
                    }}
                    onCancel={() => setEditing(false)}
                />
            </Show>
        </div>
    )
}

export default KanbanAddColumn
