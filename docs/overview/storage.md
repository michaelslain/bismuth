# Storage: Where Everything Is Kept

This document exhaustively covers every on-disk and in-browser location that Bismuth reads or writes, including vault file conventions, settings, the layout cache, localStorage keys, the daemon's machine + per-vault state, git snapshots, and the relay plugin's PTY environment. Each section describes the path, format, ownership, and any edge-case behaviour verified in the source and tests.

---

## 1. The Vault Directory

The vault is an arbitrary directory on the local file system, passed via the `BISMUTH_VAULT` environment variable (required; server refuses to start without it). All vault-relative paths are resolved with a path-traversal guard (`resolveInVault` in `core/src/files.ts`): any attempt to escape the vault root with `..`, absolute paths, or symlink chains throws `EINVAL` with the message `path escapes vault: <rel>`.

### 1.1 Markdown Notes

All files matching `**/*.md` (recursively, skipping dotfiles/dot-directories) are vault notes. `listMarkdown` uses a `Bun.Glob` with `dot: false`, so hidden files are never indexed.

- Format: UTF-8 markdown, optional YAML frontmatter delimited by `---` fences
- Frontmatter fields of interest: `tags`, `aliases`, `icon` (emoji or Lucide name), `type` (`base` marks a Bases data file), plus any user-defined property types registered under `.settings → properties:`
- Path matching: wikilinks (`[[Note Name]]`) are resolved by **basename** anywhere in the vault, not by path; ambiguous matches are undefined behaviour

### 1.2 Other Vault File Types

The file tree (`listTree`) surfaces the following extensions to the UI; all others (`.txt`, etc.) are omitted from the tree but are still accessible as embeds:

| Extension | Purpose |
|-----------|---------|
| `.md` | Notes, bases, templates |
| `.draw` | Vector drawing documents (JSON `DrawingDoc`); shown with a `PenTool` icon marker |
| `.sheet` | Univer workbook snapshots (JSON) |
| `.yaml` / `.yml` | User-authored YAML files |
| `.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`, `.svg` | Images — open as an annotatable markup surface (a paired `<file>.draw` sidecar holds the markup) |
| `.pdf` | PDFs — same annotatable markup surface as images |

Image/PDF extensions are matched case-insensitively via `/\.(png|jpe?g|gif|webp|svg|pdf)$/i` in `listTree` (`core/src/files.ts`). Generated sidecars `.draw.png` and `.draw.pdf` are explicitly **excluded** from the tree even though they live in the vault, so a drawing's export artifact never masquerades as an openable image/PDF.

The single hidden settings file `.settings` (no extension, vault root) is always included in the tree regardless of the extension allowlist above, shown with a gear icon and the label `"settings"` — see §2. When the vault's daemon is enabled, `.daemon/` is also shown (as a system folder surfacing every file inside it regardless of extension) — see §6.2.

Markdown notes' optional `icon` frontmatter is read once per file and cached by mtime (`iconCache: Map<absPath, {mtime, icon}>` in `files.ts`), so `listTree` only re-reads + re-parses frontmatter for notes whose mtime changed since the last call.

### 1.3 The `.trash` Directory

Deleting a file or folder via `deleteEntry` moves it into `<vault>/.trash/` rather than permanently removing it. The trash path format is:

```
.trash/<unix-epoch-ms>-<original-basename>
```

Example: deleting `projects/notes.md` produces `.trash/1717776000000-notes.md`.

The `.trash` directory is a dotfile directory, so `walkDir` skips it entirely — deleted items never appear in `listTree`, `listMarkdown`, or graph construction. Items in `.trash` can be manually restored by moving them back; there is no undo API in the server.

**Folder deletes** move the whole subtree: `deleteEntry(root, "projects")` moves the entire `projects/` folder as `<vault>/.trash/<ts>-projects/`.

### 1.4 Attachments and Assets

Pasted or dropped media (images, PDFs, audio, video) are written into the vault at a configurable location. The default folder is `attachments/` (relative to the vault root), controlled by `.settings → attachments.folder`. Special values:

