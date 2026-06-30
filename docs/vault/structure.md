# Vault Structure

This document covers how Bismuth models a vault: the markdown file tree that constitutes the "2nd brain," how notes are discovered and turned into graph nodes and edges (the two-pass algorithm in `buildVaultGraph`), the shared `buildGraphFromNotes` helper, the file types recognized in the sidebar tree, path-traversal safety, and every public function exported by `files.ts`, `vault.ts`, and `graphBuilder.ts`.

---

## What Is a Vault?

A vault is an ordinary directory of files on disk — no database, no sidecar index. The primary content is `.md` (Markdown) files. The backend also recognizes `.draw`, `.sheet`, `.yaml`/`.yml` as first-class vault files, and silently ignores everything else (images, PDFs, `.txt`, etc.) when building the sidebar tree.

The path to the vault is supplied via the `BISMUTH_VAULT` environment variable or the `--vault` CLI flag. There is no default; the server refuses to start without it.

---

## File Types Recognized

`listTree` (the sidebar tree) recognizes the following extensions:

| Extension | Kind | Notes |
|---|---|---|
| `.md` | `file` | Primary note format. `icon` frontmatter surfaced on the tree entry. |
| `.draw` | `file` | Vector drawing; always receives `icon: "PenTool"` in the tree entry. |
| `.sheet` | `file` | Univer spreadsheet JSON snapshot. |
| `.yaml` / `.yml` | `file` | YAML files (e.g. `settings.yaml`). |
| Directory | `dir` | All non-dotfile directories are included. |

### Explicitly excluded by `listTree`

- `.draw.png` and `.draw.pdf` — generated export sidecars of `.draw` files; hidden from the tree so they do not appear as siblings of the drawing.
- Any file starting with `.` (dotfiles) or any directory starting with `.` (e.g. `.trash`, `.git`). The dot-skip applies at every level of the recursive walk.
- All other extensions (`.png`, `.pdf`, `.txt`, etc.) are silently dropped.

### `listMarkdown` — only `.md` files

`listMarkdown` is a tighter scan used solely for graph construction. It returns only `.md` files, never directories or other types. It uses `Bun.Glob("**/*.md")` with `dot: false`, so it also skips dotfiles automatically.

```ts
// core/src/files.ts
export async function listMarkdown(root: string): Promise<string[]>
// Returns vault-relative paths: ["a.md", "reading/My Note.md", ...]
```

---

## Path Decomposition: `pathParts`

Every `.md` path is decomposed by `pathParts` in `vault.ts`. The result drives the graph node's `label`, `folder`, and id fields.

```ts
export function pathParts(rel: string): {
  name: string;       // basename without extension
  ext: string;        // extension without dot
  folder: string;     // full directory path (empty string at vault root)
  basename: string;   // same as name (alias)
  topFolder: string;  // first path segment, or "(root)" at vault root
}
```

### Examples (from test suite)

| Relative path | `name` | `folder` | `topFolder` |
|---|---|---|---|
| `x.md` | `"x"` | `""` | `"(root)"` |
| `reading/My Note.md` | `"My Note"` | `"reading"` | `"reading"` |
| `reading/quotes/deep.md` | `"deep"` | `"reading/quotes"` | `"reading"` |
| `a/b/c/d/deep.md` | `"deep"` | `"a/b/c/d"` | `"a"` |
| `projects/work/task1.md` | `"task1"` | `"projects/work"` | `"projects"` |

**Key rule**: `topFolder` is always the first path segment regardless of nesting depth. A note at `a/b/c/d/deep.md` gets `folder: "a"`, not `"a/b/c/d"`. Root-level notes get `folder: "(root)"`.

### Note id: `noteId`

```ts
export function noteId(rel: string): string
// "reading/My Note.md" → "reading/My Note"
// "x.md"              → "x"
```

The note id is the vault-relative path with the `.md` extension stripped (case-insensitive). This is what appears as `GraphNode.id` and in all edge references.

---

## Two-Pass Graph Construction: `buildVaultGraph`

`buildVaultGraph(root: string): Promise<VaultGraphResult>` is the main entry point for building the vault knowledge graph. It is built on top of `buildGraphFromNotes` (see below).

### What it returns

```ts
export interface VaultGraphResult {
  graph: GraphData;         // { nodes: GraphNode[], edges: GraphEdge[] }
  byBase: Map<string, string>; // basename (no .md) → note id
  byPath: Map<string, string>; // full rel path (no .md) → note id
}
```

### Pass 1 — Node creation

For every `.md` file discovered by `listMarkdown`:

1. Compute `noteId(rel)` — this becomes `GraphNode.id`.
2. Call `pathParts(rel)` — `parts.name` becomes `label`; `parts.topFolder` becomes `folder`.
3. Push a `GraphNode` with `kind: "note"`.
4. Index the node in `byBase` (basename → id) and `byPath` (full path minus extension → id).

