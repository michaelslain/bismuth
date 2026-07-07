// app/src/editor/wikilink.test.ts
import { test, expect } from "bun:test";
import {
  matchWikilinkPrefix,
  matchWikilinkHeadingPrefix,
  parseHeadings,
  findHeadingLineIndex,
  buildInsert,
  parseWikilink,
  resolveNotePath,
  wikilinkVisibleRange,
  wikilinkOpenPath,
} from "./wikilink";

// `start` is the document offset of the opening "[[". With start=0, "[[" occupies 0-1,
// the inner text starts at offset 2, and "]]" follows the inner.
test("wikilinkVisibleRange: bare name reveals the whole name", () => {
  expect(wikilinkVisibleRange("My Note", 0)).toEqual({ from: 2, to: 9 });
});

test("wikilinkVisibleRange: a path reveals only the basename", () => {
  // "[[reading/quotes/My Note]]" — basename "My Note" begins after the last "/"
  expect(wikilinkVisibleRange("reading/quotes/My Note", 0)).toEqual({ from: 17, to: 24 });
});

test("wikilinkVisibleRange: an alias reveals the alias text", () => {
  // "[[My Note|Alias]]" — "Alias" sits between the "|" and the closing "]]"
  expect(wikilinkVisibleRange("My Note|Alias", 0)).toEqual({ from: 10, to: 15 });
});

test("wikilinkVisibleRange: a heading is excluded from the revealed name", () => {
  expect(wikilinkVisibleRange("My Note#Section", 0)).toEqual({ from: 2, to: 9 });
});

test("wikilinkVisibleRange: honors a non-zero start offset", () => {
  expect(wikilinkVisibleRange("My Note", 100)).toEqual({ from: 102, to: 109 });
});

test("parseWikilink: bare name is its own target and display", () => {
  expect(parseWikilink("My Note")).toEqual({ target: "My Note", display: "My Note" });
});

test("parseWikilink: a path target displays only the basename", () => {
  expect(parseWikilink("reading/quotes/My Note")).toEqual({
    target: "reading/quotes/My Note",
    display: "My Note",
  });
});

test("parseWikilink: an alias becomes the display text", () => {
  expect(parseWikilink("My Note|Alias")).toEqual({
    target: "My Note",
    alias: "Alias",
    display: "Alias",
  });
});

test("parseWikilink: a heading is stripped from the target", () => {
  expect(parseWikilink("My Note#Section")).toEqual({
    target: "My Note",
    heading: "Section",
    display: "My Note",
  });
});

test("parseWikilink: combined path + heading + alias", () => {
  expect(parseWikilink("reading/My Note#Section|Alias")).toEqual({
    target: "reading/My Note",
    heading: "Section",
    alias: "Alias",
    display: "Alias",
  });
});

test("parseWikilink: trims surrounding whitespace from the target", () => {
  expect(parseWikilink("  My Note  ")).toEqual({ target: "My Note", display: "My Note" });
});

const NOTES = [
  { label: "My Note", path: "reading/quotes/My Note" },
  { label: "Index", path: "Index" },
];

test("resolveNotePath: a basename resolves to its subfolder path", () => {
  expect(resolveNotePath("My Note", NOTES)).toBe("reading/quotes/My Note");
});

test("resolveNotePath: a root note resolves to itself", () => {
  expect(resolveNotePath("Index", NOTES)).toBe("Index");
});

test("resolveNotePath: a full path target resolves to itself", () => {
  expect(resolveNotePath("reading/quotes/My Note", NOTES)).toBe("reading/quotes/My Note");
});

test("resolveNotePath: an unknown target returns null (new note)", () => {
  expect(resolveNotePath("Nonexistent", NOTES)).toBeNull();
});

// --- wikilinkOpenPath (#38: a table-cell/note-body wikilink CHIP to an image opened a
// blank note tab instead of previewing the image — see the doc comment on the function). ---

test("wikilinkOpenPath: a resolved note gets its id .md-suffixed", () => {
  expect(wikilinkOpenPath("My Note", "reading/quotes/My Note")).toBe("reading/quotes/My Note.md");
});

test("wikilinkOpenPath: an unresolved image target opens as-is (no .md appended)", () => {
  // The exact #38 repro: a bare `[[Screenshot ….png]]` wikilink chip (not an `![[…]]` embed)
  // inside a table cell, clicked when the file isn't in the notes list (it's an attachment).
  expect(wikilinkOpenPath("attachments/Screenshot 2026-07-07 at 12.51.05 AM.png", null)).toBe(
    "attachments/Screenshot 2026-07-07 at 12.51.05 AM.png",
  );
});

test("wikilinkOpenPath: an unresolved pdf/code/external target also opens as-is", () => {
  expect(wikilinkOpenPath("Contract.pdf", null)).toBe("Contract.pdf");
  expect(wikilinkOpenPath("script.ts", null)).toBe("script.ts");
  expect(wikilinkOpenPath("Deck.pptx", null)).toBe("Deck.pptx");
});

test("wikilinkOpenPath: an unresolved bare name still falls back to creating a new note", () => {
  expect(wikilinkOpenPath("Nonexistent", null)).toBe("Nonexistent.md");
});

test("wikilinkOpenPath: an unresolved target that already ends with .md is never doubled", () => {
  expect(wikilinkOpenPath("Some Note.md", null)).toBe("Some Note.md");
});

test("matches an empty open wikilink", () => {
  expect(matchWikilinkPrefix("[[")).toEqual({ from: 2, query: "" });
});

