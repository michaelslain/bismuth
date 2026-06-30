import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMarkdown, listTree, moveEntry, readNote, writeNote, deleteEntry, createEntry } from "../src/files";

test("lists markdown relative paths, reads and writes notes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-files-"));
  mkdirSync(join(dir, "projects"));
  await writeNote(dir, "a.md", "# A");
  await writeNote(dir, "projects/b.md", "# B");
  await writeNote(dir, "notes.txt", "ignore me");
  const rels = (await listMarkdown(dir)).sort();
  expect(rels).toEqual(["a.md", "projects/b.md"]);
  expect(await readNote(dir, "projects/b.md")).toBe("# B");
});

test("empty directory returns empty list", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-files-empty-"));
  const files = await listMarkdown(dir);
  expect(files).toEqual([]);
});

test("ignores non-markdown files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-files-mixed-"));
  await writeNote(dir, "note.md", "content");
  Bun.file(join(dir, "image.png")).writer().write("binary");
  Bun.file(join(dir, "doc.txt")).writer().write("text");
  const files = await listMarkdown(dir);
  expect(files).toEqual(["note.md"]);
});

test("handles filenames with special characters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-special-"));
  await writeNote(dir, "note-with-dashes.md", "content");
  await writeNote(dir, "note_with_underscores.md", "content");
  await writeNote(dir, "note (1).md", "content");
  const files = await listMarkdown(dir);
  expect(files.length).toBe(3);
});

test("markdown listing ignores non-markdown files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-md-only-"));
  await writeNote(dir, "note.md", "");
  await writeNote(dir, "another.md", "");
  const files = await listMarkdown(dir);
  expect(files.length).toBe(2);
  expect(files.every((f) => f.endsWith(".md"))).toBe(true);
});

test("readNote preserves exact file content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-exact-"));
  const content = "Line 1\nLine 2\nLine 3\n\nWith blank lines";
  await writeNote(dir, "exact.md", content);
  const read = await readNote(dir, "exact.md");
  expect(read).toBe(content);
});

test("multiple writes to same file overwrite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-overwrite-"));
  await writeNote(dir, "file.md", "First");
  await writeNote(dir, "file.md", "Second");
  const read = await readNote(dir, "file.md");
  expect(read).toBe("Second");
});

test("handles unicode content in markdown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-unicode-"));
  const content = "Unicode: 你好世界 🚀 مرحبا";
  await writeNote(dir, "unicode.md", content);
  const read = await readNote(dir, "unicode.md");
  expect(read).toBe(content);
});

test("deeply nested directories work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-deep-"));
  await writeNote(dir, "a/b/c/d/e/f.md", "deep content");
  const files = await listMarkdown(dir);
  expect(files).toContain("a/b/c/d/e/f.md");
});

test("listTree surfaces the `icon` frontmatter property", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-tree-icon-"));
  await writeNote(dir, "plain.md", "# Plain");
  await writeNote(dir, "fancy.md", "---\nicon: 🚀\n---\n# Fancy");
  const entries = (await listTree(dir)).sort((a, b) => a.path.localeCompare(b.path));
  expect(entries).toEqual([
    { path: "fancy.md", icon: "🚀", kind: "file" },
    { path: "plain.md", kind: "file" },
  ]);
});

test("listTree ignores a non-string icon value", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-tree-badicon-"));
  await writeNote(dir, "note.md", "---\nicon: [not, a, string]\n---\n# Note");
  const entries = await listTree(dir);
  expect(entries).toEqual([{ path: "note.md", kind: "file" }]);
});

test("listTree includes directories and excludes dot-dirs like .trash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-tree-dirs-"));
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
  const dir = mkdtempSync(join(tmpdir(), "bismuth-tree-nonmd-"));
  await writeNote(dir, "note.md", "# Note");
  await Bun.write(join(dir, "image.png"), "binary");
  const paths = (await listTree(dir)).map((e) => e.path);
  expect(paths).toEqual(["note.md"]);
});

