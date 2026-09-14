// app/src/migrationPoll.ts
//
// Pure retry-schedule logic for App.tsx's boot-time GET /tasks/migration poll. The server's
// task-syntax migration scan now starts only once its own tree build has settled (core/src/
// server.ts's boot warm-up chain), instead of firing at the very top of boot alongside every
// other fire-and-forget pass — so on a large vault, the report can genuinely still be `ran:
// null` well past a single fixed retry. Wave 3 review (I4): keep polling with exponential
// backoff instead of giving up after one retry, capped at a total time budget so an
// always-`null` response (a server that never finishes, or an old core with no migration
// support at all) does not poll forever.
//
// Kept here, pure and framework-free, so the schedule itself is unit-testable without wiring
// fake timers through Solid's onMount.

export interface MigrationPollScheduleOptions {
    /** Delay before the first retry (ms). Doubles every retry after that. Default 2000. */
    initialDelayMs?: number
    /** Stop scheduling once the NEXT delay would push cumulative elapsed time past this (ms).
     *  Default 60_000 (60s). */
    maxElapsedMs?: number
}

const DEFAULT_INITIAL_DELAY_MS = 2000
const DEFAULT_MAX_ELAPSED_MS = 60_000

/**
 * The full sequence of retry delays (ms) to wait between polls of GET /tasks/migration while it
 * keeps reporting `ran: null`: 2s, 4s, 8s, 16s, ... doubling each time, stopping before the
 * cumulative elapsed time (summed delays only — not response latency) would exceed
 * `maxElapsedMs`. The caller polls once, and if the result is still `ran: null`, waits for
 * `delays[0]`, polls again, waits for `delays[1]` if still null, and so on; once `delays` is
 * exhausted the caller gives up silently (an old core, or a migration that is taking unusually
 * long — either way, nothing more to do here).
 */
export function migrationPollDelays(
    opts: MigrationPollScheduleOptions = {},
): number[] {
    const initialDelayMs = opts.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
    const maxElapsedMs = opts.maxElapsedMs ?? DEFAULT_MAX_ELAPSED_MS
    const delays: number[] = []
    let elapsed = 0
    let delay = initialDelayMs
    while (elapsed + delay <= maxElapsedMs) {
        delays.push(delay)
        elapsed += delay
        delay *= 2
    }
    return delays
}
