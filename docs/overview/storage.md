# Storage

Bismuth keeps your notes as plain files in your vault folder and everything else in four places: hidden files inside the vault, a machine directory at `~/.bismuth`, the app's own config directory, and the browser's `localStorage`. This page lists what lives where and which parts are safe to delete. The daemon's own two-tier layout is in [daemon storage](../daemon/storage.md).

| Location | Holds | Safe to delete? |
|---|---|---|
| `<vault>/` notes, drawings, sheets, attachments | Your content | No |
| `<vault>/.settings`, `<vault>/.themes/` | Your settings and custom themes | No |
| `<vault>/.trash/` | Notes and folders you deleted | Yes, if you do not need them back |
| `<vault>/.git/` | Local snapshot history | Yes; snapshots restart empty |
| `<vault>/.daemon/` | The daemon's brain for this vault | See [daemon storage](../daemon/storage.md) |
| `~/.bismuth/layout-cache/` | Computed graph layouts | Yes; rebuilt on demand |
| `~/.bismuth/` (everything else) | Machine-wide install, daemon state, tokens, caches | See [What is in `~/.bismuth`?](#what-is-in-bismuth) |
| App config directory | The last vault you opened | Yes; the app asks for a vault again |
| Browser `localStorage` | Tab layout and instant-paint caches | Yes; the app rebuilds them |

## What does Bismuth store inside a vault?

A vault is any folder you point Bismuth at. The sidebar lists the file types below; every other file stays on disk, untouched, and can still be embedded in a note. [Vault structure](../vault/structure.md) covers the sidebar and file operations.

| Item | Path | Notes |
|---|---|---|
| Notes, bases, templates | `**/*.md` | UTF-8 markdown with optional YAML frontmatter. Dot-folders are never indexed |
| Drawings | `*.draw` | A JSON drawing document |
| Sheets | `*.sheet` | A JSON spreadsheet snapshot |
| YAML files | `*.yaml`, `*.yml` | Listed in the sidebar |
| Images and PDFs | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.bmp`, `.ico`, `.svg`, `.heic`, `.heif`, `.tif`, `.tiff`, `.pdf` | Carry tags in a companion note `<file>.md` and ink in a `<file>.draw` sidecar |
| Settings | `.settings` | One hidden, extensionless YAML file; see [settings](../settings/overview.md) |
| Custom themes | `.themes/<name>.yaml` | Only top-level YAML files are listed |
| Attachments | `attachments/` by default | Set by `attachments.folder`; see [attachments](../vault/attachments.md) |
| Templates | `Templates/` by default | Set by `templates.folder` |
| Trash | `.trash/<epoch-ms>-<name>` | Deleting moves here; restoring moves back |
| Daemon brain | `.daemon/` | Shown in the sidebar only while `daemon.enabled` is on |

A companion note and a `.draw` sidecar are hidden in the sidebar while the image or PDF they belong to exists, and the export artifacts `*.draw.png` and `*.draw.pdf` are never listed. A move, delete or restore carries a file's sidecars with it.

`.settings` holds nothing secret. Google Calendar credentials and tokens live in `~/.bismuth/gcal`, outside every vault.

### How does Bismuth keep a file inside the vault?

Every path a request names is resolved inside the vault root. A path that climbs out with `..`, or an absolute path outside the root, is rejected with `EINVAL` (`path escapes vault: <path>`).

### What happens when I delete a note?

Delete moves the file or folder to `.trash/<epoch-ms>-<name>`. A deleted folder moves whole. The trash is a dot-folder, so deleted items vanish from the sidebar, the graph and search, and the sidebar's delete undo (or `POST /restore`) moves them back to their original place.

## How do vault snapshots work?

Bismuth keeps a local-only git repository in the vault and commits to it as you edit. It never adds a remote and never pushes.

- With `vault.backupOnSave` on (the default), each editor save asks for a snapshot. Saves are coalesced: the commit happens about 30 seconds after the last save, and at least every 5 minutes during continuous editing.
- A snapshot is `git add -A` and one commit named `vault snapshot YYYY-MM-DD HH:MM` (UTC). With nothing changed, no commit is made.
- A new repository gets the identity `Bismuth <vault@local>`. An existing git repository you use as a vault keeps your identity.
- `.settings`, `.themes/` and the vault's notes are tracked. Inside `.daemon/`, only `identity.md`, `PAGES.md` and the `.md` definitions in `crons/`, `processes/` and `pages/` are tracked; runtime files and the memory repo are excluded.
- `.trash/` is not excluded, so deleted items are committed unless you add a `.gitignore`.
- The 3rd-brain memory directory is its own repository. Memory writes are snapshotted separately with `memory snapshot YYYY-MM-DD HH:MM` messages.

The exclusion rules live in `.git/info/exclude` and are kept current on every snapshot. Lines you add by hand are left alone.

## What is in `~/.bismuth`?

`~/.bismuth` is the machine-wide Bismuth home. `bismuth uninstall` removes the daemon service, the CLI link and the MCP registrations, then deletes this whole directory.

| Path | Holds | Safe to delete? |
|---|---|---|
| `bin/`, `docs/`, `.version` | The installed `bismuth` CLI, `bismuth-mcp`, `bismuth-daemon` and the docs tree | Yes; the app reinstalls them on launch |
| `layout-cache/` | One JSON layout per graph signature, plus a warm-start seed per vault | Yes; layouts recompute |
| `daemon/` | Machine identity and daemon state | See [daemon storage](../daemon/storage.md) |
| `run/` | One record per running core: port, vault, pid and the owner token (mode `0600`) | Yes while no core is running |
| `gcal/` | Google OAuth credentials, tokens and the sync manifest | Deleting disconnects Google Calendar |
| `chat/models.json` | The model last used in each chat session | Yes; sessions fall back to their default model |
| `tmp/` | Pasted files staged for chat | Yes; entries older than 24 hours are pruned at boot |
| `trusted-commands.json` | Approved `run:` status-bar commands per vault | Yes; each command asks for approval again |
| `models/`, `cache/recall/` | The embedding model and memory vectors for recall | Yes; they download or recompute |
| `agents/bin/` | The free agent's binary | Yes; set it up again from the chat setup |
| `.daemon-installed`, `.mcp-registrations.json` | Install markers and the MCP registration ledger | Avoid; the install logic reads them |

Environment variables can relocate several of these; the names are listed under [Machine directory](#machine-directory).

## What does the app store outside the vault?

The desktop app keeps two files in its config directory, which Tauri derives from the app identifier `com.bismuth.app` (on macOS, `~/Library/Application Support/com.bismuth.app/`).

| File | Holds |
|---|---|
| `config.json` | `{ "vault": "...", "memory": "..." }`, the vault the next launch reopens. Memory is always `<vault>/.daemon/memory` |
| `intro-seen` | A one-byte marker. While it is absent, the app shows the first-run intro |

## What does the browser store?

The app caches view state in `localStorage` so the next launch paints instantly. All access is guarded: with storage blocked or full, the app still works and only loses these conveniences. None of these keys belongs in `.settings`, because they are per-window or per-browser choices.

| Key | Holds |
|---|---|
| `bismuth-tabs-v1` | This window's tab and pane layout. Other windows use `bismuth-tabs-v1:<window id>` |
| `bismuth-closed-sessions-v1` | The tab layouts of recently closed windows, for Reopen Closed Tab |
| `bismuth-sidebar-visible-v1`, `bismuth-tab-rail-pinned-v1` | Sidebar and tab-rail visibility |
| `bismuth-tree-cache-v1::<api base>`, `bismuth-graph-cache-v2::<api base>` | The last sidebar tree and graph, scoped to one backend so vaults do not mix |
| `bismuth-settings-cache-v1` | The last settings, so theme and fonts paint on the first frame |
| `bismuth-theme-vars-v1` | The active theme's CSS variables, applied by an inline script before the bundle loads |
| `bismuth:graph:viewMode`, `bismuth:graph:clusters` | The graph's 2D/3D flag and cluster toggle |
| `bismuth:ui:zoom` | The UI zoom percentage |
| `bismuth-frecency-v1` | Decayed use counts that rank the command palette and the switcher |
| `bismuth-folds:<note path>` | Fold blocks locked open in one note |
| `bismuth:table-size:<note path>` | Resized table column widths and row heights |
| `bismuth.chat.*`, `bismuth-chat-sessions-v1`, `bismuth-chat-colors-v1` | Last chat provider, model, effort and permission mode, and each chat tab's session id and tint |
| `bismuth.export.destFolder`, `bismuth.export.calSpan` | The export pane's last folder and calendar span |
| `three-brains.harper` | The spell checker's personal dictionary and ignored lints |
| `bismuth-first-run-powerups`, `bismuth-first-run-agent` | The intro's choices, read and removed once after the first vault opens |

The Bases row cache is held in memory only and clears when the server version advances.

## How it works

### Vault IO

`core/src/files.ts` resolves every path through `resolveInVault`. `listTree` decides what the sidebar shows: the extension allow-list is `isTreeListedName` in `core/src/fileKinds.ts`, shared with the mobile file layer and the preview surface, and a per-note icon and visibility cache is keyed by mtime so only changed notes are re-parsed. `deleteEntry` stamps the trash name and `carrySidecars` moves companion notes, ink sidecars and a daemon page's state file alongside. `listMarkdown` globs `**/*.md` with `dot: false`.

### Snapshots

`core/src/backup.ts` runs every git call with the repo-location variables (`GIT_DIR`, `GIT_WORK_TREE` and similar) removed, and `assertTargets` refuses to commit when git resolves the vault to a different work tree. `ensureExclude` rewrites `.git/info/exclude` from `EXCLUDE_LINES`, an allow-list for `.daemon`, because a deny-list fails open when the daemon starts writing a new runtime file. The order of those lines is load-bearing: git cannot re-include a file whose parent directory is excluded. `scheduleBackup` debounces per repository; its timing can be overridden with `BISMUTH_BACKUP_DEBOUNCE_MS` and `BISMUTH_BACKUP_MAX_WAIT_MS`.

### Machine directory

`bismuthHome()` in `core/src/bismuthHome.ts` returns `~/.bismuth[/...]`. Several subdirectories accept an override variable (`BISMUTH_RUN_DIR`, `BISMUTH_GCAL_DIR`, `BISMUTH_CHAT_DIR`, `BISMUTH_TMP_DIR`, `BISMUTH_TRUST_FILE`, `BISMUTH_DAEMON_DIR`, `BISMUTH_LAYOUT_CACHE_DIR`). The layout cache stays outside the vault because a write inside it would trip the file watcher and loop invalidate, rebuild and rewrite; it is pruned to `BISMUTH_LAYOUT_CACHE_MAX_ENTRIES` files (default 1000), oldest first. The cache key and warm-start seeds are explained in [knowledge graph](../graph/overview.md#layout-cache-and-warm-starts). Run records are written atomically with mode `0600` because they carry the owner token (`core/src/runRegistry.ts`).

### App config

`app/src-tauri/src/lib.rs` reads and writes `config.json` through `app_config_dir()` and derives memory with `vault_memory_dir`. A record is valid only if its vault is an existing directory. The `intro-seen` marker is separate from `config.json` so replaying the intro never touches the saved vault.

### Browser keys

`app/src/viewCache.ts` wraps every `localStorage` access in `try`/`catch` and scopes caches with `scopedKey(key, apiBase)`. `localStorage` is shared by every window of one origin, which is why the tab layout is keyed by window id (`app/src/windowId.ts`) and the tree and graph caches by backend. The theme-variable key is declared in `app/src/storageKeys.ts` and read by the inline script in `app/index.html`. Bump `GRAPH_CACHE_KEY` in `app/src/App.tsx` whenever the layout `CACHE_VERSION` changes.

Source: `core/src/files.ts`, `core/src/fileKinds.ts`, `core/src/backup.ts`, `core/src/bismuthHome.ts`, `core/src/layout-cache.ts`, `core/src/runRegistry.ts`, `core/src/tmpFiles.ts`, `core/src/chatModelStore.ts`, `core/src/statusBarTrust.ts`, `core/src/bismuthInstall.ts`, `core/src/gcal/manifest.ts`, `core/src/schema/settingsSchema.ts`, `app/src-tauri/src/lib.rs`, `app/src/viewCache.ts`, `app/src/windowId.ts`, `app/src/storageKeys.ts`, `app/src/App.tsx`, `app/src/settings.ts`
