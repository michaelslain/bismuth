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
