import { expect, test } from 'bun:test'
import {
    computeCreatePayload,
    DRAG_DEADZONE_PX,
    pointerDistance,
    SNAP_INTERVAL,
} from './timeGridDrag'

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))

/** Comfortably past the deadzone — a movement nobody would call a click. */
const DRAGGED = 12

test('a real drag that snaps back to zero net minutes still gets an explicit end time', () => {
    const r = computeCreatePayload('2026-01-01', 30, 30, DRAGGED)
    expect(r.endTime).toBeDefined()
    expect(mins(r.endTime!) - mins(r.startTime)).toBe(SNAP_INTERVAL)
})

test('an ordinary one-bucket drag is unchanged', () => {
    const r = computeCreatePayload('2026-01-01', 30, 60, DRAGGED)
    expect(r.startTime).toBe('00:30')
    expect(r.endTime).toBe('01:00')
})

test('a drag is direction-agnostic — dragging upward still yields start < end', () => {
    const r = computeCreatePayload('2026-01-01', 120, 60, DRAGGED)
    expect(r.startTime).toBe('01:00')
    expect(r.endTime).toBe('02:00')
})

test('a still click keeps the existing default-duration behaviour', () => {
    const r = computeCreatePayload('2026-01-01', 30, 30, 0)
    expect(r.endTime).toBeUndefined()
})

test('a floored drag at the very end of the day stays inside the grid', () => {
    const r = computeCreatePayload('2026-01-01', 23 * 60 + 45, 23 * 60 + 45, DRAGGED)
    expect(mins(r.endTime!)).toBeLessThanOrEqual(23 * 60 + 45)
})

// ── The deadzone ────────────────────────────────────────────────────────────────────────
// The pair below is the whole point of the change: pre-deadzone, BOTH of these produced a
// floored 30-minute event, because any mousemove at all set the old boolean.

test('a 3px wobble is a click, not a drag — no end time', () => {
    const r = computeCreatePayload('2026-01-01', 30, 30, 3)
    expect(r.endTime).toBeUndefined()
})

test('a 5px movement is a drag — floored to one snap interval', () => {
    const r = computeCreatePayload('2026-01-01', 30, 30, 5)
    expect(r.endTime).toBeDefined()
    expect(mins(r.endTime!) - mins(r.startTime)).toBe(SNAP_INTERVAL)
})

test('movement of exactly the deadzone is still a click — the threshold is exclusive', () => {
    const r = computeCreatePayload('2026-01-01', 30, 30, DRAG_DEADZONE_PX)
    expect(r.endTime).toBeUndefined()
})

// The deadzone governs the FLOOR only. It must never suppress a span the pointer genuinely
// covered — otherwise a slow drag across a bucket boundary would lose its end time.
test('a genuine multi-bucket span keeps its end time even below the deadzone', () => {
    const r = computeCreatePayload('2026-01-01', 30, 60, 0)
    expect(r.endTime).toBe('01:00')
})

test('pointerDistance is euclidean, not per-axis', () => {
    expect(pointerDistance(3, 4)).toBe(5)
    expect(pointerDistance(-3, -4)).toBe(5)
    expect(pointerDistance(0, 0)).toBe(0)
})

// The 3px/5px pair above only constrains the deadzone to [3, 5) — a silent edit to 3 or to 4.9
// would ship green. These literals pin the user's actual product decision (4px, industry
// standard) to within a hundredth of a pixel, through the same path a real drag takes.
test('the deadzone sits at 4px specifically', () => {
    expect(computeCreatePayload('2026-01-01', 30, 30, 3.99).endTime).toBeUndefined()
    expect(computeCreatePayload('2026-01-01', 30, 30, 4.01).endTime).toBeDefined()
})
