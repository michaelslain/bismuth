import { expect, test } from 'bun:test'
import { computeCreatePayload, SNAP_INTERVAL } from './timeGridDrag'

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))

test('a real drag that snaps back to zero net minutes still gets an explicit end time', () => {
    const r = computeCreatePayload('2026-01-01', 30, 30, true)
    expect(r.endTime).toBeDefined()
    expect(mins(r.endTime!) - mins(r.startTime)).toBe(SNAP_INTERVAL)
})

test('an ordinary one-bucket drag is unchanged', () => {
    const r = computeCreatePayload('2026-01-01', 30, 60, true)
    expect(r.startTime).toBe('00:30')
    expect(r.endTime).toBe('01:00')
})

test('a drag is direction-agnostic — dragging upward still yields start < end', () => {
    const r = computeCreatePayload('2026-01-01', 120, 60, true)
    expect(r.startTime).toBe('01:00')
    expect(r.endTime).toBe('02:00')
})

test('a plain click (no mousemove) keeps the existing default-duration behaviour', () => {
    const r = computeCreatePayload('2026-01-01', 30, 30, false)
    expect(r.endTime).toBeUndefined()
})

test('a floored drag at the very end of the day stays inside the grid', () => {
    const r = computeCreatePayload('2026-01-01', 23 * 60 + 45, 23 * 60 + 45, true)
    expect(mins(r.endTime!)).toBeLessThanOrEqual(23 * 60 + 45)
})
