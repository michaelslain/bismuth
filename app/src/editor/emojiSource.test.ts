// app/src/editor/emojiSource.test.ts
//
// Pins the #67 contract of the `:emoji` completion source: the BEST-MATCHING EMOJI is the FIRST
// (default-selected) option, and there is NO "Open emoji gallery" row in the popup at all — so
// typing `:rocket`↵ inserts 🚀 and nothing can float above it. The full emoji library lives behind
// the command palette + the quick-action rail beside the right-click menu now (see
// emojiQuickAction.test.ts), not inside this list.
//
// The user-facing failure this guards: "if i type :rocket the first result should be rocket not
// emoji gallery." The BOTH-CONTEXTS requirement is satisfied by one test because the note editor
// and the in-cell table editor consume this EXACT source through `vaultCompletion()` (see
// cellEditorExtensions.ts → markdownEditingExtensions). We exercise the note-editor case
// (`x :rocket`, mid-line) and the table-cell case (`:rocket`, at the very start of the cell's doc).
//
// These run the REAL CompletionSource against a real EditorState + CompletionContext — not a
// re-implementation — so a regression in matchEmojiPrefix, searchEmoji ranking, or the option
// assembly in autocomplete.ts all fail here.
import { describe, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { emojiSource } from "./autocomplete";

const GALLERY = "Open emoji gallery";
const ROCKET = "🚀  :rocket:";

/** Run the emoji source with the caret at the end of `doc`. The source is synchronous, so the
 *  cast is safe. */
function run(doc: string): CompletionResult | null {
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, doc.length, false);
  return emojiSource()(ctx) as CompletionResult | null;
}

const labels = (r: CompletionResult | null): string[] => (r ? r.options.map((o) => String(o.label)) : []);

describe("emojiSource — matching emoji first, no gallery entry (#67)", () => {
  test("note editor: `:rocket` → 🚀 is the FIRST option and no gallery row exists", () => {
    const ls = labels(run("hello :rocket"));
    expect(ls[0]).toBe(ROCKET);
    expect(ls).not.toContain(GALLERY);
  });

  test("table cell (doc-start): `:rocket` → 🚀 first, no gallery row", () => {
    // A table cell feeds the nested editor the cell source as its whole doc, so the trigger sits at
    // offset 0. matchEmojiPrefix allows `:` at line start, so this must behave identically.
    const ls = labels(run(":rocket"));
    expect(ls[0]).toBe(ROCKET);
    expect(ls).not.toContain(GALLERY);
  });

  test("partial `:roc` → 🚀 still first, no gallery row", () => {
    for (const doc of ["x :roc", ":roc"]) {
      const ls = labels(run(doc));
      expect(ls[0]).toBe(ROCKET);
      expect(ls).not.toContain(GALLERY);
    }
  });

  test("across the whole `:rocket` keystroke sequence, the buried gallery row never appears", () => {
    for (const q of [":r", ":ro", ":roc", ":rock", ":rocke", ":rocket", ":rocket:"]) {
      const ls = labels(run(`x ${q}`));
      expect(ls.length).toBeGreaterThan(0);
      // The popup is pure emoji at EVERY keystroke — no "Open emoji gallery" row to outrank a match.
      expect(ls).not.toContain(GALLERY);
    }
  });

  test("every query that targets `rocket` puts 🚀 first (the exact-match `:rock` correctly wins its own glyph)", () => {
    for (const q of [":roc", ":rocke", ":rocket", ":rocket:"]) {
      expect(labels(run(`x ${q}`))[0]).toBe(ROCKET);
    }
    // `:rock` is a different word: its EXACT shortcode match (🪨) legitimately leads. This documents
    // that "matching emoji first" means the BEST match, which for `:rock` is rock, not rocket.
    expect(labels(run("x :rock"))[0]).toBe("🪨  :rock:");
  });

  test("closing colon `:rocket:` → same top hit; the whole `:query:` token is the replace range", () => {
    const doc = "x :rocket:";
    const r = run(doc);
    expect(labels(r)[0]).toBe(ROCKET);
    expect(r!.from).toBe(2); // the leading `:`
    expect((r as { to?: number }).to).toBe(doc.length); // spans the closing `:`
  });

  test("lone `:` → popular emoji, still no gallery row, still emoji-first", () => {
    const ls = labels(run("x :"));
    expect(ls.length).toBeGreaterThan(10);
    expect(ls).not.toContain(GALLERY);
    expect(ls[0]).not.toBe(GALLERY);
  });

  test("no-match query → no popup at all (null), not a lone gallery row", () => {
    expect(run("x :zzzzzzzzzzzz")).toBeNull();
  });

  test("filter is false so CodeMirror never re-sorts our ranking", () => {
    expect(run("x :rocket")!.filter).toBe(false);
  });

  test("suppressed inside an open inline code span", () => {
    expect(run("`code :roc")).toBeNull();
  });

  test("no trigger without whitespace/line-start before `:` (12:30, key:value)", () => {
    expect(run("12:30")).toBeNull();
    expect(run("key:value")).toBeNull();
  });
});
