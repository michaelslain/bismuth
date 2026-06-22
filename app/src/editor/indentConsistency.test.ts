// Pins the "one Tab = a consistent 4-space indent everywhere" behavior: plain prose, a
// bullet under a bullet, and a bullet under a (wider) numbered marker all advance by the
// same raw 4 spaces — and the 4-space nesting keeps ordered-list renumbering working.
// These mirror how Editor.tsx wires markdown notes (4-space unit, IndentedCode removed).
import { describe, expect, test } from "bun:test";
import { EditorState, EditorSelection } from "@codemirror/state";
import { markdown, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { indentUnit, syntaxTree } from "@codemirror/language";
import { indentMore } from "@codemirror/commands";

const exts = [markdown({ extensions: [{ remove: ["IndentedCode"] }] }), indentUnit.of("    ")];

function run(doc: string, cursor: number, cmd: any): string {
  const state = EditorState.create({ doc, extensions: exts, selection: EditorSelection.cursor(cursor) });
  let tr: any = null;
  cmd({ state, dispatch: (t: any) => (tr = t) });
  return tr ? state.update(tr).state.doc.toString() : doc;
}
const endOf = (doc: string, s: string) => doc.indexOf(s) + s.length;

describe("indent consistency (4 spaces everywhere)", () => {
  test("Tab on a plain paragraph inserts 4 spaces", () => {
    expect(run("foo", 1, indentMore)).toBe("    foo");
  });

  test("Tab on a bullet under a bullet inserts 4 spaces", () => {
    const doc = ["- A", "- B"].join("\n");
    expect(run(doc, endOf(doc, "- B"), indentMore)).toBe(["- A", "    - B"].join("\n"));
  });

  test("Tab on a bullet under a numbered item inserts 4 spaces (clears the `1. ` marker)", () => {
    const doc = ["1. Alpha", "- sub", "2. Beta"].join("\n");
    expect(run(doc, endOf(doc, "- sub"), indentMore)).toBe(["1. Alpha", "    - sub", "2. Beta"].join("\n"));
  });

  test("after 4-space nesting, Enter renumbers the ordered list", () => {
    const doc = ["1. Alpha", "    - sub", "2. Beta"].join("\n");
    expect(run(doc, endOf(doc, "1. Alpha"), insertNewlineContinueMarkup)).toBe(
      ["1. Alpha", "2. ", "    - sub", "3. Beta"].join("\n"),
    );
  });

  test("a 4-space plain paragraph stays a paragraph, not an indented code block", () => {
    const state = EditorState.create({ doc: "    just text", extensions: exts });
    const names: string[] = [];
    syntaxTree(state).iterate({ enter: (n) => void names.push(n.name) });
    expect(names).toContain("Paragraph");
    expect(names).not.toContain("CodeBlock");
  });
});
