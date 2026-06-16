// app/src/editor/wrapSelection.ts
// Surround the current selection with a formatting character instead of replacing
// it. With text selected, typing `*`/`_`/`~`/`` ` `` (configurable) yields `*text*`
// etc., leaving the selection on the inner text so a second press nests it (`**text**`).
// A bare caret types the literal char as usual, so normal typing is unaffected.
//
// Brackets and quotes ( [ { ' " $ already wrap a selection via closeBrackets (see
// Editor.tsx), so the default char set here is intentionally disjoint from those to
// avoid two handlers fighting over the same key.
import { EditorView } from "@codemirror/view";
import { EditorSelection, type EditorState, type Extension, type TransactionSpec } from "@codemirror/state";

/** Open → close for the asymmetric pairs; every other char wraps with itself. */
const CLOSERS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "<": ">",
};

/** The closing delimiter for an opening char (itself, unless it's a known pair). */
export function closerFor(open: string): string {
  return CLOSERS[open] ?? open;
}

/**
 * Build a transaction that surrounds each selection range with `open … close`,
 * keeping the selection on the inner text. Returns null — so the caller falls
 * through to normal text insertion — when `open` isn't a single configured wrap
 * char, or when the whole selection is empty (a bare caret types the char).
 */
export function wrapSelectionTransaction(
  state: EditorState,
  open: string,
  chars: readonly string[],
): TransactionSpec | null {
  if (open.length !== 1 || !chars.includes(open)) return null;
  // Only act when there's something to wrap; a lone caret falls through to typing.
  if (!state.selection.ranges.some((r) => !r.empty)) return null;
  const close = closerFor(open);
  return {
    ...state.changeByRange((range) => {
      // In a multi-selection, leave bare carets alone — only real selections wrap.
      // (The top-level guard already ruled out the all-empty case.)
      if (range.empty) return { range };
      return {
        // Two inserts (not one replace) so existing marks/decorations on the inner
        // text survive — the canonical CodeMirror selection-wrapping idiom.
        changes: [
          { from: range.from, insert: open },
          { from: range.to, insert: close },
        ],
        // Only the leading `open` shifts the inner text, so both ends move by its length.
        range: EditorSelection.range(range.from + open.length, range.to + open.length),
      };
    }),
    userEvent: "input.wrap",
    scrollIntoView: true,
  };
}

/**
 * Editor extension: intercept input of a configured wrap character while a
 * selection is active and surround the selection with it. `getChars` is read on
 * each keystroke so the set stays live with `settings.editor.wrapSelectionChars`.
 */
export function wrapSelection(getChars: () => readonly string[]): Extension {
  return EditorView.inputHandler.of((view, _from, _to, text) => {
    const spec = wrapSelectionTransaction(view.state, text, getChars());
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  });
}
