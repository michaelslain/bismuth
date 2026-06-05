// core/test/localBackend.test.ts
// Proves the in-process backend (the iPad "server") works end-to-end against a
// purely in-memory FileAccess — no HTTP, no Bun, no disk. This is the mobile path.
import { test, expect, describe, afterEach } from "bun:test";
import { createLocalBackend } from "../src/localBackend";
import { setFileAccess, type FileAccess } from "../src/fileAccess";
import type { GraphData } from "../src/graph";
import type { Task } from "../src/tasks";

// An in-memory vault standing in for tauri-plugin-fs. writeNote mutates the map so
// reads reflect writes (the real device behavior).
function memVault(initial: Record<string, string>): { fa: FileAccess; files: Record<string, string> } {
  const files = { ...initial };
  const fa: FileAccess = {
    listMarkdown: async () => Object.keys(files).filter((p) => p.endsWith(".md")),
    listTree: async () => Object.keys(files).map((path) => ({ path, kind: "file" as const })),
    readNote: async (_root, rel) => {
      if (!(rel in files)) throw new Error(`ENOENT ${rel}`);
      return files[rel];
    },
    writeNote: async (_root, rel, contents) => { files[rel] = contents; },
    listBases: async () => Object.keys(files).filter((p) => p.endsWith(".base")),
    statNote: async (_root, rel) => (rel in files ? { size: files[rel].length, mtimeMs: 0, ctimeMs: 0, birthtimeMs: 0 } : null),
    realPath: async (p) => p,
  };
  return { fa, files };
}

afterEach(() => setFileAccess(undefined as unknown as FileAccess));

describe("localBackend dispatch (no HTTP / no Bun)", () => {
  test("builds the graph from an in-memory vault", async () => {
    const { fa } = memVault({ "a.md": "see [[b]]", "b.md": "leaf" });
    setFileAccess(fa);
    const be = createLocalBackend({ vault: "/v" });
    const g = (await be.dispatch("GET", "/graph")) as GraphData;
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    // a → b wikilink edge resolved
    expect(g.edges.some((e) => e.from === "a" && e.to === "b")).toBe(true);
  });

  test("reads file + frontmatter meta", async () => {
    const { fa } = memVault({ "n.md": "---\ntitle: Hi\n---\nbody" });
    setFileAccess(fa);
    const be = createLocalBackend({ vault: "/v" });
    expect(await be.dispatch("GET", "/file?path=n.md")).toBe("---\ntitle: Hi\n---\nbody");
    expect(await be.dispatch("GET", "/meta?path=n.md")).toEqual({ title: "Hi" });
  });

  test("PUT /file writes through + bumps version + notifies subscribers", async () => {
    const { fa, files } = memVault({ "n.md": "old" });
    setFileAccess(fa);
    const be = createLocalBackend({ vault: "/v" });
    const events: Array<{ version: number; paths: string[] }> = [];
    be.subscribe((e) => events.push(e));

    expect(be.getVersion()).toBe(0);
    await be.dispatch("PUT", "/file", { path: "n.md", contents: "new" });
    expect(files["n.md"]).toBe("new"); // wrote through to the (in-memory) vault
    expect(be.getVersion()).toBe(1);
    expect(events).toEqual([{ version: 1, paths: ["n.md"] }]);
  });

  test("set-property edits frontmatter; refuses a nonexistent note", async () => {
    const { fa, files } = memVault({ "n.md": "---\na: 1\n---\nx" });
    setFileAccess(fa);
    const be = createLocalBackend({ vault: "/v" });
    await be.dispatch("POST", "/set-property", { path: "n.md", key: "b", value: 2 });
    expect(files["n.md"]).toContain("b: 2");
    // missing note → 404, not a silent create
    await expect(be.dispatch("POST", "/set-property", { path: "missing.md", key: "b", value: 2 })).rejects.toThrow();
  });

  test("collects tasks from the vault", async () => {
    const { fa } = memVault({ "todo.md": "- [ ] one\n- [x] two" });
    setFileAccess(fa);
    const be = createLocalBackend({ vault: "/v" });
    const tasks = (await be.dispatch("GET", "/tasks")) as Task[];
    expect(tasks.length).toBe(2);
    expect(tasks.map((t) => t.statusChar).sort()).toEqual([" ", "x"]);
  });

  test("search returns ranked hits", async () => {
    const { fa } = memVault({ "a.md": "the quick brown fox", "b.md": "nothing here" });
    setFileAccess(fa);
    const be = createLocalBackend({ vault: "/v" });
    const hits = (await be.dispatch("POST", "/search", { query: "fox", opts: { caseSensitive: false, wholeWord: false, regex: false } })) as Array<{ path: string }>;
    expect(hits.some((h) => h.path === "a.md")).toBe(true);
  });

  test("structural ops report NOT_SUPPORTED (documented follow-up)", async () => {
    setFileAccess(memVault({}).fa);
    const be = createLocalBackend({ vault: "/v" });
    await expect(be.dispatch("POST", "/create", { path: "x.md", kind: "file" })).rejects.toThrow(/not supported/i);
  });
});
