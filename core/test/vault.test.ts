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
  expect(g.nodes.map((n) => n.id).sort()).toEqual(["housing", "internship"]);
  expect(g.nodes.every((n) => n.kind === "note")).toBe(true);
  expect(g.edges).toEqual([{ from: "internship", to: "housing", kind: "link" }]);
});
