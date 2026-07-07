// In-process registry of the app's OPEN WINDOWS and a request/reply command channel to each of
// them. This is the core→frontend control channel that powers the `app` CLI group (bismuth app …)
// and, through it, MCP app-control — the ONE surface that can drive a running window's tabs from
// outside the webview (list/open/close/focus tabs, run a safe command). SSE hard-drops any
// non-version frame and `bismuth-open` is a same-realm DOM event, so neither can carry a command;
// this is a dedicated per-window WebSocket, modeled on relay.ts's Map idiom + chat.ts's
// pending-reply idiom.
//
// Pure over injectable `send` functions (the WebSocket is wired in server.ts's `case "ui"`), so the
// whole registry + reply round-trip is unit-testable like relay.test.ts. Lives in core (not a
// daemon) for the same reason relay does: the only clients are windows of THIS running app.

import { randomUUID } from "node:crypto";

/** A leaf (pane) inside a tab, as the client reports it. `content` is a note path or a `::` sentinel. */
export interface UiLeafSummary {
  leafId: string;
  content: string;
  label: string;
  icon?: string;
  active: boolean;
}

/** One open tab (a pane tree) in a window. */
export interface UiTabSummary {
  tabId: string;
  label: string;
  active: boolean;
  leaves: UiLeafSummary[];
}

/** A window's reported tab layout — pushed by the client heartbeat (piggybacked on App's existing
 *  tab-persistence effect) and returned verbatim by the `list-tabs` command. */
export interface UiTabsSnapshot {
  tabs: UiTabSummary[];
  activeTabId: string | null;
}

/** What `GET /ui/windows` returns — one row per connected window. */
export interface UiWindowInfo {
  id: string;
  label: string;
  activeTabId: string | null;
  tabCount: number;
}

/** The outcome of a command dispatched to a window. NEVER rejects — a timeout / vanished window
 *  resolves `{ok:false, error}` so the caller (and the daemon) treats "no response" as data, not a
 *  thrown exception to retry-loop on. */
export interface UiReply {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** The command frame pushed down the socket to a window; it answers with a matching `reply`. */
export interface UiCommandFrame {
  type: "command";
  reqId: string;
  action: string;
  args?: unknown;
}

type Send = (frame: unknown) => void;

interface WindowEntry {
  id: string;
  send: Send;
  snapshot: UiTabsSnapshot | null;
  lastSeen: number;
}

/** Default per-command timeout — long enough for a webview to build a tab snapshot and answer,
 *  short enough that a wedged window can't hang an MCP/daemon caller. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 8000;

const windows = new Map<string, WindowEntry>();
const pending = new Map<string, { resolve: (r: UiReply) => void; timer: ReturnType<typeof setTimeout> }>();

/** Register (or replace) a window's control socket, keyed by its stable window id (`?w=`). A
 *  reconnect reuses the same id and swaps in the new socket; the previous snapshot is preserved so
 *  `list-windows` doesn't briefly empty out on a reload. */
export function registerWindow(id: string, send: Send, now = Date.now()): void {
  windows.set(id, { id, send, snapshot: windows.get(id)?.snapshot ?? null, lastSeen: now });
}

/** Drop a window's socket. Identity-guarded: a stale close of an OLD socket (after a reconnect
 *  already re-registered a new one under the same id) is ignored, so the live window survives. */
export function unregisterWindow(id: string, send?: Send): void {
  const w = windows.get(id);
  if (!w) return;
  if (send && w.send !== send) return;
  windows.delete(id);
}

/** Store a window's latest tab layout (the client heartbeat). */
export function updateTabs(id: string, snapshot: UiTabsSnapshot, now = Date.now()): void {
  const w = windows.get(id);
  if (!w) return;
  w.snapshot = snapshot;
  w.lastSeen = now;
}

function labelFor(w: WindowEntry): string {
  const active = w.snapshot?.tabs.find((t) => t.active) ?? w.snapshot?.tabs[0];
  return active && active.label ? `${w.id} — ${active.label}` : w.id;
}

/** Every connected window (id, a distinct label, active tab, tab count). */
export function listWindows(): UiWindowInfo[] {
  const out: UiWindowInfo[] = [];
  for (const w of windows.values()) {
    out.push({
      id: w.id,
      label: labelFor(w),
      activeTabId: w.snapshot?.activeTabId ?? null,
      tabCount: w.snapshot?.tabs.length ?? 0,
    });
  }
  return out;
}

export type TargetResolution =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string };

/** Resolve which window a command targets. An explicit id must be a CONNECTED window; with no id,
 *  the single open window is used, but zero (404) or many (409) is an error — the daemon must treat
 *  "no Bismuth window is open" as an expected outcome, not a condition to retry. */
export function resolveTarget(windowId?: string): TargetResolution {
  if (windowId) {
    if (windows.has(windowId)) return { ok: true, id: windowId };
    return { ok: false, status: 404, error: `no Bismuth window "${windowId}" is connected` };
  }
  const ids = [...windows.keys()];
  if (ids.length === 0) return { ok: false, status: 404, error: "no Bismuth window is open" };
  if (ids.length === 1) return { ok: true, id: ids[0] };
  return { ok: false, status: 409, error: `multiple Bismuth windows open — pass --window <id> (open: ${ids.join(", ")})` };
}

/** Send a command to a resolved window and await its reply. Resolves `{ok:false}` on timeout, a
 *  send failure, or a vanished window; never rejects. */
export function sendCommand(id: string, action: string, args?: unknown, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS): Promise<UiReply> {
  const w = windows.get(id);
  if (!w) return Promise.resolve({ ok: false, error: `no Bismuth window "${id}" is connected` });
  const reqId = randomUUID();
  return new Promise<UiReply>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      resolve({ ok: false, error: `window "${id}" did not respond within ${timeoutMs}ms` });
    }, timeoutMs);
    pending.set(reqId, { resolve, timer });
    try {
      w.send({ type: "command", reqId, action, args } satisfies UiCommandFrame);
    } catch (e) {
      clearTimeout(timer);
      pending.delete(reqId);
      resolve({ ok: false, error: `failed to reach window "${id}": ${(e as Error).message}` });
    }
  });
}

/** Settle a pending command with the client's reply. An unknown reqId (already timed out, or a
 *  stale duplicate) is ignored. */
export function resolveReply(reqId: string, reply: UiReply): void {
  const p = pending.get(reqId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(reqId);
  p.resolve(reply);
}

export function windowCount(): number {
  return windows.size;
}

/** Clear all registry + pending state (tests). */
export function resetUiControl(): void {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  windows.clear();
}
