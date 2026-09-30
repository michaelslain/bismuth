// A group's header band inside the table body: the tinted row background is the table's, the
// `● LABEL // N` text is GroupHeader's (shared with List, Cards and Bullets). GroupHeader carries
// no padding, so this band owns the gutter. Its edges are typed by AsciiCellEdges: top, left and
// right only, since the row after it types its own top.
import type { Component } from 'solid-js'
import GroupHeader from '../ui/GroupHeader'
import AsciiCellEdges from '../ui/ascii/AsciiCellEdges'
import styles from './TableGroupRow.module.css'

export type TableGroupRowProps = {
    label: string
    /** Rows in the group, shown as ` // N`. */
    count: number
    /** How many columns the band spans. */
    colspan: number
    /** The band sits directly under the header, which already types the line above it — omit
     *  this band's own top so the two never overprint. */
    first?: boolean
    class?: string
}

const TableGroupRow: Component<TableGroupRowProps> = props => (
    <tr class={[styles.row, props.class].filter(Boolean).join(' ')}>
        <td colspan={props.colspan} class={styles.cell}>
            <GroupHeader label={props.label} count={props.count} />
            {/* A full-width band: top, left, right — no interior `|` crossing the label. */}
            <AsciiCellEdges
                edges={
                    props.first
                        ? ['left', 'right']
                        : ['top', 'left', 'right']
                }
            />
        </td>
    </tr>
)

export default TableGroupRow
