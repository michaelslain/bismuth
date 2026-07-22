import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMarkdown, listTree, moveEntry, readNote, writeNote, deleteEntry, createEntry } from "../src/files";

const created: string[] = [];

afterEach(() => {
  for (const d of created.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* */ }
  }
});

test("lists markdown relative paths, reads and writes notes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-files-"));
  created.push(dir);
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
  created.push(dir);
  const files = await listMarkdown(dir);
  expect(files).toEqual([]);
});

test("ignores non-markdown files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-files-mixed-"));
  created.push(dir);
  await writeNote(dir, "note.md", "content");
  Bun.file(join(dir, "image.png")).writer().write("binary");
  Bun.file(join(dir, "doc.txt")).writer().write("text");
  const files = await listMarkdown(dir);
  expect(files).toEqual(["note.md"]);
});

test("handles filenames with special characters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-special-"));
  created.push(dir);
  await writeNote(dir, "note-with-dashes.md", "content");
  await writeNote(dir, "note_with_underscores.md", "content");
  await writeNote(dir, "note (1).md", "content");
  const files = await listMarkdown(dir);
  expect(files.length).toBe(3);
});

test("markdown listing ignores non-markdown files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-md-only-"));
  created.push(dir);
  await writeNote(dir, "note.md", "");
  await writeNote(dir, "another.md", "");
  const files = await listMarkdown(dir);
  expect(files.length).toBe(2);
  expect(files.every((f) => f.endsWith(".md"))).toBe(true);
});

test("readNote preserves exact file content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-exact-"));
  created.push(dir);
  const content = "Line 1\nLine 2\nLine 3\n\nWith blank lines";
  await writeNote(dir, "exact.md", content);
  const read = await readNote(dir, "exact.md");
  expect(read).toBe(content);
});

test("multiple writes to same file overwrite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-overwrite-"));
  created.push(dir);
  await writeNote(dir, "file.md", "First");
  await writeNote(dir, "file.md", "Second");
  const read = await readNote(dir, "file.md");
  expect(read).toBe("Second");
});

test("handles unicode content in markdown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-unicode-"));
  created.push(dir);
  const content = "Unicode: 你好世界 🚀 مرحبا";
  await writeNote(dir, "unicode.md", content);
  const read = await readNote(dir, "unicode.md");
  expect(read).toBe(content);
});

test("deeply nested directories work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-deep-"));
  created.push(dir);
  await writeNote(dir, "a/b/c/d/e/f.md", "deep content");
  const files = await listMarkdown(dir);
  expect(files).toContain("a/b/c/d/e/f.md");
});

test("listTree surfaces the `icon` frontmatter property", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-tree-icon-"));
  created.push(dir);
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
  created.push(dir);
  await writeNote(dir, "note.md", "---\nicon: [not, a, string]\n---\n# Note");
  const entries = await listTree(dir);
  expect(entries).toEqual([{ path: "note.md", kind: "file" }]);
});

test("listTree surfaces the `visibility` frontmatter property (raw, pre-cascade)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-tree-visibility-"));
  created.push(dir);
  await writeNote(dir, "plain.md", "# Plain");
  await writeNote(dir, "hidden.md", "---\nvisibility: hidden\n---\n# Hidden");
  await writeNote(dir, "chat-only.md", "---\nvisibility: chat-only\n---\n# Chat only");
  await writeNote(dir, "override.md", "---\nvisibility: all\n---\n# Explicit override");
  const entries = (await listTree(dir)).sort((a, b) => a.path.localeCompare(b.path));
  expect(entries).toEqual([
    { path: "chat-only.md", kind: "file", visibility: "chat-only" },
    { path: "hidden.md", kind: "file", visibility: "hidden" },
    { path: "override.md", kind: "file", visibility: "all" },
    { path: "plain.md", kind: "file" },
  ]);
});

test("listTree ignores an invalid visibility value", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-tree-badvisibility-"));
  created.push(dir);
  await writeNote(dir, "note.md", "---\nvisibility: nonsense\n---\n# Note");
  const entries = await listTree(dir);
  expect(entries).toEqual([{ path: "note.md", kind: "file" }]);
});

