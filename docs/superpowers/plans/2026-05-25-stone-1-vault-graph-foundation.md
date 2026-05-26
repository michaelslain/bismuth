# Stone 1 — Vault Graph Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working desktop app + headless CLI that opens a markdown vault (plus claude-bot's memory folder), shows all three brains as one interactive 2D graph, edits notes with a CodeMirror 6 live-preview editor, and auto-backs-up the vault with local git.

**Architecture:** One repo, Bun workspace. A **Bun/TypeScript core** holds all logic (parsers, graph sources, git backup, filesystem) and exposes a local HTTP API. A **Bun CLI** imports the core for headless use (the Pi target). A **thin Tauri (Rust) shell + SolidJS webview** is the GUI; the webview talks to the core over localhost HTTP. Everything is a graph: each "brain" is a `GraphSource` emitting the same `GraphData`, rendered by a swappable `GraphRenderer` (`Canvas2DRenderer` now, WebGL later).

**Tech Stack:** Bun, TypeScript, `yaml` (frontmatter), `Bun.Glob` (file scan), `Bun.$` (git), `Bun.serve` (HTTP); Tauri 2 + SolidJS + Vite; CodeMirror 6 (`@codemirror/*`); `d3-force` (graph layout) + Canvas.

**Repo layout this plan creates:**
```
obsidian-alternative/
  package.json            # Bun workspace root
  core/                   # Bun/TS engine + HTTP server (the brain)
    package.json
    tsconfig.json
    src/{graph,frontmatter,wikilinks,files,vault,memory,engine,backup,server}.ts
    test/*.test.ts
  cli/                    # Bun/TS headless face (Pi)
    package.json
    src/index.ts
  app/                    # Tauri + SolidJS GUI
    src/                  # SolidJS (webview)
    src-tauri/            # thin Rust shell
  sample-vault/           # demo notes + fake memory for dev/tests (committed)
```

**Conventions used throughout:**
- Note `id` = path relative to the vault root, without `.md` (e.g. `projects/internship`). `label` = basename.
- Memory node `id` is prefixed `mem:` to avoid collisions (e.g. `mem:michael-profile`).
- Wikilinks resolve by **basename** (Obsidian style): `[[internship]]` matches the note whose basename is `internship`.
- A `self` node (`id: "self"`, `kind: "self"`) anchors brain 1.

---

## Task 0: Scaffold the Bun workspace, core, cli, and Tauri+Solid GUI

**Files:**
- Create: `package.json` (workspace root)
- Create: `core/package.json`, `core/tsconfig.json`
- Create: `cli/package.json`
- Create: `app/` (via create-tauri-app)

- [ ] **Step 1: Create the workspace root `package.json`**

```json
{
  "name": "obsidian-alternative",
  "private": true,
  "workspaces": ["core", "cli", "app"],
  "scripts": {
    "test": "bun test core",
    "core:serve": "bun run core/src/server.ts"
  }
}
```

- [ ] **Step 2: Create `core/package.json`**

```json
{
  "name": "@oa/core",
  "version": "0.1.0",
  "type": "module",
  "module": "src/index.ts",
  "dependencies": { "yaml": "^2.5.0" },
  "devDependencies": { "@types/bun": "latest" }
}
```

- [ ] **Step 3: Create `core/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

- [ ] **Step 4: Create `cli/package.json`**

```json
{
  "name": "@oa/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "oa": "src/index.ts" },
  "dependencies": { "@oa/core": "workspace:*" },
  "devDependencies": { "@types/bun": "latest" }
}
```

- [ ] **Step 5: Scaffold the Tauri + SolidJS GUI into `app/`**

Run (non-interactive; if flags differ on your CTA version, run `bun create tauri-app` interactively and choose **SolidJS**, **TypeScript**, **bun**):

```bash
bun create tauri-app@latest app --template solid-ts --manager bun --identifier com.michael.obsidian -y
```

Expected: `app/` created with `app/src` (SolidJS) and `app/src-tauri` (Rust). 

- [ ] **Step 6: Install everything**

Run: `bun install`
Expected: installs workspace deps and `app/` deps with no errors.

- [ ] **Step 7: Verify the GUI shell builds**

Run: `cd app && bun run tauri build --debug 2>&1 | tail -5` (first Rust build is slow)
Expected: completes without error (a debug bundle is produced). If it builds, the toolchain is good. Then `cd ..`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold bun workspace (core, cli) + tauri+solid gui"
```

---

## Task 1: Graph types + `mergeGraphs`

**Files:**
- Create: `core/src/graph.ts`
- Test: `core/test/graph.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// core/test/graph.test.ts
import { test, expect } from "bun:test";
import { mergeGraphs, emptyGraph, type GraphData } from "../src/graph";

test("emptyGraph has no nodes or edges", () => {
  expect(emptyGraph()).toEqual({ nodes: [], edges: [] });
});

test("mergeGraphs concatenates and dedupes nodes by id, keeps all edges", () => {
  const a: GraphData = {
    nodes: [{ id: "x", label: "X", kind: "note" }],
    edges: [{ from: "x", to: "y", kind: "link" }],
  };
  const b: GraphData = {
    nodes: [
      { id: "x", label: "X", kind: "note" }, // duplicate id
      { id: "y", label: "Y", kind: "note" },
    ],
    edges: [{ from: "y", to: "x", kind: "link" }],
  };
  const merged = mergeGraphs([a, b]);
  expect(merged.nodes.map((n) => n.id).sort()).toEqual(["x", "y"]);
  expect(merged.edges.length).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/test/graph.test.ts`
Expected: FAIL — cannot find module `../src/graph`.

- [ ] **Step 3: Write minimal implementation**

