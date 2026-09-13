import { For, type Component } from 'solid-js'
import { toDateStr } from '../../dates'
import DayGutter from './DayGutter'
import DayNumber from '../DayNumber'
import styles from './DayHeaderRow.module.css'

export type DayHeaderRowProps = {
    dates: Date[]
    /** ISO date to mark as today. Passed in, not read from the clock, so a story can pin it. */
    today: string
    class?: string
}

/** The weekday + date header over a run of day columns. Shared by the events time grid and the
 *  tasks strip, so the two registers can never disagree about column geometry. */
const DayHeaderRow: Component<DayHeaderRowProps> = props => (
    <div class={[styles.row, props.class ?? ''].filter(Boolean).join(' ')}>
        <DayGutter />
        <For each={props.dates}>
            {d => {
                const ds = toDateStr(d)
                const isToday = () => ds === props.today
                return (
                    <div
                        class={[styles.header, isToday() ? styles.today : ''].filter(Boolean).join(' ')}
                        data-testid="day-header"
                    >
                        <span class={styles.weekday}>
                            {d.toLocaleString('default', { weekday: 'short' })}
                        </span>{' '}
                        <span>
                            {d.toLocaleString('default', { month: 'numeric' })}/
                            <DayNumber day={d.getDate()} today={isToday()} inline />
                        </span>
                    </div>
                )
            }}
        </For>
    </div>
)

export default DayHeaderRow
