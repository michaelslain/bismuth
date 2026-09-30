// The table's footer: one summary value per column (sum / avg / count …), keyed by the column's
// canonical id. A column with no summary renders an empty cell so the rule still spans the table.
import { For, type Component } from 'solid-js'
import { canonicalId } from '../../../core/src/bases/query'
import Text from '../ui/Text'
import AsciiCellEdges, { type AsciiEdge } from '../ui/ascii/AsciiCellEdges'
import styles from './TableSummaryRow.module.css'

export type TableSummaryRowProps = {
    cols: string[]
    /** `ViewResult.summaries`, keyed by canonical column id. */
    summaries: Record<string, string>
    class?: string
}

// The footer types its top as the heavy `=` (the body row above omits its bottom) and closes the
// grid with its own left, bottom and — on the last column — right.
const summaryEdges = (last: boolean): AsciiEdge[] =>
    last
        ? ['top', 'left', 'right', 'bottom']
        : ['top', 'left', 'bottom']

const TableSummaryRow: Component<TableSummaryRowProps> = props => (
    <tfoot class={props.class}>
        <tr>
            <For each={props.cols}>
                {(c, i) => (
                    <td class={styles.cell}>
                        <div class={styles.clip}>
                            <Text as="span" inherit>
                                {props.summaries[canonicalId(c)] ?? ''}
                            </Text>
                        </div>
                        <AsciiCellEdges
                            edges={summaryEdges(i() === props.cols.length - 1)}
                            edgeWeight={{ top: 'heavy' }}
                        />
                    </td>
                )}
            </For>
        </tr>
    </tfoot>
)

export default TableSummaryRow