- `""` — write to the vault root
- `"."` — write to the same folder as the current note (desktop/Tauri only; browser build falls back to vault root)

The folder is created automatically (`mkdirSync(..., { recursive: true })`) on first use. Asset names for pasted clipboard images default to the template `Pasted image {timestamp}` with a sortable date-time stamp; collisions are resolved by appending ` 1`, ` 2`, … up to 9999, then a `Date.now()` suffix as a pathological fallback (`uniqueAssetPath` in `files.ts`).

**Upload limit**: `POST /asset` caps each upload at 100 MB (`MAX_ASSET_BYTES`).

**Resolution** (`resolveAsset`): `![[target]]` embeds resolve filename-first — an exact vault-relative path wins; otherwise the first file anywhere in the vault whose basename equals the target's basename. Fragment suffixes (`#page=3`) and size hints (`|WxH`) are stripped before matching. Returns `null` when nothing matches.

**Safety**: `isSafeAssetTarget` in `server.ts` rejects any path whose segments are empty, `.`, `..`, or start with `.` — this blocks writing into `.git/`, `.obsidian/`, `.trash/`, etc.

---

## 2. `.settings`

### 2.1 Location and Ownership

```
<vault>/.settings
```

`.settings` is a single **hidden, extensionless** YAML file at the vault root, and the **single source of truth** for all user-visible settings. The backend is the sole writer; the frontend never directly modifies the file. Filename is the constant `SETTINGS_FILE = ".settings"` in `core/src/settings.ts`.

### 2.2 Legacy Migration

`migrateSettingsLocation(vault)` (`core/src/settings.ts` ~lines 29–60), run at the top of every `reconcileSettings` call, is a one-time, idempotent relocation of two older on-disk layouts into the single `.settings` file:

- **Legacy vault-root file** — an older `settings.yaml` at the vault root (`LEGACY_SETTINGS_FILE = "settings.yaml"`) is renamed to `.settings`. If the rename fails (a lock, an odd filesystem state), it falls back to a plain copy so `.settings` exists with the user's real values; the legacy file is left in place as a backup either way.
- **Interim `.settings/` directory** — an earlier build of this branch stored settings at `.settings/settings.yaml` (a *directory* named `.settings` containing a `settings.yaml` file). Since a file and a directory can't share the name `.settings`, migration renames the interim file to a temp name (`.settings.migrating`), removes the now-empty `.settings/` directory, then renames the temp file to `.settings`.

The function is a no-op once a `.settings` **file** already exists — it explicitly checks `statSync(...).isFile()` before bailing, because a leftover interim `.settings/` *directory* would otherwise also make `existsSync` true and short-circuit the migration. Best-effort throughout (each step is wrapped so a partial failure falls through to the next strategy rather than throwing).

### 2.3 Lifecycle

| Event | Behaviour |
|-------|-----------|
| Vault opened, file absent | `initializeSettings` writes a clean comment-free defaults file from `SETTINGS_SCHEMA` |
| Vault opened, file present | `reconcileSettings` first runs `migrateSettingsLocation`, then fills any missing schema keys while preserving existing values, comments, key order, and unknown keys; skips if the file is corrupt |
| Corrupt YAML | File left untouched; backend degrades to `DEFAULTS` for runtime config |
| `POST /set-setting` | `setSettingInFile` runs `reconcileSettings` first, then edits the YAML document in place via `doc.setIn(path, value)` — one key at a time, preserving everything else |
| Frontend toggle | Sends `POST /set-setting` with a `path: string[]` and `value`; backend is the only writer |

### 2.4 Concurrent Write Safety

All writes to `.settings` are serialized through a per-vault **promise-chain mutex** (`settingsMutexes` map in `settings.ts`). Concurrent `POST /set-setting` requests chain onto the same promise, so 100+ simultaneous requests all persist without TOCTOU clobbering.

### 2.5 Git Exclusion

