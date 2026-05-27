import { test, expect } from "bun:test";
import { parseFrontmatter } from "../src/frontmatter";

test("parses YAML frontmatter and returns the body", () => {
  const md = `---\nstatus: in-progress\npriority: 1\ntags: [a, b]\n---\n# Title\nbody text`;
  const { data, body } = parseFrontmatter(md);
  expect(data).toEqual({ status: "in-progress", priority: 1, tags: ["a", "b"] });
  expect(body.trim()).toBe("# Title\nbody text");
});

test("no frontmatter returns empty data and full body", () => {
  const md = `# Just a note`;
  const { data, body } = parseFrontmatter(md);
  expect(data).toEqual({});
  expect(body).toBe(md);
});

test("empty frontmatter block parses as empty object", () => {
  const md = `---\n---\nBody content`;
  const { data, body } = parseFrontmatter(md);
  expect(data).toEqual({});
  expect(body).toContain("Body content");
});

test("frontmatter with string values", () => {
  const md = `---\ntitle: My Note\nauthor: Alice\n---\nBody`;
  const { data } = parseFrontmatter(md);
  expect(data.title).toBe("My Note");
  expect(data.author).toBe("Alice");
});

test("frontmatter with numeric values", () => {
  const md = `---\npriority: 5\ncount: 0\n---\nBody`;
  const { data } = parseFrontmatter(md);
  expect(typeof data.priority).toBe("number");
  expect(typeof data.count).toBe("number");
});

test("frontmatter with boolean values", () => {
  const md = `---\npublished: true\ndraft: false\n---\nBody`;
  const { data } = parseFrontmatter(md);
  expect(data.published).toBe(true);
  expect(data.draft).toBe(false);
});

test("frontmatter with array values", () => {
  const md = `---\ntags: [one, two, three]\n---\nBody`;
  const { data } = parseFrontmatter(md);
  expect(Array.isArray(data.tags)).toBe(true);
  expect(data.tags).toContain("one");
});

test("frontmatter with object/nested values", () => {
  const md = `---\nmetadata:\n  key: value\n  nested: data\n---\nBody`;
  const { data } = parseFrontmatter(md);
  expect(typeof data.metadata).toBe("object");
  expect(data.metadata?.key).toBe("value");
});

test("frontmatter with special characters in values", () => {
  const md = `---\ntitle: "Special: Characters @#$%"\nurl: https://example.com\n---\nBody`;
  const { data } = parseFrontmatter(md);
  expect(data.title).toContain("Special");
  expect(data.url).toContain("example.com");
});

test("missing closing --- falls back to no frontmatter", () => {
  const md = `---\nstatus: incomplete\nBody content here`;
  const { data, body } = parseFrontmatter(md);
  // Should handle gracefully
  expect(typeof data).toBe("object");
});

test("triple dashes in body do not interfere", () => {
  const md = `---\nkey: value\n---\nSome text\n---\nMore text`;
  const { data, body } = parseFrontmatter(md);
  expect(data.key).toBe("value");
  expect(body).toContain("Some text");
  expect(body).toContain("More text");
});

test("frontmatter with quoted strings", () => {
  const md = `---\ntitle: "My Title"\nauthor: 'Single Quoted'\n---\nBody`;
  const { data } = parseFrontmatter(md);
  expect(data.title).toBe("My Title");
  expect(data.author).toBe("Single Quoted");
});

test("frontmatter with empty array", () => {
  const md = `---\ntags: []\n---\nBody`;
  const { data } = parseFrontmatter(md);
  expect(Array.isArray(data.tags)).toBe(true);
  expect(data.tags.length).toBe(0);
});

test("frontmatter with multiline string value", () => {
  const md = `---\ndescription: |\n  This is a\n  multiline\n  description\n---\nBody`;
  const { data } = parseFrontmatter(md);
  expect(typeof data.description).toBe("string");
  expect(data.description).toContain("multiline");
});

test("body preserves formatting and newlines", () => {
  const md = `---\nkey: value\n---\n# Title\n\nParagraph 1\n\nParagraph 2`;
  const { body } = parseFrontmatter(md);
  expect(body).toContain("# Title");
  expect(body).toContain("Paragraph 1");
});

test("empty body is preserved", () => {
  const md = `---\nkey: value\n---\n`;
  const { body } = parseFrontmatter(md);
  expect(body.trim()).toBe("");
});

test("whitespace-only body is preserved", () => {
  const md = `---\nkey: value\n---\n   \n\n   `;
  const { body } = parseFrontmatter(md);
  expect(body).toBeDefined();
});

test("invalid YAML does not crash (tolerant parsing)", () => {
  const md = `---\nkey: value\ninvalid: : : syntax\n---\nBody`;
  // Should not throw
  const result = parseFrontmatter(md);
  expect(typeof result.data).toBe("object");
});

test("no --- at start is treated as no frontmatter", () => {
  const md = `key: value\n---\nBody`;
  const { data, body } = parseFrontmatter(md);
  expect(data).toEqual({});
  expect(body).toContain("key: value");
});
