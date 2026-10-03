import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
    GRID_PX,
    MINUTES_PER_DAY,
    allDayOn,
    eventMinutes,
    ghostBox,
    layoutDay,
    minutesToPx,
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
