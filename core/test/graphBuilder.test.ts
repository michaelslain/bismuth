// core/test/graphBuilder.test.ts
import { test, expect, describe, afterEach } from "bun:test";
import { buildGraphFromNotes } from "../src/graphBuilder";
import { setFileAccess, type FileAccess } from "../src/fileAccess";
import type { GraphNode } from "../src/graph";

// A no-disk FileAccess backed by an in-memory map — what a tauri-plugin-fs impl
// stands in for on iPad. Only listMarkdown/readNote matter for graph building.
function memAccess(vault: Record<string, string>): FileAccess {
  return {
    listMarkdown: async () => Object.keys(vault),
    readNote: async (_root, rel) => vault[rel] ?? "",
    writeNote: async () => {},
    listBases: async () => [],
    statNote: async () => null,
    realPath: async (p) => p,
  };
}

// Reset to the lazy `files.ts` default after each test so other suites that
// build real graphs off disk are unaffected by an injected in-memory reader.
afterEach(() => setFileAccess(undefined as unknown as FileAccess));

describe("buildGraphFromNotes FileAccess seam (the mobile in-process path)", () => {
  test("builds a graph from an injected reader with no filesystem touched", async () => {
    // An entirely in-memory vault — no Bun, no node:fs, no disk.
    setFileAccess(memAccess({ "a.md": "links to [[b]]", "b.md": "leaf note" }));

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

  test("setFileAccess swaps the active reader", async () => {
    let used = "";
    const a = memAccess({});
    setFileAccess({ ...a, listMarkdown: async () => { used = "injected"; return []; } });
    await buildGraphFromNotes("/x", (r) => ({ id: r, label: r, kind: "note" }), () => []);
    expect(used).toBe("injected");
  });
});
