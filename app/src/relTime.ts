// app/src/relTime.ts
// Shared relative-time formatting. Thin wrappers over a common
// chained-bucketing core so each call site keeps its exact output:
//   - relTimeMs(ms): coarse "just now / Nm / Nh / Nd ago" (floored, no seconds
//     bucket), used by the daemon page's face caption
//     (daemon/daemonPageModel.ts faceCaption, "last: <cron> <age>").
//   - relTimeChat(ms): the chat history row's label (45s just-now, date from 7d).
//   - relTimeISO(iso): finer "Ns / Nm / Nh / Nd ago" (rounded, with a seconds
//     bucket) from an ISO timestamp, used by the DaemonOwnerModal device list.
//
// Both walk the same unit ladder (s → m → h → d), rounding into each unit and
// promoting when the rounded value reaches the next unit's threshold, so the
// bucket is chosen on the rounded count (not the raw diff). `seconds` toggles
// the sub-minute bucket between a numeric "Ns ago" and a fixed `justNow` label.

type Round = (n: number) => number

type FormatOpts = {
    seconds: boolean
    justNow: string
    round: Round
    /** Seconds below which the age reads as `justNow` / "Ns ago" (default 60). */
    justNowBelow?: number
    /** Days at which the ladder stops and `dateFallback` formats the timestamp instead. */
    dateAfterDays?: number
    dateFallback?: () => string
}

/**
 * Core formatter over an elapsed millisecond count, walking s → m → h → d with
 * chained rounding/promotion (matches the historical hand-rolled helpers).
 */
function format(diffMs: number, opts: FormatOpts): string {
    const { seconds, justNow, round, justNowBelow = 60 } = opts
    const secs = Math.max(0, round(diffMs / 1000))
    if (secs < justNowBelow) return seconds ? `${secs}s ago` : justNow
    const mins = round(secs / 60)
    if (mins < 60) return `${mins}m ago`
    const hours = round(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = round(hours / 24)
    if (opts.dateAfterDays !== undefined && days >= opts.dateAfterDays)
        return opts.dateFallback!()
    return `${days}d ago`
}

/** Coarse relative time from an epoch-ms timestamp: "just now / Nm / Nh / Nd ago". */
export function relTimeMs(ms: number, now: number = Date.now()): string {
    return format(now - ms, {
        seconds: false,
        justNow: 'just now',
        round: Math.floor,
    })
}

/**
 * Relative "last seen" from an ISO string (best-effort): "Ns / Nm / Nh / Nd ago".
 * Returns "never seen" for empty input and echoes back an unparseable string.
 */
export function relTimeISO(iso: string): string {
    if (!iso) return 'never seen'
    const t = Date.parse(iso)
    if (Number.isNaN(t)) return iso
    return format(Date.now() - t, {
        seconds: true,
        justNow: 'just now',
        round: Math.round,
    })
}

/**
 * Chat history labels: "just now" under 45s, then "Nm / Nh / Nd ago", then a short
 * date from a week on. A future or non-finite timestamp reads as "just now".
 */
export function relTimeChat(ms: number): string {
    const diff = Date.now() - ms
    if (!Number.isFinite(diff) || diff < 0) return 'just now'
    return format(diff, {
        seconds: false,
        justNow: 'just now',
        round: Math.floor,
        justNowBelow: 45,
        dateAfterDays: 7,
        dateFallback: () =>
            new Date(ms).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
            }),
    })
}