test("moveEntry renames a file within the same folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-move-rename-"));
  await writeNote(dir, "old.md", "# Content");
  moveEntry(dir, "old.md", "new.md");
  expect(await readNote(dir, "new.md")).toBe("# Content");
  expect(existsSync(join(dir, "old.md"))).toBe(false);
});

test("moveEntry moves a file into another folder, creating it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-move-into-"));
  await writeNote(dir, "note.md", "# N");
  moveEntry(dir, "note.md", "archive/note.md");
  expect(await readNote(dir, "archive/note.md")).toBe("# N");
});

test("moveEntry moves a whole folder with its children", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-move-folder-"));
  await writeNote(dir, "proj/a.md", "# A");
  await writeNote(dir, "proj/b.md", "# B");
  moveEntry(dir, "proj", "archive/proj");
  expect(await readNote(dir, "archive/proj/a.md")).toBe("# A");
  expect(await readNote(dir, "archive/proj/b.md")).toBe("# B");
});

test("moveEntry rejects an existing destination (no overwrite)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-move-collide-"));
  await writeNote(dir, "a.md", "# A");
  await writeNote(dir, "b.md", "# B");
  expect(() => moveEntry(dir, "a.md", "b.md")).toThrow();
  expect(await readNote(dir, "b.md")).toBe("# B");
});

test("moveEntry rejects moving a folder into its own descendant", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-move-cycle-"));
  await writeNote(dir, "parent/x.md", "# X");
  expect(() => moveEntry(dir, "parent", "parent/child")).toThrow();
});

test("moveEntry rejects a missing source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-move-missing-"));
  expect(() => moveEntry(dir, "nope.md", "yep.md")).toThrow();
});

test("deleteEntry moves a file into .trash and returns its trash path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-del-file-"));
  await writeNote(dir, "note.md", "# Bye");
  const { trashPath } = deleteEntry(dir, "note.md");
  expect(existsSync(join(dir, "note.md"))).toBe(false);
  expect(trashPath.startsWith(".trash/")).toBe(true);
  expect(await readNote(dir, trashPath)).toBe("# Bye");
});

test("deleteEntry moves a whole folder into .trash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-del-folder-"));
  await writeNote(dir, "proj/a.md", "# A");
  const { trashPath } = deleteEntry(dir, "proj");
  expect(existsSync(join(dir, "proj"))).toBe(false);
  expect(await readNote(dir, `${trashPath}/a.md`)).toBe("# A");
});

test("deleted entries do not appear in listTree (trash is hidden)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-del-hidden-"));
  await writeNote(dir, "note.md", "# N");
  deleteEntry(dir, "note.md");
  const paths = (await listTree(dir)).map((e) => e.path);
  expect(paths).toEqual([]);
});

test("deleteEntry rejects a missing path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-del-missing-"));
  expect(() => deleteEntry(dir, "nope.md")).toThrow();
});

test("createEntry creates an empty markdown file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-create-file-"));
  createEntry(dir, "Untitled.md", "file");
  expect(existsSync(join(dir, "Untitled.md"))).toBe(true);
  expect(await readNote(dir, "Untitled.md")).toBe("");
});

test("createEntry creates a directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-create-dir-"));
  createEntry(dir, "New Folder", "dir");
  const entry = (await listTree(dir)).find((e) => e.path === "New Folder");
  expect(entry).toEqual({ path: "New Folder", kind: "dir" });
});

test("createEntry rejects an existing path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-create-collide-"));
  await writeNote(dir, "exists.md", "# E");
  expect(() => createEntry(dir, "exists.md", "file")).toThrow();
});

