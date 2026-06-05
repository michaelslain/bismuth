// core/test/graphBuilder.test.ts
import { test, expect, describe, afterEach } from "bun:test";
import { buildGraphFromNotes, setVaultReader, type VaultReader } from "../src/graphBuilder";
import type { GraphNode } from "../src/graph";

// Reset to the lazy `files.ts` default after each test so other suites that
// build real graphs off disk are unaffected by an injected in-memory reader.
afterEach(() => setVaultReader(undefined as unknown as VaultReader));

describe("buildGraphFromNotes VaultReader seam (the mobile in-process path)", () => {
  test("builds a graph from an injected reader with no filesystem touched", async () => {
    // An entirely in-memory vault — this is what a tauri-plugin-fs reader stands
    // in for on iPad. No Bun, no node:fs, no disk.
    const vault: Record<string, string> = {
      "a.md": "links to [[b]]",
      "b.md": "leaf note",
    };
    const memReader: VaultReader = {
      listMarkdown: async () => Object.keys(vault),
      readNote: async (_root, rel) => vault[rel] ?? "",
    };
    setVaultReader(memReader);

    const node = (rel: string): GraphNode => ({ id: rel.replace(/\.md$/, ""), label: rel, kind: "note" });
    const { nodes, edges, byBase } = await buildGraphFromNotes(
      "/ignored-root",
      node,
      // minimal edge extractor: one "link" edge per [[wikilink]] resolved via byBase
      (nodeId, content, byBase) => {
        const out = [];
        for (const m of content.matchAll(/\[\[([^\]]+)\]\]/g)) {
          const target = byBase.get(m[1]);
          if (target) out.push({ from: nodeId, to: target, kind: "link" as const });
        }
        return out;
      },
    );

    expect(nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(byBase.get("b")).toBe("b");
    expect(edges).toEqual([{ from: "a", to: "b", kind: "link" }]);
  });

  test("setVaultReader swaps the active reader", async () => {
    let used = "";
    setVaultReader({
      listMarkdown: async () => { used = "injected"; return []; },
      readNote: async () => "",
    });
    await buildGraphFromNotes("/x", (r) => ({ id: r, label: r, kind: "note" }), () => []);
    expect(used).toBe("injected");
  });
});
