// A group's header band inside the table body: the tinted row background is the table's, the
// `● LABEL // N` text is GroupHeader's (shared with List, Cards and Bullets). GroupHeader carries
// no padding, so this band owns the gutter.
import type { Component } from 'solid-js'
import GroupHeader from '../ui/GroupHeader'
import styles from './TableGroupRow.module.css'

export type TableGroupRowProps = {
    label: string
    /** Rows in the group, shown as ` // N`. */
    count: number
    /** How many columns the band spans. */
    colspan: number
    class?: string
}

const TableGroupRow: Component<TableGroupRowProps> = props => (
    <tr class={[styles.row, props.class].filter(Boolean).join(' ')}>
        <td colspan={props.colspan} class={styles.cell}>
            <GroupHeader label={props.label} count={props.count} />
        </td>
    </tr>
)

export default TableGroupRow
