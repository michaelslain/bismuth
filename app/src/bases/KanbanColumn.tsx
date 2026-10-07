// One kanban column: its header, its card list (each card a CardFrame around a KanbanCard, or
// around a TaskRow on a tasks board), the drop-gap placeholders the drag engine opens between
// cards, and the add-card composer. Presentational — KanbanView owns the state (which cards a
// column shows, the drag engine, every write) and hands each as props/callbacks. The column's
// `data-kbcol` / `data-hover` / `data-kbcard` / `data-path` attributes are runtime hooks the drag
// engine and the header's CSS read.
import { createSignal, For, Show, type Component } from 'solid-js'
import type { BaseConfig, Row } from '../../../core/src/bases/types'
import DropCue from '../ui/DropCue'
import IconButton from '../ui/IconButton'
import TextInput from '../ui/TextInput'
import { isConfirmKey, isDismissKey } from '../ui/widgetKeys'
import CardFrame from './CardFrame'
import { KanbanCard } from './KanbanCard'
import KanbanColumnHeader, {
    type KanbanColumnHeaderProps,
} from './KanbanColumnHeader'
import TaskRow from './TaskRow'
import { suppressCardContextMenu } from './kanbanCardMenu'
import { isStoredPlaceholder } from './taskWrite'
import styles from './KanbanColumn.module.css'

export type KanbanColumnProps = KanbanColumnHeaderProps & {
    /** The pointer is over this column — reveals the header's action bar (mirrors CSS :hover). */
    hovered: boolean
    onHover: (hovered: boolean) => void
    /** A card is being dragged over this column. */
    over: boolean
    /** Another column is being dragged over this one (a reorder target). */
    reorderTarget: boolean
    /** This column is the one being dragged. */
    dragging: boolean
    /** The last real column drops its right-hand rule. */
    last: boolean
    /** The visible card ids, in order (the list is keyed by these strings so a reorder MOVES
     *  card DOM rather than remounting it). */
    ids: string[]
    rowById: (id: string) => Row | undefined
    /** The slot the drag engine has open in THIS column (0..ids.length), else null. */
    overIndex: number | null
    tasks: boolean
    config: BaseConfig
    titleCol: string
    metaCols: string[]
    hideLabels: boolean
    /** Cards are editable (a real base file to write to). */
    cardsEditable: boolean
    /** The image-drop highlight target (a card id), or null. */
    dropCardId: string | null
    onCardPointerDown: (e: PointerEvent, id: string) => void
    onFileDragOver: (e: DragEvent, id: string) => void
    onFileDragLeave: (e: DragEvent, id: string) => void
    onFileDrop: (e: DragEvent, row: Row) => void
    onRenameCard: (row: Row, title: string) => Promise<string | undefined>
    onSetMeta: (row: Row, id: string, value: unknown) => void
    onDeleteCard: (row: Row) => void
    siblingValues: (id: string) => unknown[]
    onToggle?: (row: Row, e: Event) => void
    onSetStatus?: (row: Row, e: MouseEvent) => void
    /** The add-card composer is offered (editable + a writable groupBy). */
    canAdd: boolean
    composing: boolean
    draft: string
    onDraft: (value: string) => void
    onOpenComposer: () => void
    onCloseComposer: () => void
    /** Add the drafted card; resolves once the write is dispatched. */
    onAddCard: () => Promise<void>
}

