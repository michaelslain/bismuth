import { describe, expect, test } from "bun:test";
import { EditorState, EditorSelection } from "@codemirror/state";
import { toggleBold, toggleItalic } from "./markdownFormat";

// Returns [docAfter, selectionStart, selectionEnd] after running the command.
function run(cmd: any, doc: string, from: number, to = from): [string, number, number] {
  const state = EditorState.create({ doc, selection: EditorSelection.range(from, to) });
  let next = state;
  cmd({ state, dispatch: (tr: any) => (next = state.update(tr).state) });
  const sel = next.selection.main;
  return [next.doc.toString(), sel.from, sel.to];
}

describe("toggleBold / toggleItalic", () => {
  test("wraps a selection in ** for bold", () => {
    const [doc, from, to] = run(toggleBold, "hello world", 0, 5);
    expect(doc).toBe("**hello** world");
    expect([from, to]).toEqual([2, 7]); // selection stays on "hello"
  });

  test("wraps a selection in * for italic", () => {
    const [doc] = run(toggleItalic, "hello world", 6, 11);
    expect(doc).toBe("hello *world*");
  });

  test("empty selection inserts markers with caret between them", () => {
    const [doc, from, to] = run(toggleBold, "ab", 1);
    expect(doc).toBe("a****b");
    expect([from, to]).toEqual([3, 3]); // caret sits between the ** pairs
  });

  test("unwraps when the selection already includes the markers", () => {
    const [doc, from, to] = run(toggleBold, "**hi**", 0, 6);
    expect(doc).toBe("hi");
    expect([from, to]).toEqual([0, 2]);
  });

  test("unwraps when the markers sit just outside the selection", () => {
    const [doc, from, to] = run(toggleBold, "**hi**", 2, 4); // "hi" selected, ** around it
    expect(doc).toBe("hi");
    expect([from, to]).toEqual([0, 2]);
  });

  test("italic toggle off when * markers surround the selection", () => {
    const [doc] = run(toggleItalic, "*word*", 1, 5);
    expect(doc).toBe("word");
  });
});
