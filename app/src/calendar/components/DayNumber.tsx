// A day-of-month number — shared by MonthView's cell header, TimeGrid's day header and
// TaskAllDayStrip's day header (was `.cal-today-circle`, hand-duplicated across all three).
// `today` draws the 20px accent circle; `inline` makes that circle sit inside a line of text
// (the time-grid header's "Sun 9/5" shape) instead of standing alone as a block (the month
// cell's own header).
import type { Component } from 'solid-js'
import Text from '../../ui/Text'
import styles from './DayNumber.module.css'

export type DayNumberProps = {
    day: number
    today?: boolean
    inline?: boolean
    class?: string
}

const DayNumber: Component<DayNumberProps> = props => {
    return (
        <Text
            as="span"
            inherit
            class={[
                styles.root,
                props.today ? styles.today : '',
                props.today && props.inline ? styles.inline : '',
                props.class ?? '',
            ]
                .filter(Boolean)
                .join(' ')}
        >
            {props.day}
        </Text>
    )
}

export default DayNumber
