import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMarkdown, listMarkdownWithIcons, readNote, writeNote } from "../src/files";

test("lists markdown relative paths, reads and writes notes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-files-"));
  mkdirSync(join(dir, "projects"));
  await writeNote(dir, "a.md", "# A");
  await writeNote(dir, "projects/b.md", "# B");
  await writeNote(dir, "notes.txt", "ignore me");
  const rels = (await listMarkdown(dir)).sort();
  expect(rels).toEqual(["a.md", "projects/b.md"]);
  expect(await readNote(dir, "projects/b.md")).toBe("# B");
});

test("empty directory returns empty list", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-files-empty-"));
  const files = await listMarkdown(dir);
  expect(files).toEqual([]);
});

test("ignores non-markdown files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-files-mixed-"));
  await writeNote(dir, "note.md", "content");
  Bun.file(join(dir, "image.png")).writer().write("binary");
  Bun.file(join(dir, "doc.txt")).writer().write("text");
  const files = await listMarkdown(dir);
  expect(files).toEqual(["note.md"]);
});

test("handles filenames with special characters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-special-"));
  await writeNote(dir, "note-with-dashes.md", "content");
  await writeNote(dir, "note_with_underscores.md", "content");
  await writeNote(dir, "note (1).md", "content");
  const files = await listMarkdown(dir);
  expect(files.length).toBe(3);
});

test("markdown listing ignores non-markdown files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-md-only-"));
  await writeNote(dir, "note.md", "");
  await writeNote(dir, "another.md", "");
  const files = await listMarkdown(dir);
  expect(files.length).toBe(2);
  expect(files.every((f) => f.endsWith(".md"))).toBe(true);
});

test("readNote preserves exact file content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-exact-"));
  const content = "Line 1\nLine 2\nLine 3\n\nWith blank lines";
  await writeNote(dir, "exact.md", content);
  const read = await readNote(dir, "exact.md");
  expect(read).toBe(content);
});

test("multiple writes to same file overwrite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-overwrite-"));
  await writeNote(dir, "file.md", "First");
  await writeNote(dir, "file.md", "Second");
  const read = await readNote(dir, "file.md");
  expect(read).toBe("Second");
});

test("handles unicode content in markdown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-unicode-"));
  const content = "Unicode: 你好世界 🚀 مرحبا";
  await writeNote(dir, "unicode.md", content);
  const read = await readNote(dir, "unicode.md");
  expect(read).toBe(content);
});

test("deeply nested directories work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-deep-"));
  await writeNote(dir, "a/b/c/d/e/f.md", "deep content");
  const files = await listMarkdown(dir);
  expect(files).toContain("a/b/c/d/e/f.md");
});

test("listMarkdownWithIcons surfaces the `icon` frontmatter property", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-icons-"));
  await writeNote(dir, "fire.md", "---\nicon: 🔥\n---\nhot");
  await writeNote(dir, "plain.md", "# no frontmatter");
  const entries = (await listMarkdownWithIcons(dir)).sort((a, b) => a.path.localeCompare(b.path));
  expect(entries).toEqual([
    { path: "fire.md", icon: "🔥" },
    { path: "plain.md" },
  ]);
});

test("listMarkdownWithIcons ignores a non-string icon value", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-icons-bad-"));
  await writeNote(dir, "num.md", "---\nicon: 42\n---\nbody");
  const entries = await listMarkdownWithIcons(dir);
  expect(entries).toEqual([{ path: "num.md" }]);
});
