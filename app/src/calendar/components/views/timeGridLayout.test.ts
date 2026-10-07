import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
    GRID_PX,
    computeLanes,
    MINUTES_PER_DAY,
    allDayOn,
    eventMinutes,
    ghostBox,
    layoutDay,
    minutesToPx,
    sortDayEvents,
    timedOn,
    yToMinutes,
} from './timeGridLayout'

const ev = (
    id: string,
    date: string,
    startTime?: string,
    endTime?: string,
) => ({
    id,
    title: id,
    date,
    startTime,
    endTime,
})

test('one grid height, one minutes-per-day', () => {
    expect(MINUTES_PER_DAY).toBe(1440)
    expect(minutesToPx(MINUTES_PER_DAY)).toBe(GRID_PX)
    expect(minutesToPx(720)).toBe(GRID_PX / 2)
})

test('timedOn / allDayOn split a day by startTime', () => {
    const list = [ev('a', 'd1', '09:00'), ev('b', 'd1'), ev('c', 'd2', '10:00')]
    expect(timedOn(list, 'd1').map(e => e.id)).toEqual(['a'])
    expect(allDayOn(list, 'd1').map(e => e.id)).toEqual(['b'])
})

test('eventMinutes defaults the end to +1h and never runs backwards near midnight', () => {
    expect(eventMinutes(ev('a', 'd', '09:00'))).toEqual({
        startMin: 540,
        endMin: 600,
    })
    expect(eventMinutes(ev('a', 'd', '09:00', '09:30'))).toEqual({
        startMin: 540,
        endMin: 570,
    })
    const late = eventMinutes(ev('a', 'd', '23:30'))
    expect(late.endMin).toBeGreaterThan(late.startMin)
})

test('yToMinutes snaps to the interval and clamps', () => {
    expect(yToMinutes(GRID_PX / 2, GRID_PX)).toBe(720)
    expect(yToMinutes(-50, GRID_PX)).toBe(0)
    expect(yToMinutes(GRID_PX * 2, GRID_PX)).toBe(23 * 60 + 45)
})

test('layoutDay puts overlapping events in lanes and fits a 30-min block in one row', () => {
    const a = ev('a', 'd', '09:00', '10:00')
    const b = ev('b', 'd', '09:30', '10:30')
    const c = ev('c', 'd', '13:00', '13:30')
    const out = layoutDay([a, b, c])
    const byId = Object.fromEntries(out.map(l => [l.event.id, l]))
    expect(byId.a.lane).toBe(0)
    expect(byId.b.lane).toBe(1)
    expect(byId.a.lanes).toBe(2)
    expect(byId.c.lanes).toBe(1)
    // a 30 min event is exactly one half-hour row, minus the 3px trim — it never crosses a line
    expect(byId.c.height).toBeCloseTo(minutesToPx(30) - 3)
    // ...which is one line tall: the compact layout
    expect(byId.c.compact).toBe(true)
    // 30 min or less drops its time; a 1h block keeps it
    expect(byId.c.short).toBe(true)
    expect(byId.a.short).toBe(false)
    expect(byId.a.top).toBe(minutesToPx(540))
    expect(byId.a.compact).toBe(false)
})

test('a block shorter than 30 min grows to a half-hour row, never into the next event', () => {
    const out = layoutDay([
        ev('a', 'd', '08:00', '08:15'),
        ev('b', 'd', '09:00', '09:10'),
        ev('c', 'd', '09:20', '10:00'),
    ])
    const byId = Object.fromEntries(out.map(l => [l.event.id, l]))
    expect(byId.a.height).toBeCloseTo(minutesToPx(30) - 3)
    expect(byId.b.height).toBeCloseTo(minutesToPx(20) - 3)
})

test('a back-to-back 30-min block keeps its own row', () => {
    const out = layoutDay([
        ev('a', 'd', '08:00', '08:30'),
        ev('b', 'd', '08:30', '10:00'),
    ])
    const a = out.find(l => l.event.id === 'a')!
    expect(a.height).toBeCloseTo(minutesToPx(30) - 3)
    expect(a.compact).toBe(true)
})

test('an untimed-end event is capped at the next start so back-to-backs stack', () => {
    const out = layoutDay([ev('a', 'd', '08:00'), ev('b', 'd', '08:30')])
    expect(out.every(l => l.lanes === 1)).toBe(true)
})

test('ghostBox floors a zero span to 15 minutes and sizes like the chip', () => {
    const g = ghostBox(600, 600)
    expect(g.endMin).toBe(615)
    expect(g.top).toBe(minutesToPx(600))
    expect(g.height).toBeCloseTo(minutesToPx(30) - 3)
    expect(ghostBox(600, 630).height).toBeCloseTo(minutesToPx(30) - 3)
    expect(ghostBox(600, 660).height).toBeCloseTo(minutesToPx(60) - 3)
})

