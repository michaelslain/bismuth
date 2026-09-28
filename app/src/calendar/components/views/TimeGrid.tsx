import { For, Index } from 'solid-js'
import { CalendarEvent, Category } from '../../types'
import { EventChip } from '../EventChip'
import { toDateStr, formatGutterHour } from '../../dates'
import { showEventModal, dragState, settings, recurrenceAction } from '../../state'
import { EventStore } from '../../EventStore'
import { refreshEvents } from '../../refresh'
import Text from '../../../ui/Text'
import DayHeaderRow from './DayHeaderRow'
import AllDayRow from './AllDayRow'
import DayGutter from './DayGutter'
import TimeGridDayColumn from './TimeGridDayColumn'
import styles from './TimeGrid.module.css'
import {
    snap,
    clamp,
    minutesToStr,
    computeCreatePayload,
    pointerDistance,
} from './timeGridDrag'
import { allDayOn, eventMinutes, yToMinutes } from './timeGridLayout'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

interface Props {
    dates: Date[]
    events: CalendarEvent[]
    categories: Category[]
    store: EventStore
}

export function TimeGrid(props: Props) {
    const today = toDateStr(new Date())
    const colRefs: Record<string, HTMLDivElement | undefined> = {}

    function getMinutesFromEvent(e: MouseEvent, ds: string): number {
        const col = colRefs[ds]
        if (!col) return 0
        const rect = col.getBoundingClientRect()
        return yToMinutes(e.clientY - rect.top, rect.height)
    }

    /** The day column under a horizontal screen position (for dragging across days). */
    function columnAt(clientX: number): { ds: string; rect: DOMRect } | null {
        for (const ds of Object.keys(colRefs)) {
            const el = colRefs[ds]
            if (!el) continue
            const rect = el.getBoundingClientRect()
            if (clientX >= rect.left && clientX <= rect.right)
                return { ds, rect }
        }
        return null
    }

    function onColMouseDown(e: MouseEvent, ds: string): void {
        if (e.button !== 0) return
        e.preventDefault()
        const minutes = getMinutesFromEvent(e, ds)
        // Tracked separately from the snapped minutes: two endpoints in the same snap bucket are
        // a zero-duration drag that is nonetheless a real one, and a wobble during an intended
        // click is the opposite. The RUNNING MAXIMUM, not the live distance — a press that
        // wanders past the deadzone and returns to its origin is still a drag, and the final
        // displacement alone cannot tell. The threshold itself lives in timeGridDrag.ts.
        const originX = e.clientX
        const originY = e.clientY
        let movedPx = 0
        dragState.value = {
            type: 'create',
            date: ds,
            startMinutes: minutes,
            currentMinutes: minutes,
        }

        function onMouseMove(ev: MouseEvent): void {
            movedPx = Math.max(
                movedPx,
                pointerDistance(ev.clientX - originX, ev.clientY - originY),
            )
            const cur = getMinutesFromEvent(ev, ds)
            const state = dragState.value
            if (state?.type === 'create') {
                dragState.value = {
                    type: 'create',
                    date: ds,
                    startMinutes: state.startMinutes,
                    currentMinutes: cur,
                }
            }
        }

        function onMouseUp(): void {
            const state = dragState.value
            if (state?.type === 'create') {
                showEventModal.value = computeCreatePayload(
                    state.date,
                    state.startMinutes,
                    state.currentMinutes,
                    movedPx,
                )
            }
            dragState.value = null
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
        }

        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
    }

    function onChipMouseDown(
        e: MouseEvent,
        event: CalendarEvent,
        ds: string,
        masterId?: string,
    ): void {
        if (e.button !== 0) return
        e.stopPropagation()
        e.preventDefault()
        const col = colRefs[ds]
        if (!col) return

        const rect = col.getBoundingClientRect()
        const { startMin: eventStartMinutes, endMin: eventEndMinutes } =
            eventMinutes(event)
        const clickMinutes = yToMinutes(e.clientY - rect.top, rect.height)
        const offsetMinutes = clickMinutes - eventStartMinutes
        const durationMinutes = eventEndMinutes - eventStartMinutes
        const startX = e.clientX
        const startY = e.clientY
        let dragging = false

        function onMouseMove(ev: MouseEvent): void {
            if (!dragging) {
                // Start once the pointer moves enough in EITHER axis (vertical = retime,
                // horizontal = move to another day).
                if (
                    Math.abs(ev.clientY - startY) < 4 &&
                    Math.abs(ev.clientX - startX) < 4
                )
                    return
                dragging = true
            }
            // Drop target follows the cursor across day columns; fall back to the original
            // column when the pointer is outside the grid. Read the time from the target
            // column so a cross-day drag lands at the right slot.
            const target = columnAt(ev.clientX) ?? { ds, rect }
            const cur = yToMinutes(
                ev.clientY - target.rect.top,
                target.rect.height,
            )
            const newStart = clamp(snap(cur - offsetMinutes))
            dragState.value = {
                type: 'move',
                event,
                masterId,
                date: target.ds,
                startMinutes: newStart,
                currentMinutes: newStart + durationMinutes,
                offsetMinutes,
            }
        }

        async function onMouseUp(): Promise<void> {
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
            if (!dragging) return
            const state = dragState.value
            // Clear the drag state FIRST, before the awaited persist below. If updateEvent /
            // refreshEvents throws, an end-of-function reset would be skipped and the dragged
            // event would stay stuck at 0.3 opacity (renders "faint") until the next interaction.
            dragState.value = null
            if (state?.type === 'move') {
                const newStart = state.startMinutes
                const newEnd = clamp(newStart + durationMinutes)
                // state.date is the column the event was dropped on — include it only when the
                // event actually changed days, so a same-day retime stays a pure time edit.
                const updates = {
                    startTime: minutesToStr(newStart),
                    endTime: minutesToStr(newEnd),
                    ...(state.date !== ds ? { date: state.date } : {}),
                }
                if (state.masterId) {
                    // Recurring: route through the recurrence dialog so the user picks the
                    // scope (this/following/all). occurrenceDate is the ORIGINAL day (ds) so the
                    // dialog edits the occurrence that was dragged, not the day it landed on.
                    recurrenceAction.value = {
                        type: 'edit',
                        masterId: state.masterId,
                        occurrenceDate: ds,
                        updates,
                    }
                } else {
                    await props.store.updateEvent(event.id, updates)
                    await refreshEvents(props.store)
                }
            }
        }

        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
    }

    return (
        <div class={styles['time-grid']}>
            <div class={styles['time-grid-body']}>
                <div class={styles['time-grid-columns']}>
                    <div class={styles['time-grid-sticky-top']}>
                        <DayHeaderRow dates={props.dates} today={today} />
                        <AllDayRow
                            dates={props.dates}
                            cell={ds => (
                                <For each={allDayOn(props.events, ds)}>
                                    {e => (
                                        <EventChip
                                            event={e}
                                            masterId={e.recurrence ? e.id : undefined}
                                            occurrenceDate={e.recurrence ? ds : undefined}
                                            categories={props.categories}
                                            store={props.store}
                                        />
                                    )}
                                </For>
                            )}
                        />
                    </div>
                    <div class={styles['time-grid-time-rows']}>
                        <DayGutter>
                            <Index each={HOURS}>
                                {h => (
                                    <div class={styles['time-gutter-hour-block']}>
                                        <Text
                                            as="div"
                                            inherit
                                            class={styles['time-gutter-hour']}
                                        >
                                            {formatGutterHour(h(), settings.value.militaryTime)}
                                        </Text>
                                        <div class={styles['time-gutter-half']} />
                                    </div>
                                )}
                            </Index>
                        </DayGutter>
                        <For each={props.dates}>
                            {d => {
                                const ds = toDateStr(d)
                                return (
                                    <TimeGridDayColumn
                                        date={ds}
                                        today={ds === today}
                                        events={props.events}
                                        categories={props.categories}
                                        store={props.store}
                                        ref={el => (colRefs[ds] = el)}
                                        onMouseDown={e => onColMouseDown(e, ds)}
                                        onEventMouseDown={(e, event, masterId) =>
                                            onChipMouseDown(e, event, ds, masterId)
                                        }
                                    />
                                )
                            }}
                        </For>
                    </div>
                </div>
            </div>
        </div>
    )
}
