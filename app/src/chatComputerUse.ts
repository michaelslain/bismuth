// app/src/chatComputerUse.ts
// Per-chat --chrome (browser/computer-use) state, keyed by the chat TAB id (the ::chat:<uuid>
// content id's suffix — the durable identity that survives a close/reopen), PERSISTED in
// localStorage. Mirrors chatColors.ts / chatSessionStore.ts.
//
// BUG #87: --chrome was a single GLOBAL setting (settings.chat.computerUse), yet the control is
// presented as "for this chat" — so flipping it in one chat flipped it everywhere. The state is now
// PER-CHAT, and `settings.chat.computerUse` is what it always documented itself to be: the DEFAULT
// for a chat that hasn't made its own choice.
//
// Bounce-3 note — why the seed is read here again: the previous fix removed this fallback (hardcoding
// the default to `false`) to stop a bare `/chrome` from reporting "disabled" on a vault whose global
// was true. That aimed at the wrong layer and cost the setting its meaning: ChatView stamps this
// value onto every open/user/resume message, and the server only falls back to appConfig when the
// client sends nothing — so a hardcoded `false` here silently OVERRODE an explicit
// `chat.computerUse: true` and spawned every session WITHOUT --chrome. The "disabled" report was
// never about the seed; it came from `/chrome` being a blind toggle, and is fixed at that layer
// (computeChromeCommand: `/chrome` ENABLES, idempotently). With an enable verb, seeding from the
// user's own setting is safe in every direction: the chat opens in the state they asked for, and
// `/chrome` still reads "enabled".
import { createSignal } from "solid-js";
import { settings } from "./settings";

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
 *  the pill updates the instant the state changes. A chat that has made its OWN choice (via the pill
 *  or `/chrome`) keeps it; otherwise it falls back to the vault's documented default,
 *  `settings.chat.computerUse` — which ChatView stamps onto the session's spawn, so setting it true
 *  really does open chats with the browser on. */
export function chatComputerUse(chatId: string): boolean {
  return lookupChrome(chrome(), chatId) ?? settings.chat.computerUse;
}

/** Set a chat tab's --chrome state. Persists + updates the live signal. */
export function setChatComputerUse(chatId: string, enabled: boolean): void {
  if (!chatId) return;
  const next = upsertChrome(chrome(), chatId, enabled);
  setChrome(next);
  persist(next);
}
