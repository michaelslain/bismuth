// app/src/chatComputerUse.ts
// Per-chat --chrome (browser/computer-use) state, keyed by the chat TAB id (the ::chat:<uuid>
// content id's suffix — the durable identity that survives a close/reopen), PERSISTED in
// localStorage. Mirrors chatColors.ts / chatSessionStore.ts.
//
// BUG #87 re-fix: --chrome was a single GLOBAL setting (settings.chat.computerUse), yet the toggle
// is presented as "for this chat". Enabling it in one chat (or a value persisted from a prior
// session) left it true EVERYWHERE, so the user's next chat opened with it already on — and typing
// `/chrome` to "turn it on" instead flipped it OFF and (correctly, but confusingly) reported
// "disabled". Making the state per-chat — DEFAULTING un-toggled chats to OFF (not the possibly-stale
// global) — means each chat's first `/chrome` reliably ENABLES, exactly matching the "for this chat"
// wording, and toggling a chat no longer mutates any global.
import { createSignal } from "solid-js";

const KEY = "bismuth-chat-chrome-v1";
const CAP = 200;

/** One chat TAB id → whether --chrome is enabled for that chat. */
export interface ChatChromeEntry {
  chatId: string;
  enabled: boolean;
}

/** Pure upsert: drop any existing entry for `chatId`, append the new one (most-recent last), cap the
 *  list (oldest dropped). Exported for unit testing. */
export function upsertChrome(
  list: ChatChromeEntry[],
  chatId: string,
  enabled: boolean,
  cap = CAP,
): ChatChromeEntry[] {
  const next = list.filter((e) => e.chatId !== chatId);
  next.push({ chatId, enabled });
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Pure lookup: the remembered state for `chatId`, or undefined when the chat has no override yet
 *  (the caller falls back to the global default). Reads newest-first. Exported for tests. */
export function lookupChrome(list: ChatChromeEntry[], chatId: string): boolean | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].chatId === chatId) return list[i].enabled;
  }
  return undefined;
}

function parse(raw: string | null): ChatChromeEntry[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter(
          (x): x is ChatChromeEntry =>
            !!x && typeof x === "object" && typeof x.chatId === "string" && typeof x.enabled === "boolean",
        )
      : [];
  } catch {
    return [];
  }
}

// A reactive mirror of the persisted store: the signal drives ChatView's live Globe-pill state,
// localStorage makes it survive reload/reopen. Seeded once from storage on module load.
const [chrome, setChrome] = createSignal<ChatChromeEntry[]>(
  parse(typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null),
);

function persist(list: ChatChromeEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage unavailable/full — the in-memory signal still drives the toggle this run
  }
}

/** Whether --chrome is enabled for a chat tab id. REACTIVE — read it inside a ChatView binding so
 *  the pill updates the instant the toggle flips. Defaults to OFF ("for this chat" semantics) for a
 *  chat that hasn't been toggled yet, so the FIRST /chrome in ANY chat reliably ENABLES — regardless
 *  of any stale global `settings.chat.computerUse` left true by earlier testing (BUG #87 re-fix). */
export function chatComputerUse(chatId: string): boolean {
  return lookupChrome(chrome(), chatId) ?? false;
}

/** Set a chat tab's --chrome state. Persists + updates the live signal. */
export function setChatComputerUse(chatId: string, enabled: boolean): void {
  if (!chatId) return;
  const next = upsertChrome(chrome(), chatId, enabled);
  setChrome(next);
  persist(next);
}
