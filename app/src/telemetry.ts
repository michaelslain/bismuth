/**
 * Lightweight dev-loop visibility for SSE health. Just console.warn — no
 * persistence, no remote shipping. The point is to make broken connections
 * visible during local development so we notice silent drops.
 */

export function recordSseError(e: Event): void {
  console.warn("[sse] EventSource error", {
    at: new Date().toISOString(),
    readyState: (e.target as EventSource | null)?.readyState,
  });
}

export function recordPollCatchup(observed: number, lastSse: number): void {
  console.warn("[sse] fallback poll caught a version SSE missed", {
    at: new Date().toISOString(),
    pollObserved: observed,
    lastSseVersion: lastSse,
    delta: observed - lastSse,
  });
}
