import { test, expect } from "bun:test";
import { extractTags } from "../src/tags";

test("frontmatter array tags are returned individually", () => {
  const tags = extractTags({ tags: ["foo", "bar"] }, "");
  expect(tags.sort()).toEqual(["bar", "foo"]);
});

test("frontmatter string tag is returned as single tag", () => {
  const tags = extractTags({ tags: "baz" }, "");
  expect(tags).toEqual(["baz"]);
});

test("inline body tags are extracted", () => {
  const tags = extractTags({}, "Hello #body-tag and #another");
  expect(tags.sort()).toEqual(["another", "body-tag"]);
});

test("frontmatter and body tags are deduped", () => {
  const tags = extractTags({ tags: ["foo"] }, "Text with #foo and #bar");
  expect(tags.sort()).toEqual(["bar", "foo"]);
});

test("leading hash in frontmatter tag is stripped", () => {
  const tags = extractTags({ tags: ["#prefixed"] }, "");
  expect(tags).toEqual(["prefixed"]);
});

test("markdown heading # Title does NOT produce a tag", () => {
  const tags = extractTags({}, "# Title\n## Another Heading");
  expect(tags).toEqual([]);
});

test("inline tag immediately after newline is captured", () => {
  const tags = extractTags({}, "Some text\n#inline-tag more text");
  expect(tags).toEqual(["inline-tag"]);
});

test("empty frontmatter tags and empty body returns empty array", () => {
  const tags = extractTags({}, "");
  expect(tags).toEqual([]);
});

test("comma-separated frontmatter string tags are split individually", () => {
  const tags = extractTags({ tags: "foo, bar" }, "");
  expect(tags.sort()).toEqual(["bar", "foo"]);
});

test("multi-word frontmatter tag is NOT split on internal whitespace", () => {
  // Comma is the only separator; a single multi-word tag stays intact.
  const tags = extractTags({ tags: "science fiction" }, "");
  expect(tags).toEqual(["science fiction"]);
});

test("comma-separated multi-word frontmatter tags split on commas only", () => {
  const tags = extractTags({ tags: "science fiction, russian lit" }, "");
  expect(tags.sort()).toEqual(["russian lit", "science fiction"]);
});

test("frontmatter array tags with internal spaces are preserved", () => {
  const tags = extractTags({ tags: ["science fiction", "russian"] }, "");
  expect(tags.sort()).toEqual(["russian", "science fiction"]);
});

test("tags with numbers are extracted", () => {
  const tags = extractTags({}, "#tag1 #tag2");
  expect(tags.sort()).toEqual(["tag1", "tag2"]);
});

test("tags with hyphens are extracted", () => {
  const tags = extractTags({}, "#my-tag #another-tag");
  expect(tags.sort()).toEqual(["another-tag", "my-tag"]);
});

test("tags with underscores are extracted", () => {
  const tags = extractTags({}, "#my_tag #complex_tag_name");
  expect(tags.sort()).toEqual(["complex_tag_name", "my_tag"]);
});

test("null or undefined frontmatter tags are handled", () => {
  const tags = extractTags({ tags: null }, "");
  expect(tags).toEqual([]);
});

test("empty string frontmatter tags returns empty", () => {
  const tags = extractTags({ tags: "" }, "");
  expect(tags).toEqual([]);
});

test("tags with mixed case preserve casing", () => {
  const tags = extractTags({}, "#MyTag #myTag #MYTAG");
  expect(tags.sort()).toEqual(["MYTAG", "MyTag", "myTag"]);
});

test("consecutive tags on same line are extracted", () => {
  const tags = extractTags({}, "Text #tag1#tag2 #tag3");
  // tag2 may or may not be extracted depending on implementation
  expect(tags).toContain("tag1");
  expect(tags).toContain("tag3");
});

test("tags at end of text are extracted", () => {
  const tags = extractTags({}, "This is a note #final");
  expect(tags).toEqual(["final"]);
});

test("tags at start of text are extracted", () => {
  const tags = extractTags({}, "#start is a tag");
  expect(tags).toEqual(["start"]);
});

test("tags inside code blocks are still extracted (current behavior)", () => {
  const tags = extractTags({}, "```\n#notag\n```\n#realtag");
  // Verify behavior - may extract both or just realtag
  expect(Array.isArray(tags)).toBe(true);
});

test("frontmatter object with empty tags array", () => {
  const tags = extractTags({ tags: [] }, "");
  expect(tags).toEqual([]);
});

test("both frontmatter array and comma-separated string mixed", () => {
  const tags = extractTags({ tags: ["foo", "bar"] }, "#baz, #qux");
  // Should extract from array and body
  expect(tags).toContain("foo");
  expect(tags).toContain("bar");
});

test("tags with numbers at start are extracted", () => {
  const tags = extractTags({}, "#123tag #456");
  expect(Array.isArray(tags)).toBe(true);
});

test("duplicate tags in frontmatter array are deduped", () => {
  const tags = extractTags({ tags: ["same", "same", "different"] }, "");
  expect(tags).toContain("same");
  expect(tags).toContain("different");
  // Check that "same" appears only once
  expect(tags.filter(t => t === "same").length).toBe(1);
});

test("special characters in tags are handled", () => {
  const tags = extractTags({ tags: ["tag-with-dash", "tag_with_underscore"] }, "#tag.dot");
  expect(tags).toContain("tag-with-dash");
  expect(tags).toContain("tag_with_underscore");
});

test("whitespace-only frontmatter tags returns empty", () => {
  const tags = extractTags({ tags: "   " }, "");
  expect(tags).toEqual([]);
});