test("listTree includes directories and excludes dot-dirs like .trash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-tree-dirs-"));
  created.push(dir);
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

test("listTree omits unsupported files but surfaces images as openable rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-tree-nonmd-"));
  created.push(dir);
  await writeNote(dir, "note.md", "# Note");
  await Bun.write(join(dir, "data.txt"), "text");   // unsupported → omitted
  await Bun.write(join(dir, "photo.png"), "binary"); // image → annotatable markup surface
  const paths = (await listTree(dir)).map((e) => e.path).sort();
  expect(paths).toEqual(["note.md", "photo.png"]);
});

test("moveEntry renames a file within the same folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-move-rename-"));
  created.push(dir);
  await writeNote(dir, "old.md", "# Content");
  moveEntry(dir, "old.md", "new.md");
  expect(await readNote(dir, "new.md")).toBe("# Content");
  expect(existsSync(join(dir, "old.md"))).toBe(false);
});

test("moveEntry moves a file into another folder, creating it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-move-into-"));
  created.push(dir);
  await writeNote(dir, "note.md", "# N");
  moveEntry(dir, "note.md", "archive/note.md");
  expect(await readNote(dir, "archive/note.md")).toBe("# N");
});

test("moveEntry moves a whole folder with its children", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-move-folder-"));
  created.push(dir);
  await writeNote(dir, "proj/a.md", "# A");
  await writeNote(dir, "proj/b.md", "# B");
  moveEntry(dir, "proj", "archive/proj");
  expect(await readNote(dir, "archive/proj/a.md")).toBe("# A");
  expect(await readNote(dir, "archive/proj/b.md")).toBe("# B");
});

test("moveEntry rejects an existing destination (no overwrite)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-move-collide-"));
  created.push(dir);
  await writeNote(dir, "a.md", "# A");
  await writeNote(dir, "b.md", "# B");
  expect(() => moveEntry(dir, "a.md", "b.md")).toThrow();
  expect(await readNote(dir, "b.md")).toBe("# B");
});

test("moveEntry rejects moving a folder into its own descendant", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-move-cycle-"));
  created.push(dir);
  await writeNote(dir, "parent/x.md", "# X");
  expect(() => moveEntry(dir, "parent", "parent/child")).toThrow();
});

test("moveEntry rejects a missing source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-move-missing-"));
  created.push(dir);
  expect(() => moveEntry(dir, "nope.md", "yep.md")).toThrow();
});

test("deleteEntry moves a file into .trash and returns its trash path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-del-file-"));
  created.push(dir);
  await writeNote(dir, "note.md", "# Bye");
  const { trashPath } = deleteEntry(dir, "note.md");
  expect(existsSync(join(dir, "note.md"))).toBe(false);
  expect(trashPath.startsWith(".trash/")).toBe(true);
  expect(await readNote(dir, trashPath)).toBe("# Bye");
});

test("deleteEntry moves a whole folder into .trash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-del-folder-"));
  created.push(dir);
  await writeNote(dir, "proj/a.md", "# A");
  const { trashPath } = deleteEntry(dir, "proj");
  expect(existsSync(join(dir, "proj"))).toBe(false);
  expect(await readNote(dir, `${trashPath}/a.md`)).toBe("# A");
});

test("deleted entries do not appear in listTree (trash is hidden)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-del-hidden-"));
  created.push(dir);
  await writeNote(dir, "note.md", "# N");
  deleteEntry(dir, "note.md");
  const paths = (await listTree(dir)).map((e) => e.path);
  expect(paths).toEqual([]);
});

test("deleteEntry rejects a missing path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-del-missing-"));
  created.push(dir);
  expect(() => deleteEntry(dir, "nope.md")).toThrow();
});

test("createEntry creates an empty markdown file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-create-file-"));
  created.push(dir);
  createEntry(dir, "Untitled.md", "file");
  expect(existsSync(join(dir, "Untitled.md"))).toBe(true);
  expect(await readNote(dir, "Untitled.md")).toBe("");
});

