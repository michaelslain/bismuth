# Vault Structure

This document covers how Bismuth models a vault: the markdown file tree that constitutes the "2nd brain," how notes are discovered and turned into graph nodes and edges (the two-pass algorithm in `buildVaultGraph`), the shared `buildGraphFromNotes` helper, the file types recognized in the sidebar tree, path-traversal safety, every public function exported by `files.ts`, `vault.ts`, and `graphBuilder.ts`, and the frontend sidebar (`app/src/FileTree.tsx` + `app/src/fileTreeOps.ts`) that renders and edits that tree.

---

## What Is a Vault?

A vault is an ordinary directory of files on disk — no database, no sidecar index. The primary content is `.md` (Markdown) files. The backend also recognizes `.draw`, `.sheet`, `.yaml`/`.yml`, and common image/PDF formats (`.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`, `.svg`, `.pdf`) as first-class vault files in the sidebar tree — images and PDFs open as an annotatable markup surface backed by a `.draw` sidecar (see `docs/drawing/`). Everything else (`.txt`, other binaries, etc.) is silently ignored when building the sidebar tree. Two system entries also surface despite the normal dotfile skip: the hidden `.settings` config file (always) and the `.daemon` folder (only when this vault's daemon is enabled) — see "System Folders" below.

The path to the vault is supplied via the `BISMUTH_VAULT` environment variable or the `--vault` CLI flag. There is no default; the server refuses to start without it.

---

## File Types Recognized

`listTree` (the sidebar tree) recognizes the following:

| Extension / entry | Kind | Notes |
|---|---|---|
| `.md` | `file` | Primary note format. `icon` frontmatter surfaced on the tree entry. A "base" is a `.md` file with `type: base` frontmatter — there is no separate `.base` extension (see `listBases` below for the unrelated, currently-unused `.base` glob). |
| `.draw` | `file` | Vector drawing; always receives `icon: "PenTool"` in the tree entry, regardless of content. |
| `.sheet` | `file` | Univer spreadsheet JSON snapshot. |
| `.yaml` / `.yml` | `file` | YAML files. |
| `.png` / `.jpg` / `.jpeg` / `.gif` / `.webp` / `.svg` / `.pdf` | `file` | Images and PDFs; open as an annotatable markup surface via a sidecar `<file>.draw` (the export sidecars `<file>.draw.png`/`<file>.draw.pdf` are excluded separately — see below). |
| `.settings` (hidden, no extension) | `file` | The vault's single settings file. Always surfaced despite the leading dot; rendered with label `"settings"` + a `Settings2` icon (see "System Folders" below). |
| `.daemon` (hidden dir) | `dir` | The per-vault daemon's home folder. Surfaced only when the vault's daemon is enabled; everything inside is surfaced regardless of extension (see "System Folders" below). |
| Directory | `dir` | All other non-dotfile directories are included, recursively. |

### Explicitly excluded by `listTree`

- `.draw.png` and `.draw.pdf` — generated export sidecars of `.draw` files; hidden from the tree so they do not appear as siblings of the drawing.
- Any file starting with `.` (dotfiles) or any directory starting with `.` (e.g. `.trash`, `.git`), **except** the two system entries below. The dot-skip applies at every level of the recursive walk.
- All other extensions (`.txt`, other binaries, etc.) are silently dropped.

### System Folders: `.settings` and `.daemon`

`listTree(root, opts)` takes an optional `{ daemonEnabled?, daemonName? }` and threads two predicates into `walkDir`'s `allowDot` parameter (`core/src/files.ts:111-114`):

- `allowDot(rel)` — returns `true` for `rel === ".settings"` always, and for `rel === ".daemon"` only when `opts.daemonEnabled` is set. This is what lets those two dotfile entries survive the walk's usual dot-skip.
- `inSystemFolder(rel)` — `true` for anything under `.daemon/`. Files inside the daemon folder (crons, memory notes, process defs, `identity.md`, …) are surfaced **regardless of extension** — the normal `.md`/`.draw`/`.sheet`/`.yaml`/image allowlist doesn't apply inside `.daemon/`, only the `.draw` → `PenTool` icon marker still does. The daemon's own internal dot-state (e.g. `.daemon/crons/.last-fired.json`) stays hidden, since `allowDot` only opts in the two named roots, not their nested dotfiles.

Output shaping for the two system entries (`core/src/files.ts:157-166`):

- `.settings` → `{ path: ".settings", kind: "file", label: "settings", icon: "Settings2" }`.
- `.daemon` → `{ path: ".daemon", kind: "dir", isSystemFolder: true, label: daemonName }`, where `daemonName` is `opts.daemonName?.trim() || "daemon"` (the daemon's configured `identity.md` name, read by the server via `daemonIdentityName()`).

`TreeEntry.isSystemFolder` and `TreeEntry.label` (`core/src/graph.ts`) exist specifically to carry this: the frontend sidebar uses them to render the entry distinctly and guard it from rename/delete/drag (see "System-folder protection" below). Folder-level `icon` overrides (via the icon picker, stored in the `.settings` file's `folderIcons` map — see `settings.ts`'s `setFolderIcon`/`readFolderIcons`) are **not** applied inside `listTree` itself — they're merged onto `dir` entries per-request by the `GET /tree` route in `server.ts`, so a folder-icon change is reflected without needing the underlying tree cache to rebuild.

### `listMarkdown` — only `.md` files

`listMarkdown` is a tighter scan used solely for graph construction. It returns only `.md` files, never directories or other types. It uses `Bun.Glob("**/*.md")` with `dot: false`, so it also skips dotfiles automatically.

```ts
// core/src/files.ts
export async function listMarkdown(root: string): Promise<string[]>
// Returns vault-relative paths: ["a.md", "reading/My Note.md", ...]
```

### `listBases` — a `.base`-extension glob (currently unused)

```ts
// core/src/files.ts
export async function listBases(root: string): Promise<string[]>
// Bun.Glob("**/*.base"), dot: false, results sorted.
```

This exists in the `FileAccess` interface (`fileAccess.ts`, wired to both the desktop `files.ts` impl and the iPad `tauriFileAccess.ts` impl) alongside `listMarkdown`, but **nothing in the live Bases pipeline calls it**: `basesData.ts`'s `buildVaultRows` and `bases/source.ts` both discover bases the same way as every other note — via `listMarkdown` + `type: base` frontmatter (the actual base convention; see the `.md` row above). A literal `.base`-extension file is never created by the app. `listBases` reads as a legacy/future-proofing hook rather than part of any code path a note or base file actually travels through today.

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
export async function listTree(
  root: string,
  opts?: { daemonEnabled?: boolean; daemonName?: string },
): Promise<TreeEntry[]>
```

Returns a flat list of `TreeEntry` objects representing the vault sidebar:

```ts
// core/src/graph.ts
interface TreeEntry {
  path: string;             // vault-relative path
  icon?: string;             // frontmatter `icon` for .md files; "PenTool" for .draw; "Settings2" for .settings
  kind: "file" | "dir";
  isSystemFolder?: boolean;  // true for .daemon — rendered distinctly, guarded from rename/delete/drag
  label?: string;            // display override (e.g. "settings" for .settings, or the configured daemon name for .daemon)
}
```

`opts.daemonEnabled`/`opts.daemonName` control whether `.daemon` surfaces and what label it carries — see "System Folders" above.

### Walk behavior

- All non-dotfile directories are always recursed.
- Dotfile directories (`.trash`, `.git`, etc.) are skipped entirely — their contents never appear — **except** `.settings`/`.daemon`, opted back in via `allowDot` (see "System Folders" above).
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
- Any dotfile or dotfile directory at any depth, **except** `.settings` and (when the vault's daemon is enabled) `.daemon` — see "System Folders" above.
- All file types other than `.md`, `.draw`, `.sheet`, `.yaml`, `.yml`, and images/PDF (`.png`/`.jpg`/`.jpeg`/`.gif`/`.webp`/`.svg`/`.pdf`) — except inside `.daemon/`, where every file surfaces regardless of extension.

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

## Sidebar File Tree (Frontend): `FileTree.tsx` + `fileTreeOps.ts`

`app/src/FileTree.tsx` is the sidebar component that renders the flat `TreeEntry[]` from `GET /tree` as a nested tree and layers **optimistic, undoable** editing on top of the plain `api.*` CRUD calls (`create`/`move`/`del`/`restore`/`setProperty`/`deleteProperty`/`setFolderIcon`). `app/src/fileTreeOps.ts` holds the pure list-transform helpers those optimistic edits use; `app/src/fileTreeRefresh.ts` (`decideTreeRefresh`) holds the pure SSE-refetch gating logic (not detailed here — see that module's own tests).

### Tree building

`buildTree(entries)` folds the flat list into a nested `TreeNode` map keyed by path segment, carrying each entry's `icon`, `label`, and `isSystemFolder` onto its own node (not its ancestors). `sortedChildren(node)` orders each level: system entries (anything with `isSystemFolder`, plus the `.settings` path) always sink to the bottom, then folders before files, then alphabetically by name. Row icons fall back to `Settings2` for system folders, `FolderOpen`/`Folder` for other directories (open/closed), `Table` for `.sheet` files, and `FileText` for everything else, when no explicit `icon` is set.

### Creating entries

`doCreate(parentDir, kind, view?)` handles `CreateKind = "file" | "dir" | "base" | "sheet" | "draw"` (the backend only knows `file`/`dir` — `base`/`sheet`/`draw` are `.md`/`.sheet`/`.draw` files with a seeded default name/content):

- The default name (`"Untitled.md"`, `"New Folder"`, a base-view-specific name via `baseFileName()`, `"Untitled.sheet"`, `"Untitled.draw"`) is disambiguated against the current (optimistic) tree via `fileTreeOps.ts`'s `uniqueChildName`, which mirrors the backend's `uniqueAssetPath` collision-suffix algorithm (append `" 1"`, `" 2"`, … to the stem before the extension; a `Date.now()` fallback after 9999 tries) — so two fast "New note" clicks land as distinct rows instead of the second create 409ing (`EEXIST`) and yanking the first row's inline-rename box.
- The new entry is added to the tree instantly via `fileTreeOps.ts`'s `addEntry` (a no-op if the path already exists), then `api.create` fires for real.
- A `base` is created, seeded with `baseTemplate(view)` via `api.write`, and opened immediately in a new tab (skipping inline-rename, since a blank base row wouldn't show its view). Every other kind drops into inline-rename mode (`EditableLabel`); files also get their note-cache primed with an empty body (`primeNoteCache`) so an immediate open is a guaranteed cache hit instead of racing the create.
- `pendingCreate`, keyed by a fresh per-invocation `Symbol` (not the path, so concurrent creates never collide), exposes the in-flight `api.create` promise so a same-row rename-on-Enter can `awaitCreate(path)` before issuing its `move` — preventing the move from reaching the server before the file exists.
- The toolbar's "+" chooser and header "New note"/"New folder" buttons (in `App.tsx`) both create at the vault root by dispatching a `bismuth-new` window `CustomEvent` that `FileTree` listens for.

```ts
// app/src/fileTreeOps.ts — pure helpers used by the optimistic edits above
export function renameEntries(entries: TreeEntry[], from: string, to: string): TreeEntry[]      // rewrites `from` + every descendant path
export function removeEntries(entries: TreeEntry[], path: string): TreeEntry[]                   // drops `path` + descendants
export function addEntry(entries: TreeEntry[], path: string, kind: "file" | "dir"): TreeEntry[]  // no-op if path exists
export function uniqueChildName(entries: TreeEntry[], parentDir: string, name: string): string   // "Untitled.md" → "Untitled 1.md", …
```

`pendingOps` — a counter of in-flight optimistic round-trips (create/move/delete) — gates SSE-driven `refetch()` (via `decideTreeRefresh`), so a server tree snapshot that was in flight before an edit landed can never clobber the optimistic state with stale data; the effect re-runs once `pendingOps` drops back to 0.

### Delete + undo

`doDelete`/`doDeleteMany` optimistically remove the row(s) via `removeEntries` and fire `POST /del` per path (the backend's `deleteEntry` moves the file into `.trash/<timestamp>-<basename>`, see below), then push `{ trashPath, to, name }` onto a LIFO `undoStack` and a toast with an "Undo" action. `restoreDeleted` pops the matching stack entry and calls `api.restore(trashPath, to)`. **Cmd/Ctrl+Z** (ignored while typing in an input/textarea/contenteditable) undoes the most recently deleted entry via the same path — bound as a `window` `keydown` listener. Deleting a multi-selection first runs `pruneNested` to drop any selected path whose ancestor is also selected, so deleting a selected folder doesn't also try (and 404) to delete an already-gone selected child.

### Multi-select

`selected` is a `Set<string>` of paths, managed by `onRowClick`:

- **Cmd/Ctrl+click** — toggles the row in/out of the selection and sets it as the new range anchor.
- **Shift+click** (with an existing anchor or non-empty selection) — extends a contiguous range from the anchor to the clicked row, computed over `visibleOrder()` — a flattened walk of only the currently-expanded rows, in on-screen display order (so a range spans exactly what's visible, not the full underlying tree).
- **Plain click** — clears the selection.
- `Delete`/`Backspace` with a non-empty selection deletes the whole selection (undoable, as above).
- Right-clicking a row that's part of a >1-item selection replaces the normal per-row context menu with a single "Delete N items" action.
- System folders and `.settings` are excluded from selection entirely — `onRowClick` returns `false` immediately for them, so the click falls through to the normal open/toggle behavior instead.

### Icon picker

"Set Icon…" on a file or folder opens `IconPicker`; picking (or explicitly clearing, via `onClear`) calls `applyIcon(node, isDir, icon)`, which routes by entry kind:

- **Folders** → `api.setFolderIcon(path, icon)` → `POST /folder-icon` → `settings.ts`'s `setFolderIcon`, storing the mapping in the `.settings` file's `folderIcons` map (an empty icon deletes the entry). This is merged onto `dir` entries by the `GET /tree` route in `server.ts`, not by `listTree` itself (see "System Folders" above).
- **Files** → the note's own `icon` frontmatter key, set via `api.setProperty(path, "icon", icon)` or cleared via `api.deleteProperty(path, "icon")`.

### System-folder protection

`.settings` (matched via `tabIds.ts`'s `SETTINGS_FILE` constant) and any node with `isSystemFolder` (currently only `.daemon`) are excluded from:

- The context menu's **Set Icon…**/**Rename**/**Delete** items (`buildMenuItems` skips pushing them when `node.isSystemFolder || node.path === SETTINGS_FILE`) — the creation submenu (New File/Folder/Base/Spreadsheet/Drawing) still shows for `.daemon`, so crons/memory files can be hand-added.
- `draggable` on the row (both the folder and file row templates check `!child.isSystemFolder` / `child.path !== SETTINGS_FILE`).
- Multi-select and rename-on-click handling, as noted above.

### Drag-and-drop

Dragging a row sets `dragPath` (`makeDragStart`); dropping onto a folder row (or the tree root's own background, representing the vault root) calls `moveInto(targetDir)`, which no-ops if the target is the entry's current parent or a descendant of the dragged path, otherwise optimistically renames via `renameEntries` and calls `api.move(from, to)` (reverting via `refetch()` on failure). Only **file** rows also write the `application/x-bismuth-path` drag payload (`e.dataTransfer.setData`), so a pane can accept the drop as a split target; folder drags participate only in tree reordering, never pane splitting.

### Inline rename

Rename swaps the row's label for an `<input>` (`EditableLabel`), pre-filled with the extension-stripped stem: `.md`/`.yaml`/`.yml` are hidden (matching the tree's `displayName()`, which strips the same extensions for the non-editing label — Obsidian-style), while any other extension (`.sheet`, `.draw`, images) shows in full. Enter commits (re-appending the hidden extension if the user dropped it; a no-op if the name is unchanged), Escape cancels, and blur also commits. A `done` flag ensures the commit/cancel body runs exactly once even though `setEditing(null)` unmounts the input and fires a second `blur`. If the row's `api.create` is still in flight, the commit `awaits awaitCreate(from)` before calling `api.move`, so a fast type-and-Enter can't race the row's own creation.

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
- **`settings.ts`** — owns the `.settings` file lifecycle, including the `folderIcons` map behind the sidebar's folder icon picker, and `daemon.enabled`, which gates whether `.daemon` surfaces in `listTree`.
- **`server.ts`** — `GET /tree` merges per-folder icons onto `listTree`'s cached output; `POST /folder-icon`, `POST /del`, `POST /create`, `POST /move`, `POST /restore` back the frontend sidebar's mutations.
- **`app/src/FileTree.tsx`** + **`app/src/fileTreeOps.ts`** — the sidebar tree consuming `GET /tree`, with optimistic create/rename/move/delete, delete-undo, multi-select, an icon picker, and drag-and-drop (see "Sidebar File Tree (Frontend)" above).
- See also: [bases overview](../bases/overview.md) for how vault notes become base rows.

`Source: core/src/vault.ts, core/src/files.ts, core/src/graphBuilder.ts, core/src/fileAccess.ts, core/src/graph.ts, core/src/settings.ts, core/src/server.ts, app/src/FileTree.tsx, app/src/fileTreeOps.ts, core/test/vault.test.ts, core/test/files.test.ts, core/test/graphBuilder.test.ts, app/src/fileTreeOps.test.ts, app/src/FileTree.refresh.test.ts`