const KanbanColumn: Component<KanbanColumnProps> = props => (
    <div
        class={styles.kanbanColumn}
        data-kbcol={props.columnKey}
        classList={{
            [styles.kanbanColDragging]: props.dragging,
            [styles.kanbanColumnLast]: props.last,
        }}
        style={{ '--kb-col-color': props.color }}
        data-hover={props.hovered ? '' : undefined}
        onPointerEnter={() => props.onHover(true)}
        onPointerLeave={() => props.onHover(false)}
    >
        <DropCue
            active={props.over || props.reorderTarget}
            className={styles.kanbanDropCue}
        />
        <KanbanColumnHeader {...props} />

        <div class={styles.kanbanCards}>
            <For each={props.ids}>
                {(id, i) => {
                    const [editing, setEditing] = createSignal(false)
                    const row = () => props.rowById(id)
                    return (
                        <>
                            <div
                                class={`${styles.kanbanPlaceholder} ${
                                    props.overIndex === i()
                                        ? styles.kanbanPlaceholderActive
                                        : ''
                                }`}
                            />
                            <Show when={row()}>
                                {r => (
                                    <CardFrame
                                        kind={props.tasks ? 'task' : 'note'}
                                        class={
                                            props.tasks
                                                ? undefined
                                                : styles.kanbanCardPad
                                        }
                                        draggable
                                        dropTarget={props.dropCardId === id}
                                        data-kbcard=""
                                        data-path={id}
                                        data-testid="kanban-card"
                                        onPointerDown={e => {
                                            if (!editing())
                                                props.onCardPointerDown(e, id)
                                        }}
                                        onContextMenu={suppressCardContextMenu}
                                        onDragEnter={e =>
                                            props.onFileDragOver(e, id)
                                        }
                                        onDragOver={e =>
                                            props.onFileDragOver(e, id)
                                        }
                                        onDragLeave={e =>
                                            props.onFileDragLeave(e, id)
                                        }
                                        onDrop={e => props.onFileDrop(e, r())}
                                    >
                                        <Show
                                            when={props.tasks}
                                            fallback={
                                                <KanbanCard
                                                    row={r()}
                                                    titleCol={props.titleCol}
                                                    metaCols={props.metaCols}
                                                    config={props.config}
                                                    editable={
                                                        props.cardsEditable &&
                                                        !isStoredPlaceholder(
                                                            r(),
                                                        )
                                                    }
                                                    hideLabels={
                                                        props.hideLabels
                                                    }
                                                    onEditingChange={setEditing}
                                                    onRename={t =>
                                                        props.onRenameCard(
                                                            r(),
                                                            t,
                                                        )
                                                    }
                                                    onSetMeta={(metaId, v) =>
                                                        props.onSetMeta(
                                                            r(),
                                                            metaId,
                                                            v,
                                                        )
                                                    }
                                                    onDelete={() =>
                                                        props.onDeleteCard(r())
                                                    }
                                                    siblingValues={
                                                        props.siblingValues
                                                    }
                                                />
                                            }
                                        >
                                            <TaskRow
                                                row={r()}
                                                variant="card"
                                                onToggle={(taskRow, e) =>
                                                    props.onToggle?.(taskRow, e)
                                                }
                                                onSetStatus={(taskRow, e) =>
                                                    props.onSetStatus?.(
                                                        taskRow,
                                                        e,
                                                    )
                                                }
                                            />
                                        </Show>
                                    </CardFrame>
                                )}
                            </Show>
                        </>
                    )
                }}
            </For>
            <div
                class={`${styles.kanbanPlaceholder} ${
                    props.overIndex === props.ids.length
                        ? styles.kanbanPlaceholderActive
                        : ''
                }`}
            />

            {/* Add-card composer (Trello-style) — only when the column value is writable. */}
            <Show when={props.canAdd}>
                <Show
                    when={props.composing}
                    fallback={
                        <IconButton
                            icon="Plus"
                            label="Add a card"
                            class={styles.kbAddBtn}
                            onClick={props.onOpenComposer}
                        />
                    }
                >
                    <TextInput
                        multiline
                        class={styles.kbComposer}
                        value={props.draft}
                        placeholder="Card title…  (⏎ to add, Esc to close)"
                        ref={el => queueMicrotask(() => el.focus())}
                        onInput={props.onDraft}
                        onKeyDown={e => {
                            if (isConfirmKey(e)) {
                                e.preventDefault()
                                // Capture the element NOW — after the await, `e.currentTarget` is
                                // null (it only points at the handler's node during dispatch).
                                // Composer focus must survive every add for rapid entry (#93).
                                const el = e.currentTarget
                                void props.onAddCard().then(() => el.focus())
                            } else if (isDismissKey(e)) {
                                props.onCloseComposer()
                            }
                        }}
                        onBlur={() => {
                            if (props.draft.trim() === '')
                                props.onCloseComposer()
                        }}
                    />
                </Show>
            </Show>
        </div>
    </div>
)

export default KanbanColumn