test("createEntry creates a directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-create-dir-"));
  created.push(dir);
  createEntry(dir, "New Folder", "dir");
  const entry = (await listTree(dir)).find((e) => e.path === "New Folder");
  expect(entry).toEqual({ path: "New Folder", kind: "dir" });
});

test("createEntry rejects an existing path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-create-collide-"));
  created.push(dir);
  await writeNote(dir, "exists.md", "# E");
  expect(() => createEntry(dir, "exists.md", "file")).toThrow();
});

test("file ops reject path traversal outside the vault", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-traversal-"));
  created.push(dir);
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
  created.push(dir);
  createEntry(dir, "sub/folder", "dir");
  createEntry(dir, "sub/folder/note.md", "file");
  expect((await listTree(dir)).map((e) => e.path).sort()).toContain("sub/folder/note.md");
});

test("listTree shows .draw files but hides .draw.png/.pdf sidecars", async () => {
  const root = mkdtempSync(join(tmpdir(), "draw-tree-"));
  created.push(root);
  await Bun.write(join(root, "a.draw"), "{}");
  await Bun.write(join(root, "a.draw.png"), "x");
  await Bun.write(join(root, "a.draw.pdf"), "x");
  const paths = (await listTree(root)).map((e) => e.path);
  expect(paths).toContain("a.draw");
  expect(paths).not.toContain("a.draw.png");
  expect(paths).not.toContain("a.draw.pdf");
});

test("listTree surfaces a plain .pdf (markup source) + its sidecar, hides the .draw.pdf export", async () => {
  const root = mkdtempSync(join(tmpdir(), "pdf-tree-"));
  created.push(root);
  await Bun.write(join(root, "paper.pdf"), "%PDF-1.4"); // openable markup source
  await Bun.write(join(root, "paper.pdf.draw"), "{}");   // its annotation sidecar → matches .draw
  await Bun.write(join(root, "sketch.draw.pdf"), "x");   // a drawing's PDF export artifact → hidden
  const paths = (await listTree(root)).map((e) => e.path).sort();
  expect(paths).toContain("paper.pdf");
  expect(paths).toContain("paper.pdf.draw");
  expect(paths).not.toContain("sketch.draw.pdf");
});

test("listTree surfaces system folders: .settings always, .daemon only when enabled", async () => {
  const root = mkdtempSync(join(tmpdir(), "sysfolders-"));
  created.push(root);
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
  created.push(root);
  await Bun.write(join(root, ".daemon/memory/m.md"), "mem");
  const on = await listTree(root, { daemonEnabled: true, daemonName: "" });
  expect(on.find((e) => e.path === ".daemon")?.label).toBe("daemon");
});

// ── Sidecar carry: note ink (.ink/<path>.ink) + image markup (<path>.draw) follow moves,
//    deletes (into the trash), and restores (back out) ─────────────────────────────────────

test("moveEntry carries a note's ink sidecar to the new path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-files-ink-"));
  created.push(dir);
  await writeNote(dir, "a.md", "# A");
  await writeNote(dir, ".ink/a.md.ink", '{"v":1,"kind":"ink","strokes":[]}');
  moveEntry(dir, "a.md", "sub/b.md");
  expect(existsSync(join(dir, ".ink/a.md.ink"))).toBe(false);
  expect(existsSync(join(dir, ".ink/sub/b.md.ink"))).toBe(true);
});

test("moveEntry of a folder re-roots its whole ink subtree", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-files-inkdir-"));
  created.push(dir);
  await writeNote(dir, "proj/x.md", "x");
  await writeNote(dir, ".ink/proj/x.md.ink", '{"v":1,"kind":"ink","strokes":[]}');
  moveEntry(dir, "proj", "archive/proj");
  expect(existsSync(join(dir, ".ink/proj"))).toBe(false);
  expect(existsSync(join(dir, ".ink/archive/proj/x.md.ink"))).toBe(true);
});

test("moveEntry carries an image's co-located .draw markup sidecar", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-files-markup-"));
  created.push(dir);
  await writeNote(dir, "pic.png", "binary-ish");
  await writeNote(dir, "pic.png.draw", '{"v":1,"kind":"drawing","paper":{"bg":"blank"},"pages":[{"strokes":[]}]}');
  moveEntry(dir, "pic.png", "media/pic.png");
  expect(existsSync(join(dir, "pic.png.draw"))).toBe(false);
  expect(existsSync(join(dir, "media/pic.png.draw"))).toBe(true);
});

