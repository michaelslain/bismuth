// app/src/editor/applyCompletion.ts
// Shared completion-apply logic for every editor completion source. Replace [from,to)
// with `insert`, put the caret `cursorOffset` chars past `from`, and tag the change as a
// picked completion so CM's bookkeeping (closing the popup, etc.) stays correct. When
// `trigger` is set, re-open the popup so a follow-up value list appears immediately. One
// place, not copy-pasted across taskComplete/queryComplete/autocomplete.
import { pickedCompletion, startCompletion, type Completion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

/** Apply a completion directly: dispatch the change + caret move, then optionally re-open. */
export function applyCompletion(
  view: EditorView,
  completion: Completion,
  from: number,
  to: number,
  insert: string,
  cursorOffset: number,
  trigger = false,
) {
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + cursorOffset },
    annotations: pickedCompletion.of(completion),
  });
  if (trigger) startCompletion(view);
}

/** Factory: a `Completion.apply` handler that runs `applyCompletion` with fixed args. */
export function makeApply(insert: string, cursorOffset: number, trigger = false) {
  return (view: EditorView, completion: Completion, from: number, to: number) =>
    applyCompletion(view, completion, from, to, insert, cursorOffset, trigger);
}
