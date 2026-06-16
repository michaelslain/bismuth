// app/src/editor/wrapSelection.test.ts
import { test, expect, describe } from "bun:test";
import { EditorState, EditorSelection } from "@codemirror/state";
import { wrapSelectionTransaction, closerFor } from "./wrapSelection";

const CHARS = ["*", "_", "~", "`"];

/** Apply the wrap transaction (if any) and return the resulting doc + main range. */
function wrap(doc: string, sel: EditorSelection, ch: string, chars = CHARS) {
  const state = EditorState.create({ doc, selection: sel });
  const spec = wrapSelectionTransaction(state, ch, chars);
  if (!spec) return null;
  const next = state.update(spec).state;
  return { doc: next.doc.toString(), main: next.selection.main, sel: next.selection };
}

describe("wrapSelectionTransaction", () => {
  test("wraps a selection with * and keeps the selection on the inner text", () => {
    const r = wrap("hello", EditorSelection.single(0, 5), "*")!;
    expect(r.doc).toBe("*hello*");
    expect([r.main.from, r.main.to]).toEqual([1, 6]);
  });

  test("each configured symmetric char wraps with itself", () => {
    expect(wrap("x", EditorSelection.single(0, 1), "_")!.doc).toBe("_x_");
    expect(wrap("x", EditorSelection.single(0, 1), "~")!.doc).toBe("~x~");
    expect(wrap("x", EditorSelection.single(0, 1), "`")!.doc).toBe("`x`");
  });

  test("a second press nests, producing bold-style **text**", () => {
    // First wrap: "word" -> "*word*", selection on inner "word" at [1,5).
    const first = wrap("word", EditorSelection.single(0, 4), "*")!;
    expect(first.doc).toBe("*word*");
    // Second wrap over that same inner selection.
    const state = EditorState.create({ doc: first.doc, selection: first.sel });
    const spec = wrapSelectionTransaction(state, "*", CHARS)!;
    const next = state.update(spec).state;
    expect(next.doc.toString()).toBe("**word**");
    expect([next.selection.main.from, next.selection.main.to]).toEqual([2, 6]);
  });

  test("asymmetric pairs use the matching closer", () => {
    expect(closerFor("<")).toBe(">");
    const r = wrap("note", EditorSelection.single(0, 4), "<", ["<"])!;
    expect(r.doc).toBe("<note>");
    expect([r.main.from, r.main.to]).toEqual([1, 5]);
  });

  test("every configured asymmetric pair wraps with its closer", () => {
    expect(wrap("x", EditorSelection.single(0, 1), "(", ["("])!.doc).toBe("(x)");
    expect(wrap("x", EditorSelection.single(0, 1), "[", ["["])!.doc).toBe("[x]");
    expect(wrap("x", EditorSelection.single(0, 1), "{", ["{"])!.doc).toBe("{x}");
  });

  test("wrapping is literal — text containing the closer is not escaped", () => {
    const r = wrap("a)b", EditorSelection.single(0, 3), "(", ["("])!;
    expect(r.doc).toBe("(a)b)");
    expect([r.main.from, r.main.to]).toEqual([1, 4]);
  });

  test("wraps a mid-document selection without touching the rest", () => {
    // "the cat sat" — select "cat" at [4,7).
    const r = wrap("the cat sat", EditorSelection.single(4, 7), "*")!;
    expect(r.doc).toBe("the *cat* sat");
    expect([r.main.from, r.main.to]).toEqual([5, 8]);
  });

  test("multi-cursor wraps each non-empty range independently", () => {
    // The app doesn't enable multiple selections today, but the transaction is
    // built over every range, so it stays correct if that's ever turned on. The
    // facet is required for EditorState to keep more than the main range.
    const state = EditorState.create({
      doc: "ab cd",
      selection: EditorSelection.create([
        EditorSelection.range(0, 2), // "ab"
        EditorSelection.range(3, 5), // "cd"
      ]),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    const next = state.update(wrapSelectionTransaction(state, "*", CHARS)!).state;
    expect(next.doc.toString()).toBe("*ab* *cd*");
    expect(next.selection.ranges.map((x) => [x.from, x.to])).toEqual([
      [1, 3],
      [6, 8],
    ]);
  });

  test("mixed multi-cursor wraps only the non-empty ranges, leaving carets alone", () => {
    const state = EditorState.create({
      doc: "ab cd",
      selection: EditorSelection.create([
        EditorSelection.cursor(0), // bare caret — must stay literal
        EditorSelection.range(3, 5), // "cd" — wraps
      ]),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    const next = state.update(wrapSelectionTransaction(state, "*", CHARS)!).state;
    expect(next.doc.toString()).toBe("ab *cd*");
    expect(next.selection.ranges.map((x) => [x.from, x.to])).toEqual([
      [0, 0],
      [4, 6],
    ]);
  });

  test("a bare caret does not wrap (types the char normally)", () => {
    expect(wrap("hello", EditorSelection.single(2, 2), "*")).toBeNull();
  });

  test("a char outside the configured set falls through", () => {
    expect(wrap("hello", EditorSelection.single(0, 5), "*", ["_"])).toBeNull();
    // A letter never wraps.
    expect(wrap("hello", EditorSelection.single(0, 5), "a")).toBeNull();
  });

  test("an empty configured set never wraps", () => {
    expect(wrap("hello", EditorSelection.single(0, 5), "*", [])).toBeNull();
  });

  test("multi-character input (e.g. paste/IME) is ignored", () => {
    expect(wrap("hello", EditorSelection.single(0, 5), "**")).toBeNull();
  });
});
