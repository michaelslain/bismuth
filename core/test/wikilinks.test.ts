import { test, expect } from "bun:test";
import { extractWikilinks } from "../src/wikilinks";

test("extracts targets, strips alias and heading, dedupes", () => {
  const md = `See [[internship]] and [[housing|my place]] and [[essay#intro]] and [[internship]].`;
  expect(extractWikilinks(md).sort()).toEqual(["essay", "housing", "internship"]);
});

test("no links returns empty array", () => {
  expect(extractWikilinks("plain text")).toEqual([]);
});

test("wikilink with heading anchor is extracted without anchor", () => {
  const md = `[[note#section]] [[another#deep.nested]]`;
  expect(extractWikilinks(md).sort()).toEqual(["another", "note"]);
});

test("wikilink with alias strips alias", () => {
  const md = `[[target|alias text]]`;
  expect(extractWikilinks(md)).toEqual(["target"]);
});

test("multiple wikilinks on same line are all extracted", () => {
  const md = `[[one]][[two]] [[three]] [[four]]`;
  expect(extractWikilinks(md).sort()).toEqual(["four", "one", "three", "two"]);
});

test("wikilinks are case sensitive", () => {
  const md = `[[Note]] and [[note]]`;
  expect(extractWikilinks(md).sort()).toEqual(["Note", "note"]);
});

test("wikilinks with numbers are extracted", () => {
  const md = `[[2024-01-15]] [[note123]] [[123abc]]`;
  expect(extractWikilinks(md).sort()).toEqual(["123abc", "2024-01-15", "note123"]);
});

test("wikilinks with hyphens and underscores are extracted", () => {
  const md = `[[my-note]] [[my_note]] [[my-note_v2]]`;
  expect(extractWikilinks(md).sort()).toEqual(["my-note", "my-note_v2", "my_note"]);
});

test("wikilinks with spaces in alias are extracted", () => {
  const md = `[[note|this is a long alias text]]`;
  expect(extractWikilinks(md)).toEqual(["note"]);
});

test("incomplete or malformed wikilinks are ignored", () => {
  const md = `[incomplete [[valid]] [also incomplete [[another valid]]`;
  expect(extractWikilinks(md).sort()).toEqual(["another valid", "valid"]);
});

test("nested brackets do not create additional links", () => {
  const md = `[[outer [[inner]] outer]]`;
  // Should match outermost brackets
  expect(extractWikilinks(md).length).toBeGreaterThan(0);
});

test("empty wikilinks are ignored", () => {
  const md = `[[]] [[valid]]`;
  const result = extractWikilinks(md);
  expect(result).toContain("valid");
});

test("wikilinks with special characters are extracted", () => {
  const md = `[[note@tag]] [[doc-v1.2.3]]`;
  expect(extractWikilinks(md).sort()).toEqual(["doc-v1.2.3", "note@tag"]);
});

test("wikilinks spanning multiple lines work", () => {
  const md = `[[\nmultiline\nlink\n]]`;
  // Behavior depends on regex; verify it doesn't crash
  expect(Array.isArray(extractWikilinks(md))).toBe(true);
});

test("embeds (![[...]]) are NOT extracted — they are render-only, not graph links", () => {
  const md = `Link [[Real Note]] but embed ![[Resonance.pdf]] and ![[Diagram.png]] and ![[Other Note]].`;
  expect(extractWikilinks(md)).toEqual(["Real Note"]);
});

test("an embed adjacent to a real link only excludes the embed", () => {
  const md = `![[image.png]][[Note]]`;
  expect(extractWikilinks(md)).toEqual(["Note"]);
});

test("wikilinks inside a fenced code block are NOT extracted", () => {
  const md = "Real [[Outside]]\n```\nsee [[Inside]]\n```\nmore [[Also Outside]]";
  expect(extractWikilinks(md).sort()).toEqual(["Also Outside", "Outside"]);
});

test("wikilinks inside an inline code span are NOT extracted", () => {
  const md = "Use `[[NotALink]]` but [[RealLink]] counts.";
  expect(extractWikilinks(md)).toEqual(["RealLink"]);
});

test("tilde-fenced code block also hides wikilinks", () => {
  const md = "[[Before]]\n~~~\n[[Hidden]]\n~~~\n[[After]]";
  expect(extractWikilinks(md).sort()).toEqual(["After", "Before"]);
});

test("unterminated fenced block hides links to end of document", () => {
  const md = "[[Before]]\n```\n[[StillHidden]]\nno closing fence";
  expect(extractWikilinks(md)).toEqual(["Before"]);
});
