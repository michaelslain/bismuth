// Sample data for the daemon-inbox stories (dev-only, Storybook). NOT a story file itself —
// the `*.stories.*` glob (see `.storybook/main.ts`) skips underscore-prefixed files. Mirrors
// core/src/daemonPages.ts's `DaemonPage` shape (a page merged with its dynamic sidecar state)
// across every `PageStatus`, so a story can render the inbox's full state matrix
// (pending/working/done/failed/dismissed) without a live daemon.
import type { DaemonPage, PageAction } from "../../../core/src/daemonPages";

const APPROVE: PageAction = { id: "approve", label: "Send", kind: "primary", prompt: "Send the drafted replies." };
const DISMISS: PageAction = { id: "dismiss", label: "Dismiss", kind: "default" };

const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * One page per `PageStatus` — pending/working/done/failed/dismissed — so a story can render
 * the daemon inbox's full state matrix. Pass `overrides` to replace the whole list (e.g. a
 * single page for a detail story) rather than patch individual fields onto the default set.
 */
export function sampleDaemonPages(overrides?: DaemonPage[]): DaemonPage[] {
  if (overrides) return overrides;
  return [
    {
      path: ".daemon/pages/reply-drafts.md",
      slug: "reply-drafts",
      title: "3 reply drafts ready",
      createdAt: iso(-2 * HOUR),
      source: "cron:answer-emails",
      actions: [APPROVE, DISMISS],
      body: "Drafted replies to 3 unread emails from the last hour. Review before sending.",
      status: "pending",
    },
    {
      path: ".daemon/pages/vault-review.md",
      slug: "vault-review",
      title: "Weekly vault review",
      createdAt: iso(-30 * MIN),
      source: "cron:vault-review",
      actions: [{ id: "run", label: "Run now", kind: "primary", prompt: "Summarize this week's notes." }],
      body: "Summarizing new + edited notes from the last 7 days.",
      status: "working",
      pressedAction: "run",
      pressedAt: iso(-5 * MIN),
    },
    {
      path: ".daemon/pages/dream-consolidation.md",
      slug: "dream-consolidation",
      title: "Memory consolidation complete",
      createdAt: iso(-1 * DAY),
      source: "cron:dream",
      actions: [DISMISS],
      body: "Consolidated 14 memory notes into 3 themes.",
      status: "done",
      pressedAction: "dismiss",
      pressedAt: iso(-23 * HOUR),
      daemonNote: 'Merged "housing" + "internship" threads into one project note.',
      completedAt: iso(-23 * HOUR),
    },
    {
      path: ".daemon/pages/gcal-sync.md",
      slug: "gcal-sync",
      title: "Calendar sync failed",
      createdAt: iso(-6 * HOUR),
      source: "cron:gcal-sync",
      actions: [{ id: "retry", label: "Retry", kind: "danger", prompt: "Retry the Google Calendar sync." }],
      body: "Google Calendar sync failed: token expired.",
      status: "failed",
      pressedAction: "retry",
      pressedAt: iso(-5 * HOUR),
      daemonNote: "Marked failed — no response from the daemon.",
      completedAt: iso(-5 * HOUR),
    },
    {
      path: ".daemon/pages/social-digest.md",
      slug: "social-digest",
      title: "Weekly social digest",
      createdAt: iso(-3 * DAY),
      source: "cron:social-digest",
      actions: [DISMISS],
      body: "No notable mentions this week.",
      status: "dismissed",
      pressedAction: "dismiss",
      pressedAt: iso(-3 * DAY + MIN),
      completedAt: iso(-3 * DAY + MIN),
    },
  ];
}
