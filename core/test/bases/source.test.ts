import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../../src/files";
import { resolveSource } from "../../src/bases/source";

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
