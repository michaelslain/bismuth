// app/src/daemon/activityLine.ts
// Pure formatter turning one raw ActivityEvent (core/src/daemonActivity.ts — cron/process/daemon
// lifecycle events from the daemon's activity log) into the four strings + a tone DaemonLog.tsx
// renders per row. No Solid imports — see activityLine.test.ts. Vocabulary this maps (docs/api/
// http-reference.md `GET /daemon/logs`): cron started/finished/skipped/stopped, process
// started/exited/restarting/reaped, daemon brain-started.
import type { ActivityEvent } from '../../../core/src/daemonActivity'

export type ActivityTone = 'ok' | 'fail' | 'live' | 'quiet'

export type ActivityLine = {
    time: string
    who: string
    what: string
    tone: ActivityTone
    duration: string | null
}

const FAIL_OUTCOMES = new Set(['failed', 'killed', 'error'])
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
    if (e.outcome && FAIL_OUTCOMES.has(e.outcome)) return 'fail'
    if (!e.outcome && LIVE_EVENTS.has(e.event)) return 'live'
    if (e.event === 'skipped' || e.outcome === 'skipped') return 'quiet'
    return 'ok'
}

export default function activityLine(
    e: ActivityEvent,
    now: Date,
): ActivityLine {
    return {
        time: timeLabel(e.ts, now),
        who: e.name || e.kind,
        what: e.outcome ? `${e.event} ${e.outcome}` : e.event,
        tone: toneOf(e),
        duration: durationLabel(e.durationMs),
    }
}
