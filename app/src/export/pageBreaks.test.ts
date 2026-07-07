// app/src/export/pageBreaks.test.ts
import { test, expect, describe } from "bun:test";
import { splitByPageBreaks, pageSections } from "./pageBreaks";

// The marker only counts when it's alone on its own line (`^[ \t]*<!--...-->[ \t]*$`), so every
// fixture below puts it on its own line — surrounded by "\n" (or string start/end).
const MARK = "<!-- pagebreak -->";

describe("splitByPageBreaks", () => {
  test("no markers -> single-element array, text unchanged", () => {
    expect(splitByPageBreaks("just some\nprose")).toEqual(["just some\nprose"]);
  });

  test("one marker -> two sections", () => {
    expect(splitByPageBreaks(`page one\n${MARK}\npage two`)).toEqual(["page one\n", "\npage two"]);
  });

  test("many markers -> N+1 sections", () => {
    expect(splitByPageBreaks(`a\n${MARK}\nb\n${MARK}\nc`)).toEqual(["a\n", "\nb\n", "\nc"]);
  });

  test("marker at the very start -> empty leading section", () => {
    expect(splitByPageBreaks(`${MARK}\ncontent`)).toEqual(["", "\ncontent"]);
  });

  test("marker at the very end -> empty trailing section", () => {
    expect(splitByPageBreaks(`content\n${MARK}`)).toEqual(["content\n", ""]);
  });

  test("marker line tolerates surrounding whitespace and indentation", () => {
    expect(splitByPageBreaks(`a\n   <!--   pagebreak   -->  \nb`)).toEqual(["a\n", "\nb"]);
  });

  test("a marker-like line INSIDE a fenced code block is NOT a split point", () => {
    const text = `before\n\`\`\`\n${MARK}\n\`\`\`\nafter`;
    expect(splitByPageBreaks(text)).toEqual([text]);
  });

  test("a REAL marker outside code still splits, even when the doc also has code containing the marker text", () => {
    const text = `\`\`\`\n${MARK}\n\`\`\`\nreal\n${MARK}\nsplit`;
    const parts = splitByPageBreaks(text);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(`\`\`\`\n${MARK}\n\`\`\`\nreal\n`); // code content preserved verbatim
    expect(parts[1]).toBe("\nsplit");
  });

  test("a --- horizontal rule is not confused for the marker (different syntax entirely)", () => {
    const text = "above\n\n---\n\nbelow";
    expect(splitByPageBreaks(text)).toEqual([text]);
  });
});

describe("pageSections", () => {
  test("no markers -> single section, whole text (no frontmatter to strip)", () => {
    expect(pageSections("prose with no breaks")).toEqual(["prose with no breaks"]);
  });

  test("frontmatter is stripped BEFORE splitting, so page 1 is real content, not just frontmatter", () => {
    const text = `---\ntitle: Foo\n---\n${MARK}\nReal content on page 2`;
    const sections = pageSections(text);
    // Splitting after stripping frontmatter yields an empty leading section (nothing between
    // the stripped start and the marker), which is then dropped as blank — so there is exactly
    // ONE real section, and it is the actual content, never the frontmatter block.
    expect(sections).toEqual(["\nReal content on page 2"]);
    expect(sections.some((s) => s.includes("title: Foo"))).toBe(false);
  });

  test("frontmatter + two real content pages -> two sections, neither is frontmatter-only", () => {
    const text = `---\ntitle: Foo\n---\nPage one\n${MARK}\nPage two`;
    expect(pageSections(text)).toEqual(["Page one\n", "\nPage two"]);
  });

  test("a leading/trailing marker with nothing but whitespace around it drops the blank page", () => {
    const text = `${MARK}\n\nreal content\n\n${MARK}`;
    expect(pageSections(text)).toEqual(["\n\nreal content\n\n"]);
  });

  test("many real pages -> that many sections", () => {
    const text = `one\n${MARK}\ntwo\n${MARK}\nthree`;
    expect(pageSections(text)).toEqual(["one\n", "\ntwo\n", "\nthree"]);
  });

  test("an all-blank note yields a single empty section, never an empty array", () => {
    expect(pageSections("   \n  \n")).toEqual([""]);
  });

  test("no frontmatter, just markers -> unaffected by the frontmatter-strip step", () => {
    const text = `first\n${MARK}\nsecond`;
    expect(pageSections(text)).toEqual(["first\n", "\nsecond"]);
  });
});
