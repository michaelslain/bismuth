// One editable table cell: shows its value, and a click swaps in the SAME type-aware editor a
// kanban card's property chip uses (PropertyValueEditor), right in the cell — the way a
// spreadsheet edits. Enter or blur commits, Escape cancels. The write itself is the caller's
// (TableView hands it rowWrites' `commitMeta`, the one row write helper), so this component
// owns nothing but "is this cell open".
import {
    Show,
    createEffect,
    createMemo,
    createSignal,
    type Component,
    type JSX,
} from 'solid-js'
import type { BaseConfig, Row } from '../../../core/src/bases/types'
import { resolveProperty } from '../../../core/src/bases/query'
import {
    propertyType,
    coercePropertyValue,
} from '../../../core/src/bases/properties'
import { propertyRegistry } from '../propertyRegistry'
import { propertyEditKind, type PropertyEditKind } from './propertyEdit'
import { PropertyValueEditor } from './PropertyValueEditor'
import PlainButton from '../ui/PlainButton'
import { pushToast } from '../ui/toastStore'
import styles from './TableCell.module.css'

export type TableCellProps = {
    row: Row
    /** The column id (`author`, `note.author`, …). */
    col: string
    config: BaseConfig
    /** Every other row's value for this column, for the editor's pick-from-history fallback.
     *  Read only when the cell OPENS — never on render, so a table does not rescan every row
     *  for every cell on each refetch. */
    siblingValues: () => unknown[]
    /** How many rows are stored in this row's own base file (0 for a note row). A stored row's
     *  identity is its position in that file, so if this count changes while the cell is open
     *  (a row above it was deleted or added) the edit could land in a different row — it is
     *  dropped instead. */
    storedCount?: () => number
    /** Persist the (already type-coerced) value. The write revalidates the base, so `row` then
     *  arrives as a NEW object on this same instance (TableView keys rows by `mountKeys`, so the
     *  cell is never remounted by its own write). */
    onCommit: (value: unknown) => void
    /** The read-only rendering, shown whenever the cell is not being edited. */
    children: JSX.Element
    class?: string
}

const TableCell: Component<TableCellProps> = props => {
    const value = () => resolveProperty(props.col, props.row)
    // A boolean never becomes an `editing` state and never mounts PropertyValueEditor — a click
    // commits the flip immediately. Checking the kind here (rather than gating on it inside the
    // editor) is what keeps `editing()` boolean-free, so the Show below never has to special-case
    // it once open.
    const kindOf = (siblings: unknown[]) =>
        propertyEditKind(
            props.col,
            value(),
            propertyRegistry(),
            siblings,
            propertyType(props.config, props.col),
        )
    // The resting cell's kind, WITHOUT siblings — enough to tell a boolean (toggles in place)
    // and a read-only value (never opens) apart; only an open editor needs the siblings.
    const restingKind = createMemo(() => kindOf([]).kind)
    const isBoolean = () => restingKind() === 'boolean'
    const isReadonly = () => restingKind() === 'readonly'
    // What the open editor edits, frozen at the moment the cell opens. The row refetches while
    // an editor is open (the previous cell's save lands a moment later), and recomputing the
    // editor kind hands PropertyValueEditor a NEW kind object, which re-creates its input and
    // drops focus to <body> — the typed text then goes nowhere.
    const [editing, setEditing] = createSignal<{
        kind: PropertyEditKind
        value: unknown
        storedCount: number
    } | null>(null)
    // A stored row shifted under the open editor (see `storedCount`): drop the edit rather than
    // write it into whichever row now holds this position.
    createEffect(() => {
        const e = editing()
        if (!e || !props.storedCount) return
        if (props.storedCount() !== e.storedCount) {
            setEditing(null)
            pushToast('The rows changed while you were editing — that edit was not saved.')
        }
    })
    const commit = (v: unknown) => {
        const t = propertyType(props.config, props.col)
        const coerced = (t ? coercePropertyValue(t, v) : v) ?? null
        props.onCommit(coerced)
        setEditing(null)
    }
    const open = () => {
        const kind = kindOf(props.siblingValues())
        if (kind.kind === 'readonly') return
        if (kind.kind === 'boolean') {
            commit(!(value() === true))
            return
        }
        setEditing({ kind, value: value(), storedCount: props.storedCount?.() ?? 0 })
    }

    return (
        <Show
            when={editing()}
            fallback={
                <PlainButton
                    class={[
                        styles.cell,
                        isBoolean() ? styles.cellBoolean : '',
                        isReadonly() ? styles.cellReadonly : '',
                        props.class ?? '',
                    ]
                        .filter(Boolean)
                        .join(' ')}
                    title={
                        isReadonly()
                            ? 'Not editable here — edit this property in the note'
                            : isBoolean()
                              ? 'Click to toggle'
                              : 'Click to edit'
                    }
                    onClick={e => {
                        e.stopPropagation()
                        open()
                    }}
                >
                    {props.children}
                </PlainButton>
            }
        >
            {e => (
                <div
                    class={styles.editor}
                    onClick={ev => ev.stopPropagation()}
                    // Focus the editor ourselves: PropertyValueEditor's text control leans on the
                    // `autofocus` attribute, which a browser honours ONCE per page — the first cell
                    // opened focused, every later one opened with focus left on <body>, so typing
                    // went nowhere. A tag selector, not a class: this is our own editor's control.
                    ref={el =>
                        queueMicrotask(() => {
                            const c = el.querySelector<HTMLElement>(
                                'input, textarea, button',
                            )
                            c?.focus()
                            if (c instanceof HTMLInputElement) c.select()
                        })
                    }
                >
                    <PropertyValueEditor
                        inline
                        kind={e().kind}
                        value={e().value}
                        onCommit={commit}
                        onCancel={() => setEditing(null)}
                    />
                </div>
            )}
        </Show>
    )
}

export default TableCell
