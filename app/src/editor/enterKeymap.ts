// app/src/editor/enterKeymap.ts
// Enter handling for the note editor. Two bindings, in order:
//   1. insertNewlineContinueMarkup — continues list/blockquote markup, but ONLY when the
//      caret is actually inside a list/blockquote (it returns false otherwise).
//   2. insertNewline — a PLAIN line break with no auto-indentation.
//
// The second binding deliberately replaces CodeMirror's default `insertNewlineAndIndent`
// for the fall-through case. The markdown language's indentation service returns a
// non-zero indent for some non-list contexts (notably right after a ``` code fence and
// certain paragraph continuations), which leaked a stray leading space onto the new line
// and could push a closing ``` fence onto its own line, breaking the block. A plain
// newline keeps the previous line untouched and never indents a line that isn't in a
// list. This keymap must precede `defaultKeymap` so its Enter wins.
import { keymap } from "@codemirror/view";
import { insertNewline } from "@codemirror/commands";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { Prec, type Extension } from "@codemirror/state";

export const enterKeymap: Extension = Prec.high(
  keymap.of([{ key: "Enter", run: insertNewlineContinueMarkup }, { key: "Enter", run: insertNewline }]),
);
