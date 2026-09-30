import { For, Index, Show, createMemo, type Component } from 'solid-js'
import type { CalendarEvent, Category } from '../../types'
import { EventStore } from '../../EventStore'
import { dragState } from '../../state'
import { eventCategoryColors } from '../../categoryColor'
import AsciiCellEdges from '../../../ui/ascii/AsciiCellEdges'
import DragGhost from './DragGhost'
import TimeGridEvent from './TimeGridEvent'
import {
    eventMinutes,
    ghostBox,
    layoutDay,
    timedOn,
} from './timeGridLayout'
import { clamp } from './timeGridDrag'
import styles from './TimeGridDayColumn.module.css'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

export type TimeGridDayColumnProps = {
    /** `YYYY-MM-DD` */
    date: string
    today?: boolean
    /** The rightmost day: adds the `|` that closes the grid on its right. Default true, so a column
     *  on its own is closed. TimeGrid passes it for the last date only. */
    last?: boolean
    /** Something above the column (TimeGrid's all-day row) already types the first hour's `-`, so
     *  this column leaves it out rather than overprint it. Default false: a column on its own
     *  types its own top. */
    topTyped?: boolean
    /** Every event in view; the column keeps its own day's timed ones. */
    events: CalendarEvent[]
    categories: Category[]
    store: EventStore
    /** The column element, for the grid's pointer maths. */
    ref?: (el: HTMLDivElement) => void
    onMouseDown: (e: MouseEvent) => void
    onEventMouseDown: (e: MouseEvent, event: CalendarEvent, masterId?: string) => void
}

/** One day of the hourly grid, typed as an ASCII grid: each hour block hosts an `AsciiCellEdges`
 *  overlay giving its hour `-` (top) and the day `|` (left); the last column adds its right `|`
 *  and the last hour its bottom `-`. The half-hour cell carries no line. Reads the shared `dragState` for its own ghost and to dim the
 *  event being moved; every pointer handler is the grid's. */
const TimeGridDayColumn: Component<TimeGridDayColumnProps> = props => {
    const layout = createMemo(() => layoutDay(timedOn(props.events, props.date)))
    const ghost = () => {
        const state = dragState.value
        if (!state || state.date !== props.date) return null
        if (state.type === 'create') {
            return {
                startMin: Math.min(state.startMinutes, state.currentMinutes),
                endMin: Math.max(state.startMinutes, state.currentMinutes),
                colors: [] as string[],
            }
        }
        const span = eventMinutes(state.event)
        return {
            startMin: state.startMinutes,
            endMin: clamp(state.startMinutes + (span.endMin - span.startMin)),
            colors: eventCategoryColors(state.event, props.categories),
        }
    }
    const movingId = () => {
        const s = dragState.value
        return s?.type === 'move' ? s.event.id : undefined
    }
    return (
        <div
            class={`${styles.col}${props.today ? ` ${styles.today}` : ''}`}
            data-testid="time-grid-day-col"
            ref={props.ref}
            onMouseDown={e => props.onMouseDown(e)}
        >
            <Index each={HOURS}>
                {(_, h) => (
                    <div class={styles.hourBlock}>
                        <div class={styles.hourCell} />
                        <div class={styles.halfCell} />
                        <AsciiCellEdges
                            edges={[
                                ...(h === 0 && props.topTyped ? [] : ['top' as const]),
                                'left' as const,
                                ...((props.last ?? true) ? ['right' as const] : []),
                                ...(h === HOURS.length - 1 ? ['bottom' as const] : []),
                            ]}
                        />
                    </div>
                )}
            </Index>
            <For each={layout()}>
                {item => (
                    <TimeGridEvent
                        {...{ item }}
                        date={props.date}
                        categories={props.categories}
                        store={props.store}
                        dimmed={movingId() === item.event.id}
                        onMouseDown={props.onEventMouseDown}
                    />
                )}
            </For>
            <Show when={ghost()}>
                {g => {
                    const box = () => ghostBox(g().startMin, g().endMin)
                    return (
                        <DragGhost
                            top={box().top}
                            height={box().height}
                            startMin={g().startMin}
                            endMin={box().endMin}
                            colors={g().colors}
                        />
                    )
                }}
            </Show>
        </div>
    )
}

export default TimeGridDayColumn