test("matches a partial query mid-line", () => {
  expect(matchWikilinkPrefix("see [[par")).toEqual({ from: 6, query: "par" });
});

test("matches a query containing spaces", () => {
  expect(matchWikilinkPrefix("[[My Note")).toEqual({ from: 2, query: "My Note" });
});

test("matches the rightmost open wikilink when an earlier one is closed", () => {
  expect(matchWikilinkPrefix("[[a]] [[b")).toEqual({ from: 8, query: "b" });
});

test("returns null for a closed wikilink", () => {
  expect(matchWikilinkPrefix("[[Done]]")).toBeNull();
});

test("returns null when no wikilink is open", () => {
  expect(matchWikilinkPrefix("just text")).toBeNull();
});

test("buildInsert appends closing brackets when none ahead", () => {
  expect(buildInsert("Foo", false)).toEqual({ insert: "Foo]]", cursorOffset: 5 });
});

test("buildInsert skips closing brackets when already ahead", () => {
  expect(buildInsert("Foo", true)).toEqual({ insert: "Foo", cursorOffset: 5 });
});

// --- heading-anchor wikilinks: `[[File#Heading]]` ---------------------------------------

test("matchWikilinkHeadingPrefix: null with no open wikilink", () => {
  expect(matchWikilinkHeadingPrefix("just text")).toBeNull();
});

test("matchWikilinkHeadingPrefix: null while the target has no # yet", () => {
  // Plain note-name completion territory — heading source must stay quiet.
  expect(matchWikilinkHeadingPrefix("[[My Note")).toBeNull();
});

test("matchWikilinkHeadingPrefix: splits target and heading at the #", () => {
  // "see [[My Note#Sec" — the `#` is at query index 7, so the heading query starts at
  // doc offset 4(=`[[` start "[[" begins at index 4) → from = 6(query start) + 7 + 1 = 14.
  expect(matchWikilinkHeadingPrefix("see [[My Note#Sec")).toEqual({
    target: "My Note",
    heading: "Sec",
    from: 14,
  });
});

test("matchWikilinkHeadingPrefix: empty heading right after the #", () => {
  expect(matchWikilinkHeadingPrefix("[[Note#")).toEqual({ target: "Note", heading: "", from: 7 });
});

test("matchWikilinkHeadingPrefix: a heading with spaces is kept verbatim (untrimmed query)", () => {
  expect(matchWikilinkHeadingPrefix("[[Note#My Sec")).toEqual({
    target: "Note",
    heading: "My Sec",
    from: 7,
  });
});

test("matchWikilinkHeadingPrefix: ignores a closed wikilink", () => {
  expect(matchWikilinkHeadingPrefix("[[a#b]] ")).toBeNull();
});

test("parseHeadings: extracts ATX headings with level + text", () => {
  const md = "# Title\n\nintro\n\n## Section One\ntext\n### Deep\n";
  expect(parseHeadings(md)).toEqual([
    { level: 1, text: "Title" },
    { level: 2, text: "Section One" },
    { level: 3, text: "Deep" },
  ]);
});

test("parseHeadings: strips trailing closing #s", () => {
  expect(parseHeadings("## Closed ##")).toEqual([{ level: 2, text: "Closed" }]);
});

test("parseHeadings: skips # lines inside fenced code", () => {
  const md = "# Real\n```\n# not a heading\n```\n## Also Real";
  expect(parseHeadings(md)).toEqual([
    { level: 1, text: "Real" },
    { level: 2, text: "Also Real" },
  ]);
});

test("parseHeadings: requires a space after the #s (not a #tag)", () => {
  expect(parseHeadings("#tag is not a heading\n# Heading")).toEqual([{ level: 1, text: "Heading" }]);
});

test("parseHeadings: skips a leading YAML frontmatter block (its # lines aren't headings)", () => {
  const md = "---\ntitle: x\n# a yaml comment\n---\n# Real Heading\n";
  expect(parseHeadings(md)).toEqual([{ level: 1, text: "Real Heading" }]);
});

test("parseHeadings: an UNTERMINATED frontmatter is treated as body (no crash, scans all)", () => {
  // No closing `---`: bodyStartLine falls back to 0, so the `# H` line is still found.
  expect(parseHeadings("---\nkey: v\n# H")).toEqual([{ level: 1, text: "H" }]);
});

test("findHeadingLineIndex: returns the ABSOLUTE line index past frontmatter", () => {
  const lines = ["---", "title: x", "---", "intro", "## Target"];
  expect(findHeadingLineIndex(lines, "Target")).toBe(4);
});

test("findHeadingLineIndex: does not match a # comment inside frontmatter", () => {
  const lines = ["---", "# Target", "---", "body"];
  expect(findHeadingLineIndex(lines, "Target")).toBe(-1);
});

test("findHeadingLineIndex: matches case- and whitespace-insensitively", () => {
  const lines = ["# Top", "", "## My  Section", "body"];
  expect(findHeadingLineIndex(lines, "my section")).toBe(2);
});

test("findHeadingLineIndex: returns the first match line", () => {
  const lines = ["## Dup", "x", "## Dup"];
  expect(findHeadingLineIndex(lines, "Dup")).toBe(0);
});

test("findHeadingLineIndex: -1 when no heading matches", () => {
  expect(findHeadingLineIndex(["# A", "# B"], "C")).toBe(-1);
});

test("findHeadingLineIndex: ignores a matching # line inside a fence", () => {
  const lines = ["```", "## Fenced", "```", "## Fenced"];
  expect(findHeadingLineIndex(lines, "Fenced")).toBe(3);
});
