// app/src/chat/chatRelativeTime.ts
// Compact relative time for a chat session's lastModified (ms epoch), moved verbatim from
// ChatView.tsx (~320) so the history panel's row labels are unit-tested without pulling in the
// Solid component. Pure — no DOM, no framework.

/** "just now", "5m ago", "2h ago", "3d ago", then a short date. Used to label history rows. */
export function relativeTime(ms: number): string {
    const diff = Date.now() - ms
    if (!Number.isFinite(diff) || diff < 0) return 'just now'
    const sec = Math.floor(diff / 1000)
    if (sec < 45) return 'just now'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    const day = Math.floor(hr / 24)
    if (day < 7) return `${day}d ago`
    return new Date(ms).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
    })
}