```ts
// Resulting node shape for "reading/My Note.md":
{
  id: "reading/My Note",
  label: "My Note",
  kind: "note",
  folder: "reading",
}
```

All files are read in **parallel** (via `Promise.all`) between pass 1 and pass 2 so the wall time for a large vault is bounded by the slowest single read, not their sum.

### Pass 2 — Edge extraction

For each note, the content is scanned for:

1. **Wikilinks** — extracted by `extractWikilinks(content)`. Each `[[target]]` is resolved to a note id (see "Wikilink Resolution" below). If the target resolves, a `{ from, to, kind: "link" }` edge is pushed. Unresolvable targets (links to notes that do not exist) produce **no edge** — broken links are silently dropped.

2. **Tags** — extracted by `extractTags(data, body)` from both YAML frontmatter and the markdown body. For each tag:
   - A `GraphNode` with `kind: "tag"`, `id: "tag:<name>"`, and `label: "#<name>"` is lazily created the first time the tag is seen (deduplicated across all notes).
   - A `{ from: noteId, to: "tag:<name>", kind: "tag" }` edge is pushed.

### Tag node shape

```ts
// For tag "foo":
{ id: "tag:foo", label: "#foo", kind: "tag" }
```

Tag nodes are collected in a separate `Map<string, GraphNode>` during pass 2 and merged into `graph.nodes` at the end. This ensures each tag has exactly one node regardless of how many notes reference it.

### What does NOT produce edges

- Wikilinks inside fenced code blocks (` ``` `) — `extractWikilinks` skips code fences.
- Wikilinks to non-existent notes (broken links).
- Circular links (`[[self]]` inside `self.md`) — the edge is created but there is no dedup; the test suite documents that self-links are present in the graph if the wikilink resolves.

### Edge to duplicate links

If a note contains `[[target]] [[target]] [[target]]`, the current implementation emits one edge per `extractWikilinks` match — there is no dedup at the edge level. The test suite marks this as implementation-defined (`expect(dupEdges.length).toBeGreaterThan(0)`).

---

## Wikilink Resolution: `resolveLinkTarget`

```ts
export function resolveLinkTarget(
  target: string,
  byBase: Map<string, string>,
  byPath: Map<string, string>,
): string | undefined
```

Resolution order (mirrors the editor's `resolveNotePath`):

1. **Exact path match**: look up `target` in `byPath` (e.g. `"reading/My Note"` for `[[reading/My Note]]`).
2. **Basename fallback**: look up `target` in `byBase` (e.g. `"My Note"` for `[[My Note]]`).
3. Returns `undefined` if neither resolves.

### Resolution examples (from test suite)

```
[[My Note]]          → resolves via byBase → "reading/My Note"
[[reading/My Note]]  → resolves via byPath → "reading/My Note"  (wins over basename collision)
[[ghost]]            → undefined (no node)  → no edge
```

When two notes share the same basename (e.g. `reading/Note.md` and `writing/Note.md`), a path-qualified link `[[reading/Note]]` resolves exactly to `reading/Note`. A bare `[[Note]]` resolves to whichever was indexed last in the iteration order — the result is undefined for ambiguous bare links.

---

## Shared Builder: `buildGraphFromNotes`

```ts
// core/src/graphBuilder.ts
export async function buildGraphFromNotes(
  root: string,
  nodeBuilder: (relPath: string) => GraphNode,
  edgeExtractor: (
    nodeId: string,
    content: string,
    byBase: Map<string, string>,
    byPath: Map<string, string>,
  ) => GraphEdge[],
): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
  byBase: Map<string, string>;
  byPath: Map<string, string>;
}>
```

This function implements the canonical two-pass graph construction pattern shared by both `vault.ts` and `memory.ts`. Pass 1 builds nodes and index maps; pass 2 reads all files in parallel and calls `edgeExtractor` per note.

### FileAccess seam

`buildGraphFromNotes` does not call `files.ts` / `Bun` / `node:fs` directly. It routes all I/O through the `FileAccess` interface from `fileAccess.ts`. On desktop/Bun the default impl is lazy-loaded from `files.ts`; on iPad it is swapped for a `tauri-plugin-fs`-backed impl via `setFileAccess()`. This means:

- Tests can inject a fully in-memory vault with no disk access (see `graphBuilder.test.ts`).
- The WebView bundle never statically depends on `Bun.Glob` or `node:fs`.

### Minimal usage example (from test)

```ts
import { buildGraphFromNotes } from "../src/graphBuilder";
import { setFileAccess } from "../src/fileAccess";

