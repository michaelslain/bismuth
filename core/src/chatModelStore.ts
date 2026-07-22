// core/src/chatModelStore.ts
// Durable per-SESSION model choices for the visual chat (Bug #89: "chat not saving model per
// session"). Keyed by the SDK session_id — the on-disk identity of a conversation — NOT the chat
// tab id, so a conversation resumed into ANY tab (history picker, Cmd+Shift+T, app relaunch) comes
// back on the model it was last set to.
//
// Why server-side: the packaged app is a WKWebView whose localStorage is best-effort (and per-tab
// keys can't follow a session across tabs anyway). The CLI's own session store DOES restore a
// resumed session's model (verified live), but only after the first turn's init manifest — this
// store lets the server (a) re-apply the choice on resume as belt-and-braces and (b) report it in
// the spawn-time synthetic manifest, so the header shows the session's own model the instant a
// resumed chat opens, before any turn.
//
// One machine-wide JSON file (session ids are uuids — globally unique), following runRegistry.ts's
// ~/.bismuth convention + atomic temp+rename writes. Best-effort and never authoritative: an
// unreadable/corrupt file degrades to "no saved model" (the CLI's own restore still applies).

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, renameSync, readFileSync } from "node:fs";

/** One remembered choice: the model (a picker value, e.g. "opus[1m]") a session was last set to. */
export interface ChatModelEntry {
  sessionId: string;
  model: string;
  /** ms epoch of the last write — the cap evicts the oldest entries. */
  at: number;
}

/** Keep the file bounded: plenty for any realistic history; oldest entries fall off. */
const CAP = 500;

/** `~/.bismuth/chat` — where the per-session model file lives. Overridable via BISMUTH_CHAT_DIR
 *  (tests). */
export function chatStateDir(): string {
  return process.env.BISMUTH_CHAT_DIR || join(homedir(), ".bismuth", "chat");
}

function modelsFile(): string {
  return join(chatStateDir(), "models.json");
}

/** Pure upsert: drop any existing entry for `sessionId`, append the new one (most-recent last),
 *  cap the list (oldest dropped). Exported for unit testing. */
export function upsertSessionModel(
  list: ChatModelEntry[],
  sessionId: string,
  model: string,
  at: number,
  cap = CAP,
): ChatModelEntry[] {
  const next = list.filter((e) => e.sessionId !== sessionId);
  next.push({ sessionId, model, at });
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Pure lookup: the remembered model for `sessionId`, or null. Newest-first so a duplicate
 *  (shouldn't exist after upsert, but be defensive) resolves to the most recent. */
export function lookupSessionModel(list: ChatModelEntry[], sessionId: string): string | null {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.sessionId === sessionId) return list[i]!.model;
  }
  return null;
}

function readAll(): ChatModelEntry[] {
  try {
    const arr = JSON.parse(readFileSync(modelsFile(), "utf8"));
    return Array.isArray(arr)
      ? arr.filter(
          (x): x is ChatModelEntry =>
            !!x &&
            typeof x === "object" &&
            typeof (x as ChatModelEntry).sessionId === "string" &&
            typeof (x as ChatModelEntry).model === "string" &&
            typeof (x as ChatModelEntry).at === "number",
        )
      : [];
  } catch {
    return []; // missing / unreadable / corrupt — degrade to "no saved models"
  }
}

function writeAll(list: ChatModelEntry[]): void {
  try {
    const dir = chatStateDir();
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.models.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(list));
    renameSync(tmp, modelsFile()); // atomic on POSIX — a concurrent reader never sees a torn file
  } catch {
    /* best-effort — a failed persist just means this choice won't survive a restart */
  }
}

/** Remember the model a session was last set to. No-op on empty args. */
export function saveSessionModel(sessionId: string, model: string, at: number = Date.now()): void {
  if (!sessionId || !model) return;
  writeAll(upsertSessionModel(readAll(), sessionId, model, at));
}

/** The remembered model for a session, or null if none was ever saved for it. */
export function loadSessionModel(sessionId: string): string | null {
  if (!sessionId) return null;
  return lookupSessionModel(readAll(), sessionId);
}
