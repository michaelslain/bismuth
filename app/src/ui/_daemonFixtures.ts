// Sample data for the daemon-inbox stories (dev-only, Storybook). NOT a story file itself —
// the `*.stories.*` glob (see `.storybook/main.ts`) skips underscore-prefixed files. Mirrors
// core/src/daemonPages.ts's `DaemonPage` shape (a page merged with its dynamic sidecar state)
// across every `PageStatus`, so a story can render the inbox's full state matrix
// (pending/working/done/failed/dismissed) without a live daemon.
import type { DaemonPage, PageAction } from '../../../core/src/daemonPages'
import type { DaemonSnapshot } from '../../../core/src/daemonGraph'
import type { ActivityEvent } from '../../../core/src/daemonActivity'

const APPROVE: PageAction = {
    id: 'approve',
    label: 'Submit',
    kind: 'primary',
    prompt: 'Send the drafted replies.',
}
const DISMISS: PageAction = { id: 'dismiss', label: 'Dismiss', kind: 'default' }

const NOW = Date.now()
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/**
 * One page per `PageStatus` — pending/working/done/failed/dismissed — so a story can render
 * the daemon inbox's full state matrix. Pass `overrides` to replace the whole list (e.g. a
 * single page for a detail story) rather than patch individual fields onto the default set.
 */
export function sampleDaemonPages(overrides?: DaemonPage[]): DaemonPage[] {
    if (overrides) return overrides
    return [
        {
            path: '.daemon/pages/reply-drafts.md',
            slug: 'reply-drafts',
            title: '3 reply drafts ready',
            createdAt: iso(-2 * HOUR),
            source: 'cron:answer-emails',
            actions: [APPROVE, DISMISS],
            body: 'Drafted replies to 3 unread emails from the last hour. Review before sending.',
            status: 'pending',
        },
        {
            path: '.daemon/pages/vault-review.md',
            slug: 'vault-review',
            title: 'Weekly vault review',
            createdAt: iso(-30 * MIN),
            source: 'cron:vault-review',
            actions: [
                {
                    id: 'run',
                    label: 'Run now',
                    kind: 'primary',
                    prompt: "Summarize this week's notes.",
                },
            ],
            body: 'Summarizing new + edited notes from the last 7 days.',
            status: 'working',
            pressedAction: 'run',
            pressedAt: iso(-5 * MIN),
        },
        {
            path: '.daemon/pages/dream-consolidation.md',
            slug: 'dream-consolidation',
            title: 'Memory consolidation complete',
            createdAt: iso(-1 * DAY),
            source: 'cron:dream',
            actions: [DISMISS],
            body: 'Consolidated 14 memory notes into 3 themes.',
            status: 'done',
            pressedAction: 'dismiss',
            pressedAt: iso(-23 * HOUR),
            daemonNote:
                'Merged "housing" + "internship" threads into one project note.',
            completedAt: iso(-23 * HOUR),
        },
        {
            path: '.daemon/pages/gcal-sync.md',
            slug: 'gcal-sync',
            title: 'Calendar sync failed',
            createdAt: iso(-6 * HOUR),
            source: 'cron:gcal-sync',
            actions: [
                {
                    id: 'retry',
                    label: 'Retry',
                    kind: 'danger',
                    prompt: 'Retry the Google Calendar sync.',
                },
            ],
            body: 'Google Calendar sync failed: token expired.',
            status: 'failed',
            pressedAction: 'retry',
            pressedAt: iso(-5 * HOUR),
            daemonNote: 'Marked failed — no response from the daemon.',
            completedAt: iso(-5 * HOUR),
        },
        {
            path: '.daemon/pages/social-digest.md',
            slug: 'social-digest',
            title: 'Weekly social digest',
            createdAt: iso(-3 * DAY),
            source: 'cron:social-digest',
            actions: [DISMISS],
            body: 'No notable mentions this week.',
            status: 'dismissed',
            pressedAction: 'dismiss',
            pressedAt: iso(-3 * DAY + MIN),
            completedAt: iso(-3 * DAY + MIN),
        },
    ]
}

/**
 * Sample daemon-page data: the daemon hub + 3 crons + 2 processes, mirroring
 * `daemonSnapshot()` (core/src/daemonGraph.ts). Covers a running cron, a recently-failed
 * one whose frontmatter name differs from its file, and a disabled file-change cron; an
 * enabled process and a disabled one. Pass
 * `overrides` to replace individual top-level fields (daemon/crons/processes) rather than
 * the whole snapshot.
 */
