// Tracks the last-focused CodeMirror view so the template picker can insert into
// the note the user came from — even after opening the palette stole DOM focus.
// Deliberately NOT cleared on blur; only on the view's destroy.
// Also tracks the SET of all live views, so a global change with no per-view caller
// (e.g. editing the custom dictionary) can re-lint every open editor.
import type { EditorView } from "@codemirror/view";
import { requestRelint } from "./editor/relint";
import { notePathFacet } from "./editor/tableState";

let focusedView: EditorView | null = null;
const liveViews = new Set<EditorView>();
// Per-view "flush my pending autosave NOW (and await it)" hooks. A rename (NoteTitle / file
// tree) must persist unsaved edits to the OLD path BEFORE moving, or the editor's path-change
// cleanup stray-writes the buffer to the old path AFTER the move, re-creating it as an orphan (B6).
const flushers = new Map<EditorView, () => Promise<void>>();

/** Track a newly-created view for relintAllEditors. Does NOT change the focused view
 *  — focus tracking (for insertIntoFocusedEditor) stays focus-event-driven below, so a
 *  background-mounted editor can't hijack "the note the user came from". */
export function trackEditor(view: EditorView): void {
  liveViews.add(view);
}

export function registerEditor(view: EditorView): void {
  focusedView = view; // last-focused, for insertIntoFocusedEditor
  liveViews.add(view); // also ensure membership (idempotent)
}

export function unregisterEditor(view: EditorView): void {
  if (focusedView === view) focusedView = null;
  liveViews.delete(view);
  flushers.delete(view);
}

/** Register a view's awaitable autosave-flush (called by the Editor). */
export function setEditorFlush(view: EditorView, fn: () => Promise<void>): void {
  flushers.set(view, fn);
}

/** Flush the last-focused editor's pending save and await it. Used by the rename flows so the
 *  move carries the complete buffer and nothing strays back to the old path afterward (B6).
 *  No-op when the active pane isn't a note (no focused view) or it has nothing pending. */
export async function flushFocusedEditor(): Promise<void> {
  const view = focusedView;
  if (!view) return;
  const f = flushers.get(view);
  if (f) await f();
}

/** Flush a SPECIFIC note's editor by its buffer path, regardless of which pane was last
 *  focused — the daemon-page action bar must persist THIS page's pending edits before the
 *  daemon acts on the file, and in a split layout the last-focused view may be a different
 *  note entirely (flushing the wrong buffer AND skipping this one). No-op when the path has
 *  no live editor (nothing typed / visual mode) — the debounced autosave already covers it. */
export async function flushEditorByPath(path: string): Promise<void> {
  for (const [view, fn] of flushers) {
    if (view.state.facet(notePathFacet) === path) {
      await fn();
      return;
    }
  }
}

/** Force a lint re-run on every open editor. Used after a change that affects
 *  diagnostics globally but isn't a document edit — e.g. adding/removing a custom
 *  dictionary word — since CM only re-lints on doc changes or an explicit request. */
export function relintAllEditors(): void {
  for (const view of liveViews) requestRelint(view);
}

/** The last-focused editor's note path + its current selection text (empty string when the
 *  caret is collapsed). Returns null when no editor is registered (the active pane isn't a note).
 *  Read by the visual chat to inject "what the user is looking at" onto the wire — never into the
 *  visible message. focusedView persists across blur (see top), so the returned `path` lets the
 *  caller attribute a still-live selection to the note it came from. */
export function getFocusedSelection(): { path: string | null; selection: string } | null {
  const view = focusedView;
  if (!view) return null;
  const { from, to } = view.state.selection.main;
  return {
    path: view.state.facet(notePathFacet) ?? null,
    selection: from === to ? "" : view.state.sliceDoc(from, to),
  };
}

/** Insert text at the focused editor's selection; caret lands at cursorOffset.
 *  Returns false if no editor is registered (e.g. the active pane isn't a note). */
export function insertIntoFocusedEditor(text: string, cursorOffset: number): boolean {
  const view = focusedView;
  if (!view) return false;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + cursorOffset },
  });
  view.focus();
  return true;
}
