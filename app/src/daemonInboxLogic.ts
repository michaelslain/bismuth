// app/src/daemonInboxLogic.ts
// Pure sorting/grouping logic for the daemon inbox (core/src/daemonPages.ts), split out from the
// reactive store (daemonInbox.ts) so it's unit-testable headlessly — matches the
// bases/flashcardsQueue.ts split (pure queue logic vs. the Solid-facing FlashcardsView).
import type { DaemonPage, PageStatus } from '../../core/src/daemonPages'

/** Status → the colour an inbox row's <StatusDot> renders in (InboxRow.tsx) — a pure
 *  presentation lookup, not tied to Solid, so it lives beside the sort/group helpers. Per the ASCII
 *  design system's status-dot convention: pending=gold (awaiting review) · working=blue (in
 *  flight) · done=green · failed=danger · dismissed=faint (settled, no longer live). */
export const STATUS_COLOR: Record<PageStatus, string> = {
    pending: 'var(--gold)',
    working: 'var(--blue)',
    done: 'var(--green)',
    failed: 'var(--danger)',
    dismissed: 'var(--faint)',
}

/**
 * Stateless due predicate (no delivery write, no queued/delivered persisted state — see the
 * plan's §3): a page is due once it's still `pending` and its `deliverAt` (or `createdAt` when
 * `deliverAt` is omitted — "deliver on next open") has passed. Re-evaluated fresh on every call.
 */
export function isDue(p: DaemonPage, now: number): boolean {
    if (p.status !== 'pending') return false
    const at = Date.parse(p.deliverAt ?? p.createdAt)
    return Number.isNaN(at) || now >= at // unparseable timestamp => treat as already due
}

/** Status → the word a screen reader hears in place of the dot's colour. */
export const STATUS_WORD: Record<PageStatus, string> = {
    pending: 'needs review',
    working: 'working',
    done: 'done',
    failed: 'failed',
    dismissed: 'dismissed',
}

/** Settled for good. `failed` is NOT here: a failed page keeps its actions live and pressing
 *  again re-runs the round-trip (docs/daemon/pages.md, "Retry"), so it still needs the user. */
const SETTLED: ReadonlySet<DaemonPage['status']> = new Set([
    'done',
    'dismissed',
])

/** "Needs review": due pages, oldest-created first (FIFO — first authored, first reviewed). */
export function dueSorted(pages: DaemonPage[], now: number): DaemonPage[] {
    return pages
        .filter(p => isDue(p, now))
        .sort(
            (a, b) =>
                Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''),
        )
}

/** "Scheduled": pending pages with a future `deliverAt`, soonest first — transparency only,
 *  no actions rendered (mirrors the inbox's read-only "not due yet" section). */
export function scheduledSorted(
    pages: DaemonPage[],
    now: number,
): DaemonPage[] {
    return pages
        .filter(p => p.status === 'pending' && !isDue(p, now))
        .sort(
            (a, b) =>
                Date.parse(a.deliverAt || '') - Date.parse(b.deliverAt || ''),
        )
}

const newestSettledFirst = (a: DaemonPage, b: DaemonPage) =>
    Date.parse(b.completedAt ?? b.pressedAt ?? '') -
    Date.parse(a.completedAt ?? a.pressedAt ?? '')

/** "Failed": pages whose action the daemon could not complete, newest first — retryable. */
export function failedSorted(pages: DaemonPage[]): DaemonPage[] {
    return pages.filter(p => p.status === 'failed').sort(newestSettledFirst)
}

/** "Recently resolved": settled pages (done/dismissed), most-recently-settled first. */
export function resolvedSorted(pages: DaemonPage[]): DaemonPage[] {
    return pages.filter(p => SETTLED.has(p.status)).sort(newestSettledFirst)
}

/** A row button's label: the action that failed reads retry, since pressing it re-runs it;
 *  every other label is the page's own, lowercased for TextButton. */
export function actionLabel(page: DaemonPage, actionId: string): string {
    if (page.status === 'failed' && page.pressedAction === actionId)
        return 'retry'
    const action = page.actions.find(a => a.id === actionId)
    return (action?.label ?? actionId).toLowerCase()
}

/**
 * "Approve-all" only appears when every page in the due set exposes the SAME single primary
 * action id (2+ pages) — returns that shared id, or null when there are fewer than two due pages
 * or their primary actions disagree/are missing. "Primary" = the one action whose `kind` is
 * "primary"; a page with zero or more than one primary action never contributes (ambiguous).
 */
export function sharedPrimaryAction(pages: DaemonPage[]): string | null {
    if (pages.length < 2) return null
    let shared: string | null = null
    for (const p of pages) {
        const primaries = p.actions.filter(a => a.kind === 'primary')
        if (primaries.length !== 1) return null
        const id = primaries[0].id
        if (shared === null) shared = id
        else if (shared !== id) return null
    }
    return shared
}
