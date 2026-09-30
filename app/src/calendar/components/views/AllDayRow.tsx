import { For, Show, type Component, type JSX } from 'solid-js'
import { todayISO } from '../../../../../core/src/dates'
import AsciiCellEdges from '../../../ui/ascii/AsciiCellEdges'
import DayGutter from './DayGutter'
import styles from './AllDayRow.module.css'

export type AllDayRowProps = {
    dates: Date[]
    /** One day's contents, given its ISO date. */
    cell: (date: string) => JSX.Element
    /** Grow to fill the parent's remaining height, cells stretched with it. */
    fill?: boolean
    /** Render the left time-gutter spacer. Default true — it aligns these rows with TimeGrid's
     *  hour labels. A grid with no TimeGrid under it (the tasks strip) passes false: there is
     *  nothing to align to and the column is empty. */
    gutter?: boolean
    onCellDragOver?: (e: DragEvent, date: string) => void
    onCellDrop?: (e: DragEvent, date: string) => void
    class?: string
}

/** A row of one cell per day under a DayHeaderRow: all-day events, or the tasks register's chips.
 *  Typed as ASCII cells: no top (the header's heavy `=` above is that line), a left `|` each, a right
 *  `|` on the last, and a bottom `-` — this is the last row of its band (and, in `fill` mode, of the
 *  whole grid). The gutter spacer types nothing. */
const AllDayRow: Component<AllDayRowProps> = props => (
    <div class={[styles.row, props.fill ? styles.fill : '', props.class ?? ''].filter(Boolean).join(' ')}>
        <Show when={props.gutter !== false}><DayGutter /></Show>
        <For each={props.dates}>
            {(d, i) => {
                const ds = todayISO(d)
                return (
                    <div
                        class={styles.cell}
                        data-testid="allday-cell"
                        onDragOver={e => props.onCellDragOver?.(e, ds)}
                        onDrop={e => props.onCellDrop?.(e, ds)}
                    >
                        {props.cell(ds)}
                        <AsciiCellEdges
                            edges={
                                i() === props.dates.length - 1
                                    ? ['left', 'right', 'bottom']
                                    : ['left', 'bottom']
                            }
                        />
                    </div>
                )
            }}
        </For>
    </div>
)

export default AllDayRow
