// Pure geometry for the hourly day grid: which events belong to a column, where each one sits
// vertically, and which lane an overlap puts it in. No framework imports — TimeGrid.tsx and its
// parts only wire the result. The grid's height is defined ONCE here (`GRID_PX`); TimeGrid.module.css
// defines the matching `--time-grid-height` custom property, which every CSS module beneath reads
// (a test keeps the two equal).
import type { CalendarEvent } from '../../types'
import { clamp, minutesToStr, snap } from './timeGridDrag'

export const MINUTES_PER_DAY = 24 * 60
/** 72px an hour: four of the app's 18px rows (--row-h), so a quarter hour is 18px and every grid
 *  line, half-hour row and 15-minute snap lands on the unit. Also tile-h + 4 x pitch, so each hour
 *  block is a whole number of ASCII dash pitches and its typed `-` paints one pitch both ways. */
export const GRID_PX = 1728

/** A block shorter than this many px lays out on one line (time + title side by side). A 30-min
 *  block (33px, one half-hour row) is that short; a 45-min block (51px) has room for the time
 *  over a full-width title line. */
const COMPACT_BELOW_PX = 40
/** Every chip trims this much so neighbours keep a hairline gap. */
const CHIP_TRIM_PX = 3
const MIN_HEIGHT_PX = 8
/** A block at most this many minutes long drops its time. It is also the visual FLOOR: anything
 *  shorter grows to one half-hour row, so every block fills whole grid rows and a 30-min event
 *  sits exactly between two lines instead of spilling past the next one. */
const SHORT_MIN = 30
/** A zero-length drag span floors to this many minutes. */
const ZERO_SPAN_MIN = 15

export type MinuteSpan = { startMin: number; endMin: number }

export function minutesToPx(min: number): number {
    return (min / MINUTES_PER_DAY) * GRID_PX
}

/** A day's events in reading order: all-day first, then by start time. The sort is stable, so
 *  events that start together (or are all-day) keep their stored order. Never mutates its input. */
export function sortDayEvents(events: CalendarEvent[]): CalendarEvent[] {
    const key = (e: CalendarEvent): number =>
        e.startTime ? eventMinutes(e).startMin : -1
    return [...events].sort((a, b) => key(a) - key(b))
}

/** Timed events on one day, earliest start first. */
export function timedOn(events: CalendarEvent[], ds: string): CalendarEvent[] {
    return sortDayEvents(events.filter(e => e.date === ds && e.startTime))
}

/** All-day (untimed) events on one day, in source order. */
export function allDayOn(events: CalendarEvent[], ds: string): CalendarEvent[] {
    return events.filter(e => e.date === ds && !e.startTime)
}

export function eventMinutes(e: {
    startTime?: string
    endTime?: string
}): MinuteSpan {
    const [sh, sm] = (e.startTime ?? '00:00').split(':').map(Number)
    const startMin = sh * 60 + sm
    // Default to start+1h, clamped to 23:59 so a late start (e.g. 23:30) never
    // yields an earlier end (negative duration).
    const [eh, em] = (
        e.endTime || minutesToStr(Math.min(startMin + 60, 23 * 60 + 59))
    )
        .split(':')
        .map(Number)
    // An end BEFORE the start (typed backwards, or "23:00 to 01:00" across midnight) is a
    // zero-length event at its start, not a swap: the start is what places the block, and swapping
    // would invent a start the user never set (23:00-01:00 would jump to 01:00). Zero-length then
    // gets the usual half-hour floor, capped at the next event.
    return { startMin, endMin: Math.max(eh * 60 + em, startMin) }
}

export function yToMinutes(y: number, colHeight: number): number {
    return clamp(snap((y / colHeight) * MINUTES_PER_DAY))
}

/** The height of a block spanning `duration` minutes: true to its duration, except that a block
 *  shorter than `SHORT_MIN` grows to it — never past `room` minutes (the gap before whatever
 *  starts next) — so the title stays readable. */
function blockHeight(duration: number, room = Infinity): number {
    const visual = Math.max(duration, Math.min(SHORT_MIN, room))
    return Math.max(minutesToPx(visual) - CHIP_TRIM_PX, MIN_HEIGHT_PX)
}

