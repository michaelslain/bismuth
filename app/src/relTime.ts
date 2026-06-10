// app/src/relTime.ts
// Shared relative-time formatting for the daemon UI. Two thin wrappers over a
// common chained-bucketing core so each call site keeps its exact output:
//   - relTimeMs(ms): coarse "just now / Nm / Nh / Nd ago" (floored, no seconds
//     bucket), used by the DaemonList cron status column.
//   - relTimeISO(iso): finer "Ns / Nm / Nh / Nd ago" (rounded, with a seconds
//     bucket) from an ISO timestamp, used by the DaemonOwnerModal device list.
//
// Both walk the same unit ladder (s → m → h → d), rounding into each unit and
// promoting when the rounded value reaches the next unit's threshold, so the
// bucket is chosen on the rounded count (not the raw diff). `seconds` toggles
// the sub-minute bucket between a numeric "Ns ago" and a fixed `justNow` label.

type Round = (n: number) => number;

/**
 * Core formatter over an elapsed millisecond count, walking s → m → h → d with
 * chained rounding/promotion (matches the historical hand-rolled helpers).
 */
function format(diffMs: number, opts: { seconds: boolean; justNow: string; round: Round }): string {
  const { seconds, justNow, round } = opts;
  const secs = Math.max(0, round(diffMs / 1000));
  if (secs < 60) return seconds ? `${secs}s ago` : justNow;
  const mins = round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${round(hours / 24)}d ago`;
}

/** Coarse relative time from an epoch-ms timestamp: "just now / Nm / Nh / Nd ago". */
export function relTimeMs(ms: number): string {
  return format(Date.now() - ms, { seconds: false, justNow: "just now", round: Math.floor });
}

/**
 * Relative "last seen" from an ISO string (best-effort): "Ns / Nm / Nh / Nd ago".
 * Returns "never seen" for empty input and echoes back an unparseable string.
 */
export function relTimeISO(iso: string): string {
  if (!iso) return "never seen";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return format(Date.now() - t, { seconds: true, justNow: "just now", round: Math.round });
}