test("delete then restore round-trips the ink sidecar through the trash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-files-inktrash-"));
  created.push(dir);
  await writeNote(dir, "n.md", "note");
  await writeNote(dir, ".ink/n.md.ink", '{"v":1,"kind":"ink","strokes":[]}');
  const { trashPath } = deleteEntry(dir, "n.md");
  expect(existsSync(join(dir, ".ink/n.md.ink"))).toBe(false);
  expect(existsSync(join(dir, `.ink/${trashPath}.ink`))).toBe(true);
  // POST /restore is just moveEntry(trashPath, to) — the carry brings the ink back.
  moveEntry(dir, trashPath, "n.md");
  expect(existsSync(join(dir, ".ink/n.md.ink"))).toBe(true);
  expect(await readNote(dir, "n.md")).toBe("note");
});

test("move without any sidecar behaves exactly as before", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-files-nosc-"));
  created.push(dir);
  await writeNote(dir, "plain.md", "p");
  moveEntry(dir, "plain.md", "moved.md");
  expect(existsSync(join(dir, "moved.md"))).toBe(true);
  expect(existsSync(join(dir, ".ink"))).toBe(false);
});

test("moveEntry carries a daemon page's state sidecar (slug-keyed) and drops its stale trigger", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-files-pagestate-"));
  created.push(dir);
  await writeNote(dir, ".daemon/pages/reply.md", "---\ntype: daemon-page\n---\n\nbody");
  await writeNote(dir, ".daemon/pages/.state/reply.json", '{"status":"failed"}');
  await writeNote(dir, ".daemon/pages/.triggers/reply", "2026-07-06T00:00:00.000Z");
  moveEntry(dir, ".daemon/pages/reply.md", ".daemon/pages/reply-v2.md");
  expect(existsSync(join(dir, ".daemon/pages/.state/reply.json"))).toBe(false);
  expect(existsSync(join(dir, ".daemon/pages/.state/reply-v2.json"))).toBe(true);
  // An in-pages rename carries the pending trigger to the new slug (the queued action survives).
  expect(existsSync(join(dir, ".daemon/pages/.triggers/reply"))).toBe(false);
  expect(existsSync(join(dir, ".daemon/pages/.triggers/reply-v2"))).toBe(true);
  // Moving OUT of pages/ drops the trigger (nothing to fire) and co-locates the state.
  moveEntry(dir, ".daemon/pages/reply-v2.md", "archived-reply.md");
  expect(existsSync(join(dir, ".daemon/pages/.state/reply-v2.json"))).toBe(false);
  expect(existsSync(join(dir, "archived-reply.md.pagestate.json"))).toBe(true);
  expect(existsSync(join(dir, ".daemon/pages/.triggers/reply-v2"))).toBe(false);
});

test("delete then restore round-trips a daemon page's state through the trash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-files-pagetrash-"));
  created.push(dir);
  await writeNote(dir, ".daemon/pages/drafts.md", "---\ntype: daemon-page\n---\n\nbody");
  await writeNote(dir, ".daemon/pages/.state/drafts.json", '{"status":"done"}');
  await writeNote(dir, ".daemon/pages/.triggers/drafts", "t");
  const { trashPath } = deleteEntry(dir, ".daemon/pages/drafts.md");
  expect(existsSync(join(dir, ".daemon/pages/.state/drafts.json"))).toBe(false);
  expect(existsSync(join(dir, `${trashPath}.pagestate.json`))).toBe(true);
  // A deleted page can never fire — its pending trigger is dropped, not carried.
  expect(existsSync(join(dir, ".daemon/pages/.triggers/drafts"))).toBe(false);
  // POST /restore is moveEntry(trashPath, to) — the state maps back to its slug-keyed home.
  moveEntry(dir, trashPath, ".daemon/pages/drafts.md");
  expect(existsSync(join(dir, ".daemon/pages/.state/drafts.json"))).toBe(true);
});