test("file ops reject path traversal outside the vault", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-traversal-"));
  await writeNote(dir, "real.md", "# Real");
  expect(() => createEntry(dir, "../escape.md", "file")).toThrow(/escape|vault/i);
  expect(() => createEntry(dir, "/etc/whatever.md", "file")).toThrow(/escape|vault/i);
  expect(() => moveEntry(dir, "../x.md", "y.md")).toThrow(/escape|vault/i);
  expect(() => moveEntry(dir, "real.md", "../../y.md")).toThrow(/escape|vault/i);
  expect(() => deleteEntry(dir, "../../etc/hosts")).toThrow(/escape|vault/i);
  await expect(readNote(dir, "../../../etc/passwd")).rejects.toThrow(/escape|vault/i);
});

test("file ops still allow legitimate nested paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-nested-ok-"));
  createEntry(dir, "sub/folder", "dir");
  createEntry(dir, "sub/folder/note.md", "file");
  expect((await listTree(dir)).map((e) => e.path).sort()).toContain("sub/folder/note.md");
});

test("listTree shows .draw files but hides .draw.png/.pdf sidecars", async () => {
  const root = mkdtempSync(join(tmpdir(), "draw-tree-"));
  await Bun.write(join(root, "a.draw"), "{}");
  await Bun.write(join(root, "a.draw.png"), "x");
  await Bun.write(join(root, "a.draw.pdf"), "x");
  const paths = (await listTree(root)).map((e) => e.path);
  expect(paths).toContain("a.draw");
  expect(paths).not.toContain("a.draw.png");
  expect(paths).not.toContain("a.draw.pdf");
});

test("listTree surfaces system folders: .settings always, .daemon only when enabled", async () => {
  const root = mkdtempSync(join(tmpdir(), "sysfolders-"));
  await Bun.write(join(root, "Note.md"), "# Note");
  await Bun.write(join(root, ".settings"), "appearance:\n  theme: light\n");
  await Bun.write(join(root, ".daemon/memory/m.md"), "mem");
  await Bun.write(join(root, ".daemon/crons/c.md"), "cron");
  await Bun.write(join(root, ".daemon/crons/.last-fired.json"), "{}"); // internal dot-state
  await Bun.write(join(root, ".daemon/session-id"), "sid");

  // Daemon OFF (default): the .settings FILE is shown; .daemon entirely hidden.
  const off = await listTree(root);
  const offPaths = off.map((e) => e.path);
  expect(offPaths).toContain(".settings");
  expect(offPaths.some((p) => p.startsWith(".daemon"))).toBe(false);
  const settingsEntry = off.find((e) => e.path === ".settings");
  expect(settingsEntry?.kind).toBe("file"); // a file, not a folder
  expect(settingsEntry?.label).toBe("settings");

  // Daemon ON: .daemon shown + labeled with the name; memory/crons/session-id surface;
  // internal dot-state (.last-fired.json) stays hidden; the normal note is unaffected.
  const on = await listTree(root, { daemonEnabled: true, daemonName: "Atlas" });
  const onPaths = on.map((e) => e.path);
  expect(onPaths).toContain("Note.md");
  expect(onPaths).toContain(".daemon");
  expect(onPaths).toContain(".daemon/memory/m.md");
  expect(onPaths).toContain(".daemon/crons/c.md");
  expect(onPaths).toContain(".daemon/session-id");
  expect(onPaths).not.toContain(".daemon/crons/.last-fired.json");
  const daemonEntry = on.find((e) => e.path === ".daemon");
  expect(daemonEntry?.isSystemFolder).toBe(true);
  expect(daemonEntry?.label).toBe("Atlas");

  // System folders never enter the knowledge graph (listMarkdown excludes dotfiles).
  const md = await listMarkdown(root);
  expect(md).toContain("Note.md");
  expect(md.some((p) => p.startsWith(".daemon") || p.startsWith(".settings"))).toBe(false);
});

test("listTree daemon label falls back to 'daemon' when name is blank", async () => {
  const root = mkdtempSync(join(tmpdir(), "sysfolders-noname-"));
  await Bun.write(join(root, ".daemon/memory/m.md"), "mem");
  const on = await listTree(root, { daemonEnabled: true, daemonName: "" });
  expect(on.find((e) => e.path === ".daemon")?.label).toBe("daemon");
});
