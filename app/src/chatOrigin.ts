// app/src/chatOrigin.ts
// Per-chat DAEMON-vs-USER origin, published by ChatView from the backend's `session` ChatFrame, and
// read by the tab-icon provider App.tsx installs in tabIds. Same tiny reactive-singleton pattern as
// chatTitles.ts, keyed by the TAB's chat id (props.chatId), so the tab bar + pane header icon stay
// live as a tab's bound session changes (a fresh chat, a resume from History, a reconnect).
//
// The origin itself is decided SERVER-SIDE and only carried here: core/src/chat.ts resolveChatOrigin
// tests the session id for membership in the vault's durable daemon set. This module never re-judges
// it — one signal, one place.
import { createSignal } from "solid-js";
import type { ChatOrigin } from "./api";
export type { ChatOrigin };

const [origins, setOrigins] = createSignal<Map<string, ChatOrigin>>(new Map());

/** The known origin for a chat tab id, or undefined before any session has bound to it (a brand-new,
 *  never-sent chat — reads as user-started, see {@link chatOriginIcon}). Reactive. */
export function chatOrigin(chatId: string): ChatOrigin | undefined {
  return origins().get(chatId);
}

/** Publish (or clear, with a null origin) a chat tab's resolved origin. */
export function publishChatOrigin(chatId: string, origin: ChatOrigin | null): void {
  setOrigins((m) => {
    const next = new Map(m);
    if (origin) next.set(chatId, origin);
    else next.delete(chatId);
    return next;
  });
}

/**
 * The Lucide icon name for a chat, by origin — the ONE place the daemon-vs-user glyph is decided,
 * shared by every surface that lists or names a chat: the tab bar + pane header (via tabIds' chat-
 * icon provider), the chat's own header crumb, and the History picker's list + content-search rows
 * (each ChatSessionInfo/ChatSearchHit carries its own `origin`).
 *
 * An undefined origin reads as user-started: `Bot` is reserved for a CONFIRMED daemon session. That
 * covers a brand-new tab not yet bound to any session, and it is the same safe direction the
 * backend's tolerant reads take — an unknown provenance is never asserted to be the daemon's.
 */
export function chatOriginIcon(origin: ChatOrigin | undefined): string {
  return origin === "daemon" ? "Bot" : "MessageSquare";
}
