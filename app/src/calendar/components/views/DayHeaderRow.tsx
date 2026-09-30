import { For, Show, type Component } from 'solid-js'
import { todayISO } from '../../../../../core/src/dates'
import DayGutter from './DayGutter'
import DayNumber from '../DayNumber'
import AsciiCellEdges from '../../../ui/ascii/AsciiCellEdges'
import Text from '../../../ui/Text'
import styles from './DayHeaderRow.module.css'

export type DayHeaderRowProps = {
    dates: Date[]
    /** ISO date to mark as today. Passed in, not read from the clock, so a story can pin it. */
    today: string
    /** Render the left time-gutter spacer. Default true — it aligns these rows with TimeGrid's
     *  hour labels. A grid with no TimeGrid under it (the tasks strip) passes false: there is
     *  nothing to align to and the column is empty. */
    gutter?: boolean
    class?: string
}

/** The weekday + date header over a run of day columns, typed as ASCII cells: each header types its
 *  top + left, the last adds its right, and every one types its bottom heavy (`=`), the line under
 *  the labels. The all-day / tasks row beneath omits its top so the two never overprint. Shared by
 *  the events time grid and the tasks strip, so the two registers can never disagree about column
 *  geometry. */
const DayHeaderRow: Component<DayHeaderRowProps> = props => (
    <div class={[styles.row, props.class ?? ''].filter(Boolean).join(' ')}>
        <Show when={props.gutter !== false}><DayGutter /></Show>
        <For each={props.dates}>
            {(d, i) => {
                const ds = todayISO(d)
                const isToday = () => ds === props.today
                return (
                    <div
                        class={[styles.header, isToday() ? styles.today : ''].filter(Boolean).join(' ')}
                        data-testid="day-header"
                    >
                        <Text
                            as="span"
                            inherit
                            class={styles.weekday}
                        >
                            {d.toLocaleString('default', { weekday: 'short' })}
                        </Text>{' '}
                        <Text as="span" inherit>
                            {d.toLocaleString('default', { month: 'numeric' })}/
                            <DayNumber day={d.getDate()} today={isToday()} inline />
                        </Text>
                        <AsciiCellEdges
                            edges={
                                i() === props.dates.length - 1
                                    ? ['top', 'left', 'right', 'bottom']
                                    : ['top', 'left', 'bottom']
                            }
                            edgeWeight={{ bottom: 'heavy' }}
                            backdrop
                        />
                    </div>
                )
            }}
        </For>
    </div>
)

export default DayHeaderRow
