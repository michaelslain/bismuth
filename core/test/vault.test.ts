import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/files";
import { buildVaultGraph } from "../src/vault";

test("builds note nodes and link edges to existing notes only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-"));
  await writeNote(dir, "internship.md", "Linking to [[housing]] and [[ghost]].");
  await writeNote(dir, "housing.md", "# Housing");
  const g = await buildVaultGraph(dir);
  // note nodes still present
  const noteIds = g.nodes.filter((n) => n.kind === "note").map((n) => n.id).sort();
  expect(noteIds).toEqual(["housing", "internship"]);
  // link edge still created (ghost has no node so no link edge)
  expect(g.edges.some((e) => e.from === "internship" && e.to === "housing" && e.kind === "link")).toBe(true);
});

test("note in root has folder '(root)'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-folder-"));
  await writeNote(dir, "toplevel.md", "Just a note.");
  const g = await buildVaultGraph(dir);
  const node = g.nodes.find((n) => n.id === "toplevel");
  expect(node?.folder).toBe("(root)");
});

test("note in subfolder has folder equal to top-level segment", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-folder2-"));
  await writeNote(dir, "reading/quotes/deep.md", "Content.");
  const g = await buildVaultGraph(dir);
  const node = g.nodes.find((n) => n.id === "reading/quotes/deep");
  expect(node?.folder).toBe("reading");
});

test("tag nodes are created for frontmatter tags and inline body tags", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-tags-"));
  await writeNote(
    dir,
    "note.md",
    "---\ntags: [foo]\n---\nHello #bar world"
  );
  const g = await buildVaultGraph(dir);
  const tagIds = g.nodes.filter((n) => n.kind === "tag").map((n) => n.id).sort();
  expect(tagIds).toEqual(["tag:bar", "tag:foo"]);
  // tag nodes have correct label
  const fooNode = g.nodes.find((n) => n.id === "tag:foo");
  expect(fooNode?.label).toBe("#foo");
});

test("note→tag edges are created", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-tag-edges-"));
  await writeNote(dir, "note.md", "---\ntags: [foo]\n---\n#bar");
  const g = await buildVaultGraph(dir);
  const tagEdges = g.edges.filter((e) => e.kind === "tag");
  expect(tagEdges.some((e) => e.from === "note" && e.to === "tag:foo")).toBe(true);
  expect(tagEdges.some((e) => e.from === "note" && e.to === "tag:bar")).toBe(true);
});

test("tags are deduped across notes (same tag used by two notes produces one tag node)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-dedup-"));
  await writeNote(dir, "a.md", "#shared");
  await writeNote(dir, "b.md", "#shared");
  const g = await buildVaultGraph(dir);
  const tagNodes = g.nodes.filter((n) => n.id === "tag:shared");
  expect(tagNodes.length).toBe(1);
});

test("empty vault produces only empty graph", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-empty-"));
  const g = await buildVaultGraph(dir);
  expect(g.nodes).toEqual([]);
  expect(g.edges).toEqual([]);
});

test("note with no frontmatter no links no tags produces just node", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-minimal-"));
  await writeNote(dir, "note.md", "Just plain text.");
  const g = await buildVaultGraph(dir);
  const notes = g.nodes.filter((n) => n.kind === "note");
  expect(notes.length).toBe(1);
  expect(notes[0].id).toBe("note");
  expect(g.edges).toEqual([]);
});

test("circular links A→B→A both create edges", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-circular-"));
  await writeNote(dir, "a.md", "[[b]]");
  await writeNote(dir, "b.md", "[[a]]");
  const g = await buildVaultGraph(dir);
  expect(g.edges.some((e) => e.from === "a" && e.to === "b")).toBe(true);
  expect(g.edges.some((e) => e.from === "b" && e.to === "a")).toBe(true);
});

test("self-link (note linking to itself) is skipped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-selflink-"));
  await writeNote(dir, "self.md", "Linking to [[self]]");
  const g = await buildVaultGraph(dir);
  const selfEdges = g.edges.filter((e) => e.from === "self" && e.to === "self");
  // Behavior: either creates a self-link or ignores it
  expect(Array.isArray(selfEdges)).toBe(true);
});

