# Vault structure

A vault is an ordinary folder on disk that Bismuth reads as your notes: markdown files, plus drawings, spreadsheets, images, PDFs and a few configuration files.
There is no database and no index file, so any editor can open the same files.
Read [Getting started](../overview/getting-started.md) to choose a vault, and [Storage](../overview/storage.md) for what the app keeps outside it.

```text
my-vault/
  Inbox.md                  a note
  reading/
    Dune.md                 a note in a folder
    cover.png               an image
    cover.png.md            the image's companion note (holds its tags)
  Budget.sheet              a spreadsheet
  Sketch.draw               a drawing
  .settings                 the vault's configuration
```

## What can I put in a vault?

Put any of the file types below in a vault, at any depth. The sidebar lists them; every other file type stays on disk and is ignored.

| File | What it is |
|---|---|
| `.md` | A note. A note whose frontmatter says `type: base` is a base |
| `.draw` | A vector drawing |
| `.sheet` | A spreadsheet |
| `.yaml`, `.yml` | A YAML file, shown beside your notes |
| `.png` `.jpg` `.jpeg` `.gif` `.webp` `.avif` `.bmp` `.ico` `.svg` `.heic` `.heif` `.tif` `.tiff` | An image |
| `.pdf` | A PDF |
| `.settings` | The vault's configuration, a hidden file with no extension |
| `.themes/<name>.yaml` | A custom colour theme |
| `.daemon/` | The vault's daemon folder, listed only while the daemon is enabled |

The vault path comes from the folder you pick in the app, or from `--vault` or `BISMUTH_VAULT` when you run the backend yourself. The standalone backend exits with a usage message unless it also gets a memory directory (`--memory` or `BISMUTH_MEMORY`).

## Which files appear in the sidebar?

The sidebar shows every folder and every file type in the table above, and hides the rest:

- Files and folders whose name starts with a dot are hidden, except `.settings`, `.themes` and (when enabled) `.daemon`. That keeps `.trash` and `.git` out of sight.
- The exports `Sketch.draw.png` and `Sketch.draw.pdf` are hidden, so they never sit beside their drawing.
- A binary's companion note and ink sidecar are hidden while the binary exists. See the next section.
- Folders sort before files, and the system entries (`.settings`, `.daemon`) sort last.

The sidebar drops the `.md`, `.yaml` and `.yml` extensions from displayed names and keeps every other extension.

Inside `.daemon/`, every file is listed whatever its extension, so you can hand-edit crons and memory notes. The daemon's internal dot-files stay hidden.

## How do images and PDFs carry tags and ink?

An image or PDF has no frontmatter of its own, so Bismuth keeps two sidecar files next to it:

- `<file>.md`, the companion note: an ordinary note whose frontmatter holds the binary's `tags`. It is created the first time you edit tags on the binary's preview tab.
- `<file>.draw`, the ink sidecar: the strokes you draw on the image or PDF. See [Drawing](../drawing/overview.md).