`backup.ts` adds both `.settings` and `.daemon` to `<vault>/.git/info/exclude` (idempotent — `EXCLUDE_LINES = [".settings", ".daemon"]` in `core/src/backup.ts`) so git snapshots never track the settings file or the daemon's runtime brain. This prevents committing personal appearance preferences, API keys, or per-device paths (and, for `.daemon`, runtime junk like `daemon.pid`, `session-id`, logs, and `.triggers` files that the daemon already version-controls on its own) into a vault's git history.

### 2.6 Key Sections

The schema (`core/src/schema/settingsSchema.ts`) is the authoritative field list; the frontend `Settings` interface must stay in parity (`settings.parity.test.ts`). Notable sections:

- `appearance` — theme, fonts, accent colour
- `graph` — node size, repulsion, link distance, spin
- `vault` — `backupOnSave: true` (default)
- `attachments` — `folder: "attachments"`, `onDrop: "copy"`, `naming`
- `daemon` — `enabled: false` (the only key; master switch for this vault's daemon — see §6). The daemon's name lives in `<vault>/.daemon/identity.md` frontmatter, not here
- `templates` — `folder: ""` (subfolder containing `.md` templates)
- `dailyNotes` — list of daily-note configs (`id`, `label`, `icon`, `folder`, `fileName`, `template`)
- `toolbar` — list of sidebar toolbar button configs
- `folderIcons` — `{ "<vault-relative-folder>": "<IconName>" }` free-form map
- `properties` — user-defined property type registry (delivered to the frontend via `GET /schema`, stripped from `GET /settings`)
- `keybindings` — per-action key combos
- `srs` — spaced-repetition algorithm parameters

---

## 3. Templates

Templates are `.md` files under `.settings → templates.folder` (defaults to `""`, i.e. the vault root). `listTemplates` walks that subfolder recursively, skipping dotfiles and non-`.md` files, and returns sorted `{ name, path }` pairs where `name` is the basename without the `.md` extension.

---

## 4. Vault Git Snapshots

`core/src/backup.ts` implements a **local-only** git repository inside the vault for point-in-time snapshots. No remote is ever added.

### 4.1 Repository Initialisation

`ensureRepo(dir)` runs:

```bash
git -C <dir> init -q
git -C <dir> config user.email "vault@local"
git -C <dir> config user.name "Bismuth"
```

These run only when `.git/` is absent. On every call (including existing repos) it also calls `ensureExclude` to add `.settings` and `.daemon` to `.git/info/exclude`.

### 4.2 Snapshot Format

`commitVault(dir, message)`:

1. Calls `ensureRepo`
2. `git add -A` (stages all changes)
3. Checks `git status --porcelain` — if empty, returns `false` (no commit made)
4. Commits with `git commit -q -m "<message>"`
5. Returns `true`

Commit messages follow the pattern `vault snapshot YYYY-MM-DD HH:MM` (UTC, ISO slice, space-separated via `snapshotMessage()`).

`vault.backupOnSave = true` (the default) triggers a snapshot on every save via `POST /backup`. The snapshot is local: `git remote` is always empty.

### 4.3 What Is Tracked

Everything staged by `git add -A` except `.settings` and `.daemon` (both excluded via `.git/info/exclude`). This includes notes, drawings, sheets, templates, and attachment files. Dotfile directories (`.trash`) are not explicitly excluded from git; if they exist they will be committed unless the user adds them to `.gitignore`.

---

## 5. Backend Layout Cache

`core/src/layout-cache.ts` precomputes and persists 2D + 3D graph layouts so the browser never runs a force simulation.

### 5.1 Location

```
~/.bismuth/layout-cache/
```

The constant `CACHE_DIR = process.env.BISMUTH_LAYOUT_CACHE_DIR || join(homedir(), ".bismuth", "layout-cache")`. It lives under a **durable** app dir, not `os.tmpdir()` — macOS periodically purges `/tmp`, which was wiping the cache between sessions and forcing a cold rebuild on every reopen. Override with `BISMUTH_LAYOUT_CACHE_DIR` (tests redirect it to an isolated temp dir).

**Why not the vault?** Writing into the vault would trip the file-system watcher and create an infinite invalidate → rebuild → recompute → rewrite loop. The cache dir is intentionally outside any watched directory.

### 5.2 File Format

Each cached layout is a single JSON file:

```
~/.bismuth/layout-cache/<version>-<sha1_16hex>.json
```

The filename is the `graphSig`:

```
<CACHE_VERSION>-<16-hex-chars>
```

Current `CACHE_VERSION = "v9"`. The version prefix is bumped whenever the layout algorithm or cache shape changes (e.g. v9 added the persisted full-layout warm-seed that powers incremental add-only relayout) — bumping the version causes all existing cached files to be ignored on the next run (stale files are never explicitly deleted).

The SHA-1 is computed over the `vaultKey` string + sorted node ids + sorted `from|to|kind` edge triples. This means retargeting a wikilink (same node set and edge count, different connectivity) correctly busts the cache.

File contents:

```json
{
  "pos3d": { "<nodeId>": [x, y, z], ... },
  "pos2d": { "<nodeId>": [x, y, z], ... }
}
```

`pos2d` entries always have `z = 0` (the 2D layout is seeded from the flattened 3D one, then refined with `dimensions: 2`). On `GET /graph` the server calls `attachLayout` which reads from the disk cache (or computes fresh), then sets `node.position = pos3d[id]` and `node.position2d = [x, y]` (z dropped) on each node.

### 5.3 Two-Tier Caching

1. **In-memory** (`memCache: Map<string, Layout>`) — survives for the lifetime of a server process, eliminates disk reads for warm layouts
2. **On-disk** (`~/.bismuth/layout-cache/<sig>.json`) — survives across server restarts

`peekLayout` checks both tiers without computing; `layoutFor` computes on miss and writes both tiers.

### 5.4 Warm-Starting

`lastFullLayout: Map<string, Layout>` (keyed by `vaultKey`) stores the most recent full-graph layout per vault. On the next structural edit, `attachLayout` passes `lastFullLayout.get(vaultKey)?.pos3d` as the `seed` to `computeLayoutAsync`, skipping the expensive cold PivotMDS step and running only `REFINE_TICKS = 120` force ticks. This keeps the layout stable across edits.

---

## 6. The Daemon: Machine Home + Per-Vault Brains

The in-repo **`@bismuth/daemon`** workspace (`daemon/src/**`) is **one machine process that multiplexes per-vault "brains"** — machine-level identity in a single home dir, plus a separate `.daemon` brain folder inside each enabled vault. `core/src/daemon.ts` is Bismuth's read/write window onto this on-disk state; it only ever writes `owner.json` and the cron/process control files.

### 6.1 Machine Home Directory Resolution

The machine-level identity dir (`daemonMachineDir()` in `core/src/daemon.ts`; `MACHINE_DIR` in `daemon/src/lib/config.ts`) resolves as:

```
BISMUTH_DAEMON_DIR   (env override)   ||   ~/.bismuth/daemon   (default)
```

There is **no `daemon.home` setting** and no host override in `.settings`; the default is **not** `~/.claude-bot`. (`~/.claude-bot` survives only as a one-time, copy-only legacy migration source — see §6.6.)

### 6.2 File Structure

The machine home holds only **machine-level identity + runtime state** (one device, one owner, reachable from mobile):

```
~/.bismuth/daemon/             (= daemonMachineDir / MACHINE_DIR)
  device-id              — plain text UUID for this machine (no trailing newline after trim)
  devices.json           — { "<deviceId>": { "label": string, "lastSeenISO": string }, ... }
  owner.json             — { "ownerDeviceId": string, "ownerLabel": string, "updatedAt": ISO }
                            (ABSENT = vault is unclaimed)
  daemon.pid             — running daemon's integer PID; presence + liveness ⇒ running
  vaults.json            — JSON array of absolute vault roots the daemon knows about
  logs/                  — daemon log output
  .claude-bot-migrated   — marker recording which vault the legacy brain migrated into (§6.6)
```

Each enabled vault keeps its own **brain** — crons, processes, memory, session, and the daemon's name — under `<vault>/.daemon` (`vaultDaemonDir(vault)` in `core/src/daemon.ts`; `vaultPaths()` in `daemon/src/lib/config.ts`):

```
<vault>/.daemon/               (= vaultDaemonDir(vault))
  identity.md            — the daemon's name (`name:` frontmatter) + personality/system-prompt body
  session-id             — per-vault conversation session id (for resume)
  memory/                — this vault's 3rd-brain memory notes ($BISMUTH_MEMORY_DIR)
  crons/
    <name>.md            — cron def; YAML frontmatter { name?, schedule, enabled?, timeout?, catchup? }
    .last-fired.json     — { "<name>": { "timestamp": ISO, "result": string } }
    .running.json        — { "<name>": { "startedAt": ISO } }
    .triggers/
      <basename>         — ISO timestamp file; polled by daemon (~5s) to trigger on-demand run
  processes/
    <name>.md            — process def; YAML frontmatter { name?, command, enabled? }
    .triggers/
      <basename>         — ISO timestamp file; nudges daemon to reconcile process runtime
```

The daemon's **name** comes from `<vault>/.daemon/identity.md`'s `name:` frontmatter (`daemonIdentityName(vault)`), defaulting to `"daemon"` when absent — it is not a setting, and the daemon-graph hub label is `"daemon"`.

The default crons are **embedded string constants** in the daemon binary (`daemon/src/daemon/defaultCrons.ts`: `dream` = hourly memory consolidation, `vault-review` = every-4-hours model-of-the-user pass), seeded **non-clobbering** into `<vault>/.daemon/crons` on setup by `reconcileSeeds` (`daemon/src/daemon/seeds.ts`) — existing files are never overwritten.

### 6.3 Files Bismuth Reads

Every read is fault-tolerant (`try/catch` returning `null` or empty on failure). The machine-home reads:

- `device-id` → `thisDeviceId()`: trimmed string, null if absent/empty
- `devices.json` → `listDevices()`: returns `{ devices, ownerDeviceId }`
- `owner.json` → `getOwner()`: returns `Owner | null`
- `daemon.pid` → `daemonStatus()`: reads PID, checks liveness with `pidAlive()`; `running: false` if absent or dead PID

Per-vault `.daemon` reads (cron/process defs, last-fired, running) back the daemon graph (`core/src/daemonGraph.ts`).

### 6.4 Files Bismuth Writes

Bismuth only ever writes `owner.json` (machine home) and the per-vault cron/process control files; all are byte-compatible with what the daemon reads.

**`owner.json`** (`setOwner(deviceId)`, machine home):

```json
{
  "ownerDeviceId": "<deviceId>",
  "ownerLabel": "<label from devices.json>",
  "updatedAt": "<ISO timestamp>"
}
```

Throws if `deviceId` is not a known device in `devices.json`.

**`crons/.triggers/<basename>`** and **`processes/.triggers/<basename>`** (under the vault's `.daemon`) — a plain ISO timestamp string. Written by `runCron` (on-demand cron trigger) and `setProcessEnabled` (process reconcile trigger). `setCronEnabled` does NOT write a trigger (the daemon re-reads cron files on every tick). Trigger filenames are always the file **basename** (e.g. `dream`, not `Pretty Name`), even when the cron's frontmatter `name` differs from its filename.

**`crons/<name>.md` / `processes/<name>.md`** — `setCronEnabled` and `setProcessEnabled` flip the `enabled` frontmatter key via `setFrontmatterKey`, preserving all other content. (These accessors take the target `.daemon` dir as their `home` argument, resolved from the active vault.)

### 6.5 Install & Lifecycle

Bismuth never starts the daemon as a Tauri child — it must outlive the app to keep firing crons. Setup lives in `core/src/daemonInstall.ts`: `installDaemonFromBundle()` copies the bundled `bismuth-daemon` binary to `~/.bismuth/bin` (version-gated by a size+mtime marker), then runs `<bin> --ensure-installed` to register the OS service. `installStatus()` returns `{ installed, running, binPath }`; `runSetup()` returns `{ ok, binPath, error? }` and is what `POST /daemon/update` calls. The service ids are launchd `com.bismuth.daemon` / systemd `bismuth-daemon` (`daemon/src/lib/platform.ts`). The daemon updates **with the app** — there is no `daemon.autoUpdate` setting and no git-pull self-update.

### 6.6 Legacy Migration

`migrateDaemonState(vault)` performs a **one-time, copy-only** import of a legacy brain directory (`~/.claude-bot/{memory,crons,processes}`, overridable via `BISMUTH_LEGACY_CLAUDE_BOT_DIR`) into `<vault>/.daemon`. It is per-file merge (never clobbers seeded defaults or existing notes), gated machine-wide by a `.claude-bot-migrated` marker in the machine home recording the destination vault, so the brain lands in exactly one vault. The legacy source is **never deleted or moved** — it stays as a permanent backup. Best-effort; never throws.

### 6.7 Name Resolution

`resolveDaemonFile(dir, name)` maps a graph node label to a file basename:

1. If `<name>.md` exists in `dir` → return `name`
2. Otherwise scan all `*.md` files for one whose `frontmatter.name` equals `name` → return that file's basename (without `.md`)
3. Returns `null` if no match; callers throw `AppError("ENOENT")` when null

---

## 7. Relay Plugin and PTY Environment

### 7.1 Plugin Directory

The relay plugin lives in the `relay/` workspace at the repo root. Its path relative to `core/src/terminal.ts` is:

```javascript
const RELAY_PLUGIN_DIR = resolve(import.meta.dir, "..", "..", "relay");
// resolves to <repo-root>/relay/
```

Nothing is installed in `~/.claude` — the plugin loads per-session only inside Bismuth terminal tabs.

### 7.2 PATH Shim

```
<repo-root>/relay/shim/claude     — executable script
```

For non-zsh shells, this directory is prepended to the PTY's `PATH` so `claude` in the terminal transparently becomes `claude --plugin-dir <relay>`.

### 7.3 zsh ZDOTDIR Init

```
<repo-root>/relay/shim/zdotdir/
  .zshenv    — sources the user's real ~/.zshenv first
  .zshrc     — sources the user's real ~/.zshrc, then defines a `claude` shell function
                that runs `command "$BISMUTH_REAL_CLAUDE" --plugin-dir "$BISMUTH_RELAY_PLUGIN" "$@"`
  .zsh_history  — (tracked in git) zsh history file for the zdotdir context
```

For zsh shells, `ZDOTDIR` is pointed at this directory instead of prepending to `PATH`. The `.zshrc` restores `ZDOTDIR="$HOME"` before sourcing the user's real `.zshrc`, so nested shells and user config behave normally. Using a shell function instead of a PATH entry means `.zshrc` files that re-prepend `PATH` cannot shadow it.

### 7.4 Environment Variables Injected into Every PTY

`buildPtyEnv` (pure, tested) sets these variables in every terminal tab's environment:

| Variable | Value | Purpose |
|----------|-------|---------|
| `TERM` | `xterm-256color` | Terminal type |
| `CLAUDE_RELAY_URL` | `http://localhost:<relayPort>` | Where relay hooks POST |
| `CLAUDE_TERMINAL_ID` | UUID (the PTY session id) | Provenance for the agents graph |
| `DISABLE_AUTO_UPDATE` | `true` | Suppress oh-my-zsh update prompt |
| `DISABLE_UPDATE_PROMPT` | `true` | Same |
| `BISMUTH_REAL_CLAUDE` | absolute path to `claude` binary | Set only when `claude` resolves |
| `BISMUTH_RELAY_PLUGIN` | `<repo-root>/relay` | Set only when `claude` resolves |
| `ZDOTDIR` | `<repo-root>/relay/shim/zdotdir` | zsh-only; overrides startup files |
| `PATH` | `<shim-dir>:<original-PATH>` | Non-zsh fallback; set only when `claude` resolves |

`claude` is resolved **once** at server startup with an augmented `CLAUDE_LOOKUP_PATH` that includes `/opt/homebrew/bin`, `/usr/local/bin`, `~/.bun/bin`, and `~/.local/bin` so it works when the GUI app inherits a minimal `launchd` PATH. If `claude` cannot be found, all shim variables are omitted and the tab runs as a plain shell.

### 7.5 Relay Registry (In-Process)

The relay registry (`core/src/relay.ts`) is **purely in-memory** — there is no on-disk state. Sessions and subagents are pruned when their PTY closes (at `GET /agent-graph` read time). Finished subagents linger for 60 seconds (`DONE_SUBAGENT_TTL_MS = 60_000`) before being pruned so brief subagents remain visible for a beat.

---

## 8. Browser `localStorage` Keys

All `localStorage` access is guarded against unavailability and quota errors; failures degrade gracefully to the in-memory state.

| Key | File | Purpose |
|-----|------|---------|
| `bismuth-tabs-v1` | `App.tsx` | Serialized tab/pane layout (restored on next launch) |
| `bismuth-sidebar-visible-v1` | `App.tsx` | Sidebar visible/hidden boolean (`"1"` / `"0"`) |
| `bismuth-graph-cache-v1` | `App.tsx` | Last fetched `GraphData` (structure only, no `views` layouts); seeds the graph on boot so it paints instantly |
| `bismuth-theme-vars-v1` | `App.tsx` | CSS variable map for the active theme; also read by an inline `<head>` script in `index.html` to apply the theme before the bundle loads |
| `bismuth-settings-cache-v1` | `app/src/settings.ts` | Last hydrated `Settings` object; seeds the reactive store on the next launch |
| `three-brains.settings` | `app/src/settings.ts` | **Legacy key** — read once for first-launch migration, then removed |
| `oa:graph:viewMode` | `app/src/GraphView.tsx` | 2D / 3D toggle (`"2d"` or `"3d"`); **not** in `.settings` |
| `bismuth-graphpos:v5:2d` | `app/src/graph/WebGLRenderer.ts` | Settled 2D node positions (id → `[x, y, z]` with `z=0`); merged on save |
| `bismuth-graphpos:v5:3d` | `app/src/graph/WebGLRenderer.ts` | Settled 3D node positions (id → `[x, y, z]`); merged on save |
| `bismuth-folds:<vault-relative-path>` | `app/src/editor/foldBlocks.ts` | Set of locked-open fold block ids per note; absent = no locks |
| `three-brains.harper` | `app/src/editor/harperStore.ts` | Harper spell-checker personal dictionary and ignored lints (`{ words, ignoredLints }`) |

### Notes on graph position keys

The graph position keys are versioned (`v5`). The version is bumped whenever the layout algorithm changes so stale cached positions are dropped and a fresh settle runs. On quota overflow, `evictOtherPositionCaches` removes all `bismuth-graphpos:*` keys except the one being saved, then retries. If the retry also fails, the save is silently skipped.

The positions are merged (not overwritten) on save: the existing blob is parsed and current node positions are overlaid by id. This means a large-but-slowly-changing vault reuses ~99% of cached positions across loads instead of cold-starting every time.

### Notes on the row cache

The Bases row cache (`app/src/bases/rowCache.ts`) is a **pure in-memory** `Map` (a `RowCache<T>` instance), not a `localStorage` entry. It is invalidated when the SSE server version advances (a vault change). There is no cross-session persistence for row data.

---

## 9. Summary of Paths at a Glance

```
$BISMUTH_VAULT/                         # vault root (required)
  **/*.md                            # notes (indexed, graph nodes)
  **/*.draw                          # drawing documents (JSON DrawingDoc)
  **/*.sheet                         # Univer workbook snapshots
  .settings                          # app settings — hidden, extensionless (excluded from git)
  attachments/                       # default attachment folder (configurable)
    *.png *.pdf *.mp4 …              # pasted/dropped assets (capped at 100 MB each)
  <templates.folder>/                # templates subfolder (default: vault root)
    *.md                             # template files
  .trash/                            # soft-delete graveyard (dotdir, not indexed)
    <epoch>-<basename>               # deleted file/folder
  .git/                              # local-only git repo for vault snapshots
    info/exclude                     # contains ".settings" + ".daemon" entries (added by backup.ts)

$BISMUTH_MEMORY/                          # 3rd-brain memory dir (required; may be empty)
  *.md                               # 3rd-brain memory notes (mem: namespace in graph)

~/.bismuth/layout-cache/      # backend layout cache (durable; outside vault to avoid watcher loop)
  v5-<16hex>.json                    # precomputed pos3d + pos2d per graph signature

~/.bismuth/daemon/  (or $BISMUTH_DAEMON_DIR)   # daemon MACHINE home (identity only)
  device-id                          # this machine's UUID
  devices.json                       # all heartbeating devices
  owner.json                         # claimed owner device (absent = unclaimed)
  daemon.pid                         # running daemon's PID
  vaults.json                        # absolute roots of known vaults
  logs/                              # daemon log output
~/.bismuth/bin/bismuth-daemon        # installed daemon binary (launchd/systemd service)

$BISMUTH_VAULT/.daemon/                 # this vault's daemon BRAIN (per-vault)
  identity.md                        # daemon name (frontmatter) + personality/system prompt
  session-id                         # per-vault conversation session id
  memory/                            # this vault's 3rd-brain memory notes
  crons/<name>.md                    # cron definitions (seeded: dream, vault-review)
  crons/.last-fired.json             # last run timestamp + result per cron
  crons/.running.json                # currently-running crons
  crons/.triggers/<basename>         # on-demand run trigger files (written by Bismuth)
  processes/<name>.md                # background process definitions
  processes/.triggers/<basename>     # process reconcile trigger files (written by Bismuth)

~/.claude-bot/                          # LEGACY claude-bot brain — copy-only migration source

Browser localStorage:
  bismuth-tabs-v1                         # tab/pane layout
  bismuth-sidebar-visible-v1              # sidebar state
  bismuth-graph-cache-v1                  # last GraphData for instant boot paint
  bismuth-theme-vars-v1                   # CSS variable map for pre-bundle theme apply
  bismuth-settings-cache-v1               # last Settings object for instant boot seed
  oa:graph:viewMode                  # "2d" or "3d" toggle (not in .settings)
  bismuth-graphpos:v5:2d                  # settled 2D node positions
  bismuth-graphpos:v5:3d                  # settled 3D node positions
  bismuth-folds:<path>                    # per-note locked fold block ids
  three-brains.harper                # Harper spell-checker state
  three-brains.settings              # legacy key (imported once, then deleted)

<repo-root>/relay/shim/             # PTY PATH shim (not installed, ephemeral per-session)
  claude                             # exec wrapper: claude --plugin-dir <relay>
  zdotdir/
    .zshenv                          # sources user ~/.zshenv
    .zshrc                           # sources user ~/.zshrc; defines claude() function
    .zsh_history                     # zsh history for the zdotdir context
```

---

Source: `core/src/files.ts`, `core/src/settings.ts`, `core/src/layout-cache.ts`, `core/src/daemon.ts`, `core/src/daemonInstall.ts`, `core/src/daemonGraph.ts`, `daemon/src/lib/config.ts`, `daemon/src/lib/platform.ts`, `daemon/src/daemon/defaultCrons.ts`, `daemon/src/daemon/seeds.ts`, `core/src/terminal.ts`, `core/src/backup.ts`, `core/src/relay.ts`, `core/src/schema/settingsSchema.ts`, `core/src/server.ts`, `app/src/App.tsx`, `app/src/GraphView.tsx`, `app/src/graph/WebGLRenderer.ts`, `app/src/viewCache.ts`, `app/src/settings.ts`, `app/src/editor/foldBlocks.ts`, `app/src/editor/harperStore.ts`, `app/src/bases/rowCache.ts`, `relay/shim/zdotdir/.zshrc`, `relay/shim/zdotdir/.zshenv`, `core/test/files.test.ts`, `core/test/settings.test.ts`, `core/test/backup.test.ts`, `core/test/layout-cache.test.ts`, `core/test/daemon.test.ts`, `core/test/terminal.test.ts`
