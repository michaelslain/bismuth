import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../../src/files";
import { resolveSource, resolveBaseRows } from "../../src/bases/source";

test("resolveSource('notes') returns vault rows filtered by where", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-src-"));
  await writeNote(dir, "a.md", "---\ntags: [book]\n---\nA");
  await writeNote(dir, "b.md", "---\ntags: [film]\n---\nB");
  const rows = await resolveSource({ kind: "notes", where: 'file.hasTag("book")' }, { root: dir });
  expect(rows.map((r) => r.file.name)).toEqual(["a"]);
});

test("resolveSource('notes') with no where returns all notes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-src-"));
  await writeNote(dir, "a.md", "A");
  await writeNote(dir, "b.md", "B");
  const rows = await resolveSource({ kind: "notes" }, { root: dir });
  expect(rows.length).toBe(2);
});

test("resolveSource('tasks') returns task rows filtered by DSL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-src-"));
  await writeNote(dir, "t.md", "- [ ] one\n- [x] two");
  const rows = await resolveSource({ kind: "tasks", where: "not done" }, { root: dir });
  expect(rows.map((r) => r.note.description)).toEqual(["one"]);
});

test("resolveSource('base') reads a base file's own table rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-src-"));
  await writeNote(dir, "C.md", "---\ntype: base\nview: table\n---\n\n| title |\n| --- |\n| Hi |");
  const rows = await resolveSource({ kind: "base", ref: "[[C]]" }, { root: dir });
  expect(rows[0].note.title).toBe("Hi");
});

test("resolveSource('base') resolves a ref that already carries a .base extension", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-src-"));
  await writeNote(dir, "Legacy.base", "views:\n  - type: table\n    name: L");
  // a .base ref must not become Legacy.base.md
  const rows = await resolveSource({ kind: "base", ref: "[[Legacy.base]]" }, { root: dir });
  expect(Array.isArray(rows)).toBe(true); // resolves the file, not a .md sibling
});

test("resolveSource('base') with a missing ref returns []", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-src-"));
  const rows = await resolveSource({ kind: "base", ref: "Nope" }, { root: dir });
  expect(rows).toEqual([]);
});

test("resolveSource('base') follows the referenced base's OWN notes source (composition)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-src-"));
  await writeNote(dir, "Keep.md", '---\ntype: base\nsource: notes\nwhere: file.hasTag("keep")\n---\n');
  await writeNote(dir, "keep/x.md", "---\ntags: [keep]\n---\nX");
  await writeNote(dir, "other/z.md", "---\ntags: [other]\n---\nZ");
  const rows = await resolveSource({ kind: "base", ref: "[[Keep]]" }, { root: dir });
  expect(rows.map((r) => r.file.path).sort()).toEqual(["keep/x.md"]);
});

test("resolveSource('tasks', from) scopes tasks to the referenced base's notes only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-src-"));
  await writeNote(dir, "Keep.md", '---\ntype: base\nsource: notes\nwhere: file.hasTag("keep")\n---\n');
  await writeNote(dir, "keep/x.md", "---\ntags: [keep]\n---\n- [ ] scoped task");
  await writeNote(dir, "other/y.md", "- [ ] unscoped task");
  const rows = await resolveSource({ kind: "tasks", from: "[[Keep]]" }, { root: dir });
  expect(rows.map((r) => r.note.description)).toEqual(["scoped task"]);
});

test("base composition cycle terminates and returns []", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-src-"));
  await writeNote(dir, "A.md", '---\ntype: base\nsource: base\nref: "[[B]]"\n---\n');
  await writeNote(dir, "B.md", '---\ntype: base\nsource: base\nref: "[[A]]"\n---\n');
  const rows = await resolveSource({ kind: "base", ref: "[[A]]" }, { root: dir });
  expect(rows).toEqual([]);
});

test("UNQUOTED from: [[Base]] in a base file still scopes tasks (YAML nested-array regression)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-src-"));
  await writeNote(dir, "Keep.md", '---\ntype: base\nsource: notes\nwhere: file.inFolder("keep")\n---\n');
  await writeNote(dir, "keep/x.md", "- [ ] scoped");
  await writeNote(dir, "other/y.md", "- [ ] global");
  // NOTE: from is UNQUOTED here — YAML turns [[Keep]] into [["Keep"]].
  await writeNote(dir, "DoNow.md", "---\ntype: base\nsource: tasks\nfrom: [[Keep]]\n---\n");
  const rows = await resolveBaseRows("DoNow.md", { root: dir });
  expect(rows.map((r) => r.note.description)).toEqual(["scoped"]);
});