While `<file>` exists, its row in the sidebar stands for all three files, and opening the companion note opens the binary's preview instead.
If you delete the binary outside the app, the orphaned companion and ink files reappear as normal files.
Moving, trashing and restoring the binary carries both sidecars with it.
The tagging contract, including the `bismuth prop set` command for agents, is in [Frontmatter](frontmatter.md#companion-notes-frontmatter-for-binary-files-imagespdfs).

## How do I manage files in the sidebar?

Right-click a row, or use the **+** button at the top of the sidebar, to create a note, folder, base, spreadsheet or drawing. A new entry gets a placeholder name such as `Untitled.md` and opens straight into rename.

| Action | How |
|---|---|
| Rename | Right-click, **Rename**. The hidden extension is added back for you |
| Delete | Right-click, **Delete**, or select rows and press Delete or Backspace. The entry moves to `.trash/<timestamp>-<name>` inside the vault |
| Undo a delete | Press `Mod+Z` when no text field has focus, or click **Undo** in the toast |
| Select several | `Mod`-click toggles a row, Shift-click extends a range |
| Move | Drag a row onto a folder, or onto the tree's empty space for the vault root. See [Draggables](../overview/draggables.md) for dropping a row onto a pane or a tab |
| Add files from outside | Drop files from Finder or a browser onto a folder row. Unsupported file types are skipped, and one toast names them |
| Set an icon | Right-click, **Set Icon…**. A folder's icon is stored in `.settings` under `folderIcons`; a note's icon is its `icon` frontmatter key |
| Hide from AI | Right-click, **Visibility**. See [Visibility](visibility.md) |

`.settings` and the daemon folder cannot be renamed, deleted, dragged or given an icon from the tree. Keys for delete and undo are rebindable; see [Keybindings](../settings/keybindings.md).

## What happens to a note that links to a missing note?

A link to a note that does not exist produces no graph edge and no error. Clicking it opens an empty note with that name. A note with malformed frontmatter still appears in the graph with its body tags and links; only its properties read as empty.

An empty vault produces an empty graph and an empty tree.

## How it works

### Files become graph nodes

`buildVaultGraph(root)` in `core/src/vault.ts` builds the vault graph in two passes on top of `buildGraphFromNotes` (`core/src/graphBuilder.ts`), the helper `core/src/memory.ts` also uses for the memory graph.

1. Pass 1 lists every `.md` file (`listMarkdown`, a `**/*.md` glob that skips dot-entries), creates one `GraphNode` of kind `note` per file, and indexes it by id, basename and path.
2. Pass 2 reads all files in parallel, then calls an edge extractor per note: a `link` edge per resolved wikilink, and a `tag` edge to a shared `tag:<name>` node per tag.

```ts
// "reading/My Note.md" becomes:
{ id: 'reading/My Note', label: 'My Note', kind: 'note', folder: 'reading' }
// a tag becomes:
{ id: 'tag:foo', label: '#foo', kind: 'tag' }
```

`pathParts(rel)` decomposes a path into `name`, `ext`, `folder`, `basename` and `topFolder`. A node's `folder` is always the first path segment, or `(root)` at the vault root. `noteId(rel)` strips a trailing `.md` case-insensitively.

| Path | `name` | `folder` | `topFolder` |
|---|---|---|---|
| `x.md` | `x` | `` | `(root)` |
| `reading/My Note.md` | `My Note` | `reading` | `reading` |
| `a/b/c/d/deep.md` | `deep` | `a/b/c/d` | `a` |

The extractor reads each note's whole text, frontmatter included, so a `[[link]]` in a frontmatter value also makes an edge. `extractWikilinks` returns each target once per note, skips embeds (`![[...]]`) and ignores code, so one edge exists per linked target. A self-link produces a self-edge.

`resolveLinkTarget(target, byBase, byPath)` tries the exact path first, then the basename.
When several notes share a basename, `preferId` (`core/src/linkTarget.ts`) picks the one with the fewest path segments, then the smaller path in code-unit order.
The editor's `resolveNotePath` uses the same rule, so a link opens the note the graph connects it to.
A path-qualified link such as `[[reading/Note]]` always wins over a basename collision.
[Wikilinks and tags](wikilinks-tags.md) covers the user-facing rules.

### Listing the tree

`listTree(root, { daemonEnabled?, daemonName? })` in `core/src/files.ts` walks the vault with `walkDir` and returns a flat `TreeEntry[]` (`core/src/graph.ts`).

| `TreeEntry` field | Meaning |
|---|---|
| `path`, `kind` | Vault-relative path and `file` or `dir` |
| `icon` | An `.md` note's string `icon` frontmatter; `PenTool` for `.draw`; `Settings2` for `.settings` |
| `label`, `isSystemFolder` | Display override and system flag for `.settings` and `.daemon` |
| `visibility` | The note's own frontmatter value from `listTree`; the resolved value on `GET /tree` |

`walkDir` always recurses into directories, and skips a dot-entry unless the `allowDot(rel)` callback opts it in.
`listTree` opts in `.settings`, `.themes` and, with `daemonEnabled`, `.daemon`.
Under `.themes` only top-level `*.yaml` files list.
Inside `.daemon/` every file lists, and only the `.draw` icon marker still applies.

`isTreeListedName` in `core/src/fileKinds.ts` is the shared predicate for which names the tree considers.
It covers `.md`, `.draw`, `.sheet`, `.yaml`, `.yml`, every `IMAGE_EXTS` entry and `.pdf`.
After the walk, a second pass drops a `<file>.md` or `<file>.draw` entry whose companionable sibling `<file>` is in the same listing.
The mobile mirror in `app/src/mobile/tauriFileAccess.ts` applies the same predicate and pass.

Icon and visibility reads are cached by file mtime, so an unchanged note is not re-parsed. `GET /tree` overlays folder icons from `folderIcons` and the resolved visibility from `folderVisibility` per request, so changing either does not rebuild the tree cache.

### Binary helpers

`core/src/fileKinds.ts` is the single source for binary classification.

| Function | Result |
|---|---|
| `isCompanionable(path)` | True for an image or PDF |
| `companionPathFor(path)` | `x.png` to `x.png.md` |
| `inkSidecarFor(path)` | `x.png` to `x.png.draw` |
| `binaryForCompanion(mdPath)` | `x.png.md` to `x.png`; `null` for a plain note or `x.png.md.md` |

`carrySidecars` in `files.ts` moves `<file>.draw` and, for a companionable file, `<file>.md` along with the entry. It is best effort and existence-gated. A companion already at the destination moves to `.trash` instead of being overwritten, because it can hold real prose.

### File operations and path safety

Every function in `files.ts` that takes a relative path first runs it through `resolveInVault(root, rel)`, which resolves `..` and absolute paths and throws `EINVAL` when the result leaves the vault.

| Function | Behaviour |
|---|---|
| `readNote`, `writeNote` | Read or write UTF-8 text; `writeNote` creates parent folders |
| `createEntry(root, path, kind)` | Create an empty file or folder; `EEXIST` (409) if it exists |
| `deleteEntry(root, path)` | Move to `.trash/<ms>-<basename>` and return `{ trashPath }`; `ENOENT` (404) if missing |
| `moveEntry(root, from, to)` | Rename atomically, creating the destination's parents; `EINVAL` for a move into itself, `ENOENT`, `EEXIST` |
| `resolveAsset(root, target)` | Resolve an embed target to an absolute path, or `null` |
| `writeBinary`, `uniqueAssetPath` | Write bytes; pick a free ` 1`, ` 2`, ... suffixed path |
| `listTemplates(root, folder)` | List `.md` files under a folder, sorted by path |

`moveEntry` compares device and inode on a case-insensitive filesystem, so a case-only rename succeeds while a real collision still throws.
`POST /restore` is `moveEntry(trashPath, to)`, which is why restored entries bring their sidecars back.
[Attachments](attachments.md) covers `resolveAsset` and the upload route.

### The sidebar component

`app/src/FileTree.tsx` renders the flat entries as a nested tree and applies edits optimistically: it updates the list first, then calls the API, and reloads on failure.
`app/src/fileTreeOps.ts` holds the pure list transforms (`renameEntries`, `removeEntries`, `addEntry`, `uniqueChildName`), and `fileTreeRefresh.ts` decides when a server snapshot may replace local state.
A counter of in-flight edits holds back refetches so a stale snapshot cannot overwrite an optimistic change.
Deleted entries go on a last-in-first-out undo stack that `api.restore` replays.
Drags use the pointer-drag controller in `app/src/dnd/viewDrag.ts`, and dropped OS files are planned by `planTreeUploads` in `app/src/fileTreeDrop.ts`.

Source: `core/src/vault.ts`, `core/src/files.ts`, `core/src/fileKinds.ts`, `core/src/graphBuilder.ts`, `core/src/linkTarget.ts`, `core/src/pathUtils.ts`, `core/src/graph.ts`, `app/src/FileTree.tsx`, `app/src/fileTreeOps.ts`, `app/src/fileTreeDrop.ts`
