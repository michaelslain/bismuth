// The table's footer: one summary value per column (sum / avg / count …), keyed by the column's
// canonical id. A column with no summary renders an empty cell so the rule still spans the table.
import { For, type Component } from 'solid-js'
import { canonicalId } from '../../../core/src/bases/query'
import Text from '../ui/Text'
import styles from './TableSummaryRow.module.css'

export type TableSummaryRowProps = {
    cols: string[]
    /** `ViewResult.summaries`, keyed by canonical column id. */
    summaries: Record<string, string>
    class?: string
}

const TableSummaryRow: Component<TableSummaryRowProps> = props => (
    <tfoot class={props.class}>
        <tr>
            <For each={props.cols}>
                {c => (
                    <td class={styles.cell}>
                        <Text as="span" inherit>
                            {props.summaries[canonicalId(c)] ?? ''}
                        </Text>
                    </td>
                )}
            </For>
        </tr>
    </tfoot>
)

export default TableSummaryRow