setFileAccess({
  listMarkdown: async () => ["a.md", "b.md"],
  readNote: async (_root, rel) =>
    rel === "a.md" ? "links to [[b]]" : "leaf note",
  // ... other FileAccess methods
});

const { nodes, edges, byBase } = await buildGraphFromNotes(
  "/ignored-root",
  (rel) => ({ id: rel.replace(/\.md$/, ""), label: rel, kind: "note" }),
  (nodeId, content, byBase) => {
    const out = [];
    for (const m of content.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const target = byBase.get(m[1]);
      if (target) out.push({ from: nodeId, to: target, kind: "link" });
    }
    return out;
  },
);
// nodes: [{id:"a",...}, {id:"b",...}]
// edges: [{from:"a", to:"b", kind:"link"}]
```

---

## `listTree` — Sidebar File Tree

```ts
export async function listTree(root: string): Promise<TreeEntry[]>
```

Returns a flat list of `TreeEntry` objects representing the vault sidebar:

```ts
interface TreeEntry {
  path: string;         // vault-relative path
  icon?: string;        // frontmatter `icon` for .md files; "PenTool" for .draw
  kind: "file" | "dir";
}
```

### Walk behavior

- All non-dotfile directories are always recursed.
- Dotfile directories (`.trash`, `.git`, etc.) are skipped entirely — their contents never appear.
- Results preserve filesystem iteration order (not sorted).

### Icon extraction for `.md` files

`listTree` reads each `.md` file's frontmatter to extract the optional `icon` field. This is mtime-cached to avoid re-parsing files that have not changed:

- On first encounter (or after a file's mtime changes), the file is read + frontmatter-parsed.
- The cache key is the absolute file path; the value is `{ mtime, icon }`.
- Only string-valued `icon` frontmatter is surfaced — arrays, numbers, or any non-string type produce no `icon` field on the `TreeEntry`.
- The cache is module-level (persistent across requests) and self-healing: changed files automatically re-parse on the next `listTree` call.

### `.draw` files

`.draw` files always receive `icon: "PenTool"` regardless of their content. No frontmatter is read for `.draw` files.

### Excluded from tree

- `.draw.png` and `.draw.pdf` (export sidecars).
- Any dotfile or dotfile directory at any depth.
- All file types other than `.md`, `.draw`, `.sheet`, `.yaml`, `.yml`.

### Example output

```ts
// vault/
//   fancy.md  (icon: "🚀" in frontmatter)
//   plain.md
//   projects/  (directory)
//     inner.md
//   sketch.draw

await listTree("/vault")
// [
//   { path: "fancy.md",          kind: "file", icon: "🚀" },
//   { path: "plain.md",          kind: "file" },
//   { path: "projects",          kind: "dir"  },
//   { path: "projects/inner.md", kind: "file" },
//   { path: "sketch.draw",       kind: "file", icon: "PenTool" },
// ]
```

---

## `walkDir` — Internal Recursive Directory Walker

```ts
async function walkDir<T>(
  absRoot: string,
  filter: (entry: Dirent, rel: string) => boolean | { data: T },
): Promise<Array<{ name: string; rel: string; isDir: boolean; data?: T }>>
```

Used internally by `listTree`, `resolveAsset`, and `listTemplates`. Not exported publicly.

**Filter semantics**:

- Return `true` — include the entry (no attached data).
- Return `false` — skip the entry (but directories are still recursed even if filtered out).
- Return `{ data: T }` — include the entry with `data` attached to the result.

**Dotfile skip**: any entry whose `name` starts with `"."` is skipped entirely (not recursed, not included).

**Directory recursion**: directories are always recursed regardless of the filter's return value. Filtering a directory only controls whether it appears in the output; it does not prune the walk.

---

## Path-Traversal Safety: `resolveInVault`

All file operations in `files.ts` route through the internal `resolveInVault(root, rel)` function before any disk I/O:

```ts
function resolveInVault(root: string, rel: string): string {
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, rel);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    throw createError("EINVAL", `path escapes vault: ${rel}`);
  }
  return abs;
}
```

This rejects any path that escapes the vault root after `node:path`'s `resolve()` canonicalizes `..` components and absolute paths:

- `../escape.md` → throws `EINVAL` ("path escapes vault")
- `/etc/passwd` → throws `EINVAL`
- `../../etc/hosts` → throws `EINVAL`
- `sub/folder/note.md` → accepted

All public functions that accept a `rel` argument — `readNote`, `writeNote`, `resolveAsset`, `writeBinary`, `uniqueAssetPath`, `deleteEntry`, `createEntry`, `moveEntry`, `listTemplates` — call `resolveInVault` before any I/O.

`resolveAsset` additionally has a special case: if the exact-path lookup would escape the vault, it silently falls through to the basename search instead of throwing, since embed targets from note content should not crash the server.

---

## File Operation Functions

### `readNote(root, rel): Promise<string>`

Read a vault file as UTF-8 text. Throws `EINVAL` if `rel` escapes the vault. Preserves exact bytes including Unicode (`你好世界`, emoji, etc.) and trailing newlines.

### `writeNote(root, rel, contents): Promise<void>`

Write UTF-8 text to a vault file, creating parent directories as needed via `mkdirSync(..., { recursive: true })`. Overwrites existing files. Path-traversal guarded.

### `createEntry(root, path, kind): void`

Create a new empty file (`kind: "file"`) or directory (`kind: "dir"`). Parent directories are created automatically. Throws `EEXIST` (409) if the path already exists.

### `deleteEntry(root, path): { trashPath: string }`

Move a file or folder into `.trash/<timestamp>-<basename>` within the vault. Returns the vault-relative trash path so callers can display it or offer undo. `.trash` itself starts with a dot so `listTree` hides it. Throws `ENOENT` (404) if the path does not exist.

```ts
const { trashPath } = deleteEntry(root, "note.md");
// trashPath === ".trash/1717123456789-note.md"
// The note is now at root/.trash/1717123456789-note.md
```

### `moveEntry(root, from, to): void`

Rename or move a file or directory. Atomically via `renameSync`. Creates the destination's parent directory. Throws:

- `EINVAL` if either path escapes the vault or if `to` is a descendant of `from`.
- `ENOENT` (404) if `from` does not exist.
- `EEXIST` (409) if `to` already exists (no overwrite).

### `resolveAsset(root, target): Promise<string | null>`

Resolve an embed target (`![[target]]`) to an absolute file path. Resolution order:

1. Strip a trailing `#fragment` (e.g. `#page=3` in PDF embeds) and `|size` (e.g. `|400x300`).
2. Exact vault-relative path lookup (handles `attachments/foo.png` and root-level files).
3. Filename-first fallback: first file in the vault tree whose basename equals the target's last path segment.

