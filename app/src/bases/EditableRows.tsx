// app/src/bases/EditableRows.tsx
// THE add / reorder / remove list the Bases field editors share: conditions, formulas, sort keys,
// declared properties. Each of them used to rebuild the same interaction — rows, a remove control,
// an add button — with its own gap, its own add-button spacing (8 / 8 / 16 / 2px from the rows) and
// its own remove label. Here it is once: a `RowList` of rows, then ONE add row as the list's LAST
// row (DESIGN.md, lists in a modal: "an inline add composer is the list's last row, in the same
// columns, never a separate card"), so the add button sits one row-gap under whatever precedes it.
import { Show, type Component, type JSX } from 'solid-js'
import RowList from '../ui/RowList'
import ListRow from '../ui/ListRow'
import SettingsHint from '../ui/SettingsHint'
import styles from './EditableRows.module.css'

export type EditableRowsProps = {
    /** The rows — `EditableRow`s, or a row that brings its own disclosure (PropertyRowEditor). */
    children?: JSX.Element
    /** True when there are no rows: `empty` is shown in their place. */
    isEmpty?: boolean
    /** One line shown while the list is empty, e.g. "no conditions — every row is kept." */
    empty?: JSX.Element
    /** The add affordance: one or more `IconTextButton`s, labelled "add X". Rendered side by side
     *  in the list's last row. */
    add: JSX.Element
    class?: string
}

const EditableRows: Component<EditableRowsProps> = props => (
    <RowList class={[styles.list, props.class].filter(Boolean).join(' ')}>
        <Show when={props.isEmpty && props.empty}>
            <SettingsHint>{props.empty}</SettingsHint>
        </Show>
        {props.children}
        <ListRow>
            <div class={styles.add}>{props.add}</div>
        </ListRow>
    </RowList>
)

export default EditableRows
export { EditableRows }
