export const MAX_MINUTES = 23 * 60 + 45
export const SNAP_INTERVAL = 30

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
 * `dragged` — whether the pointer actually moved — is the load-bearing input. Both endpoints are
 * snapped independently to SNAP_INTERVAL, so a genuine drag of up to just under one bucket width
 * nets to zero minutes and is indistinguishable from a click by duration alone. Flooring such a
 * drag to one interval is what stops it silently producing an event with no end time.
 * A plain click still yields no endTime, which is what opens the modal at its default duration.
 */
export function computeCreatePayload(
    date: string,
    startMinutes: number,
    currentMinutes: number,
    dragged: boolean,
): CreatePayload {
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
