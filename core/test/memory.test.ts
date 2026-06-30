import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/files";
import { buildMemoryGraph } from "../src/memory";

test("memory nodes are kind=memory with mem: ids; internal links resolved", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-mem-"));
  await writeNote(dir, "michael-profile.md", "Profile. See [[michael-preferences]].");
  await writeNote(dir, "michael-preferences.md", "# Prefs");
  const g = await buildMemoryGraph(dir);
  expect(g.nodes.map((n) => n.id).sort()).toEqual([
    "mem:michael-preferences",
    "mem:michael-profile",
  ]);
  expect(g.nodes.every((n) => n.kind === "memory")).toBe(true);
  expect(g.edges).toEqual([
    { from: "mem:michael-profile", to: "mem:michael-preferences", kind: "link" },
  ]);
});

test("same-basename notes in different subdirs get distinct ids", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-mem-"));
  await writeNote(dir, "subdir-a/note.md", "# A");
  await writeNote(dir, "subdir-b/note.md", "# B");
  const g = await buildMemoryGraph(dir);
  expect(g.nodes.map((n) => n.id).sort()).toEqual([
    "mem:subdir-a/note",
    "mem:subdir-b/note",
  ]);
  expect(g.nodes.every((n) => n.label === "note")).toBe(true);
});