```ts
// core/src/graph.ts
export type NodeKind = "self" | "note" | "memory" | "agent";
export type EdgeKind = "link" | "message" | "about";
export type NodeState = "idle" | "awake" | "dead";

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  state?: NodeState;
}
export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function emptyGraph(): GraphData {
  return { nodes: [], edges: [] };
}

export function mergeGraphs(graphs: GraphData[]): GraphData {
  const byId = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  for (const g of graphs) {
    for (const n of g.nodes) if (!byId.has(n.id)) byId.set(n.id, n);
    edges.push(...g.edges);
  }
  return { nodes: [...byId.values()], edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test core/test/graph.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add core/src/graph.ts core/test/graph.test.ts
git commit -m "feat(core): graph types + mergeGraphs"
```

---

## Task 2: Frontmatter parser

**Files:**
- Create: `core/src/frontmatter.ts`
- Test: `core/test/frontmatter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// core/test/frontmatter.test.ts
import { test, expect } from "bun:test";
import { parseFrontmatter } from "../src/frontmatter";

test("parses YAML frontmatter and returns the body", () => {
  const md = `---\nstatus: in-progress\npriority: 1\ntags: [a, b]\n---\n# Title\nbody text`;
  const { data, body } = parseFrontmatter(md);
  expect(data).toEqual({ status: "in-progress", priority: 1, tags: ["a", "b"] });
  expect(body.trim()).toBe("# Title\nbody text");
});

