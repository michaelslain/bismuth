// app/src/daemon/activityLine.ts
// Pure formatter turning one raw ActivityEvent (core/src/daemonActivity.ts — cron/process/daemon
// lifecycle events from the daemon's activity log) into the strings + a tone DaemonLogRow.tsx renders
// per row, the note saying why among them. No Solid imports — see activityLine.test.ts. Vocabulary this maps (docs/api/
// http-reference.md `GET /daemon/logs`): cron started/finished/skipped, process
// started/exited/restarting/reaped, daemon brain-started.
import type { ActivityEvent } from '../../../core/src/daemonActivity'
import { isFailedResult } from './failedResult'

export type ActivityTone = 'ok' | 'fail' | 'live' | 'quiet'

export type ActivityLine = {
    time: string
    who: string
    what: string
    tone: ActivityTone
    duration: string | null
    /** Why it happened or how it ended: the cause, the detail and the run's report line, joined
     *  with ` // `. Null when the event carries none of them. */
    note: string | null
}

const LIVE_EVENTS = new Set(['started', 'restarting'])

function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n)
}

/** "HH:MM" (local) when `ts` falls on the same local day as `now`, else "Mon D" (e.g. "Sep 12"). */
function timeLabel(ts: string, now: Date): string {
    const d = new Date(ts)
    const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
    if (sameDay) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** null without a duration; "<1s" under a second; whole seconds under a minute; else whole minutes. */
function durationLabel(ms: number | undefined): string | null {
    if (ms === undefined) return null
    if (ms < 1000) return '<1s'
    if (ms < 60000) return `${Math.round(ms / 1000)}s`
    return `${Math.round(ms / 60000)}m`
}

function toneOf(e: ActivityEvent): ActivityTone {
    if (isFailedResult(e.outcome)) return 'fail'
    if (!e.outcome && LIVE_EVENTS.has(e.event)) return 'live'
    if (e.event === 'skipped' || e.outcome === 'skipped') return 'quiet'
    return 'ok'
}

/** A skip's detail repeats the word the `what` column already shows ("skipped: no changes …"). */
function stripSkipped(detail: string): string {
    return detail.replace(/^skipped:\s*/i, '')
}

/** The note column: an environment cause first, then the detail, then the report line when it
 *  says something the detail did not. */
function noteOf(e: ActivityEvent): string | null {
    const parts: string[] = []
    // Only `environment` adds anything: a `job` failure is the run's own (its detail says what),
    // and a `timeout` detail already reads "aborted after Ns".
    if (e.cause === 'environment') parts.push(e.cause)
    if (e.detail)
        parts.push(e.outcome === 'skipped' ? stripSkipped(e.detail) : e.detail)
    if (e.summary && e.summary !== e.detail) parts.push(e.summary)
    return parts.length ? parts.join(' // ') : null
}

/** `event outcome`, said once when the outcome is the whole story: `skipped`, never
 *  `skipped skipped` or `finished skipped`. */
function whatOf(e: ActivityEvent): string {
    if (!e.outcome) return e.event
    if (e.outcome === e.event || e.outcome === 'skipped') return e.outcome
    return `${e.event} ${e.outcome}`
}

export default function activityLine(
    e: ActivityEvent,
    now: Date,
): ActivityLine {
    return {
        time: timeLabel(e.ts, now),
        who: e.name || e.kind,
        what: whatOf(e),
        tone: toneOf(e),
        duration: durationLabel(e.durationMs),
        note: noteOf(e),
    }
}
