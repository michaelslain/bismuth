// app/src/chatTitles.ts
// Per-chat conversation titles, published by ChatView from the backend's `title` frames (the
// session's summary via getSessionInfo) and read by the tab-label provider App.tsx installs in
// tabIds. Same tiny reactive-singleton pattern as chatContext.ts, but signal-backed so tab labels
// update live. Keyed by the TAB's chat id (props.chatId — the ::chat: suffix), which names the
// tab regardless of the view-internal id swaps a "New chat" performs.
import { createSignal } from "solid-js";

const [titles, setTitles] = createSignal<Map<string, string>>(new Map());

/** The conversation title for a chat tab id, or undefined before one exists. Reactive. */
export function chatTitle(chatId: string): string | undefined {
  return titles().get(chatId);
}

/** Publish (or, with an empty title, clear) a chat tab's conversation title. */
export function publishChatTitle(chatId: string, title: string): void {
  setTitles((m) => {
    const next = new Map(m);
    const t = title.trim();
    if (t) next.set(chatId, t);
    else next.delete(chatId);
    return next;
  });
}
