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
