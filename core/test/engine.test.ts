import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/files";
import { buildGraph } from "../src/engine";

test("merges vault + memory and adds cross-brain about edges", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-eng-v-"));
  const mem = mkdtempSync(join(tmpdir(), "oa-eng-m-"));
  await writeNote(vault, "internship.md", "# Internship");
  await writeNote(mem, "michael-profile.md", "He is working on [[internship]].");
  const g = await buildGraph(vault, mem);

  expect(g.nodes.some((n) => n.id === "internship")).toBe(true);
  expect(g.edges).toContainEqual({
    from: "mem:michael-profile", to: "internship", kind: "about",
  });
});

test("works with no memory dir", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-eng-v2-"));
  await writeNote(vault, "a.md", "# A");
  const g = await buildGraph(vault);
  expect(g.nodes.some((n) => n.id === "a")).toBe(true);
});

test("empty vault produces an empty graph", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-eng-empty-"));
  const g = await buildGraph(vault);
  expect(g.nodes).toEqual([]);
});

test("about edges only created for vault basenames", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-eng-about-"));
  const mem = mkdtempSync(join(tmpdir(), "oa-eng-about-mem-"));
  await writeNote(vault, "real.md", "");
  await writeNote(mem, "memory.md", "Reference to [[real]] and [[fake]]");
  const g = await buildGraph(vault, mem);
  const aboutEdges = g.edges.filter((e) => e.kind === "about");
  // Should have edge to real, but not to fake
  expect(aboutEdges.some((e) => e.to === "real")).toBe(true);
  expect(aboutEdges.some((e) => e.to === "fake")).toBe(false);
});

test("memory references without vault match are ignored", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-eng-nomatch-"));
  const mem = mkdtempSync(join(tmpdir(), "oa-eng-nomatch-mem-"));
  await writeNote(vault, "exists.md", "");
  await writeNote(mem, "memory.md", "References [[missing1]] and [[missing2]]");
  const g = await buildGraph(vault, mem);
  const aboutEdges = g.edges.filter((e) => e.kind === "about");
  expect(aboutEdges.length).toBe(0);
});

test("two disconnected clusters get distinct community ids", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-eng-comm-"));
  // Cluster 1: a <-> b <-> c (linked). Cluster 2: x <-> y <-> z (linked). No cross-links.
  await writeNote(vault, "a.md", "[[b]] [[c]]");
  await writeNote(vault, "b.md", "[[a]] [[c]]");
  await writeNote(vault, "c.md", "[[a]] [[b]]");
  await writeNote(vault, "x.md", "[[y]] [[z]]");
  await writeNote(vault, "y.md", "[[x]] [[z]]");
  await writeNote(vault, "z.md", "[[x]] [[y]]");
  const g = await buildGraph(vault);
  const comm = (id: string) => g.nodes.find((n) => n.id === id)!.community;
  expect(comm("a")).toBe(comm("b"));
  expect(comm("a")).toBe(comm("c"));
  expect(comm("x")).toBe(comm("y"));
  expect(comm("a")).not.toBe(comm("x"));
  // Exemplar labels stamped onto every node.
  expect(g.nodes.find((n) => n.id === "a")!.communityLabel).toBeDefined();
});

test("multiple memory notes can link to same vault note", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-eng-multi-"));
  const mem = mkdtempSync(join(tmpdir(), "oa-eng-multi-mem-"));
  await writeNote(vault, "target.md", "");
  await writeNote(mem, "memory1.md", "[[target]]");
  await writeNote(mem, "memory2.md", "Also [[target]]");
  const g = await buildGraph(vault, mem);
  const aboutToTarget = g.edges.filter((e) => e.kind === "about" && e.to === "target");
  expect(aboutToTarget.length).toBe(2);
});
