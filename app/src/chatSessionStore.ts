// app/src/chatSessionStore.ts
// Remembers, per chat TAB (the ::chat:<uuid> content id — the durable tab identity that survives a
// close/reopen round-trip through serializeTabs), the SDK session_id of the Claude Code conversation
// that tab is currently showing.
//
// This is what makes "Reopen closed tab" (Cmd+Shift+T) restore a CHAT tab onto the SAME conversation
// instead of a blank new one: closing a chat tab tears its backend session down (a clean WS close),
// so the reopened tab — revived with the same ::chat:<uuid> id — must RESUME the prior conversation
// by its session_id. The session_id is the durable, on-disk identity of the conversation (the CLI's
// own session store), so this survives a relaunch too, mirroring closedSession.ts.
//
// The client learns each conversation's session_id from the backend's `session` ChatFrame and stores
// it here keyed by the tab id; ChatView reads it on mount to decide resume-vs-fresh.

const KEY = "bismuth-chat-sessions-v1";
const CAP = 50;

/** One chat TAB id → the SDK session_id it currently shows. */
export interface ChatSessionEntry {
  chatId: string;
  sessionId: string;
}

/** Pure upsert: drop any existing entry for `chatId`, append it (most-recent last), cap the list
 *  (oldest dropped). Exported for unit testing. */
export function upsertSession(
  list: ChatSessionEntry[],
  chatId: string,
  sessionId: string,
  cap = CAP,
): ChatSessionEntry[] {
  const next = list.filter((e) => e.chatId !== chatId);
  next.push({ chatId, sessionId });
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Pure lookup: the remembered session_id for `chatId`, or null. Reads newest-first so a duplicate
 *  (shouldn't happen after upsert, but be defensive) resolves to the most recent. Exported for tests. */
export function lookupSession(list: ChatSessionEntry[], chatId: string): string | null {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].chatId === chatId) return list[i].sessionId;
  }
  return null;
}

function read(): ChatSessionEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter(
          (x): x is ChatSessionEntry =>
            !!x && typeof x === "object" && typeof x.chatId === "string" && typeof x.sessionId === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function write(list: ChatSessionEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage unavailable/full — resume-on-reopen just won't be available this run
  }
}

/** Remember the session_id a chat tab is currently on. No-op on empty args. */
export function rememberChatSession(chatId: string, sessionId: string): void {
  if (!chatId || !sessionId) return;
  write(upsertSession(read(), chatId, sessionId));
}

/** The remembered session_id for a chat tab, or null if it was never seen (a brand-new chat). */
export function recallChatSession(chatId: string): string | null {
  return lookupSession(read(), chatId);
}

/** Drop a tab's remembered session (a provider switch orphans the old conversation — resuming a
 *  Claude session id on opencode, or vice versa, could only error). */
export function forgetChatSession(chatId: string): void {
  if (!chatId) return;
  write(read().filter((e) => e.chatId !== chatId));
}