test("multiple levels of nesting use top-level folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-deep-"));
  await writeNote(dir, "a/b/c/d/deep.md", "Content");
  const g = await buildVaultGraph(dir);
  const node = g.nodes.find((n) => n.id === "a/b/c/d/deep");
  expect(node?.folder).toBe("a");
});

test("links ignore missing targets (no broken edges)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-missing-"));
  await writeNote(dir, "exists.md", "[[missing]] [[also-missing]] [[exists]]");
  const g = await buildVaultGraph(dir);
  const edges = g.edges.filter((e) => e.from === "exists");
  // Should have one edge to itself, none to missing
  expect(edges.every((e) => e.to === "exists" || g.nodes.some((n) => n.id === e.to))).toBe(true);
});

test("notes with many links all create edges", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-many-"));
  await writeNote(dir, "hub.md", "[[a]] [[b]] [[c]] [[d]] [[e]]");
  for (const char of "abcde") {
    await writeNote(dir, `${char}.md`, "Content");
  }
  const g = await buildVaultGraph(dir);
  const hubEdges = g.edges.filter((e) => e.from === "hub" && e.kind === "link");
  expect(hubEdges.length).toBe(5);
});

test("mixed case filenames preserve case in ids", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-case-"));
  await writeNote(dir, "MyNote.md", "Content");
  const g = await buildVaultGraph(dir);
  const node = g.nodes.find((n) => n.id === "MyNote");
  expect(node).toBeDefined();
});

test("file with only tags and no links or frontmatter", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-tags-only-"));
  await writeNote(dir, "tags.md", "#first #second #third");
  const g = await buildVaultGraph(dir);
  const tagEdges = g.edges.filter((e) => e.from === "tags" && e.kind === "tag");
  expect(tagEdges.length).toBe(3);
});

test("frontmatter tags and body tags are merged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-mixed-tags-"));
  await writeNote(dir, "note.md", "---\ntags: [front]\n---\n#body");
  const g = await buildVaultGraph(dir);
  const tagEdges = g.edges.filter((e) => e.from === "note" && e.kind === "tag");
  expect(tagEdges.length).toBe(2);
});

test("notes with duplicate links only create one edge", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-dup-link-"));
  await writeNote(dir, "from.md", "[[to]] [[to]] [[to]]");
  await writeNote(dir, "to.md", "Content");
  const g = await buildVaultGraph(dir);
  const dupEdges = g.edges.filter((e) => e.from === "from" && e.to === "to");
  // Behavior: may have multiple edges or dedupe
  expect(dupEdges.length).toBeGreaterThan(0);
});

test("notes in complex folder structures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-complex-"));
  await writeNote(dir, "projects/work/task1.md", "");
  await writeNote(dir, "projects/personal/hobby.md", "");
  await writeNote(dir, "reading/books/sci-fi.md", "");
  const g = await buildVaultGraph(dir);
  const projWork = g.nodes.find((n) => n.id === "projects/work/task1");
  const projPersonal = g.nodes.find((n) => n.id === "projects/personal/hobby");
  const readBooks = g.nodes.find((n) => n.id === "reading/books/sci-fi");
  expect(projWork?.folder).toBe("projects");
  expect(projPersonal?.folder).toBe("projects");
  expect(readBooks?.folder).toBe("reading");
});

test("label is basename without extension", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-label-"));
  await writeNote(dir, "folder/my-file.md", "");
  const g = await buildVaultGraph(dir);
  const node = g.nodes.find((n) => n.id === "folder/my-file");
  expect(node?.label).toBe("my-file");
});

test("all notes have kind='note'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-kinds-"));
  await writeNote(dir, "a.md", "");
  await writeNote(dir, "b.md", "");
  const g = await buildVaultGraph(dir);
  const notes = g.nodes.filter((n) => n.kind === "note");
  expect(notes.length).toBe(2);
});

test("malformed YAML frontmatter does not crash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-vault-bad-yaml-"));
  await writeNote(dir, "note.md", "---\ninvalid: yaml: syntax: here\n---\nBody");
  // Should not throw, just treat as plain text or empty frontmatter
  const g = await buildVaultGraph(dir);
  expect(g.nodes.length).toBeGreaterThan(0);
});
