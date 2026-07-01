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
