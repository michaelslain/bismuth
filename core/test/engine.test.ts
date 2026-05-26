import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/files";
import { buildGraph } from "../src/engine";

test("merges self + vault + memory and adds cross-brain about edges", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-eng-v-"));
  const mem = mkdtempSync(join(tmpdir(), "oa-eng-m-"));
  await writeNote(vault, "internship.md", "# Internship");
  await writeNote(mem, "michael-profile.md", "He is working on [[internship]].");
  const g = await buildGraph(vault, mem);

  expect(g.nodes.find((n) => n.kind === "self")).toEqual({
    id: "self", label: "You", kind: "self",
  });
  expect(g.edges).toContainEqual({
    from: "mem:michael-profile", to: "internship", kind: "about",
  });
});

test("works with no memory dir", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-eng-v2-"));
  await writeNote(vault, "a.md", "# A");
  const g = await buildGraph(vault);
  expect(g.nodes.some((n) => n.id === "a")).toBe(true);
  expect(g.nodes.some((n) => n.kind === "self")).toBe(true);
});
