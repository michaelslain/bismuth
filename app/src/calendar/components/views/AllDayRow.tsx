import { For, type Component, type JSX } from 'solid-js'
import { toDateStr } from '../../dates'
import DayGutter from './DayGutter'
import styles from './AllDayRow.module.css'

export type AllDayRowProps = {
    dates: Date[]
    /** One day's contents, given its ISO date. */
    cell: (date: string) => JSX.Element
    /** Grow to fill the parent's remaining height, cells stretched with it. */
    fill?: boolean
    onCellDragOver?: (e: DragEvent, date: string) => void
    onCellDrop?: (e: DragEvent, date: string) => void
    class?: string
}

/** A row of one cell per day under a DayHeaderRow: all-day events, or the tasks register's chips. */
const AllDayRow: Component<AllDayRowProps> = props => (
    <div class={[styles.row, props.fill ? styles.fill : '', props.class ?? ''].filter(Boolean).join(' ')}>
        <DayGutter />
        <For each={props.dates}>
            {d => {
                const ds = toDateStr(d)
                return (
                    <div
                        class={styles.cell}
                        data-testid="allday-cell"
                        onDragOver={e => props.onCellDragOver?.(e, ds)}
                        onDrop={e => props.onCellDrop?.(e, ds)}
                    >
                        {props.cell(ds)}
                    </div>
                )
            }}
        </For>
    </div>
)

export default AllDayRow
