// app/src/editor/enterKeymap.ts
// Enter handling for the note editor. Three bindings, in order:
//   1. insertNewlineContinueMarkup — continues list/blockquote markup, but ONLY when the
//      caret is actually inside a list/blockquote (it returns false otherwise).
//   2. continueOrderedList — a bismuth-owned fallback that continues a NUMBERED list whose
//      parse tree doesn't nest it as an OrderedList, so the vanilla command declined.
//   3. insertNewline — a PLAIN line break with no auto-indentation.
//
// The third binding deliberately replaces CodeMirror's default `insertNewlineAndIndent`
// for the fall-through case. The markdown language's indentation service returns a
// non-zero indent for some non-list contexts (notably right after a ``` code fence and
// certain paragraph continuations), which leaked a stray leading space onto the new line
// and could push a closing ``` fence onto its own line, breaking the block. A plain
// newline keeps the previous line untouched and never indents a line that isn't in a
// list. This keymap must precede `defaultKeymap` so its Enter wins.
import { keymap, type Command } from "@codemirror/view";
import { insertNewline } from "@codemirror/commands";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, Prec, type ChangeSpec, type Extension } from "@codemirror/state";
import { isInMathBlock } from "./mathBlock";

// An ordered-list line: indent, number, delimiter (`.` or `)`), gap, content.
const ORDERED_ITEM = /^(\s*)(\d+)([.)])([ \t]+)(.*)$/;
// A following line that is itself an ordered item (indent, number) for renumbering siblings.
const ORDERED_PREFIX = /^(\s*)(\d+)[.)][ \t]/;

// Fallback Enter handler for numbered lists whose parse tree DOESN'T nest them as an
// OrderedList — most reproducibly a `1.`/`2.` sublist indented under a wider parent marker
// (e.g. a `- [ ] task` checkbox at content column 6 with the editor's 4-space Tab), where
// Lezer treats the number lines as lazy paragraph text so `insertNewlineContinueMarkup`
// finds no ordered context and declines, emitting a numberless newline. Keying off the
// line's OWN captured indent makes continuation work regardless of parse nesting. This runs
// only after the vanilla command returned false (see the keymap ordering below), so top-level
// ordered lists — which parse correctly and are handled by the vanilla command — never reach it.
export const continueOrderedList: Command = ({ state, dispatch }) => {
  // Single caret only — never hijack a selection or a multi-cursor edit.
  if (state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  if (!range.empty) return false;
  const pos = range.from;
  // A numbered-looking line inside a fenced code block or a `$$` math block is NOT list markup: e.g.
  // `1. not a list` inside ``` fences, or `1. x + y` inside display math. The vanilla command
  // declines in those contexts precisely because they aren't lists, so this fallback must too —
  // otherwise it injects a stray `2. ` into the user's code/math. isInMathBlock covers `$$`; the
  // syntax tree covers ``` fenced/inline code.
  if (isInMathBlock(state, pos)) return false;
  for (let node = syntaxTree(state).resolveInner(pos, -1); ; ) {
    if (/Code/.test(node.name)) return false; // FencedCode / CodeBlock / CodeText / InlineCode
    const parent = node.parent;
    if (!parent) break;
    node = parent;
  }
  const line = state.doc.lineAt(pos);
  const m = ORDERED_ITEM.exec(line.text);
  if (!m) return false; // not an ordered-list line → let the plain insertNewline handle it
  const [, indent, numStr, delim, , content] = m;
  // The caret must sit at/after the marker (`1.`), never before or inside the number.
  const markerEnd = line.from + indent.length + numStr.length + delim.length;
  if (pos < markerEnd) return false;

  // Empty item → end the list: clear the marker (and its indent) in place, matching the
  // vanilla command's behavior for a trailing empty ordered item (outdent, no `n+1.`).
  if (!content.trim()) {
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert: "" },
        selection: EditorSelection.cursor(line.from),
        scrollIntoView: true,
        userEvent: "input",
      }),
    );
    return true;
  }

  // Non-empty item → split at the caret and open the next marker keyed off this line's own
  // indent (not the parse tree). Text after the caret rides down onto the new line.
  const num = parseInt(numStr, 10);
  const insert = state.lineBreak + indent + (num + 1) + delim + " ";
  const changes: ChangeSpec[] = [{ from: pos, insert }];

  // Renumber following siblings at the SAME indent so the sequence stays contiguous,
  // stopping at the first line that isn't a same-indent ordered item (blank / lesser or
  // greater indent / non-ordered all end the run).
  let expected = num + 2;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    const mm = ORDERED_PREFIX.exec(l.text);
    if (!mm || mm[1] !== indent) break;
    const from = l.from + mm[1].length;
    changes.push({ from, to: from + mm[2].length, insert: String(expected) });
    expected++;
  }

  dispatch(
    state.update({
      changes,
      selection: EditorSelection.cursor(pos + insert.length),
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};

// `insertNewlineContinueMarkup` mis-reads the closing `$$` of a display-math block that sits
// directly under a list item: CommonMark parses the block as lazy paragraph continuation INSIDE
// the ListItem, so the closing `$$` line looks like an empty list line and the command's
// delete-a-markup-level branch removes the `$$`. Decline inside any `$$` block so Enter falls
// through to a plain newline (there is never list markup to continue inside math anyway).
export const continueMarkupOutsideMath: Command = (view) => {
  if (isInMathBlock(view.state, view.state.selection.main.head)) return false;
  return insertNewlineContinueMarkup(view);
};

export const enterKeymap: Extension = Prec.high(
  keymap.of([
    { key: "Enter", run: continueMarkupOutsideMath },
    { key: "Enter", run: continueOrderedList },
    { key: "Enter", run: insertNewline },
  ]),
);
