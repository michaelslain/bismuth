// app/src/editor/enterKeymap.test.ts
// The bismuth-owned Enter fallback (`continueOrderedList`) continues a numbered list whose
// parse tree doesn't nest it as an OrderedList, so the vanilla `insertNewlineContinueMarkup`
// declined (returned false) — e.g. a `1.`/`2.` block that Lezer folded into a bare paragraph
// with no list ancestor (indented under plain prose, or a run that doesn't start at 1). The
// fallback keys off the LINE'S OWN indent, so continuation works regardless of parse nesting.
// These mirror how Editor.tsx wires markdown notes (4-space indent unit, IndentedCode removed)
// and confirm the fallback fires ONLY after the vanilla command bows out — never double-inserting.
import { describe, expect, test } from "bun:test";
import { EditorState, EditorSelection } from "@codemirror/state";
import { markdown, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { insertNewline } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { continueOrderedList, continueMarkupOutsideMath } from "./enterKeymap";

const exts = [markdown({ extensions: [{ remove: ["IndentedCode"] }] }), indentUnit.of("    ")];

// Run a single command directly; returns [docAfter, caretPos, handled].
function run(doc: string, cursor: number, cmd: any): [string, number, boolean] {
  const state = EditorState.create({ doc, extensions: exts, selection: EditorSelection.cursor(cursor) });
  let tr: any = null;
  const handled: boolean = cmd({ state, dispatch: (t: any) => (tr = t) }) ?? false;
  if (!tr) return [doc, cursor, handled];
  const next = state.update(tr).state;
  return [next.doc.toString(), next.selection.main.head, handled];
}

// Mimic the enterKeymap ordering: try each command in turn, stop at the first that handles.
// Returns [docAfter, caretPos, indexOfHandler] (-1 if none handled).
function chain(doc: string, cursor: number): [string, number, number] {
  const cmds = [insertNewlineContinueMarkup, continueOrderedList, insertNewline];
  const state = EditorState.create({ doc, extensions: exts, selection: EditorSelection.cursor(cursor) });
  for (let i = 0; i < cmds.length; i++) {
    let tr: any = null;
    if (cmds[i]({ state, dispatch: (t: any) => (tr = t) } as any)) {
      const next = state.update(tr).state;
      return [next.doc.toString(), next.selection.main.head, i];
    }
  }
  return [doc, cursor, -1];
}

const endOf = (doc: string, s: string) => doc.indexOf(s) + s.length;

describe("continueOrderedList (numbered-list Enter fallback)", () => {
  // (a) The `1.`/`2.` sublist shape from the bug report: keyed off its own 4-space indent,
  // the fallback opens `    3. ` for it directly (whether or not the vanilla command also
  // could — the whole point is that it works regardless of parse nesting).
  test("Enter on `2. two` under a `- [ ] task` opens `    3. `", () => {
    const doc = ["- [ ] task", "    1. one", "    2. two"].join("\n");
    const [out, caret, handled] = run(doc, endOf(doc, "    2. two"), continueOrderedList);
    expect(handled).toBe(true);
    expect(out).toBe(["- [ ] task", "    1. one", "    2. two", "    3. "].join("\n"));
    expect(caret).toBe(out.length); // caret sits right after the new `    3. ` marker
  });

  // The fallback is what actually RESCUES a numbered block that parsed as bare paragraph text
  // (no list ancestor) — here indented under plain prose, where the vanilla command declines.
  // In the keymap chain that means the fallback (index 1), not vanilla (index 0), fires.
  test("rescues a numbered block with no list ancestor (fallback fires in the chain)", () => {
    const doc = ["intro", "    1. one", "    2. two"].join("\n");
    const [out, , which] = chain(doc, endOf(doc, "    2. two"));
    expect(which).toBe(1); // vanilla declined; the bismuth fallback handled it
    expect(out).toBe(["intro", "    1. one", "    2. two", "    3. "].join("\n"));
  });

  // (b) A top-level ordered list still increments — handled by the VANILLA command, and the
  // fallback must not double-fire (the chain stops at index 0, exactly one `3. ` appears).
  test("top-level `1. a` / `2. b` increments via vanilla; fallback does not double-fire", () => {
    const doc = ["1. a", "2. b"].join("\n");
    const [out, , which] = chain(doc, endOf(doc, "2. b"));
    expect(which).toBe(0); // the vanilla command handled it — fallback never ran
    expect(out).toBe(["1. a", "2. b", "3. "].join("\n"));
    expect(out.match(/^3\. /gm)?.length).toBe(1); // exactly one new marker, no duplication
  });

  // (c) Enter on an EMPTY nested item ends the list: the marker (and its indent) is cleared.
  test("Enter on an empty nested `    2. ` clears/outdents the marker", () => {
    const doc = ["- [ ] task", "    1. one", "    2. "].join("\n");
    const [out, caret, handled] = run(doc, endOf(doc, "    2. "), continueOrderedList);
    expect(handled).toBe(true);
    expect(out).toBe(["- [ ] task", "    1. one", ""].join("\n"));
    expect(out).not.toContain("3. "); // it ended the list, it did NOT open a `3. `
    expect(caret).toBe(out.lastIndexOf("\n") + 1); // caret at the start of the now-empty line
  });

  // (d) Inserting in the MIDDLE renumbers the following same-indent siblings.
  test("inserting mid-list bumps the following siblings", () => {
    const doc = ["- [ ] task", "    1. one", "    2. two", "    3. three"].join("\n");
    const [out] = run(doc, endOf(doc, "    1. one"), continueOrderedList);
    expect(out).toBe(["- [ ] task", "    1. one", "    2. ", "    3. two", "    4. three"].join("\n"));
  });

  // Renumbering stops at the first line that isn't a same-indent ordered item.
  test("renumber stops at a non-same-indent line", () => {
    const doc = ["    1. one", "    2. two", "- outside", "    5. later"].join("\n");
    const [out] = run(doc, endOf(doc, "    1. one"), continueOrderedList);
    expect(out).toBe(["    1. one", "    2. ", "    3. two", "- outside", "    5. later"].join("\n"));
  });

  // The fallback declines on non-ordered lines, so it never double-inserts with the plain
  // newline command that follows it in the keymap.
  test("returns false on a non-ordered line (bullet)", () => {
    const [, , handled] = run("- a bullet", "- a bullet".length, continueOrderedList);
    expect(handled).toBe(false);
  });

  test("returns false on a plain paragraph", () => {
    const [, , handled] = run("just prose", 4, continueOrderedList);
    expect(handled).toBe(false);
  });

  // A numbered-looking line inside a ``` fenced code block is NOT a list — the fallback must decline
  // (the vanilla command declines in code too, so otherwise a stray `2. ` lands in the user's code).
  test("returns false on a numbered line inside a ``` code fence", () => {
    const doc = ["```", "1. not a list", "```"].join("\n");
    const [, , handled] = run(doc, endOf(doc, "1. not a list"), continueOrderedList);
    expect(handled).toBe(false);
  });

  // Nor inside a `$$` math block (isInMathBlock guard), so `1. x + y` in display math is left alone.
  test("returns false on a numbered line inside a $$ math block", () => {
    const doc = ["$$", "1. x + y", "$$"].join("\n");
    const [, , handled] = run(doc, endOf(doc, "1. x + y"), continueOrderedList);
    expect(handled).toBe(false);
  });

  // Caret before the number (inside the indent) → decline, don't hijack.
  test("returns false when the caret is before the marker", () => {
    const [, , handled] = run("    2. two", 2, continueOrderedList); // caret inside the indent
    expect(handled).toBe(false);
  });

  // A non-empty selection is never hijacked.
  test("returns false for a non-empty selection", () => {
    const state = EditorState.create({ doc: "    2. two", extensions: exts, selection: EditorSelection.range(6, 9) });
    expect(continueOrderedList({ state, dispatch: () => {} } as any)).toBe(false);
  });

  // A `)` delimiter is continued the same way as `.`.
  test("continues a `)`-delimited numbered sublist", () => {
    const doc = ["intro", "    1) one"].join("\n");
    const [out] = run(doc, endOf(doc, "    1) one"), continueOrderedList);
    expect(out).toBe(["intro", "    1) one", "    2) "].join("\n"));
  });

  // Splitting mid-content carries the trailing text down onto the new marker.
  test("mid-content Enter carries the tail onto the new item", () => {
    const doc = ["intro", "    1. onetwo"].join("\n");
    const [out] = run(doc, endOf(doc, "    1. one"), continueOrderedList); // caret between "one" and "two"
    expect(out).toBe(["intro", "    1. one", "    2. two"].join("\n"));
  });
});

// A `$$` display-math block written directly under a list item parses as lazy paragraph
// continuation INSIDE the ListItem, so vanilla `insertNewlineContinueMarkup` reads the closing
// `$$` line as an empty list line and DELETES it. `continueMarkupOutsideMath` declines inside a
// `$$` block so Enter falls through to a plain newline and the fences survive.
describe("Enter inside a $$ math block (closing $$ must survive)", () => {
  // The real keymap ordering, but with the guarded continue-markup command (as wired in enterKeymap).
  function chainGuarded(doc: string, cursor: number): string {
    const cmds = [continueMarkupOutsideMath, continueOrderedList, insertNewline];
    const state = EditorState.create({ doc, extensions: exts, selection: EditorSelection.cursor(cursor) });
    for (const cmd of cmds) {
      let tr: any = null;
      if (cmd({ state, dispatch: (t: any) => (tr = t) } as any)) return state.update(tr).state.doc.toString();
    }
    return doc;
  }
  const block = ["- item", "$$", "E = mc^2", "$$"].join("\n");

  test("contrast: the UNGUARDED vanilla command deletes the closing $$ (the bug)", () => {
    const [outVanilla] = chain(block, block.length); // caret at end of closing $$
    expect((outVanilla.match(/\$\$/g) ?? []).length).toBe(1); // one fence was deleted
  });

  test("guarded: Enter after a $$ block under a list preserves BOTH fences", () => {
    const out = chainGuarded(block, block.length);
    expect((out.match(/\$\$/g) ?? []).length).toBe(2); // both fences intact
    expect(out).toBe(["- item", "$$", "E = mc^2", "$$", ""].join("\n"));
  });

  test("guarded: Enter on the inner math line just inserts a newline (no list markup)", () => {
    const out = chainGuarded(block, block.indexOf("E = mc^2") + "E = mc^2".length);
    expect((out.match(/\$\$/g) ?? []).length).toBe(2);
    expect(out).toBe(["- item", "$$", "E = mc^2", "", "$$"].join("\n"));
  });
});
