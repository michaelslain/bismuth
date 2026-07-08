// app/src/chatContext.ts
// A tiny singleton mirroring editorRegistry, but for "which files is the user looking at": the
// set of open editor tabs + the active file. App publishes a fresh snapshot on every tab / pane /
// focus change; the visual chat (ChatView) reads the latest snapshot at send time and injects it
// onto its wire payload (never into the visible message). Plain module state — read-only consumers
// only ever want the freshest value, never reactivity.

export interface EditorTabsSnapshot {
  openFiles: { path: string; label: string }[];
  activeFile: string | null;
}

let tabs: EditorTabsSnapshot = { openFiles: [], activeFile: null };

/** App calls this whenever the open-tabs / active-file set changes. */
export function publishEditorTabs(t: EditorTabsSnapshot): void {
  tabs = t;
}

/** ChatView reads the latest snapshot at send time (a safe empty default before the first publish). */
export function getEditorTabs(): EditorTabsSnapshot {
  return tabs;
}

// ── Per-chat file references (Row 79) ────────────────────────────────────────────────────────
// Files the user EXPLICITLY pulled into a chat — @-mentioned in the composer or dragged onto the
// chat pane. ChatView folds them into the <editor-context> preamble at send time (like the open
// tabs), so a referenced file's content is available to the model (the chat's Claude Read-tools /
// wikilink-resolves the listed path). Keyed by the chat TAB id (props.chatId) so distinct chats
// don't share references; capped so a long-lived chat can't grow unbounded. Plain module state —
// consumers only ever want the freshest set, never reactivity (mirrors the editor-tabs snapshot).
const references = new Map<string, string[]>();
const REF_CAP = 50;

/** Record a file the user referenced in `chatId` (idempotent — a repeat path is ignored; the list
 *  is order-preserving, oldest dropped past the cap). No-op on an empty chatId/path. */
export function addChatReference(chatId: string, path: string): void {
  if (!chatId || !path) return;
  const cur = references.get(chatId) ?? [];
  if (cur.includes(path)) return;
  const next = [...cur, path];
  references.set(chatId, next.length > REF_CAP ? next.slice(next.length - REF_CAP) : next);
}

/** The files referenced in `chatId` so far (a fresh array; empty when none). */
export function getChatReferences(chatId: string): string[] {
  return [...(references.get(chatId) ?? [])];
}

/** Forget a chat's references — called when its turn is sent (they've been folded into that turn's
 *  preamble) and when the chat is reset/replaced, so stale references don't ride future turns. */
export function clearChatReferences(chatId: string): void {
  references.delete(chatId);
}
