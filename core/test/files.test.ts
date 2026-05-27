import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMarkdown, listTree, moveEntry, readNote, writeNote, deleteEntry } from "../src/files";

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

test("listTree surfaces the `icon` frontmatter property", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-tree-icon-"));
  await writeNote(dir, "plain.md", "# Plain");
  await writeNote(dir, "fancy.md", "---\nicon: 🚀\n---\n# Fancy");
  const entries = (await listTree(dir)).sort((a, b) => a.path.localeCompare(b.path));
  expect(entries).toEqual([
    { path: "fancy.md", icon: "🚀", kind: "file" },
    { path: "plain.md", kind: "file" },
  ]);
});

test("listTree ignores a non-string icon value", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-tree-badicon-"));
  await writeNote(dir, "note.md", "---\nicon: [not, a, string]\n---\n# Note");
  const entries = await listTree(dir);
  expect(entries).toEqual([{ path: "note.md", kind: "file" }]);
});

test("listTree includes directories and excludes dot-dirs like .trash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-tree-dirs-"));
  await writeNote(dir, "top.md", "# Top");
  await writeNote(dir, "projects/inner.md", "# Inner");
  mkdirSync(join(dir, "empty-folder"));
  mkdirSync(join(dir, ".trash"));
  await writeNote(dir, ".trash/deleted.md", "# Deleted");
  const entries = (await listTree(dir)).sort((a, b) => a.path.localeCompare(b.path));
  const paths = entries.map((e) => e.path);
  expect(paths).toEqual(["empty-folder", "projects", "projects/inner.md", "top.md"]);
  expect(entries.find((e) => e.path === "empty-folder")).toEqual({ path: "empty-folder", kind: "dir" });
});

test("listTree omits non-markdown files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-tree-nonmd-"));
  await writeNote(dir, "note.md", "# Note");
  await Bun.write(join(dir, "image.png"), "binary");
  const paths = (await listTree(dir)).map((e) => e.path);
  expect(paths).toEqual(["note.md"]);
});

test("moveEntry renames a file within the same folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-move-rename-"));
  await writeNote(dir, "old.md", "# Content");
  moveEntry(dir, "old.md", "new.md");
  expect(await readNote(dir, "new.md")).toBe("# Content");
  expect(existsSync(join(dir, "old.md"))).toBe(false);
});

test("moveEntry moves a file into another folder, creating it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-move-into-"));
  await writeNote(dir, "note.md", "# N");
  moveEntry(dir, "note.md", "archive/note.md");
  expect(await readNote(dir, "archive/note.md")).toBe("# N");
});

test("moveEntry moves a whole folder with its children", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-move-folder-"));
  await writeNote(dir, "proj/a.md", "# A");
  await writeNote(dir, "proj/b.md", "# B");
  moveEntry(dir, "proj", "archive/proj");
  expect(await readNote(dir, "archive/proj/a.md")).toBe("# A");
  expect(await readNote(dir, "archive/proj/b.md")).toBe("# B");
});

test("moveEntry rejects an existing destination (no overwrite)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-move-collide-"));
  await writeNote(dir, "a.md", "# A");
  await writeNote(dir, "b.md", "# B");
  expect(() => moveEntry(dir, "a.md", "b.md")).toThrow();
  expect(await readNote(dir, "b.md")).toBe("# B");
});

test("moveEntry rejects moving a folder into its own descendant", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-move-cycle-"));
  await writeNote(dir, "parent/x.md", "# X");
  expect(() => moveEntry(dir, "parent", "parent/child")).toThrow();
});

test("moveEntry rejects a missing source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-move-missing-"));
  expect(() => moveEntry(dir, "nope.md", "yep.md")).toThrow();
});

test("deleteEntry moves a file into .trash and returns its trash path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-del-file-"));
  await writeNote(dir, "note.md", "# Bye");
  const { trashPath } = deleteEntry(dir, "note.md");
  expect(existsSync(join(dir, "note.md"))).toBe(false);
  expect(trashPath.startsWith(".trash/")).toBe(true);
  expect(await readNote(dir, trashPath)).toBe("# Bye");
});

test("deleteEntry moves a whole folder into .trash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-del-folder-"));
  await writeNote(dir, "proj/a.md", "# A");
  const { trashPath } = deleteEntry(dir, "proj");
  expect(existsSync(join(dir, "proj"))).toBe(false);
  expect(await readNote(dir, `${trashPath}/a.md`)).toBe("# A");
});

test("deleted entries do not appear in listTree (trash is hidden)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-del-hidden-"));
  await writeNote(dir, "note.md", "# N");
  deleteEntry(dir, "note.md");
  const paths = (await listTree(dir)).map((e) => e.path);
  expect(paths).toEqual([]);
});

test("deleteEntry rejects a missing path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-del-missing-"));
  expect(() => deleteEntry(dir, "nope.md")).toThrow();
});
