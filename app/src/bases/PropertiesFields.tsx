import { createMemo, Index, Show, type Component } from 'solid-js'
import { IconTextButton } from '../ui/IconTextButton'
import PropertyRowEditor from './PropertyRowEditor'
import {
    blankPropertyRow,
    duplicatePropertyNames,
    moveRow,
    type PropertyFormRow,
} from './basePropertiesForm'
import { indexAfterMove, indexAfterRemove } from './baseSettingsPlan'
import styles from './PropertiesFields.module.css'

export type PropertiesFieldsProps = {
    rows: PropertyFormRow[]
    onChange: (rows: PropertyFormRow[]) => void
    /** The one row whose full editor is open; null = every row collapsed. The caller owns it so a
     *  RESET can collapse them. */
    editing: number | null
    onEditing: (index: number | null) => void
    class?: string
}

/** The base's OWN declared property set — a scannable list where at most one row's full editor is
 *  open at a time, plus "add property". Removing is form state only: nothing is written until the
 *  panel's SAVE, and CANCEL discards it, so there is no undo toast here. */
const PropertiesFields: Component<PropertiesFieldsProps> = props => {
    // Row indexes whose name duplicates an earlier row's — buildPropertiesYaml silently drops the
    // later one on save, so the row warns and the panel blocks SAVE.
    const duplicates = createMemo(() => duplicatePropertyNames(props.rows))
    const update = (i: number, patch: Partial<PropertyFormRow>) =>
        props.onChange(
            props.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
        )
    const add = () => {
        const next = [
            ...props.rows,
            blankPropertyRow(props.rows.map(r => r.name)),
        ]
        props.onChange(next)
        props.onEditing(next.length - 1) // expand the new row for immediate editing
    }
    const remove = (i: number) => {
        props.onChange(props.rows.filter((_, idx) => idx !== i))
        props.onEditing(indexAfterRemove(props.editing, i))
    }
    // Reorder keeps whichever row (if any) was open following its content, not its old index.
    const move = (i: number, dir: -1 | 1) => {
        const j = i + dir
        if (j < 0 || j >= props.rows.length) return
        props.onChange(moveRow(props.rows, i, dir))
        props.onEditing(indexAfterMove(props.editing, i, j))
    }
    return (
        <div class={props.class}>
            <Show when={props.rows.length > 0}>
                <div class={styles.list}>
                    {/* <Index>, not <For>: update() replaces the row object on every keystroke,
                        and <For> would remount the row and drop focus on the first character. */}
                    <Index each={props.rows}>
                        {(row, i) => (
                            <PropertyRowEditor
                                row={row()}
                                open={props.editing === i}
                                duplicate={duplicates().has(i)}
                                isFirst={i === 0}
                                isLast={i === props.rows.length - 1}
                                onToggleOpen={() =>
                                    props.onEditing(
                                        props.editing === i ? null : i,
                                    )
                                }
                                onChange={patch => update(i, patch)}
                                onMove={dir => move(i, dir)}
                                onRemove={() => remove(i)}
                            />
                        )}
                    </Index>
                </div>
            </Show>
            <div class={styles.add}>
                <IconTextButton icon="Plus" onClick={add}>
                    add property
                </IconTextButton>
            </div>
        </div>
    )
}

export default PropertiesFields
