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
