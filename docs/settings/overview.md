# Settings Overview

This page explains how Bismuth's settings *system* works end to end: the `.settings` file's lifecycle, the schema that drives it, the frontend store that mirrors it, and the wiring in between. Read it if you're adding a new setting, debugging why a value isn't taking effect, or just want to understand the plumbing. For the exhaustive list of every section and key with its default, see the [Settings Reference](reference.md); for the theme/color system specifically, see [Themes & Palette](themes.md).

Bismuth's settings system is entirely schema-driven: there is no settings GUI page. The file `.settings` — a single hidden, extensionless YAML file at the root of every vault — IS the settings page — it is opened as a normal note in the editor, where schema-aware autocomplete (Ctrl-Space) and inline lint provide discovery and validation. All settings changes go through the backend as the single writer, ensuring the YAML document structure (comments, unknown keys, the `properties:` registry) is never clobbered by a frontend toggle. The schema (`core/src/schema/settingsSchema.ts`) is the single source of truth for field names, types, defaults, numeric bounds, and documentation strings; the frontend `Settings` interface (`app/src/settings.ts`) and the CSS custom-property projection (`app/src/settingsCssVars.ts`) are kept in lockstep with it by parity tests.

> **Historical note**: the vault settings file used to be named `settings.yaml` at the vault root. It is now `.settings` (still YAML, just hidden and extensionless) — see [Filename History and Migration](#filename-history-and-migration) below. This doc uses `.settings` throughout; older docs/discussions may still say `settings.yaml`.

---

## Architecture at a Glance

```
SETTINGS_SCHEMA (core)      ← single source of truth
    │
    ├── DEFAULTS (derived)  ← plain nested object seeded synchronously into the frontend store
    ├── reconcileSettings   ← fills missing keys on vault open, preserving comments
    ├── setSettingInFile     ← per-key in-place merge (POST /set-setting)
    ├── serializeSettings    ← file merged over defaults → GET /settings
    ├── settingsComplete.ts  ← Ctrl-Space autocomplete inside the editor
    ├── yamlSchema.ts        ← inline lint
    └── settingsCssVars.ts   ← projects appearance/ui/terminal/calendar → CSS :root vars
```

The 2D/3D graph dimension is intentionally **not** a setting — it is a transient per-window localStorage toggle in `GraphView.tsx` and never rewrites `.settings`.

---

## The `.settings` File

### Location

Always at `<vault-root>/.settings` (the constant `SETTINGS_FILE = ".settings"`, `core/src/settings.ts:17`). There is no global settings file; every vault has its own. It's a single hidden, extensionless file — still plain YAML underneath, just without a `.yaml` extension or a visible name, so it doesn't clutter the file tree as an ordinary note.

### Filename History and Migration

The settings file was originally named `settings.yaml` at the vault root (constant `LEGACY_SETTINGS_FILE = "settings.yaml"`, `core/src/settings.ts:19`). It was later renamed to the current hidden `.settings` file. `migrateSettingsLocation(vault)` (`core/src/settings.ts:29-60`) runs at the top of every `reconcileSettings` call and does a one-time, idempotent, best-effort relocation in three stages:

1. **Already migrated**: if `.settings` exists AND is a regular file, it's a no-op — return immediately.
2. **Interim half-migration**: if a `.settings/settings.yaml` *directory* exists (an earlier build of this feature briefly used `.settings/` as a folder containing `settings.yaml`), collapse it into the `.settings` *file* — rename the inner file out to a temp name (`.settings.migrating`), remove the now-empty `.settings/` directory, then rename the temp file to `.settings`. (A file and a directory can't share the same name mid-move, hence the temp hop.)
3. **Legacy vault-root file**: if a vault-root `settings.yaml` exists and `.settings` doesn't, `renameSync` it to `.settings`. A rename (not a copy) preserves the user's comments and values verbatim. If the rename fails (a lock, an odd filesystem), it falls back to `copyFileSync` so `.settings` still ends up populated (the legacy file is left behind as a backup); if even that fails, the vault silently reverts to defaults via the normal reconcile/seed path.

All of this is best-effort and silent — a vault that has never used `settings.yaml` (freshly created) or that's already on `.settings` is completely unaffected.

### First Launch

On first open of a vault `initializeSettings` is called. If `.settings` is absent, a clean, **comment-free** file is written from the schema's materialized defaults. The file ships without comments by design — discoverability is via the editor's Ctrl-Space autocomplete, which shows each key's `doc` string and valid range. Example of the generated file:

```yaml
appearance:
  theme: ink
  icon: hopper-crystal
  editorFont: Monaspace Xenon
  editorFontSize: 13.5
  ...
graph:
  spin: true
  nodeSize: 6
  repulsion: -10
  ...
keybindings:
  command-palette: Mod+P
  terminal: "Mod+`, Mod+J"
  ...
```

### On Every Vault Open: `reconcileSettings`

`reconcileSettings(vault)` runs on vault open. It:
1. First calls `migrateSettingsLocation` (see [Filename History and Migration](#filename-history-and-migration) above) to relocate any legacy `settings.yaml`/interim `.settings/` layout into the `.settings` file.
2. If `.settings` is absent, calls `initializeSettings` to write full defaults.
3. If the file exists, parses it via the YAML CST (`parseDocument`).
4. If the file has YAML parse errors, leaves it **completely untouched** (avoids clobbering a half-edited file).
5. If the top-level value is not a YAML map (empty/scalar/corrupt), leaves it untouched.
6. Otherwise calls `fillMissing` recursively: for every schema key absent from the file, inserts the default. **Does not remove unknown keys.**
7. Writes back only if something actually changed (no spurious writes/SSE churn).

Key properties of `reconcileSettings`:
- Preserves all user-written comments (including inline `# ...` after values).
- Preserves existing user values; never overwrites them.
- Preserves any keys not present in the schema (unknown keys survive).
- Adding a new schema entry self-reconciles on next vault open — no migration code needed.
- A corrupt file is never written to; the user must fix it manually.

```typescript
// Real test demonstrating preservation:
await writeNote(vault, SETTINGS_FILE, // ".settings"
  "# my notes\nappearance:\n  theme: ink # inline\n");
await reconcileSettings(vault);
// Raw file still contains "# my notes" and "# inline"
// Missing keys (graph, editor, …) are added with defaults
```

### The Per-Key Merge: `setSettingInFile`

`setSettingInFile(vault, path, value)` is the **only** backend write path for individual settings. It:
1. Runs `reconcileSettings` first (ensures the file exists and is fully shaped).
2. Reads the current raw file.
3. Uses `doc.setIn(path, value)` on the YAML CST — surgical in-place update.
4. Writes the result back, preserving all other keys, comments, and key order.

The path is a `string[]` array, e.g. `["appearance", "theme"]` or `["graph", "nodeSize"]`.

This is guarded by a **per-vault mutex** (`settingsMutexes` — a `Map<vault, Promise<void>>`) that serializes all concurrent `POST /set-setting` requests for the same vault, preventing TOCTOU races on the read-modify-write cycle. 100+ concurrent mutations are handled safely (verified by tests).

```typescript
// Setting a value:
await setSettingInFile(vault, ["appearance", "theme"], "paper");
await setSettingInFile(vault, ["graph", "nodeSize"], 12);

// Unknown keys and siblings are preserved:
// Before: appearance:\n  theme: ink\n  myCustom: 1\n# hdr
// After:  appearance:\n  theme: paper\n  myCustom: 1\n# hdr
```

### Serving Settings to the Frontend: `serializeSettingsForFrontend`

`GET /settings` returns `serializeSettingsForFrontend(vault)`:
1. Starts from `structuredClone(DEFAULTS)`.
2. Reads and parses `.settings` (tolerates malformed YAML → `data = {}`).
3. For each known section:
   - `folderIcons` — passed through as a free-form string map via `readFolderIconsFrom`.
   - `toolbar` — parsed via `readToolbarFrom` (validates item structure, drops malformed items).
   - `dailyNotes` — parsed via `readDailyNotesFrom` (validates item structure, drops malformed items).
   - All other sections: per-key `typeof` check; wrong-type values are silently dropped back to defaults. Numeric keys with out-of-range values (below `min` or above `max`) are dropped. Enum keys with unknown values are dropped.
4. Strips the `properties` section (delivered separately by `GET /schema`).

This means a corrupt or partial `.settings` degrades gracefully to defaults — nothing explodes.

---

## The Schema (`SETTINGS_SCHEMA`)

Defined in `core/src/schema/settingsSchema.ts`. Every section is an `object` entry with nested `SchemaEntry` fields.

### `SchemaEntry` Fields

```typescript
interface SchemaEntry {
  type: PropertyType;    // the type (see below)
  default?: unknown;     // materialized into DEFAULTS; required for every leaf
  doc?: string;          // shown in Ctrl-Space autocomplete; required for every leaf
  min?: number;          // lower bound (numeric types; enforced in serializeSettings)
  max?: number;          // upper bound (numeric types; enforced in serializeSettings)
}
```

### `PropertyType` Values

| Type | Description |
|---|---|
| `"string"` | Arbitrary string |
| `"number"` | Number, optionally bounded by `min`/`max` |
| `"boolean"` | `true` or `false` |
| `"date"` | Date string |
| `"datetime"` | Datetime string |
| `"file"` | Vault file path |
| `"icon"` | Lucide icon name or emoji |
| `"keybind"` | Shortcut combo string (e.g. `"Mod+P"`); drives the "Record shortcut" autocomplete |
| `{ kind: "path", only?: "dir"\|"file", scope?: "templates" }` | Vault path; completion narrows to dirs/files/templates |
| `{ kind: "enum", values: string[], caseInsensitive?: boolean, allowPrefixes?: string[] }` | One of a fixed set of strings |
| `{ kind: "list", item?: PropertyType }` | YAML sequence |
| `{ kind: "object", fields: Schema }` | Nested YAML map |

---

## All Schema Sections and Keys

### `appearance`

| Key | Type | Default | Range | Description |
|---|---|---|---|---|
| `theme` | enum | `ink` | 4 values | Bismuth color theme; selects all colors in the app and graph. Values: `ink` (default, dark), `paper` (light), `cathode` (phosphor-terminal, dark), `riso` (cream+indigo, light). |
| `icon` | enum | `hopper-crystal` | 14 values | App logo mark (favicon + sidebar). Values: `hopper-crystal`, `node-b`, `square-funnel`, `nested-diamonds`, `pinwheel`, `node-crystal`, `lattice`, `diamond-bloom`, `node-diamond`, `octagon-bloom`, `spin-cross`, `tri-bloom`, `radial-graph`, `node-rings`. |
| `editorFont` | enum | `Monaspace Xenon` | `Monaspace Xenon`, `Monaspace Neon`, `Monaspace Argon`, `Monaspace Krypton`, `Monaspace Radon` | Editor prose font — a Monaspace variant; the whole app is one monospace grid. |
| `uiFont` | enum | `Monaspace Xenon` | `Monaspace Xenon`, `Monaspace Neon`, `Monaspace Argon`, `Monaspace Krypton`, `Monaspace Radon` | UI chrome font — the Monaspace variant for rail, tabs, tables, buttons, menus. |
| `editorFontSize` | number | `13.5` | 11–28 | Note prose font size in px — the design system's own prose size (`--fs-body-lg`), the one thing NOT at the 11.5px `--fs-ui` chrome size. |
| `sidebarWidth` | number | `266` | 200–600 | Left sidebar width in px (the ASCII design's 266px vault rail). |
| `sidebarGraphHeight` | number | `305` | 200–500 | Mini graph panel height in the sidebar in px. |
| `uiFontSize` | number | `11.5` | 11–16 | Base UI font size (sidebar, tabs, menus) in px (the ASCII design's `--fs-ui` workhorse size). |
| `monoScale` | number | `1` | 0.6–1.0 | Optical-size factor for Monaspace (the mono UI/code font). The serif-vs-mono optical correction is legacy — the all-mono UI needs none; `1` = no correction. |
| `tabFontSize` | number | `11.5` | 11–14 | Editor tab label font size in px. |
| `sidebarIconFontSize` | number | `12` | 11–20 | Sidebar header icon button size in px. 12, not the 11.5px `--fs-ui` text size: the pixel icons are drawn on a 24x24 grid, so 12 is an exact half-scale landing every stem on whole device pixels. |
| `paletteInputFontSize` | number | `15` | 13–18 | Command palette search-input font size in px. |

There are **no per-color override keys** in `appearance` — the theme is the single source of color. Flat keys like `background`, `foreground`, `accent`, or `accentPalette` do not exist in the schema and are stripped by the type check in `serializeSettingsForFrontend`.

### `graph`

| Key | Type | Default | Range | Description |
|---|---|---|---|---|
| `spin` | boolean | `true` | — | Idle rotation of the 3D graph. |
| `showFps` | boolean | `false` | — | Show the frame-rate (FPS) counter. |
| `spinSpeed` | number | `0.0015` | 0–0.01 | Idle spin speed in radians/frame. |
| `repulsion` | number | `-10` | -40 – -1 | No effect currently (see note below) — was d3-force `forceManyBody` strength; more negative = nodes push apart harder. |
| `linkDistance` | number | `5` | 1–40 | No effect currently (see note below) — was target distance between linked nodes. |
| `centering` | number | `0.13` | 0–0.5 | No effect currently (see note below) — was `forceX/Y/Z` strength toward the origin; higher = denser ball. |
| `nodeSize` | number | `6` | 2–16 | No effect currently (see note below) — was base node radius. |
| `showGraphLabels` | boolean | `true` | — | Master toggle for in-scene labels. |
| `graphLabelHubCount` | number | `10` | 0–30 | Count of top-degree nodes that always have a label. |
| `nodeSizeMinMult` | number | `0.4` | 0.1–1.0 | No effect currently (see note below) — was the size multiplier for a 0/1-degree leaf (smallest dot). |
| `nodeSizeDegreeGain` | number | `0.45` | 0.1–1.5 | No effect currently (see note below) — was how fast node size grows with `sqrt(link count)`. |
| `nodeSizeMaxMult` | number | `6` | 2–12 | No effect currently (see note below) — was ceiling on node size (largest hub vs leaf). |
| `mapDefaultZoom` | number | `2` | 1–18 | Default zoom for the Bases map view when it can't fit all markers. |
| `refreshDebounceMs` | number | `300` | 100–1000 | Delay before rebuilding the graph after an edit burst in ms. |
| `backgroundNoise` | boolean | `false` | — | The faint ASCII noise texture under the graph field. Off by default. |

The graph's 2D/3D view mode is **intentionally absent** from this section. It is a transient `localStorage` toggle in `GraphView.tsx` and never writes `.settings`.

`repulsion`, `linkDistance`, `centering`, `nodeSize`, `nodeSizeMinMult`, `nodeSizeDegreeGain`, and `nodeSizeMaxMult` currently have no effect — they're vocabulary from the pre-ASCII force-directed renderer. The keys still exist and validate, but nothing reads them: `GraphView.tsx`'s `buildConfig()` never forwards them into `GraphConfig`, and `core/src/layout.ts`'s force-directed pass uses its own hardcoded constants instead. Kept for now as a deliberately deferred product decision, not removed.

### `editor`

| Key | Type | Default | Range | Description |
|---|---|---|---|---|
| `livePreview` | boolean | `true` | — | Render markdown inline as you type. |
| `lineNumbers` | boolean | `false` | — | Show line numbers. |
| `lineWrapping` | boolean | `true` | — | Wrap long lines. |
| `spellcheck` | boolean | `true` | — | Spell check the note body (Harper). |
| `grammarCheck` | boolean | `false` | — | Grammar + style check the note body (Harper); independent of spellcheck, off by default. |
| `autoSaveDelay` | number | `800` | 200–3000 | Milliseconds of idle before auto-saving. |
| `lineHeight` | number | `1.5` | 0.8–1.8 | Editor prose line height, as a multiplier of the app's row unit (`--row-h`, 18px), not the font size. Default `1.5` -> 27px, the same row cadence as the sidebar tree, tabs, and graph rows in a 2:3 relationship (two prose lines span exactly three tree rows). Prose is the proportional serif (`--prose-font`) at ~16.9px; 27px of leading gives a 1.6 ratio, the normal range for serif body text — 18px (the old 13.5px-mono-tuned default) would only give 1.07, visibly cramped. |
| `defaultMode` | enum | `source` | `source`, `visual` | How every note opens: `source` (raw Markdown editor) or `visual` (the no-code, Notion-like editor). The only control; there is no per-note toggle. |
| `mathMacros` | string | `""` | — | LaTeX preamble of `\newcommand`/`\def` definitions applied to ALL math (KaTeX), mirroring Obsidian's `preamble.sty`. Available in every `$...$` and `$$...$$` across the vault. |
| `wrapSelection` | boolean | `true` | — | With text selected, typing a wrapping character surrounds the selection instead of replacing it (e.g. select a word, press `*` → `*word*`). |
| `wrapSelectionChars` | list (string) | `["*", "_", "~", "`"]` | — | Characters that wrap the current selection when typed (each surrounds it with itself; `(` `[` `{` `<` pair to `)` `]` `}` `>`). Brackets and quotes already wrap via auto-close, so they're omitted by default. |

### `vault`

| Key | Type | Default | Description |
|---|---|---|---|
| `backupOnSave` | boolean | `true` | Take a git snapshot after every save. |

### `attachments`

| Key | Type | Default | Description |
|---|---|---|---|
| `folder` | string | `attachments` | Folder for new pasted/dropped attachments (relative to vault root). `""` = vault root, `"."` = current note's folder. Auto-created if missing. |
| `onDrop` | enum | `copy` | Behavior when dragging a file in from outside the vault. `copy` = copy into the attachment folder (keeps vault self-contained). `reference` = reference in place. Note: ⌥-drop always references regardless of this setting. |
| `naming` | string | `Pasted image {timestamp}` | Filename template for pasted clipboard images (extension added automatically). `{timestamp}` expands to a sortable date-time stamp. Name collisions get a numeric suffix. |

Embed resolution is always filename-first (like wikilinks), so moving an attachment later never breaks its `![[name]]` embed — `folder` only controls where NEW files land.

### `calendar`

| Key | Type | Default | Range | Description |
|---|---|---|---|---|
| `defaultView` | enum | `week` | `month`, `week`, `3day`, `day` | Default calendar view. Must stay in sync with `ViewType` in `app/src/calendar/types.ts`. |
| `weekStartsOnMonday` | boolean | `true` | — | Start the week on Monday. |
| `militaryTime` | boolean | `false` | — | Use 24-hour time format. |
| `monthCellMinHeight` | number | `80` | 50–160 | Minimum height of a day cell in month view in px. |
| `timeGutterWidth` | number | `50` | 40–80 | Width of the hour-label gutter in week/day views in px. |
| `defaultCategoryColor` | string | `#4a90e2` | — | Default color for a newly created event category (hex string). |

### `googleCalendar`

Two-way Google Calendar sync — connection-level config shared by every synced calendar. **Non-secret operational config only** — the OAuth client credentials and tokens live OUTSIDE the vault (`~/.bismuth/gcal`), never in `.settings` or git. Connect via the "Connect Google Calendar…" command. The single OAuth scope is `calendar.events` (read+write events only; no Gmail/Drive/contacts access).

**Which calendar base syncs with which Google calendar is now PER-CALENDAR**, declared on each calendar base's own frontmatter (not here): `googleCalendarSync: true` turns sync on for that base, and `googleCalendarId` (default `primary`) picks the Google calendar. Set both from the calendar's settings panel (or hand-edit the base frontmatter). A vault can have several calendars, each synced with a different Google calendar. See `docs/gcal/overview.md`.

| Key | Type | Default | Range | Description |
|---|---|---|---|---|
| `enabled` | boolean | `false` | — | **LEGACY** (now per-calendar). Old global on/off switch; honored only as a migration fallback for the base named by `basePath`. New calendars use each base's `googleCalendarSync` frontmatter key. |
| `calendarId` | string | `primary` | — | **LEGACY** (now per-calendar). Old global calendar id; honored only for the base named by `basePath`. New calendars set `googleCalendarId` in their own frontmatter. |
| `basePath` | string | `""` | — | **LEGACY** (now per-calendar). Old global "which calendar base to sync" pointer. Kept as a migration pointer; new setups enable sync per calendar in that calendar's settings instead. |
| `conflictPolicy` | enum | `lastWriteWins` | `lastWriteWins`, `googleWins`, `bismuthWins` | How to resolve an event changed on BOTH sides since the last sync. Applies to every synced calendar. |
| `syncIntervalMinutes` | number | `15` | 1–1440 | Auto-sync cadence in minutes for every synced calendar (manual sync is always available). |
| `timeZone` | string | `""` | — | IANA timezone applied to naive (untimed) events when pushing to Google (blank = system timezone). |

### `ui`

| Key | Type | Default | Range | Description |
|---|---|---|---|---|
| `paletteTopOffset` | string | `12vh` | — | How far down the screen the command palette appears (CSS length, e.g. `12vh`). |
| `paneDividerWidth` | number | `5` | 3–12 | Thickness of the draggable divider between split panes in px. |
| `cardGridMinWidth` | number | `220` | 150–360 | Minimum card width in Bases cards view in px. |
| `kanbanColumnMinWidth` | number | `248` | 180–360 | Minimum Bases kanban column width in px. |
| `kanbanColumnMaxWidth` | number | `288` | 220–420 | Maximum Bases kanban column width in px. |
| `mapMinHeight` | number | `480` | 300–800 | Minimum height of the Bases map view in px. |
| `tableMinColWidth` | number | `60` | 30–150 | Minimum column width when resizing a Bases table in px. |

### `server`

| Key | Type | Default | Range | Description |
|---|---|---|---|---|
| `fileWatchDebounceMs` | number | `250` | 50–2000 | Coalesce rapid file changes for this long before rebuilding caches in ms. |
| `sseHeartbeatMs` | number | `5000` | 1000–30000 | Keepalive ping interval for the live-update stream in ms. |

### `daemon`

| Key | Type | Default | Range | Description |
|---|---|---|---|---|
| `enabled` | boolean | `false` | — | Master switch for this vault's daemon — the per-vault assistant that runs crons/processes in the background, injects this vault's memory into its Claude sessions, and shows the 3rd-brain + daemon graph modes. Off = dormant: state is preserved on disk and the `.daemon` folder is hidden. Set automatically from the first-run intro; toggle anytime. The daemon's NAME lives in its identity file (`.daemon/identity.md` frontmatter), not here. |
| `inboxRetentionDays` | number | `7` | 1–90 | How long a resolved daemon-inbox page (sent/discarded/failed) stays listed before it's garbage-collected (days). GC runs opportunistically whenever the inbox is read — no separate cron or ticker. |
| `backend` | enum | `claude` | `claude`, `codex` | Which agent CLI runs this vault's daemon brain (unattended, resumable, headless). A REQUEST, not a guarantee — `resolveDaemonBackend` (`daemon/src/daemon/session.ts`) refuses any non-Claude backend for a vault with even one hidden/chat-only note and degrades to `claude` instead, logging why. |
| `inheritUserMcp` | boolean | `false` | — | Let this vault's daemon sessions use the MCP servers and plugins installed for your own `claude` CLI (user scope: `~/.claude.json` servers + `~/.claude/settings.json` plugins), on top of the always-present vault-targeted `bismuth` server. Off by default because a cron runs unattended with permissions bypassed and no confirmation prompt. Project- and local-scope settings are never loaded regardless — the session's cwd is the vault root, so a `.mcp.json` sitting in your notes would otherwise auto-execute. |

The daemon is **one machine process** (the in-repo `@bismuth/daemon` workspace, `daemon/src/**`) that multiplexes per-vault "brains". Machine identity (device-id, `devices.json`, `owner.json`, `daemon.pid`, logs, `vaults.json`) lives at `~/.bismuth/daemon` (`daemonMachineDir()` = `BISMUTH_DAEMON_DIR || ~/.bismuth/daemon`); each enabled vault's brain — crons, processes, memory, session-id, `identity.md` — lives under `<vault>/.daemon`. There is no `daemon.home` or `daemon.autoUpdate` setting; the daemon updates WITH the app (no git-pull self-update). Install/setup is `core/src/daemonInstall.ts` (`installDaemonFromBundle()` copies the bundled `bismuth-daemon` binary to `~/.bismuth/bin`, then runs `<bin> --ensure-installed`); the service ids are launchd `com.bismuth.daemon` / systemd `bismuth-daemon`.

### `update`

| Key | Type | Default | Description |
|---|---|---|---|
| `autoUpdate` | boolean | `false` | Auto-apply Bismuth app updates on launch in the background, then relaunch when the rebuild is ready (off = manual via the update banner). |

### `terminal`

| Key | Type | Default | Range | Description |
|---|---|---|---|---|
| `fontSize` | number | `13` | 9–20 | Terminal font size in px. |
| `lineHeight` | number | `1.5` | 1.2–2.0 | Terminal line height multiplier. |
| `cursorWidth` | number | `2` | 1–4 | Terminal cursor bar width in px. |
| `cursorGlideMs` | number | `70` | 20–200 | Cursor glide animation duration in ms. |
| `cursorBlinkSeconds` | number | `1.2` | 0.6–2.0 | Cursor blink cycle duration in seconds. |

### `chat`

Visual Claude chat (the `/chat` WS session, `core/src/chat.ts`) behavior.

| Key | Type | Default | Range | Description |
|---|---|---|---|---|
| `computerUse` | boolean | `false` | — | Enable Claude's browser/computer-use capability (`--chrome`) so the model can see and interact with a Chromium browser. Requires a Chromium-based browser (Chrome/Edge/Brave). Claude Code provider only. |
| `provider` | enum | `claude` | 9 values | Default chat provider for NEW chat tabs: `claude` runs Claude Code, `opencode` runs opencode, `codex` runs OpenAI Codex, `cline` runs Cline, `gemini` runs Gemini CLI, `goose` runs Goose, `openclaw` runs OpenClaw, `claude-code-acp` runs Claude Code (ACP), `codex-acp` runs Codex (ACP). Each chat can still pick its own provider in the header. |

The enum is sourced from `BACKEND_IDS` (`core/src/agentBackends/catalog.ts`), so adding a backend never needs a schema edit.

### `mcp`

Multi-CLI MCP registration (`core/src/agentBackends/mcpRegistrars.ts`): which OTHER agent CLIs, besides Claude Code (which always auto-registers on boot via `bismuthInstall.ts`), also get Bismuth's stdio MCP server (docs + `bismuth` CLI + memory tools) written into their own global config.

| Key | Type | Default | Description |
|---|---|---|---|
| `registerWith` | list (string) | `[]` | Additional agent CLIs to register Bismuth's MCP server with, e.g. `["codex", "gemini"]`. Registrar ids: `codex`, `cline`, `openclaw`, `gemini`, `qwen`, `copilot`, `amp`, `droid`, `crush`, `goose`. Listing a CLI here IS the opt-in — registration runs on the next app start (and on demand via `bismuth install --mcp <cli>` / `--mcp all`). Empty by default, so Bismuth never writes into another CLI's config uninvited; registration is idempotent and never clobbers an entry it didn't write. |

### `codex`

OpenAI Codex-specific opt-ins (`core/src/agentBackends/agentsMd.ts` + `codexHooks.ts`). Codex has no system-prompt flag and no PATH-shim hook mechanism — `AGENTS.md` and a project-scoped `.codex/hooks.json` are its own designed channels for memory + session telemetry, but both mean writing into files the user may hand-edit, so both keys default off (same opt-in precedent as `mcp.registerWith`).

| Key | Type | Default | Description |
|---|---|---|---|
| `writeAgentsMd` | boolean | `false` | Let Bismuth write/refresh a managed block in this vault's `AGENTS.md` with a short persona/memory note for the Codex CLI. The block is delimited by markers and never touches surrounding prose. |
| `installRelayHooks` | boolean | `false` | Let Bismuth write a project-scoped `.codex/hooks.json` (+ its small reporting script) into this vault so a Codex session run in a Bismuth terminal tab or chat reports its lifecycle into Bismuth's in-process relay registry — the same role Claude Code's relay plugin plays. |

### `srs` (Spaced-Repetition)

| Key | Type | Default | Range | Description |
|---|---|---|---|---|
| `baseEase` | number | `250` | 130–400 | Starting ease factor for a new flashcard (SM-2). Higher = longer intervals. |
| `easyBonus` | number | `1.3` | 1.0–2.0 | Extra interval multiplier when a card is rated "easy". |
| `lapsesIntervalChange` | number | `0.5` | 0.1–1.0 | Interval multiplier when a card is rated "hard" (lapse penalty). |
| `minEase` | number | `130` | 50–250 | Floor on a card's ease factor. |
| `easeStep` | number | `20` | 5–50 | Ease delta per review. |
| `easyGraduatingInterval` | number | `4` | 1–14 | Days until next review when a new card is rated "easy". |
| `goodGraduatingInterval` | number | `1` | 1–3 | Days until next review when a new card is rated "good"/"hard". |

### `templates`

| Key | Type | Default | Description |
|---|---|---|---|
| `folder` | path (dir) | `Templates` | Vault folder holding template `.md` files. Option+T inserts one at the cursor. |
| `newNote` | path (scope: templates) | `""` | Vault path to a template `.md` used to pre-fill a brand-new note (the New Note command and the file-tree "New File" action). Empty = no template (plain empty note). |

### `properties`

A free-form `{name: typeString}` map for the vault-wide property registry. Seeded empty on first launch. Edited directly in the YAML. Parsed separately via `GET /schema` (not included in `GET /settings`). Valid type strings: `string`, `number`, `boolean`, `date`, `datetime`, `file`, `list`, or an object with an `enum` sub-key.

```yaml
properties:
  due: date
  status:
    enum: [todo, doing, done]
  rating: number
  tags: list
```

### `folderIcons`

A free-form `{folderPath: iconName}` string map. Seeded empty. Written by right-clicking a folder → "Set icon" (calls `POST /folder-icon` which calls `setFolderIcon`). Not intended for manual editing but valid YAML.

```yaml
folderIcons:
  projects: Folder
  archive: Archive
  Journal: BookOpen
```

Empty or non-string values are dropped by `readFolderIconsFrom`.

### `folderVisibility`

A free-form `{folderPath: "chat-only"|"hidden"}` string map (folders have no frontmatter of their own to carry a `visibility` key). Seeded empty. Written via `POST /folder-visibility`; nearest-ancestor-wins resolution lives in `core/src/visibility.ts`. This restricts the daemon's and in-app chat's own tool calls from reading a marked note or folder — it is an honesty boundary, not a security boundary, and it never restricts the vault owner (editor/FileTree/graph/CLI) or their own interactive terminal Claude sessions. Per-file visibility is a note's own `visibility:` frontmatter key, not this section.

```yaml
folderVisibility:
  private: hidden
  drafts: chat-only
```

### `toolbar`

A YAML sequence of button objects. Each button must have:
- `icon` (required): a Lucide icon name (e.g. `FilePlus`) or an emoji.
- Either `command` (single string) or `commands` (list of strings) — not both; `commands` wins when both are present.
- `tooltip` (optional): hover text; defaults to the command's label.

Malformed items (missing `icon`, missing both `command`/`commands`, non-string or empty values) are **silently dropped**. An explicit empty list `[]` is honored.

```yaml
toolbar:
  - command: new-note
    icon: FilePlus
  - command: new-folder
    icon: FolderPlus
  - command: search
    icon: Search
  - command: terminal
    icon: SquareTerminal
    tooltip: Open terminal tab
  - commands:
      - new-note
      - terminal
    icon: Rocket
    tooltip: Note + terminal
```

Default toolbar has three buttons: `create-menu` (icon `Plus`), `search` (icon `Search`), and `open-inbox` (icon `Inbox`) — the daemon inbox button, hidden while the daemon is off and carrying a due-count badge.

### `tabBar`

A YAML sequence of button objects — the tab-bar action buttons (right of the tab strip). Same item shape and rendering as `toolbar` (`command`/`commands`, `icon`, `tooltip`), configured the same way.

Default tab bar has three buttons: `new-tab` (icon `SquarePlus`), `terminal` (icon `SquareTerminal`), and `new-claude-chat` (icon `MessageSquare`).

```yaml
tabBar:
  - command: new-tab
    icon: SquarePlus
  - command: terminal
    icon: SquareTerminal
  - command: new-claude-chat
    icon: MessageSquare
```

### `dailyNotes`

A YAML sequence of daily-note type configurations. Each entry must have `id` (non-empty) and `fileName` (non-empty); other fields have defaults. Malformed items are dropped; an explicit empty list is honored.

| Field | Required | Default | Description |
|---|---|---|---|
| `id` | yes | — | Stable identifier; forms the command `daily-note:<id>`. |
| `label` | no | `id` value | Command-palette label and default button tooltip. |
| `icon` | no | `CalendarDays` | Lucide icon name or emoji. |
| `folder` | no | `""` | Vault folder for entries (`""` = vault root). |
| `fileName` | yes | — | Filename pattern using `{{date}}` and other tokens; no `.md` extension. |
| `template` | no | `""` | Vault path to a template `.md` to pre-fill new notes. |

Default configuration has one entry: `journal` (folder `Journal`, fileName `{{date}} journal`, template `Templates/Journal.md`).

```yaml
dailyNotes:
  - id: journal
    label: Journal
    icon: BookOpen
    folder: Journal
    fileName: "{{date}} journal"
    template: Templates/Journal.md
  - id: work
    label: Work Log
    icon: Briefcase
    folder: Work/Logs
    fileName: "{{date}} work"
```

### `keybindings`

A nested object (not a list), one string key per app-level action. Values are combo strings using `Mod` (= Cmd on macOS, Ctrl elsewhere). Comma-separate alternatives. Defaults are derived from `KEYBINDING_CATALOG` in `core/src/keybindings.ts`.

```yaml
keybindings:
  find: Mod+F
  command-palette: Mod+P
  quick-switcher: Mod+O
  terminal: "Mod+`, Mod+J"
  split-right: Mod+D
  split-down: Mod+Shift+D
  equalize-panes: Mod+Alt+=
  close-pane: Mod+W
  new-tab: Mod+T
  reopen-tab: Mod+Shift+T
  history-back: Mod+[
  history-forward: Mod+]
  focus-pane-left: Mod+Alt+ArrowLeft
  focus-pane-right: Mod+Alt+ArrowRight
  focus-pane-up: Mod+Alt+ArrowUp
  focus-pane-down: Mod+Alt+ArrowDown
  new-claude-chat: Mod+Shift+C
  insert-template: Alt+T
  toggle-sidebar: Alt+S
```

The `keybindings` section is placed **last** in the schema so it appears at the bottom of a freshly generated `.settings`.

---

## `DEFAULTS` — The Materialized Default Object

`DEFAULTS` (exported from `core/src/schema/settingsSchema.ts`) is a plain nested object derived by `deriveDefaults(SETTINGS_SCHEMA)` — it recursively materializes the `default` field of every leaf into a nested plain object. It is the synchronous seed for both the backend's `AppConfig` type and the frontend's `Settings` store.

`DEFAULTS` includes the `properties` and `folderIcons` keys (both `{}`). The `properties` key is stripped by `serializeSettingsForFrontend` before sending to the frontend.

The frontend re-exports `DEFAULTS` from the schema spine — there is one copy, not two.

---

## Frontend Settings Store (`app/src/settings.ts`)

The Solid.js store is initialized **synchronously** from `mergeServerSettings(readCache("bismuth-settings-cache-v1"))` — reading the last hydrated settings from `localStorage`. This ensures the correct theme/fonts/sizes paint on the first frame without a flash of defaults.

### Hydration Lifecycle

1. **Synchronous seed**: store seeded from `localStorage` cache (or `DEFAULTS` on cold cache).
2. **Boot hydrate**: `GET /settings` is fetched; result is `mergeServerSettings`'d and reconciled into the store via `solid-js/store` `reconcile`.
3. **SSE re-hydrate**: when `.settings` appears in an SSE change event, `GET /settings` is refetched. If the merged result equals the live store (own write echo), the update is a no-op.
4. **Persist on change**: a 600ms debounced effect diffs the live store against `lastSnapshot` using `diffLeaves` and fires one `POST /set-setting` per changed leaf. Persistence only starts after the first hydrate, so the synchronous seed is never persisted over the user's file.
5. **localStorage mirror**: a separate effect mirrors the live store to `localStorage` (key `bismuth-settings-cache-v1`) on every change, enabling the fast first-paint seed on next launch.

### `mergeServerSettings(parsed)`

A pure function used both for the `localStorage` seed and the server JSON. It clones `DEFAULTS`, then for each known section key, copies over stored values that pass a `typeof` check — missing or wrong-type values fall back to defaults. Array-typed top-level sections (like `toolbar`, `dailyNotes`) are replaced wholesale when the server sends an array; otherwise the default is kept.

### `diffLeaves(prev, next)`

Walks `next`, emitting `{ path: string[], value }` for every leaf whose value differs from `prev`. Arrays are compared whole as leaves. Keys only in `prev` are ignored (the store never drops keys). This is the mechanism that ensures only changed leaves are posted to `POST /set-setting`, preserving comments and the `properties:` registry.

---

## Backend Runtime Config: `AppConfig` and `loadAppConfig`

The backend consumes settings at runtime via `loadAppConfig(vault): Promise<AppConfig>`. It calls `serializeSettingsForFrontend` and casts the result to `AppConfig`. The typed sections consumed by backend modules:

```typescript
interface AppConfig {
  server: { fileWatchDebounceMs: number; sseHeartbeatMs: number };
  daemon: { enabled: boolean; inboxRetentionDays: number };
  templates?: { folder: string };
  srs: SrsConfig;        // identity match for core/src/srs/scheduler.ts SrsConfig
  googleCalendar?: {
    enabled: boolean;
    calendarId: string;
    basePath: string;
    conflictPolicy: "lastWriteWins" | "googleWins" | "bismuthWins";
    syncIntervalMinutes: number;
    timeZone: string;
  };
  [section: string]: unknown;
}
```

Other sections (`graph`, `appearance`, `ui`, etc.) are present at runtime but not typed in `AppConfig`; reach them via the index signature.

---

## CSS Custom Property Projection (`app/src/settingsCssVars.ts`)

`settingsToCssVars(settings)` produces a `{ "--var": "value" }` map applied to `:root` via `setCssVars`. It is pure and DOM-free. `applyCssVars(settings)` calls both and also sets `color-scheme` (for native form controls/scrollbars).

The function is called reactively in `App.tsx` whenever `settings` changes. The same map shape is computed by an inline script in `index.html` from the `localStorage` cache — this is what makes the correct theme appear before the React tree mounts.

### Settings → CSS Custom Properties Mapping

| Setting | CSS Variable |
|---|---|
| `appearance.editorFont` | `--editor-font` (resolved to full CSS font stack via `FONT_STACKS`) |
| `appearance.editorFontSize` | `--editor-font-size` |
| `appearance.sidebarWidth` | `--sidebar-width` |
| `appearance.sidebarGraphHeight` | `--sidebar-graph-height` |
| `appearance.uiFontSize` | `--ui-font-size` |
| `appearance.monoScale` | `--mono-scale` |
| `appearance.tabFontSize` | `--tab-font-size` |
| `appearance.sidebarIconFontSize` | `--sidebar-icon-font-size` |
| `appearance.paletteInputFontSize` | `--palette-input-font-size` |
| `ui.paletteTopOffset` | `--palette-top-offset` |
| `ui.paneDividerWidth` | `--pane-divider-width` |
| `ui.cardGridMinWidth` | `--card-grid-min` |
| `ui.kanbanColumnMinWidth` | `--kanban-col-min` |
| `ui.kanbanColumnMaxWidth` | `--kanban-col-max` |
| `ui.mapMinHeight` | `--map-min-height` |
| `editor.lineHeight` | `--prose-line-height` |
| `calendar.monthCellMinHeight` | `--month-cell-min-h` |
| `calendar.timeGutterWidth` | `--time-gutter-width` |
| `terminal.cursorWidth` | `--term-cursor-width` |
| `terminal.cursorGlideMs` | `--term-cursor-glide` |
| `terminal.cursorBlinkSeconds` | `--term-cursor-blink` |

Additionally, all color/theme tokens are projected from the selected Bismuth theme via `resolveAppearance(s.appearance)` (see `app/src/themes.ts`). These include `--bg`, `--fg`, `--accent`, `--border`, `--panel`, `--surface-1/2/3`, `--rail`, `--editor`, `--hover-bg`, and the full graph ramp (`--graph-0` through `--graph-4`), plus derived accents (`--teal`, `--blue`, `--violet`, `--grad`), category colors (`--green`, `--gold`, `--rose`), and terminal colors (`--term-bg`, `--term-fg`).

---

## Autocomplete and Lint in the Editor

When `.settings` is open in the Bismuth editor:

- **Autocomplete** (`editor/settingsComplete.ts`): Ctrl-Space suggests setting keys (scoped to the current section) and values (enum members, `true`/`false`, property type names, Lucide icon names, keybind combos with a "Record shortcut…" option). Each suggestion shows the key's `doc` string and a compact range label (e.g. `11–28` for bounded numbers, `option1 | option2 | …` for enums). The autocomplete is nested-schema-aware (knows which section the cursor is in).
- **Lint** (`editor/yamlSchema.ts`): inline diagnostics highlight wrong types, out-of-range numbers, and unknown enum values.

The `doc` field on each `SchemaEntry` is the text shown in the autocomplete. A parity test (`app/src/settings.parity.test.ts`) enforces that every settable leaf has both a materialized `default` AND a non-empty `doc`.

---

## HTTP API for Settings

| Endpoint | Description |
|---|---|
| `GET /settings` | Returns `serializeSettingsForFrontend(vault)` — file merged over defaults, `properties` section stripped. |
| `GET /schema` | Returns the vault property registry (from `.settings` `properties:` section) for note validation and autocomplete. |
| `GET /config` | Read-only launch config: `{ vault, memory }`. |
| `POST /set-setting` | Merges one value at `path` into `.settings` in place. Body: `{ path: string[], value: unknown }`. Goes through `mutatingHandler` — invalidates caches and broadcasts an SSE event with `paths: [".settings"]`. |

The `POST /set-setting` endpoint validates that `body.path` is a non-empty `string[]`. A non-array or array with non-string elements returns HTTP 400. An empty path is a no-op (returns success without writing).

---

## How to Add a New Setting

Adding a setting requires changes in exactly three places, with no migration code:

### 1. Add to the Schema (`core/src/schema/settingsSchema.ts`)

Add an entry to the appropriate section inside `SETTINGS_SCHEMA`. Every leaf entry must have a `type`, a `default` equal to the current hardcoded value (so upgrades are behavioral no-ops), and a non-empty `doc` string.

```typescript
// Example: adding a new boolean to the editor section
editor: object({
  // ... existing keys ...
  myNewToggle: {
    type: "boolean",
    default: false,
    doc: "Description shown in Ctrl-Space autocomplete.",
  },
}),
```

After this change, `DEFAULTS` is automatically updated (derived from the schema). `reconcileSettings` will add the key to existing `.settings` files on next vault open. The autocomplete and lint pick it up automatically. The `settings.parity.test.ts` parity tests enforce that the default and doc are present.

### 2. Add to the Frontend `Settings` Interface (`app/src/settings.ts`)

Add the matching field to the `Settings` interface. The `settings.parity.test.ts` test will catch a mismatch.

```typescript
editor: {
  // ... existing fields ...
  myNewToggle: boolean;
};
```

### 3. Wire the Consumer

**CSS-driven setting** (a size, duration, color, or other CSS value):
- Add one line to `settingsToCssVars` in `app/src/settingsCssVars.ts`:
  ```typescript
  "--my-new-var": s.editor.myNewToggle ? "1" : "0",
  ```
- Reference it in the relevant CSS file:
  ```css
  .my-element { opacity: var(--my-new-var, 1); }
  ```

**Frontend logic setting** (read in a component or effect):
- Read `settings.editor.myNewToggle` reactively in the Solid component.

**Backend logic setting** (read in the server or a backend module):
- Call `loadAppConfig(vault)` and read `cfg.editor.myNewToggle`.
- The backend re-reads `loadAppConfig` per-request (it is not cached indefinitely); `.settings` changes are reflected within the next request after an SSE cycle.

**Adding a new top-level section** additionally requires updating the hardcoded key list in `core/test/schema/settingsSchema.test.ts` (the test asserting `Object.keys(SETTINGS_SCHEMA).sort()` — this is a guard, not a source of truth).

---

## Edge Cases and Gotchas

- **Corrupt `.settings`**: if the file has YAML parse errors or the top-level value is not a map, `reconcileSettings` leaves it untouched. The user must fix it manually. Reading a corrupt file via `readSettings` returns `{ raw, data: {} }` — callers fall back to defaults.
- **Migration is best-effort and silent**: `migrateSettingsLocation` (run at the top of every `reconcileSettings`) never throws; a failed rename falls back to a copy, and total failure just means the vault reconciles fresh defaults into a new `.settings` file (the legacy `settings.yaml` is left on disk untouched in every failure case).
- **`properties:` is stripped from `GET /settings`**: the property registry is delivered by `GET /schema`, not `GET /settings`. A `properties` key in the parsed server data is never forwarded to the frontend settings store.
- **Unknown keys survive reconcile AND `setSettingInFile`**: custom YAML keys not in the schema are never removed by any of the backend write operations. The parity-test and `serializeSettingsForFrontend` simply ignore them.
- **`toolbar` and `dailyNotes` are list sections**: they are validated item-by-item; malformed items are silently dropped (not errored). In `mergeServerSettings` on the frontend, array-typed top-level sections are replaced wholesale — the default is only used if the server sends a non-array.
- **Empty-path `setSettingInFile` call is a no-op**: `if (!path.length) return;` at the top of the function.
- **Per-vault mutex scope**: the mutex is keyed by vault path, so concurrent requests against different vaults run in parallel.
- **`folderIcons` written by `POST /folder-icon`**: folder icons are not set via `POST /set-setting`; they go through the dedicated `setFolderIcon(vault, path, icon)` helper which also acquires the per-vault mutex. An empty/null/undefined icon deletes the entry.

Source: `core/src/settings.ts`, `core/src/schema/settingsSchema.ts`, `core/src/schema/types.ts`, `core/src/theme/tokens.ts`, `core/src/agentBackends/catalog.ts`, `core/src/commands.ts`, `core/src/visibility.ts`, `app/src/settings.ts`, `app/src/settingsCssVars.ts`, `app/src/settingsDiff.ts`, `core/test/settings.test.ts`, `core/test/schema/settingsSchema.test.ts`, `core/test/fixtures/upgrade/settings-schema-snapshot.json`, `app/src/settings.parity.test.ts`