/**
 * Lay out overlapping events side-by-side. Events that overlap in time are split into
 * vertical lanes (first-fit greedy), so two events in the same slot — e.g. an event and
 * its duplicate — render as distinct columns instead of stacked on top of each other.
 * Returns id → { lane, lanes } where `lanes` is the width of that event's overlap group.
 */
export function computeLanes(
    items: { id: string; startMin: number; endMin: number }[],
): Map<string, { lane: number; lanes: number }> {
    // A reversed range counts as zero-length (see eventMinutes), and every event holds at least
    // its own minute so two zero-length events at one time still take separate lanes.
    const sorted = items
        .map(it => ({ ...it, endMin: Math.max(it.endMin, it.startMin + 1) }))
        .sort(
        (a, b) => a.startMin - b.startMin || a.endMin - b.endMin,
    )
    const out = new Map<string, { lane: number; lanes: number }>()
    let cluster: typeof sorted = []
    let clusterEnd = -Infinity
    const flush = (): void => {
        if (!cluster.length) return
        const laneEnds: number[] = [] // end minute of the last event placed in each lane
        const placed: Array<[string, number]> = []
        for (const it of cluster) {
            let lane = laneEnds.findIndex(end => end <= it.startMin)
            if (lane === -1) {
                lane = laneEnds.length
                laneEnds.push(it.endMin)
            } else laneEnds[lane] = it.endMin
            placed.push([it.id, lane])
        }
        const lanes = laneEnds.length
        for (const [id, lane] of placed) out.set(id, { lane, lanes })
        cluster = []
        clusterEnd = -Infinity
    }
    for (const it of sorted) {
        if (cluster.length && it.startMin >= clusterEnd) flush() // no overlap with the open cluster
        cluster.push(it)
        clusterEnd = Math.max(clusterEnd, it.endMin)
    }
    flush()
    return out
}

export type DayLayoutItem = {
    event: CalendarEvent
    top: number
    height: number
    lane: number
    lanes: number
    /** Only genuinely tiny blocks lay out on one line; everything else keeps time-over-title. */
    compact: boolean
    /** At most `SHORT_MIN` long: the chip drops its time — the block's position already says when,
     *  and the title gets the room. */
    short: boolean
}

/** Geometry + lane for every timed event of ONE day (pass `timedOn(...)`'s result). */
export function layoutDay(dayEvents: CalendarEvent[]): DayLayoutItem[] {
    const spans = dayEvents.map(e => eventMinutes(e))
    const starts = spans.map(s => s.startMin)
    const nextStartAfter = (startMin: number): number =>
        Math.min(...starts.filter(s => s > startMin), Infinity)
    const lanes = computeLanes(
        dayEvents.map((e, i) => {
            // An event with no explicit end defaults to a 1h block, which would overlap a
            // back-to-back event starting <1h later and force a spurious side-by-side lane. Cap
            // its end at the next event's start so consecutive untimed-end events stack.
            const { startMin, endMin } = spans[i]
            const cap = e.endTime ? Infinity : nextStartAfter(startMin)
            return { id: e.id, startMin, endMin: Math.min(endMin, cap) }
        }),
    )
    return dayEvents.map((event, i) => {
        const { startMin, endMin } = spans[i]
        const top = minutesToPx(startMin)
        // The block's 30-min floor can reach past midnight (23:45 grows to 00:15); the grid ends
        // at GRID_PX, so cut it there rather than spill over the closing rule.
        const height = Math.min(
            blockHeight(endMin - startMin, nextStartAfter(startMin) - startMin),
            GRID_PX - top,
        )
        const li = lanes.get(event.id)
        return {
            event,
            top,
            height,
            lane: li?.lane ?? 0,
            lanes: li?.lanes ?? 1,
            compact: height < COMPACT_BELOW_PX,
            short: endMin - startMin <= SHORT_MIN,
        }
    })
}

/** Box of the drag preview: matches the rendered chip's height exactly (short events grow to a
 *  half-hour row and every chip trims 3px). A zero span floors to 15 minutes. */
export function ghostBox(
    startMin: number,
    endMin: number,
): { top: number; height: number; endMin: number } {
    const end = endMin <= startMin ? startMin + ZERO_SPAN_MIN : endMin
    return {
        top: minutesToPx(startMin),
        height: blockHeight(end - startMin),
        endMin: end,
    }
}