export function sampleDaemonSnapshot(
    overrides?: Partial<DaemonSnapshot>,
): DaemonSnapshot {
    const base: DaemonSnapshot = {
        daemon: { label: 'daemon', running: true, home: '/vault/.daemon' },
        identity: {
            name: 'daemon',
            blurb: 'curious, terse, keeps careful notes',
        },
        crons: [
            {
                name: 'morning-brief',
                file: 'morning-brief',
                schedule: '0 7 * * *',
                on: 'schedule',
                watch: null,
                enabled: true,
                lastFired: {
                    timestamp: iso(-5 * HOUR),
                    result: 'success',
                },
                running: true,
                startedAt: iso(-2 * MIN),
            },
            {
                // Frontmatter renames this cron: its definition is crons/emails.md.
                name: 'answer-emails',
                file: 'emails',
                schedule: '*/15 * * * *',
                on: 'schedule',
                watch: null,
                enabled: true,
                lastFired: {
                    timestamp: iso(-10 * MIN),
                    result: 'failed',
                    detail: 'timeout calling gmail api',
                },
                running: false,
                startedAt: null,
            },
            {
                name: 'vault-review',
                file: 'vault-review',
                schedule: '',
                on: 'file-change',
                watch: 'notes/**/*.md',
                enabled: false,
                lastFired: {
                    timestamp: iso(-2 * DAY),
                    result: 'success',
                },
                running: false,
                startedAt: null,
            },
        ],
        // `running` is always false: daemonSnapshot() has no trustworthy per-process liveness, so
        // the services panel shows an enabled process by `enabled`, never by `running`.
        processes: [
            {
                name: 'web-search',
                file: 'web-search',
                enabled: true,
                running: false,
            },
            {
                name: 'backup-watcher',
                file: 'backup-watcher',
                enabled: false,
                running: false,
            },
        ],
    }
    return { ...base, ...overrides }
}

/**
 * Sample daemon activity, newest first — mirrors `readActivity()` (core/src/daemonActivity.ts).
 * 12 events spanning every kind (cron/process/daemon/session) and outcome
 * (success/failed/skipped/killed), with `durationMs` on the cron events. Process events carry
 * exactly what daemon/src/daemon/process.ts `processActivityEvent` writes: `started` has a
 * `pid` detail and NO outcome; `exited` has an outcome from its code/signal. Pass `overrides` to replace
 * the whole list (e.g. a single event for a detail story).
 */
export function sampleActivity(overrides?: ActivityEvent[]): ActivityEvent[] {
    if (overrides) return overrides
    return [
        {
            ts: iso(-2 * MIN),
            kind: 'cron',
            name: 'answer-emails',
            event: 'finished',
            outcome: 'failed',
            durationMs: 4200,
            detail: 'timeout calling gmail api',
        },
        {
            ts: iso(-5 * MIN),
            kind: 'session',
            name: 'daemon',
            event: 'message',
            outcome: 'success',
        },
        {
            ts: iso(-12 * MIN),
            kind: 'cron',
            name: 'morning-brief',
            event: 'started',
        },
        {
            ts: iso(-20 * MIN),
            kind: 'process',
            name: 'web-search',
            event: 'started',
            detail: 'pid 48213',
        },
        {
            ts: iso(-45 * MIN),
            kind: 'cron',
            name: 'vault-review',
            event: 'finished',
            outcome: 'skipped',
            durationMs: 0,
            detail: 'skipped: no changes since ' + iso(-2 * DAY),
        },
        {
            ts: iso(-1 * HOUR),
            kind: 'daemon',
            name: 'daemon',
            event: 'brain-started',
        },
        {
            ts: iso(-90 * MIN),
            kind: 'process',
            name: 'backup-watcher',
            event: 'exited',
            outcome: 'killed',
            detail: 'signal SIGTERM',
        },
        {
            ts: iso(-2 * HOUR),
            kind: 'cron',
            name: 'answer-emails',
            event: 'finished',
            outcome: 'success',
            durationMs: 3100,
        },
        {
            ts: iso(-3 * HOUR),
            kind: 'session',
            name: 'daemon',
            event: 'message',
            outcome: 'success',
        },
        {
            ts: iso(-5 * HOUR),
            kind: 'cron',
            name: 'morning-brief',
            event: 'finished',
            outcome: 'success',
            durationMs: 8700,
        },
        {
            ts: iso(-8 * HOUR),
            kind: 'process',
            name: 'web-search',
            event: 'restarting',
        },
        {
            ts: iso(-1 * DAY),
            kind: 'daemon',
            name: 'daemon',
            event: 'brain-started',
        },
    ]
}

