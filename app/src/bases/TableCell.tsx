// One editable table cell: shows its value, and a click swaps in the SAME type-aware editor a
// kanban card's property chip uses (PropertyValueEditor), right in the cell — the way a
// spreadsheet edits. Enter or blur commits, Escape cancels. The write itself is the caller's
// (TableView hands it openRowEditor's `commitMeta`, the one row write helper), so this component
// owns nothing but "is this cell open".
import { Show, createSignal, type Component, type JSX } from 'solid-js'
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
import styles from './TableCell.module.css'

export type TableCellProps = {
    row: Row
    /** The column id (`author`, `note.author`, …). */
    col: string
    config: BaseConfig
    /** Every other row's value for this column, for the editor's pick-from-history fallback. */
    siblingValues: () => unknown[]
    /** Persist the (already type-coerced) value. */
    onCommit: (value: unknown) => void
    /** The read-only rendering, shown whenever the cell is not being edited. */
    children: JSX.Element
    class?: string
}

const TableCell: Component<TableCellProps> = props => {
    // What the open editor edits, frozen at the moment the cell opens. The row refetches while
    // an editor is open (the previous cell's save lands a moment later), and recomputing the
    // editor kind hands PropertyValueEditor a NEW kind object, which re-creates its input and
    // drops focus to <body> — the typed text then goes nowhere.
    const [editing, setEditing] = createSignal<{
        kind: PropertyEditKind
        value: unknown
    } | null>(null)
    const value = () => resolveProperty(props.col, props.row)
    const open = () =>
        setEditing({
            kind: propertyEditKind(
                props.col,
                value(),
                propertyRegistry(),
                props.siblingValues(),
                propertyType(props.config, props.col),
            ),
            value: value(),
        })
    const commit = (v: unknown, opts?: { keepOpen?: boolean }) => {
        const t = propertyType(props.config, props.col)
        props.onCommit((t ? coercePropertyValue(t, v) : v) ?? null)
        if (!opts?.keepOpen) setEditing(null)
    }

    return (
        <Show
            when={editing()}
            fallback={
                <PlainButton
                    class={[styles.cell, props.class ?? '']
                        .filter(Boolean)
                        .join(' ')}
                    title="Click to edit"
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
