// Tracks the last-focused CodeMirror view so the template picker can insert into
// the note the user came from — even after opening the palette stole DOM focus.
// Deliberately NOT cleared on blur; only on the view's destroy.
import type { EditorView } from "@codemirror/view";

let focusedView: EditorView | null = null;

export function registerEditor(view: EditorView): void {
  focusedView = view;
}

export function unregisterEditor(view: EditorView): void {
  if (focusedView === view) focusedView = null;
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
