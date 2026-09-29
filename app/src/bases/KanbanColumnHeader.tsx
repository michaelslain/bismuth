// A kanban column's header: the coloured dot (a StatusDot; on an editable board a ColorChip sits
// over it as the picker trigger), the title or its inline rename field, and the padded count, with
// the hover-revealed rename/delete IconBar hung off the count's left edge. Presentational — the
// caller owns which column is renaming / which picker is open and what each action writes. The
// whole header is the column-drag handle, so the controls inside claim their own gestures.
import { Show, type Component } from 'solid-js'
import ColorChip from '../ui/ColorChip'
import IconBar from '../ui/IconBar'
import IconButton from '../ui/IconButton'
import StatusDot from '../ui/StatusDot'
import Text from '../ui/Text'
import KanbanColumnNameInput from './KanbanColumnNameInput'
import { padCount } from './kanbanOrder'
import styles from './KanbanColumnHeader.module.css'

export type KanbanColumnHeaderProps = {
    /** The column's group key; '' is the no-value "(empty)" lane (renamable, never deletable). */
    columnKey: string
    /** The column's EFFECTIVE colour (the override, else the auto hash) — ColorChip needs the
     *  colour in use, not the stored null. */
    color: string
    /** Whether `color` came from a stored `groupColors` override (else it is the auto colour). */
    hasOverride: boolean
    /** The raw palette entries the picker offers, handed back verbatim by `onPickColor`. */
    palette: readonly string[]
    count: number
    /** The colour picker is offered (a real base file to persist into). */
    editable: boolean
    /** The rename/delete bar is offered (editable + a writable groupBy). */
    actions: boolean
    renaming: boolean
    /** Every OTHER column's key — a rename to one of these is refused inline. */
    existing: string[]
    pickerOpen: boolean
    onTogglePicker: () => void
    /** A palette entry, or null for the auto entry. */
    onPickColor: (color: string | null) => void
    onStartRename: () => void
    onRename: (to: string) => void
    onCancelRename: () => void
    onDelete: () => void
    onPointerDown: (e: PointerEvent) => void
}

const KanbanColumnHeader: Component<KanbanColumnHeaderProps> = props => {
    // The picker anchors to the whole header row so it opens below the header rule.
    let headerEl: HTMLDivElement | undefined
    return (
    <div
        ref={headerEl}
        class={styles.header}
        onPointerDown={e => props.onPointerDown(e)}
    >
        <Text as="span" inherit class={styles.dotSlot}>
            <Show
                when={props.editable}
                fallback={<StatusDot color={props.color} size="md" />}
            >
                <ColorChip
                    trigger={<StatusDot color={props.color} size="md" />}
                    anchor={() => headerEl}
                    placement="below"
                    color={props.color}
                    palette={props.palette}
                    open={props.pickerOpen}
                    onToggle={props.onTogglePicker}
                    onPick={props.onPickColor}
                    auto={{
                        label: 'auto',
                        selected: !props.hasOverride,
                        onPick: () => props.onPickColor(null),
                    }}
                />
            </Show>
        </Text>
        <Show
            when={props.renaming}
            fallback={
                <Text as="span" inherit class={styles.title}>
                    {props.columnKey === '' ? '(empty)' : props.columnKey}
                </Text>
            }
        >
            <KanbanColumnNameInput
                initial={props.columnKey}
                existing={props.existing}
                selectOnMount
                onSubmit={props.onRename}
                onCancel={props.onCancelRename}
            />
        </Show>
        {/* Count flush right; the actions bar hangs off its left edge (absolute), so revealing
            it moves nothing. */}
        <div class={styles.trail}>
            <Show when={props.actions && !props.renaming}>
                <IconBar label="Column actions" class={styles.actions}>
                    <IconButton
                        icon="Pencil"
                        label="Rename column"
                        onClick={props.onStartRename}
                    />
                    {/* The "(empty)" lane is where cards with no value live — it is not a
                        column that can be deleted. */}
                    <Show when={props.columnKey !== ''}>
                        <IconButton
                            icon="Trash2"
                            label="Delete column"
                            onClick={props.onDelete}
                        />
                    </Show>
                </IconBar>
            </Show>
            <Text as="span" inherit class={styles.count}>
                {padCount(props.count)}
            </Text>
        </div>
    </div>
    )
}

export default KanbanColumnHeader
