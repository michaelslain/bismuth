// app/src/daemon/failedResult.ts
// The one predicate for "did this lastFired/outcome result mean the run failed" — shared by
// activityLine.ts (the log line's tone), daemonPageModel.ts (hasRecentFailure, which drives the
// face's `hurt` mood), cronStatus.ts (cronStatus/cronTone) and DaemonCrons.tsx (each cron row's
// dot + label). The daemon writes `result: 'killed'` on a cron timeout (daemon/src/daemon/cron.ts)
// and counts `killed` as a failure in its own streak logic (`nextLastFired`) — every consumer
// reading a result string must treat it the same as `'failed'`, and `'error'` the same way for
// process/daemon events. No Solid imports — see failedResult.test.ts.
export function isFailedResult(result: string | null | undefined): boolean {
    return result === 'failed' || result === 'killed' || result === 'error'
}

export default isFailedResult
