export const MAX_MINUTES = 23 * 60 + 45
export const SNAP_INTERVAL = 30

/**
 * Pointer movement, in CSS pixels, that a press must EXCEED before it counts as a drag rather
 * than a click. Industry standard is a 3-5px band: Windows exposes it as SM_CXDRAG/SM_CYDRAG
 * with a 4px default, Chromium uses ~5px, macOS ~3px, and mainstream drag-and-drop libraries
 * default into the same range. Exclusive comparison, so exactly 4px is still a click.
 *
 * Without it the flag below had a ZERO-pixel threshold — a trackpad wobble during an intended
 * click floored a 30-minute event, while a perfectly still click opened the modal at its
 * default duration.
 */
export const DRAG_DEADZONE_PX = 4

/** Straight-line pointer displacement. Euclidean, not per-axis: a diagonal wobble of 3px on
 *  each axis is 4.24px of movement, and treating that as 3px would make the deadzone
 *  directional. */
export function pointerDistance(dx: number, dy: number): number {
    return Math.hypot(dx, dy)
}

export function minutesToStr(m: number): string {
    const hours = String(Math.floor(m / 60)).padStart(2, '0')
    const minutes = String(m % 60).padStart(2, '0')
    return `${hours}:${minutes}`
}

export function snap(m: number): number {
    return Math.round(m / SNAP_INTERVAL) * SNAP_INTERVAL
}

export function clamp(m: number): number {
    return Math.max(0, Math.min(MAX_MINUTES, m))
}

export type CreatePayload = { date: string; startTime: string; endTime?: string }

/**
 * Decide what a finished drag-to-create should open the modal with.
 *
 * `pointerMovedPx` — how far the pointer travelled from where the press started — is the
 * load-bearing input. Both endpoints are snapped independently to SNAP_INTERVAL, so a genuine
 * drag of up to just under one bucket width nets to zero minutes and is indistinguishable from
 * a click by duration alone. Flooring such a drag to one interval is what stops it silently
 * producing an event with no end time; requiring DRAG_DEADZONE_PX of movement first is what
 * stops a wobble during an intended click from being floored the same way.
 * A click still yields no endTime, which is what opens the modal at its default duration.
 *
 * Note the caller passes the RUNNING MAXIMUM displacement, not the final one — a press that
 * wanders out and returns to its origin is still a drag.
 */
export function computeCreatePayload(
    date: string,
    startMinutes: number,
    currentMinutes: number,
    pointerMovedPx: number,
): CreatePayload {
    const dragged = pointerMovedPx > DRAG_DEADZONE_PX
    let start = Math.min(startMinutes, currentMinutes)
    let end = Math.max(startMinutes, currentMinutes)
    if (dragged && end - start < SNAP_INTERVAL) {
        end = clamp(start + SNAP_INTERVAL)
        // A drag flush against the end of the day (start already at MAX_MINUTES) can't extend
        // end any further — clamp() just caps it back to start, which would leave duration at 0
        // and defeat the floor entirely. Pull start back by SNAP_INTERVAL instead so the drag
        // still nets a real interval, just backdated rather than forward-dated.
        if (end - start < SNAP_INTERVAL) start = clamp(end - SNAP_INTERVAL)
    }
    const duration = end - start
    return {
        date,
        startTime: minutesToStr(start),
        ...(duration >= SNAP_INTERVAL ? { endTime: minutesToStr(end) } : {}),
    }
}
