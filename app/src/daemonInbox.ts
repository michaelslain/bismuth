// app/src/daemonInbox.ts
// Reactive client-side store for the daemon inbox (core/src/daemonPages.ts): fetches
// GET /daemon/pages into a Solid signal and exposes the derived views the UI needs. App.tsx owns
// the poll cadence — mirroring the existing agents/daemon-graph mode-gated polls — and calls
// refreshDaemonPages() on a timer (30s, tightened to ~5s while anyWorking()) plus once on
// lastChange() and cold launch. All the actual sorting/grouping logic is pure and lives in
// daemonInboxLogic.ts so it's unit-testable without Solid.
import { createSignal, createMemo } from "solid-js";
import { api } from "./api";
import type { DaemonPage } from "../../core/src/daemonPages";
import { isDue, dueSorted } from "./daemonInboxLogic";
import { pushToast } from "./Toast";

const [pages, setPages] = createSignal<DaemonPage[]>([]);

/** Every known daemon-inbox page (any status), in the order the server returned them. */
export const inboxPages = pages;

/** "Needs review": due pages, oldest-created first. */
export const duePages = createMemo<DaemonPage[]>(() => dueSorted(pages(), Date.now()));

/** Count of due pages — drives the InboxBell badge. */
export const dueCount = createMemo<number>(() => duePages().length);

/** True while any page is mid-run — App.tsx tightens its poll interval on this. */
export const anyWorking = createMemo<boolean>(() => pages().some((p) => p.status === "working"));

// Previous refresh's due-id set, so we only toast pages that just BECAME due (not ones that
// were already sitting there due on the last poll).
let lastDueIds = new Set<string>();

/**
 * Re-fetch GET /daemon/pages and toast any page that newly became due since the previous
 * refresh (diffed by path). Best-effort: a failed fetch leaves the previous snapshot in place
 * rather than clearing the inbox. `onReview`, when given, becomes the toast's action (open the
 * inbox tab) — batched to one toast per refresh even when several pages became due at once.
 */
export async function refreshDaemonPages(onReview?: () => void): Promise<void> {
  let next: DaemonPage[];
  try {
    next = await api.daemonPages();
  } catch {
    return;
  }
  setPages(next);

  const now = Date.now();
  const nowDue = next.filter((p) => isDue(p, now));
  const nowDueIds = new Set(nowDue.map((p) => p.path));
  const newlyDue = nowDue.filter((p) => !lastDueIds.has(p.path));
  lastDueIds = nowDueIds;
  if (newlyDue.length === 0) return;

  const message =
    newlyDue.length === 1
      ? `${newlyDue[0].title || "A page"} ready for review`
      : `${newlyDue.length} pages ready for review`;
  pushToast(message, onReview ? { label: "Review", onClick: onReview } : undefined);
}
