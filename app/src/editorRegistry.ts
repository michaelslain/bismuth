// Tracks the last-focused CodeMirror view so the template picker can insert into
// the note the user came from — even after opening the palette stole DOM focus.
// Deliberately NOT cleared on blur; only on the view's destroy.
// Also tracks the SET of all live views, so a global change with no per-view caller
// (e.g. editing the custom dictionary) can re-lint every open editor.
import type { EditorView } from "@codemirror/view";
import { requestRelint } from "./editor/relint";

let focusedView: EditorView | null = null;
const liveViews = new Set<EditorView>();

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
}

/** Force a lint re-run on every open editor. Used after a change that affects
 *  diagnostics globally but isn't a document edit — e.g. adding/removing a custom
 *  dictionary word — since CM only re-lints on doc changes or an explicit request. */
export function relintAllEditors(): void {
  for (const view of liveViews) requestRelint(view);
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