test("no frontmatter returns empty data and full body", () => {
  const md = `# Just a note`;
  const { data, body } = parseFrontmatter(md);
  expect(data).toEqual({});
  expect(body).toBe(md);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/test/frontmatter.test.ts`
Expected: FAIL — cannot find module `../src/frontmatter`.

- [ ] **Step 3: Write minimal implementation**

```ts
// core/src/frontmatter.ts
import { parse } from "yaml";

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(md: string): Frontmatter {
  const m = md.match(FM);
  if (!m) return { data: {}, body: md };
  const data = (parse(m[1]) ?? {}) as Record<string, unknown>;
  return { data, body: md.slice(m[0].length) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test core/test/frontmatter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add core/src/frontmatter.ts core/test/frontmatter.test.ts
git commit -m "feat(core): YAML frontmatter parser"
```

---

## Task 3: Wikilink extractor

**Files:**
- Create: `core/src/wikilinks.ts`
- Test: `core/test/wikilinks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// core/test/wikilinks.test.ts
import { test, expect } from "bun:test";
import { extractWikilinks } from "../src/wikilinks";

test("extracts targets, strips alias and heading, dedupes", () => {
  const md = `See [[internship]] and [[housing|my place]] and [[essay#intro]] and [[internship]].`;
  expect(extractWikilinks(md).sort()).toEqual(["essay", "housing", "internship"]);
});

test("no links returns empty array", () => {
  expect(extractWikilinks("plain text")).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/test/wikilinks.test.ts`
Expected: FAIL — cannot find module `../src/wikilinks`.

- [ ] **Step 3: Write minimal implementation**

```ts
// core/src/wikilinks.ts
const LINK = /\[\[([^\]]+?)\]\]/g;

export function extractWikilinks(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(LINK)) {
    const raw = m[1];
    const target = raw.split("|")[0].split("#")[0].trim();
    if (target) out.add(target);
  }
  return [...out];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test core/test/wikilinks.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add core/src/wikilinks.ts core/test/wikilinks.test.ts
git commit -m "feat(core): wikilink extractor"
```

---

## Task 4: Filesystem helpers (scan / read / write markdown)

**Files:**
- Create: `core/src/files.ts`
- Test: `core/test/files.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// core/test/files.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMarkdown, readNote, writeNote } from "../src/files";

test("lists markdown relative paths, reads and writes notes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-files-"));
  mkdirSync(join(dir, "projects"));
  await writeNote(dir, "a.md", "# A");
  await writeNote(dir, "projects/b.md", "# B");
  await writeNote(dir, "notes.txt", "ignore me"); // non-md is ignored by writeNote? no—write raw
  const rels = (await listMarkdown(dir)).sort();
  expect(rels).toEqual(["a.md", "projects/b.md"]);
  expect(await readNote(dir, "projects/b.md")).toBe("# B");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/test/files.test.ts`
Expected: FAIL — cannot find module `../src/files`.

- [ ] **Step 3: Write minimal implementation**

```ts
// core/src/files.ts
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";

export async function listMarkdown(root: string): Promise<string[]> {
  const glob = new Bun.Glob("**/*.md");
  const out: string[] = [];
  for await (const rel of glob.scan({ cwd: root, dot: false })) out.push(rel);
  return out;
}

export async function readNote(root: string, rel: string): Promise<string> {
  return await Bun.file(join(root, rel)).text();
}

export async function writeNote(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  await Bun.write(full, contents);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test core/test/files.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add core/src/files.ts core/test/files.test.ts
git commit -m "feat(core): filesystem helpers (list/read/write markdown)"
```

---

## Task 5: VaultSource — build the vault graph (brain 2)

**Files:**
- Create: `core/src/vault.ts`
- Test: `core/test/vault.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// core/test/vault.test.ts
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
  // edge only to the existing note; [[ghost]] dropped
  expect(g.edges).toEqual([{ from: "internship", to: "housing", kind: "link" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/test/vault.test.ts`
Expected: FAIL — cannot find module `../src/vault`.

- [ ] **Step 3: Write minimal implementation**

```ts
// core/src/vault.ts
import { basename } from "node:path";
import { listMarkdown, readNote } from "./files";
import { extractWikilinks } from "./wikilinks";
import type { GraphData, GraphNode, GraphEdge } from "./graph";

/** id = relative path without ".md" */
export function noteId(rel: string): string {
  return rel.replace(/\.md$/i, "");
}

export async function buildVaultGraph(root: string): Promise<GraphData> {
  const rels = await listMarkdown(root);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  // map basename -> id, for resolving wikilinks (Obsidian style)
  const byBase = new Map<string, string>();
  const contents = new Map<string, string>();
  for (const rel of rels) {
    const id = noteId(rel);
    const label = basename(rel).replace(/\.md$/i, "");
    nodes.push({ id, label, kind: "note" });
    byBase.set(label, id);
    contents.set(id, await readNote(root, rel));
  }
  for (const node of nodes) {
    for (const target of extractWikilinks(contents.get(node.id)!)) {
      const toId = byBase.get(target);
      if (toId) edges.push({ from: node.id, to: toId, kind: "link" });
    }
  }
  return { nodes, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test core/test/vault.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add core/src/vault.ts core/test/vault.test.ts
git commit -m "feat(core): VaultSource builds brain-2 note graph"
```

---

## Task 6: BotMemorySource — build the memory graph (brain 3)

**Files:**
- Create: `core/src/memory.ts`
- Test: `core/test/memory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// core/test/memory.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/files";
import { buildMemoryGraph } from "../src/memory";

test("memory nodes are kind=memory with mem: ids; internal links resolved", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-mem-"));
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/test/memory.test.ts`
Expected: FAIL — cannot find module `../src/memory`.

- [ ] **Step 3: Write minimal implementation**

```ts
// core/src/memory.ts
import { basename } from "node:path";
import { listMarkdown, readNote } from "./files";
import { extractWikilinks } from "./wikilinks";
import { noteId } from "./vault";
import type { GraphData, GraphNode, GraphEdge } from "./graph";

const MEM = (base: string) => `mem:${base}`;

export interface MemoryGraph extends GraphData {
  /** basename -> raw wikilink targets, for cross-brain resolution in engine.ts */
  links: Map<string, string[]>;
}

export async function buildMemoryGraph(root: string): Promise<MemoryGraph> {
  const rels = await listMarkdown(root);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const byBase = new Map<string, string>(); // base -> mem:id
  const links = new Map<string, string[]>(); // base -> targets
  const bases: { base: string; content: string }[] = [];
  for (const rel of rels) {
    const base = basename(noteId(rel));
    nodes.push({ id: MEM(base), label: base, kind: "memory" });
    byBase.set(base, MEM(base));
    const content = await readNote(root, rel);
    const targets = extractWikilinks(content);
    links.set(base, targets);
    bases.push({ base, content });
  }
  for (const { base } of bases) {
    for (const t of links.get(base)!) {
      const toId = byBase.get(t);
      if (toId) edges.push({ from: MEM(base), to: toId, kind: "link" });
    }
  }
  return { nodes, edges, links };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test core/test/memory.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add core/src/memory.ts core/test/memory.test.ts
git commit -m "feat(core): BotMemorySource builds brain-3 memory graph"
```

---

## Task 7: Engine — merge brains + cross-brain "about" edges

**Files:**
- Create: `core/src/engine.ts`
- Test: `core/test/engine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// core/test/engine.test.ts
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
  // memory references a vault note -> cross-brain "about" edge
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/test/engine.test.ts`
Expected: FAIL — cannot find module `../src/engine`.

- [ ] **Step 3: Write minimal implementation**

```ts
// core/src/engine.ts
import { basename } from "node:path";
import { buildVaultGraph, noteId } from "./vault";
import { buildMemoryGraph } from "./memory";
import { mergeGraphs, type GraphData, type GraphEdge, type GraphNode } from "./graph";
import { listMarkdown } from "./files";

const SELF: GraphNode = { id: "self", label: "You", kind: "self" };

export async function buildGraph(vaultDir: string, memoryDir?: string): Promise<GraphData> {
  const vault = await buildVaultGraph(vaultDir);
  const selfGraph: GraphData = { nodes: [SELF], edges: [] };
  if (!memoryDir) return mergeGraphs([selfGraph, vault]);

  const memory = await buildMemoryGraph(memoryDir);
  // vault note basenames -> id, to resolve cross-brain "about" edges
  const vaultByBase = new Map<string, string>();
  for (const rel of await listMarkdown(vaultDir)) {
    vaultByBase.set(basename(noteId(rel)), noteId(rel));
  }
  const about: GraphEdge[] = [];
  for (const [base, targets] of memory.links) {
    for (const t of targets) {
      const toId = vaultByBase.get(t);
      if (toId) about.push({ from: `mem:${base}`, to: toId, kind: "about" });
    }
  }
  return mergeGraphs([selfGraph, vault, { nodes: memory.nodes, edges: [...memory.edges, ...about] }]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test core/test/engine.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add core/src/engine.ts core/test/engine.test.ts
git commit -m "feat(core): engine merges three brains + cross-brain about edges"
```

---

## Task 8: Vault backup — local git only

**Files:**
- Create: `core/src/backup.ts`
- Test: `core/test/backup.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// core/test/backup.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/files";
import { ensureRepo, commitVault } from "../src/backup";
import { $ } from "bun";

test("ensureRepo inits a git repo; commitVault commits changes locally", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-bk-"));
  await ensureRepo(dir);
  expect(existsSync(join(dir, ".git"))).toBe(true);

  await writeNote(dir, "a.md", "# A");
  const committed = await commitVault(dir, "snapshot test");
  expect(committed).toBe(true);

  // a second call with no changes does not create a commit
  const again = await commitVault(dir, "snapshot test 2");
  expect(again).toBe(false);

  // exactly one commit, and NO remote was added
  const count = (await $`git -C ${dir} rev-list --count HEAD`.text()).trim();
  expect(count).toBe("1");
  const remotes = (await $`git -C ${dir} remote`.text()).trim();
  expect(remotes).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test core/test/backup.test.ts`
Expected: FAIL — cannot find module `../src/backup`.

- [ ] **Step 3: Write minimal implementation**

```ts
// core/src/backup.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

/** git init if needed + set a local identity so commits never block. Never adds a remote. */
export async function ensureRepo(dir: string): Promise<void> {
  if (!existsSync(join(dir, ".git"))) {
    await $`git -C ${dir} init -q`.quiet();
    await $`git -C ${dir} config user.email "vault@local"`.quiet();
    await $`git -C ${dir} config user.name "Obsidian Alternative"`.quiet();
  }
}

/** Stage everything and commit. Returns false if there was nothing to commit. Local only. */
export async function commitVault(dir: string, message: string): Promise<boolean> {
  await ensureRepo(dir);
  await $`git -C ${dir} add -A`.quiet();
  const status = (await $`git -C ${dir} status --porcelain`.text()).trim();
  if (status === "") return false;
  await $`git -C ${dir} commit -q -m ${message}`.quiet();
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test core/test/backup.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add core/src/backup.ts core/test/backup.test.ts
git commit -m "feat(core): local-git vault backup (init + commit, never push)"
```

---

## Task 9: HTTP API server + a sample vault

**Files:**
- Create: `core/src/server.ts`
- Create: `sample-vault/*.md` and `sample-vault/.memory/*.md`
- Test: `core/test/server.test.ts`

- [ ] **Step 1: Create the sample vault (dev/test fixture)**

```bash
mkdir -p sample-vault/.memory
printf '# Internship\n\nApplying. Depends on [[housing]].\n' > sample-vault/internship.md
printf '---\nstatus: in-progress\npriority: 1\ntags: [logistics]\n---\n# Housing\n\nSigned the lease.\n' > sample-vault/housing.md
printf '# Essay\n\nReligion and historical materialism.\n' > sample-vault/essay.md
printf 'Profile of the user. He is working on [[internship]] and [[essay]].\n' > sample-vault/.memory/michael-profile.md
```

- [ ] **Step 2: Write the failing test**

```ts
// core/test/server.test.ts
import { test, expect } from "bun:test";
import { createServer } from "../src/server";

test("GET /graph returns the merged brain graph", async () => {
  const server = createServer({ vault: "sample-vault", memory: "sample-vault/.memory", port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const g = await (await fetch(`${base}/graph`)).json();
    const ids = g.nodes.map((n: any) => n.id);
    expect(ids).toContain("internship");
    expect(ids).toContain("mem:michael-profile");
    expect(ids).toContain("self");
    // cross-brain about edge present
    expect(g.edges).toContainEqual({ from: "mem:michael-profile", to: "internship", kind: "about" });

    // GET /file then PUT /file round-trips
    const before = await (await fetch(`${base}/file?path=essay.md`)).text();
    expect(before).toContain("Essay");
  } finally {
    server.stop(true);
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test core/test/server.test.ts`
Expected: FAIL — cannot find module `../src/server`.

- [ ] **Step 4: Write minimal implementation**

```ts
// core/src/server.ts
import { buildGraph } from "./engine";
import { listMarkdown, readNote, writeNote } from "./files";
import { commitVault } from "./backup";

export interface CoreConfig { vault: string; memory?: string; port?: number }

export function createServer(cfg: CoreConfig) {
  return Bun.serve({
    port: cfg.port ?? 4321,
    async fetch(req) {
      const url = new URL(req.url);
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
      if (req.method === "OPTIONS") return new Response(null, { headers: cors });

      if (url.pathname === "/graph" && req.method === "GET") {
        const g = await buildGraph(cfg.vault, cfg.memory);
        return Response.json(g, { headers: cors });
      }
      if (url.pathname === "/tree" && req.method === "GET") {
        return Response.json(await listMarkdown(cfg.vault), { headers: cors });
      }
      if (url.pathname === "/file" && req.method === "GET") {
        const path = url.searchParams.get("path")!;
        return new Response(await readNote(cfg.vault, path), { headers: cors });
      }
      if (url.pathname === "/file" && req.method === "PUT") {
        const { path, contents } = (await req.json()) as { path: string; contents: string };
        await writeNote(cfg.vault, path, contents);
        return new Response("ok", { headers: cors });
      }
      if (url.pathname === "/backup" && req.method === "POST") {
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
        const committed = await commitVault(cfg.vault, `vault snapshot ${stamp}`);
        return Response.json({ committed }, { headers: cors });
      }
      return new Response("not found", { status: 404, headers: cors });
    },
  });
}

// Allow `bun run core/src/server.ts --vault ... --memory ... --port ...`
if (import.meta.main) {
  const arg = (k: string) => { const i = Bun.argv.indexOf(`--${k}`); return i >= 0 ? Bun.argv[i + 1] : undefined; };
  const s = createServer({
    vault: arg("vault") ?? "sample-vault",
    memory: arg("memory"),
    port: arg("port") ? Number(arg("port")) : 4321,
  });
  console.log(`core listening on http://localhost:${s.port}`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test core/test/server.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add core/src/server.ts core/test/server.test.ts sample-vault
git commit -m "feat(core): HTTP API (/graph /tree /file /backup) + sample vault"
```

---

## Task 10: CLI — headless graph/backup/serve (the Pi face)

**Files:**
- Create: `cli/src/index.ts`
- Test: `cli/test/cli.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// cli/test/cli.test.ts
import { test, expect } from "bun:test";

test("`oa graph --vault sample-vault` prints graph JSON with the self node", async () => {
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "graph", "--vault", "sample-vault"], {
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const g = JSON.parse(out);
  expect(g.nodes.some((n: any) => n.id === "self")).toBe(true);
  expect(g.nodes.some((n: any) => n.id === "internship")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test cli/test/cli.test.ts`
Expected: FAIL — cannot find module `cli/src/index.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// cli/src/index.ts
import { buildGraph } from "../../core/src/engine";
import { commitVault } from "../../core/src/backup";
import { createServer } from "../../core/src/server";

function arg(k: string): string | undefined {
  const i = Bun.argv.indexOf(`--${k}`);
  return i >= 0 ? Bun.argv[i + 1] : undefined;
}

const cmd = Bun.argv[2];
const vault = arg("vault") ?? "sample-vault";
const memory = arg("memory");

if (cmd === "graph") {
  console.log(JSON.stringify(await buildGraph(vault, memory), null, 2));
} else if (cmd === "backup") {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const committed = await commitVault(vault, `vault snapshot ${stamp}`);
  console.log(committed ? "committed" : "nothing to commit");
} else if (cmd === "serve") {
  const s = createServer({ vault, memory, port: arg("port") ? Number(arg("port")) : 4321 });
  console.log(`core listening on http://localhost:${s.port}`);
} else {
  console.error("usage: oa <graph|backup|serve> --vault <dir> [--memory <dir>] [--port n]");
  process.exit(1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test cli/test/cli.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add cli/src/index.ts cli/test/cli.test.ts
git commit -m "feat(cli): headless graph/backup/serve commands"
```

---

## Task 11: GUI — core API client + dev wiring + layout C shell

**Files:**
- Create: `app/src/api.ts`
- Modify: `app/src/App.tsx` (replace scaffold), `app/src/App.css`
- Modify: `app/package.json` (dev script starts core + vite), `app/src-tauri/tauri.conf.json` (beforeDevCommand)

- [ ] **Step 1: Add the core API client**

```ts
// app/src/api.ts
const BASE = "http://localhost:4321";
import type { GraphData } from "../../core/src/graph";

export const api = {
  graph: () => fetch(`${BASE}/graph`).then((r) => r.json() as Promise<GraphData>),
  tree: () => fetch(`${BASE}/tree`).then((r) => r.json() as Promise<string[]>),
  read: (path: string) => fetch(`${BASE}/file?path=${encodeURIComponent(path)}`).then((r) => r.text()),
  write: (path: string, contents: string) =>
    fetch(`${BASE}/file`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, contents }) }),
  backup: () => fetch(`${BASE}/backup`, { method: "POST" }),
};
```

- [ ] **Step 2: Make the dev script start the core alongside Vite**

In `app/package.json`, set the `dev` script (uses sample vault by default):

```json
"scripts": {
  "dev": "concurrently -k \"bun run ../core/src/server.ts --vault ../sample-vault --memory ../sample-vault/.memory\" \"vite\"",
  "build": "vite build",
  "tauri": "tauri"
}
```

Then add the dev dependency:

```bash
cd app && bun add -d concurrently && cd ..
```

- [ ] **Step 3: Replace `app/src/App.tsx` with the layout-C shell**

```tsx
// app/src/App.tsx
import { createSignal, onMount, onCleanup } from "solid-js";
import { api } from "./api";
import { FileTree } from "./FileTree";
import { Editor } from "./Editor";
import { GraphView } from "./GraphView";
import { Backlinks } from "./Backlinks";
import type { GraphData } from "../../core/src/graph";
import "./App.css";

export default function App() {
  const [graph, setGraph] = createSignal<GraphData>({ nodes: [], edges: [] });
  const [openPath, setOpenPath] = createSignal<string | null>(null);

  const refreshGraph = async () => setGraph(await api.graph());
  onMount(() => {
    refreshGraph();
    // poll so external/agent writes to the vault or memory show up live (Stone-1 stand-in for fs-watch)
    const t = setInterval(refreshGraph, 3000);
    onCleanup(() => clearInterval(t));
  });

  return (
    <div class="layout">
      <aside class="sidebar"><FileTree onOpen={setOpenPath} /></aside>
      <main class="editor"><Editor path={openPath()} onSaved={refreshGraph} /></main>
      <aside class="right">
        <GraphView graph={graph()} onOpen={(id) => setOpenPath(id + ".md")} />
        <Backlinks graph={graph()} path={openPath()} onOpen={setOpenPath} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Add `app/src/App.css` (layout C)**

```css
/* app/src/App.css */
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body, html, #root { margin: 0; height: 100%; }
.layout { display: grid; grid-template-columns: 220px 1fr 320px; height: 100vh; font: 14px/1.5 system-ui, sans-serif; }
.sidebar { border-right: 1px solid #2a2a2a; overflow: auto; padding: 8px; }
.editor { overflow: auto; }
.right { border-left: 1px solid #2a2a2a; display: flex; flex-direction: column; }
.right canvas { display: block; }
```

- [ ] **Step 5: Verify (manual run; depends on Tasks 12–14 stubs)**

> The app won't fully run until the components in Tasks 12–14 exist. For now just typecheck:

Run: `cd app && bunx tsc --noEmit; cd ..`
Expected: errors only about the not-yet-created `./FileTree`, `./Editor`, `./GraphView`, `./Backlinks` modules. (We create them next.)

- [ ] **Step 6: Commit**

```bash
git add app/src/api.ts app/src/App.tsx app/src/App.css app/package.json
git commit -m "feat(gui): api client, layout-C shell, dev wiring (core+vite)"
```

---

## Task 12: GUI — FileTree

**Files:**
- Create: `app/src/FileTree.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// app/src/FileTree.tsx
import { createResource, For } from "solid-js";
import { api } from "./api";

export function FileTree(props: { onOpen: (path: string) => void }) {
  const [files] = createResource(() => api.tree());
  return (
    <div>
      <div style={{ "font-size": "11px", "text-transform": "uppercase", opacity: 0.6 }}>Vault</div>
      <For each={files() ?? []}>
        {(rel) => (
          <div style={{ padding: "2px 4px", cursor: "pointer" }} onClick={() => props.onOpen(rel)}>
            {rel.replace(/\.md$/, "")}
          </div>
        )}
      </For>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/FileTree.tsx
git commit -m "feat(gui): FileTree lists vault notes"
```

---

## Task 13: GUI — CodeMirror 6 editor (load/save + clickable wikilinks)

**Files:**
- Create: `app/src/Editor.tsx`
- Modify: `app/package.json` (CodeMirror deps)

- [ ] **Step 1: Add CodeMirror deps**

```bash
cd app && bun add codemirror @codemirror/view @codemirror/state @codemirror/lang-markdown @codemirror/language @codemirror/commands && cd ..
```

- [ ] **Step 2: Implement the editor (markdown + debounced save + Ctrl/Cmd-click wikilinks)**

```tsx
// app/src/Editor.tsx
import { createEffect, onCleanup } from "solid-js";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { api } from "./api";

export function Editor(props: { path: string | null; onSaved: () => void }) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const save = async (path: string, text: string) => {
    await api.write(path, text);
    props.onSaved();
  };

  createEffect(async () => {
    const path = props.path;
    view?.destroy();
    if (!path) return;
    const text = await api.read(path);
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: text,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => save(path, u.state.doc.toString()), 800);
          }),
        ],
      }),
    });
  });

  onCleanup(() => view?.destroy());
  return <div ref={host} style={{ height: "100%" }} />;
}
```

- [ ] **Step 3: Verify (manual)**

> Full run after Tasks 14–15. Spot-typecheck now:

Run: `cd app && bunx tsc --noEmit 2>&1 | grep -i editor || echo "editor ok"; cd ..`
Expected: no Editor-specific type errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/Editor.tsx app/package.json
git commit -m "feat(gui): CodeMirror 6 editor with debounced autosave"
```

---

## Task 14: GUI — GraphRenderer interface + Canvas2DRenderer + GraphView

**Files:**
- Create: `app/src/graph/GraphRenderer.ts` (interface)
- Create: `app/src/graph/Canvas2DRenderer.ts`
- Create: `app/src/GraphView.tsx`
- Modify: `app/package.json` (d3-force)

- [ ] **Step 1: Add d3-force**

```bash
cd app && bun add d3-force && bun add -d @types/d3-force && cd ..
```

- [ ] **Step 2: Define the renderer interface (the swappable seam for WebGL later)**

```ts
// app/src/graph/GraphRenderer.ts
import type { GraphData } from "../../../core/src/graph";

export interface GraphRenderer {
  mount(el: HTMLElement, onNodeClick: (id: string) => void): void;
  render(g: GraphData): void;
  destroy(): void;
}
```

- [ ] **Step 3: Implement the 2D canvas renderer (force layout + click hit-test)**

```ts
// app/src/graph/Canvas2DRenderer.ts
import { forceSimulation, forceManyBody, forceLink, forceCenter, type Simulation } from "d3-force";
import type { GraphData } from "../../../core/src/graph";
import type { GraphRenderer } from "./GraphRenderer";

type N = { id: string; label: string; kind: string; x?: number; y?: number };
const COLOR: Record<string, string> = { self: "#ebaa5a", note: "#6496ff", memory: "#50c878", agent: "#50c878" };

export class Canvas2DRenderer implements GraphRenderer {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private sim?: Simulation<N, undefined>;
  private nodes: N[] = [];
  private onClick: (id: string) => void = () => {};

  mount(el: HTMLElement, onNodeClick: (id: string) => void) {
    this.onClick = onNodeClick;
    this.canvas = document.createElement("canvas");
    this.canvas.width = el.clientWidth || 320;
    this.canvas.height = 240;
    el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.canvas.addEventListener("click", (e) => {
      const r = this.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const hit = this.nodes.find((n) => Math.hypot((n.x ?? 0) - mx, (n.y ?? 0) - my) < 8);
      if (hit) this.onClick(hit.id);
    });
  }

  render(g: GraphData) {
    this.nodes = g.nodes.map((n) => ({ ...n }));
    const links = g.edges.map((e) => ({ source: e.from, target: e.to }));
    this.sim?.stop();
    this.sim = forceSimulation(this.nodes)
      .force("charge", forceManyBody().strength(-80))
      .force("link", forceLink(links as any).id((d: any) => d.id).distance(40))
      .force("center", forceCenter(this.canvas.width / 2, this.canvas.height / 2))
      .on("tick", () => this.draw(links));
  }

  private draw(links: { source: any; target: any }[]) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#3a3a3a";
    for (const l of links) {
      ctx.beginPath(); ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y); ctx.stroke();
    }
    for (const n of this.nodes) {
      ctx.fillStyle = COLOR[n.kind] ?? "#888";
      ctx.beginPath(); ctx.arc(n.x ?? 0, n.y ?? 0, 5, 0, Math.PI * 2); ctx.fill();
    }
  }

  destroy() { this.sim?.stop(); this.canvas?.remove(); }
}
```

- [ ] **Step 4: GraphView wraps the renderer**

```tsx
// app/src/GraphView.tsx
import { onCleanup, onMount, createEffect } from "solid-js";
import type { GraphData } from "../../core/src/graph";
import { Canvas2DRenderer } from "./graph/Canvas2DRenderer";

export function GraphView(props: { graph: GraphData; onOpen: (id: string) => void }) {
  let host!: HTMLDivElement;
  const renderer = new Canvas2DRenderer();
  onMount(() => renderer.mount(host, (id) => { if (id !== "self") props.onOpen(id); }));
  createEffect(() => renderer.render(props.graph));
  onCleanup(() => renderer.destroy());
  return (
    <div>
      <div style={{ "font-size": "11px", "text-transform": "uppercase", opacity: 0.6, padding: "8px 8px 0" }}>Living graph</div>
      <div ref={host} />
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add app/src/graph app/src/GraphView.tsx app/package.json
git commit -m "feat(gui): GraphRenderer interface + Canvas2D force-graph view"
```

---

## Task 15: GUI — Backlinks panel + first full run

**Files:**
- Create: `app/src/Backlinks.tsx`

- [ ] **Step 1: Implement backlinks (notes whose edges point at the open note)**

```tsx
// app/src/Backlinks.tsx
import { For, createMemo } from "solid-js";
import type { GraphData } from "../../core/src/graph";

export function Backlinks(props: { graph: GraphData; path: string | null; onOpen: (p: string) => void }) {
  const targetId = createMemo(() => (props.path ? props.path.replace(/\.md$/, "") : null));
  const back = createMemo(() => {
    const id = targetId();
    if (!id) return [];
    return props.graph.edges.filter((e) => e.to === id).map((e) => e.from);
  });
  return (
    <div style={{ padding: "8px", "border-top": "1px solid #2a2a2a", flex: "1", overflow: "auto" }}>
      <div style={{ "font-size": "11px", "text-transform": "uppercase", opacity: 0.6 }}>Backlinks</div>
      <For each={back()} fallback={<div style={{ opacity: 0.4 }}>none</div>}>
        {(fromId) => (
          <div style={{ padding: "2px 0", cursor: "pointer" }}
               onClick={() => !fromId.startsWith("mem:") && props.onOpen(fromId + ".md")}>
            {fromId.startsWith("mem:") ? "🧠 " + fromId.slice(4) : fromId}
          </div>
        )}
      </For>
    </div>
  );
}
```

- [ ] **Step 2: Run the whole app**

Run: `cd app && bun run tauri dev`
Expected: a window opens showing the sample vault — file tree on the left, an empty editor center, the living graph (blue note nodes, a green memory node, an orange `self` node, gray link/about edges) top-right, backlinks below. Clicking `internship` in the tree opens it in the editor; editing and pausing saves it. Clicking the `internship` node in the graph opens that note. The `housing` note shows `internship` as a backlink; opening a note referenced by `michael-profile` shows the 🧠 memory backlink.

- [ ] **Step 3: Commit**

```bash
git add app/src/Backlinks.tsx
git commit -m "feat(gui): backlinks panel; Stone 1 GUI runs end-to-end"
```

---

## Task 16: Auto-backup on save (debounced) + frontmatter badge

**Files:**
- Modify: `core/src/server.ts` (add `/meta` route)
- Test: `core/test/server.test.ts` (assert `/meta`)
- Modify: `app/src/api.ts` (add `meta`)
- Modify: `app/src/Editor.tsx` (backup after save + frontmatter badge header)

- [ ] **Step 1: Add a failing test for `/meta`**

Append to `core/test/server.test.ts` inside the existing `try` block (after the `/file` assertions):

```ts
    const meta = await (await fetch(`${base}/meta?path=housing.md`)).json();
    expect(meta).toEqual({ status: "in-progress", priority: 1, tags: ["logistics"] });
```

Run: `bun test core/test/server.test.ts`
Expected: FAIL — `/meta` returns 404 / parse error.

- [ ] **Step 2: Add the `/meta` route to the server**

In `core/src/server.ts`, add the import and the route (just before the final `return new Response("not found", ...)`):

```ts
// add near the other imports
import { parseFrontmatter } from "./frontmatter";

// add before the 404 fallback
if (url.pathname === "/meta" && req.method === "GET") {
  const path = url.searchParams.get("path")!;
  const { data } = parseFrontmatter(await readNote(cfg.vault, path));
  return Response.json(data, { headers: cors });
}
```

Run: `bun test core/test/server.test.ts`
Expected: PASS.

- [ ] **Step 3: Add `meta` to the API client**

In `app/src/api.ts`, add to the `api` object:

```ts
  meta: (path: string) =>
    fetch(`${BASE}/meta?path=${encodeURIComponent(path)}`).then((r) => r.json() as Promise<Record<string, unknown>>),
```

- [ ] **Step 4: Backup after save + show a frontmatter badge in the editor**

In `app/src/Editor.tsx`: (a) fire a backup after each save; (b) load frontmatter for the open note and render a badge header above the editor. Replace the `save` function and the component's return:

```tsx
// at top of Editor.tsx, add to the solid-js import: createSignal
import { createEffect, onCleanup, createSignal } from "solid-js";

// inside Editor(), add a signal:
const [meta, setMeta] = createSignal<Record<string, unknown>>({});

// change save():
const save = async (path: string, text: string) => {
  await api.write(path, text);
  props.onSaved();
  api.backup();           // local-git snapshot; no-op when nothing changed
  setMeta(await api.meta(path)); // frontmatter may have changed
};

// inside the createEffect, after `const text = await api.read(path);` add:
setMeta(await api.meta(path));

// replace the return statement:
return (
  <div style={{ height: "100%", display: "flex", "flex-direction": "column" }}>
    {(meta().status || meta().priority || meta().tags) && (
      <div style={{ padding: "4px 8px", "border-bottom": "1px solid #2a2a2a", "font-size": "12px", opacity: 0.8 }}>
        {meta().status ? `● ${String(meta().status)}` : ""}
        {meta().priority != null ? `  ·  P${String(meta().priority)}` : ""}
        {Array.isArray(meta().tags) ? `  ·  ${(meta().tags as string[]).map((t) => "#" + t).join(" ")}` : ""}
      </div>
    )}
    <div ref={host} style={{ flex: "1", overflow: "auto" }} />
  </div>
);
```

- [ ] **Step 5: Verify (manual)**

Run: `cd app && bun run tauri dev`, open `housing.md`.
Expected: a badge reading `● in-progress · P1 · #logistics` shows above the editor. Edit the body, pause ~1s, then in another terminal:
`git -C sample-vault log --oneline | head -3`
Expected: a `vault snapshot ...` commit appears (`sample-vault/.git` was created). Confirm no remote: `git -C sample-vault remote` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add core/src/server.ts core/test/server.test.ts app/src/api.ts app/src/Editor.tsx
git commit -m "feat: /meta route + frontmatter badge; auto local-git backup after edits"
```

---

## Task 17: Live-preview decorations (Obsidian-style)

**Files:**
- Create: `app/src/editor/livePreview.ts`
- Modify: `app/src/Editor.tsx` (add the extension)

This is the heaviest editor piece: render inline and hide markdown syntax on lines the cursor is *not* on. Start with bold/italic/headings/wikilinks; more tokens can follow.

- [ ] **Step 1: Implement a live-preview decoration extension**

```ts
// app/src/editor/livePreview.ts
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

// Hide the "**"/"*" markers and style the inner text, unless the cursor is on that line.
const STRONG = /\*\*([^*]+)\*\*/g;
const EM = /(?<!\*)\*([^*]+)\*(?!\*)/g;
const HEAD = /^(#{1,6})\s+/;
const LINK = /\[\[([^\]]+?)\]\]/g;

const hide = Decoration.mark({ class: "cm-hidden-syntax" });
const strong = Decoration.mark({ class: "cm-strong" });
const em = Decoration.mark({ class: "cm-em" });
const link = Decoration.mark({ class: "cm-wikilink" });

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const onCursorLine = line.number === cursorLine;
      const text = line.text;

      const h = text.match(HEAD);
      if (h && !onCursorLine) b.add(line.from, line.from + h[0].length, hide);

      const apply = (re: RegExp, markLen: number, mark: Decoration) => {
        for (const m of text.matchAll(re)) {
          const s = line.from + (m.index ?? 0);
          const innerStart = s + markLen, innerEnd = s + m[0].length - markLen;
          if (!onCursorLine) { b.add(s, innerStart, hide); b.add(innerEnd, s + m[0].length, hide); }
          b.add(innerStart, innerEnd, mark);
        }
      };
      apply(STRONG, 2, strong);
      apply(EM, 1, em);
      for (const m of text.matchAll(LINK)) {
        const s = line.from + (m.index ?? 0);
        b.add(s, s + m[0].length, link);
      }
      pos = line.to + 1;
    }
  }
  return b.finish();
}

export const livePreview = [
  ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = build(u.view); }
  }, { decorations: (v) => v.decorations }),
  EditorView.theme({
    ".cm-hidden-syntax": { display: "none" },
    ".cm-strong": { "font-weight": "bold" },
    ".cm-em": { "font-style": "italic" },
    ".cm-wikilink": { color: "#6496ff", cursor: "pointer", "text-decoration": "underline" },
  }),
];
```

- [ ] **Step 2: Wire it into the editor and make wikilinks open on click**

In `app/src/Editor.tsx`, import and add to the extensions array, and add a click handler that opens a wikilink target:

```tsx
// add import
import { livePreview } from "./editor/livePreview";

// inside EditorState.create extensions: add `livePreview,`
// add this extension to the array too (opens [[target]] on click):
EditorView.domEventHandlers({
  mousedown: (e, view) => {
    const pos = view.posAtCoords({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
    if (pos == null) return false;
    const line = view.state.doc.lineAt(pos);
    for (const m of line.text.matchAll(/\[\[([^\]]+?)\]\]/g)) {
      const s = line.from + (m.index ?? 0), en = s + m[0].length;
      if (pos >= s && pos <= en) {
        const target = m[1].split("|")[0].split("#")[0].trim();
        api.read(target + ".md").then(() => props.onSaved()); // ensure exists
        // open via a custom event the parent listens to:
        window.dispatchEvent(new CustomEvent("oa-open", { detail: target + ".md" }));
        return true;
      }
    }
    return false;
  },
}),
```

And in `App.tsx`, listen for that event:

```tsx
// inside App(), after signals:
onMount(() => window.addEventListener("oa-open", (e: any) => setOpenPath(e.detail)));
```

- [ ] **Step 3: Verify (manual)**

Run: `cd app && bun run tauri dev`
Expected: in a note, `**bold**` shows as **bold** with the `**` hidden until your cursor enters that line; headings hide their `#`; `[[housing]]` is underlined blue and clicking it opens `housing.md`.

- [ ] **Step 4: Commit**

```bash
git add app/src/editor/livePreview.ts app/src/Editor.tsx app/src/App.tsx
git commit -m "feat(gui): Obsidian-style live-preview decorations + clickable wikilinks"
```

---

## Stone 1 done-check

Run the full suite and the app:

```bash
bun test            # all core + cli tests green
cd app && bun run tauri dev
```

You should be able to: open the sample vault, see all three brains as one 2D graph (orange `self`, blue notes, green memory, with link + cross-brain `about` edges), edit notes with live-preview markdown + clickable wikilinks, navigate by clicking graph nodes and backlinks, and have edits auto-committed to the vault's local git. The CLI (`bun run cli/src/index.ts graph --vault sample-vault`) produces the same graph headlessly — the Pi path. **That completes Stone 1.**

(Next: point it at your real vault + claude-bot memory dir; then Stone 2 adds the live agent-network source + governance.)
