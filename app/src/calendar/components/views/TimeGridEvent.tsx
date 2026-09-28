import type { Component } from 'solid-js'
import type { CalendarEvent, Category } from '../../types'
import { EventStore } from '../../EventStore'
import { EventChip } from '../EventChip'
import type { DayLayoutItem } from './timeGridLayout'
import styles from './TimeGridEvent.module.css'

export type TimeGridEventProps = {
    item: DayLayoutItem
    /** The day column's date (`YYYY-MM-DD`) — the occurrence date of a recurring event. */
    date: string
    categories: Category[]
    store: EventStore
    /** This event is the one being dragged: drawn faint while its ghost moves. */
    dimmed?: boolean
    onMouseDown: (e: MouseEvent, event: CalendarEvent, masterId?: string) => void
    class?: string
}

/** Overlapping events get a lane, but instead of an even split (which squishes a long event to
 *  half-width for its whole span because a short one overlaps part of it) each is offset by its
 *  lane and EXTENDS to the right edge, layered by lane. */
const TimeGridEvent: Component<TimeGridEventProps> = props => {
    const masterId = () => (props.item.event.recurrence ? props.item.event.id : undefined)
    return (
        <div
            class={[
                styles.slot,
                props.item.lane > 0 ? styles.stacked : '',
                props.dimmed ? styles.dim : '',
                props.class ?? '',
            ]
                .filter(Boolean)
                .join(' ')}
            data-testid="time-grid-event"
            style={{
                top: `${props.item.top}px`,
                height: `${props.item.height}px`,
                left: `calc(var(--sp-2) + (100% - 2 * var(--sp-2)) * ${props.item.lane} / ${props.item.lanes})`,
                width: `calc((100% - 2 * var(--sp-2)) * ${props.item.lanes - props.item.lane} / ${props.item.lanes})`,
                'z-index': props.item.lane + 1,
            }}
            onMouseDown={e => props.onMouseDown(e, props.item.event, masterId())}
        >
            <EventChip
                event={props.item.event}
                compact={props.item.compact}
                inGrid
                masterId={masterId()}
                occurrenceDate={props.item.event.recurrence ? props.date : undefined}
                categories={props.categories}
                store={props.store}
            />
        </div>
    )
}

export default TimeGridEvent