Returns `null` if nothing matches.

### `writeBinary(root, rel, bytes): Promise<void>`

Write raw bytes (attachment upload). Creates parent directories. Path-traversal guarded.

### `uniqueAssetPath(root, rel): string`

Append ` 1`, ` 2`, … to the stem of `rel` until a non-colliding path is found. Returns the chosen vault-relative path. Used when pasting two screenshots with the same name. Falls back to `<stem> <Date.now()>.<ext>` after 9999 attempts.

### `listTemplates(root, folder): Promise<Array<{ name: string; path: string }>>`

List `.md` files under `folder` (relative to vault root), recursively, sorted by path. Returns `[]` if the folder does not exist. Used to populate the template picker. Only `.md` files — directories are recursed but not returned.

---

## Empty Vault Behavior

An empty vault produces an empty graph with no nodes and no edges:

```ts
const { graph } = await buildVaultGraph("/empty-dir");
// graph.nodes === []
// graph.edges === []
```

`listMarkdown` returns `[]`; `listTree` returns `[]`; `buildGraphFromNotes` short-circuits to `{ nodes: [], edges: [], byBase: Map{}, byPath: Map{} }`.

---

## Malformed YAML Frontmatter

`parseFrontmatter` (used in both `buildVaultGraph` and `listTree`'s icon extraction) is designed to never throw on malformed YAML. A note with syntactically invalid frontmatter is still indexed as a graph node; its tags and links from the body are still extracted; only the frontmatter fields are silently treated as empty.

```md
---
invalid: yaml: syntax: here
---
Body text with #tags and [[links]]
```

This note produces a `GraphNode` and its body tags/links are still processed normally.

---

## Relationship to Other Modules

- **`memory.ts`** — builds the "3rd brain" (memory graph) using the same `buildGraphFromNotes` helper with a different `nodeBuilder` and `edgeExtractor`.
- **`engine.ts`** — merges the vault graph and memory graph into the full combined graph.
- **`wikilinks.ts`** — `extractWikilinks(content)` extracts `[[...]]` patterns from markdown, skipping code fences.
- **`tags.ts`** — `extractTags(data, body)` extracts tags from both frontmatter and body.
- **`frontmatter.ts`** — `parseFrontmatter(content)` splits content into `{ data, body }`.
- **`layout.ts`** / **`layout-cache.ts`** — after graph construction, positions are computed backend-side and attached to nodes.
- **`changeClassifier.ts`** — content-only edits (no link/tag/structural change) set `dirty.graph = false` so graph rebuilds are skipped.
- See also: [bases overview](../bases/overview.md) for how vault notes become base rows.

`Source: core/src/vault.ts, core/src/files.ts, core/src/graphBuilder.ts, core/src/fileAccess.ts, core/src/graph.ts, core/test/vault.test.ts, core/test/files.test.ts, core/test/graphBuilder.test.ts`