test('the CSS custom property and the TS constant are one number', () => {
    const css = readFileSync(
        new URL('./TimeGrid.module.css', import.meta.url),
        'utf8',
    )
    expect(css).toContain(`--time-grid-height: ${GRID_PX}px`)
})

test('an event at 00:00 starts on the top rule', () => {
    const [l] = layoutDay([ev('a', 'd', '00:00', '01:00')])
    expect(l.top).toBe(0)
    expect(l.height).toBeCloseTo(minutesToPx(60) - 3)
})

test('no block ever spills past the closing rule, however late it starts', () => {
    for (const start of ['23:30', '23:45', '23:59']) {
        for (const end of [undefined, '23:59']) {
            const [l] = layoutDay([ev('a', 'd', start, end)])
            expect(l.top + l.height).toBeLessThanOrEqual(GRID_PX)
            expect(l.height).toBeGreaterThan(0)
        }
    }
    // 23:30 still gets its full half-hour row; only 23:45 and later are cut short
    const [h] = layoutDay([ev('a', 'd', '23:30')])
    expect(h.height).toBeCloseTo(minutesToPx(30) - 3)
    const [q] = layoutDay([ev('a', 'd', '23:45')])
    expect(q.top + q.height).toBe(GRID_PX)
})

test('an end before the start is a zero-length block at the start, not a swap', () => {
    // crossing midnight: 23:00 to 01:00. The start places the block, so it stays at 23:00
    // and is capped like any other short block (never the 30-min floor of a negative span).
    expect(eventMinutes(ev('a', 'd', '23:00', '01:00'))).toEqual({
        startMin: 1380,
        endMin: 1380,
    })
    const out = layoutDay([
        ev('a', 'd', '23:00', '01:00'),
        ev('b', 'd', '23:10', '23:40'),
    ])
    const a = out.find(l => l.event.id === 'a')!
    expect(a.top).toBe(minutesToPx(1380))
    // zero length grows toward the half-hour floor but only to the event that follows (10 min,
    // 12px - the 3px trim = 9px, just over the 8px minimum) - never a flat 30-min block
    expect(a.height).toBe(9)
    expect(a.short).toBe(true)
})

test('computeLanes treats a reversed range as zero-length and still separates overlaps', () => {
    const lanes = computeLanes([
        { id: 'rev', startMin: 600, endMin: 540 },
        { id: 'same', startMin: 600, endMin: 600 },
        { id: 'later', startMin: 700, endMin: 760 },
    ])
    // the reversed and zero-length events share a minute, so they take two lanes
    expect(lanes.get('rev')!.lanes).toBe(2)
    expect(lanes.get('same')!.lane).not.toBe(lanes.get('rev')!.lane)
    expect(lanes.get('later')).toEqual({ lane: 0, lanes: 1 })
})

test('timedOn returns a day in start-time order, whatever order it was stored in', () => {
    const list = [
        ev('c', 'd', '14:00', '15:00'),
        ev('a', 'd', '09:00', '10:00'),
        ev('x', 'other', '08:00'),
        ev('b', 'd', '09:00', '09:30'),
    ]
    expect(timedOn(list, 'd').map(e => e.id)).toEqual(['a', 'b', 'c'])
})

test('sortDayEvents puts all-day first, then start time, and keeps ties in stored order', () => {
    const list = [
        ev('late', 'd', '14:00'),
        ev('early', 'd', '09:00'),
        ev('allday2', 'd'),
        ev('tie1', 'd', '09:00'),
        ev('allday1', 'd'),
    ]
    const before = list.map(e => e.id)
    expect(sortDayEvents(list).map(e => e.id)).toEqual([
        'allday2',
        'allday1',
        'early',
        'tie1',
        'late',
    ])
    expect(list.map(e => e.id)).toEqual(before) // never mutates its input
})

test('the grid is 72px an hour: every quarter hour lands on the 18px row unit', () => {
    const ROW_UNIT = 18
    expect(GRID_PX).toBe(24 * 4 * ROW_UNIT)
    expect(minutesToPx(60)).toBe(4 * ROW_UNIT)
    for (let q = 0; q <= 24 * 4; q++) {
        const px = minutesToPx(q * 15)
        // float division: land on the unit to rounding error, not by exact equality
        expect(Math.abs(px - q * ROW_UNIT), `quarter ${q}`).toBeLessThan(1e-9)
    }
})

test('30 min is the one-line compact block, 45 min is the first with room for time over title', () => {
    const half = layoutDay([ev('h', 'd', '10:00', '10:30')])[0]
    const three = layoutDay([ev('t', 'd', '10:00', '10:45')])[0]
    expect(half.height).toBe(minutesToPx(30) - 3)
    expect(half.compact).toBe(true)
    expect(three.height).toBe(minutesToPx(45) - 3)
    expect(three.compact).toBe(false)
})
