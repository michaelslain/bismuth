import { test, expect } from "bun:test";
import { parseFrontmatter, setFrontmatterKey, deleteFrontmatterKey } from "../src/frontmatter";

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
  expect((data.metadata as Record<string, unknown>)?.key).toBe("value");
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
  expect((data.tags as unknown[]).length).toBe(0);
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

test("setFrontmatterKey updates an existing key", () => {
  const md = `---\nstatus: in-progress\npriority: 1\n---\n# Housing\nbody text`;
  const out = setFrontmatterKey(md, "status", "done");
  const { data, body } = parseFrontmatter(out);
  expect(data.status).toBe("done");
  expect(data.priority).toBe(1);
  expect(body).toContain("# Housing");
  expect(body).toContain("body text");
});

test("setFrontmatterKey adds a new key alongside existing ones", () => {
  const md = `---\nstatus: todo\n---\n# Note\nbody`;
  const out = setFrontmatterKey(md, "priority", 3);
  const { data } = parseFrontmatter(out);
  expect(data.status).toBe("todo");
  expect(data.priority).toBe(3);
});

test("setFrontmatterKey creates frontmatter when the note had none", () => {
  const md = `# Just a note\n\nSome content here.`;
  const out = setFrontmatterKey(md, "status", "done");
  const { data, body } = parseFrontmatter(out);
  expect(data.status).toBe("done");
  expect(body).toContain("# Just a note");
  expect(body).toContain("Some content here.");
});

test("setFrontmatterKey preserves the body verbatim when frontmatter exists", () => {
  const body = `# Title\n\nParagraph 1\n\nParagraph 2\n`;
  const md = `---\nkey: value\n---\n${body}`;
  const out = setFrontmatterKey(md, "status", "done");
  expect(out).toContain(body);
  const parsed = parseFrontmatter(out);
  expect(parsed.data.key).toBe("value");
  expect(parsed.data.status).toBe("done");
});

test("setFrontmatterKey can set array and object values", () => {
  const md = `---\nstatus: todo\n---\nbody`;
  const out = setFrontmatterKey(md, "tags", ["a", "b"]);
  const { data } = parseFrontmatter(out);
  expect(data.tags).toEqual(["a", "b"]);
  expect(data.status).toBe("todo");
});

test("deleteFrontmatterKey removes a key but keeps the others and the body", () => {
  const md = `---\nicon: House\nstatus: todo\n---\n# Note\nbody text`;
  const out = deleteFrontmatterKey(md, "icon");
  const { data, body } = parseFrontmatter(out);
  expect(data.icon).toBeUndefined();
  expect(data.status).toBe("todo");
  expect(body).toContain("# Note");
  expect(body).toContain("body text");
});

test("deleteFrontmatterKey drops the whole block when the last key is removed (no empty fence/line)", () => {
  const md = `---\nicon: House\n---\nThis is the body.\n`;
  const out = deleteFrontmatterKey(md, "icon");
  expect(out).toBe("This is the body.\n");
  expect(out).not.toContain("---");
  expect(out.startsWith("\n")).toBe(false); // no leading blank line
});

test("deleteFrontmatterKey is a no-op when the key is absent", () => {
  const md = `---\nstatus: todo\n---\nbody`;
  expect(deleteFrontmatterKey(md, "icon")).toBe(md);
});

test("deleteFrontmatterKey is a no-op when the note has no frontmatter", () => {
  const md = `# Just a note\n\ncontent`;
  expect(deleteFrontmatterKey(md, "icon")).toBe(md);
});

test("setFrontmatterKey preserves flow-style arrays on untouched keys", () => {
  const md = `---\ntitle: Gamma\ntags: [book, fiction]\n---\n# Gamma`;
  const out = setFrontmatterKey(md, "status", "done");
  // Flow style is preserved AND the bracket padding now matches Obsidian's
  // idiom exactly: `[book, fiction]` rather than `[ book, fiction ]`.
  // The block-list form is the previous bug we're guarding against.
  expect(out).toContain("tags: [book, fiction]");
  expect(out).not.toMatch(/^\s*-\s+book/m);
  expect(out).toContain("status: done");
  expect(out).toContain("# Gamma");
});

test("setFrontmatterKey preserves the existing key order on update", () => {
  const md = `---\ntitle: Gamma\nstatus: todo\nrating: 3\n---\nbody`;
  const out = setFrontmatterKey(md, "status", "done");
  const fmLines = out.match(/^---\n([\s\S]*?)\n---/)![1].split("\n");
  expect(fmLines[0]).toContain("title:");
  expect(fmLines[1]).toContain("status:");
  expect(fmLines[2]).toContain("rating:");
});
