# Settings Reference

This is the canonical, exhaustive reference for Bismuth's vault `.settings` file (a single hidden, extensionless YAML file at the vault root — `SETTINGS_FILE` in `core/src/settings.ts`). It documents **every** top-level section and **every** key in the settings schema (`core/src/schema/settingsSchema.ts`), including each key's name, type, default value, min/max bounds or enum values, and its in-app documentation string. The schema is the single source of truth: the first-launch writer authors a fully commented `.settings` from it, the editor's autocomplete and linter validate against it, and the frontend store seeds from the derived `DEFAULTS`. Defaults always equal the previously hardcoded values, so a fresh install behaves identically to an unconfigured one.

There is **no settings GUI** in Bismuth — the "settings page" is literally `.settings` opened in the editor, with schema-aware autocomplete (each key's doc + valid range) and lint. To change a setting, edit the YAML; the backend is the single writer and merges one key in place via `POST /set-setting` (preserving comments and key order). Editing `.settings` does not require a server restart — it is re-read per request. (A legacy vault-root `settings.yaml` — or the interim `.settings/settings.yaml` folder from an earlier build — is migrated into the `.settings` file automatically on first open; see `migrateSettingsLocation` in `core/src/settings.ts`.)

For how this machinery actually works under the hood — file lifecycle, the frontend store, the CSS projection — see the [Settings Overview](overview.md). This page is the flat reference: every section, every key.

## Schema overview

The schema is a nested object. Top-level keys, in canonical alphabetical-set membership (the test asserts exactly this set):

`appearance`, `attachments`, `calendar`, `chat`, `codex`, `daemon`, `dailyNotes`, `editor`, `folderIcons`, `folderVisibility`, `googleCalendar`, `graph`, `keybindings`, `mcp`, `properties`, `server`, `srs`, `tabBar`, `templates`, `terminal`, `toolbar`, `ui`, `update`, `vault`.

The **declaration order** in the schema (which determines the order in a freshly written `.settings`) is: `appearance`, `graph`, `editor`, `vault`, `attachments`, `calendar`, `googleCalendar`, `ui`, `server`, `daemon`, `update`, `terminal`, `chat`, `mcp`, `codex`, `srs`, `templates`, `properties`, `folderIcons`, `folderVisibility`, `toolbar`, `tabBar`, `dailyNotes`, `keybindings`. The `keybindings` section is deliberately **last** (a test enforces this) so it sits at the end of a fresh file.

### Property types

Every key's `type` is one of the `PropertyType` kinds (`core/src/schema/types.ts`):

| Type | Description |
|------|-------------|
| `"string"` | Free-form text. |
| `"number"` | Numeric; usually carries `min`/`max` slider-style bounds. |
| `"boolean"` | `true`/`false`. |
| `"date"`, `"datetime"` | Date / date-time strings (used in frontmatter, not in the settings sections below). |
| `"file"` | A file reference. |
| `"icon"` | A Lucide icon name (e.g. `"FilePlus"`) **or** an emoji. |
| `"keybind"` | A keyboard combo string (drives order-free shortcut autocomplete + a "record shortcut" option). |
| `{ kind: "path"; only?: "dir" \| "file"; scope?: "templates" \| "fs" }` | A path. `only` narrows completion to directories or files. `scope` selects the completion root: omitted = the vault tree; `"templates"` = the configured templates folder (files only); `"fs"` = the **real filesystem** (absolute or `~`-relative), for paths outside the vault (no current settings key uses `scope: "fs"`, but the kind is supported for filesystem paths). Validated leniently (any string) — the path need not exist yet. |
| `{ kind: "enum"; values: string[]; caseInsensitive?; allowPrefixes? }` | One of a fixed value list. `allowPrefixes` lets values beginning with a listed prefix (e.g. `daily-note:`) also pass. |
| `{ kind: "list"; item?: PropertyType }` | An array of items. |
| `{ kind: "object"; fields: Schema }` | A nested object (a section, or a free-form map when `fields` is empty `{}`). |

> **Gotcha — number bounds are lenient hints, not hard clamps.** `min`/`max` drive the autocomplete hint and lint range, but the value is your edited YAML; out-of-range numbers are flagged by lint, not silently clamped here.

---

## `appearance`

Visual chrome: theme, logo mark, fonts, and sizing. **There are no flat per-color keys** (`background`, `foreground`, `neutral`, `accent`, `accentPalette` are intentionally absent) — the theme is the single source of color. `core/src/theme/tokens.ts` holds the token values (re-exported by `app/src/themes.ts`), and `settingsCssVars.ts` projects them to CSS vars. There are exactly four themes (`THEME_NAMES`, `core/src/theme/tokens.ts`): `ink` and `cathode` are dark, `paper` and `riso` are light.

> **Gotcha — the pre-redesign 12-theme system is gone.** The old `oxide-duotone` / `gunmetal-teal` / `rose-gold` / `indigo-oxide` / `forest-oxide` / `full-sheen` names (and their `-light` variants) are no longer valid `theme` values — `resolveTheme()` silently falls back to `ink` for any unknown name. They survive only as migration INPUTS: `migrateLegacyAppearance` (`core/src/settings.ts`) rewrites a saved legacy dark name to `ink` and a `-light` one to `paper` the first time such a `.settings` file is reconciled, also resetting the redesign's type-scale keys (`editorFontSize`, `uiFontSize`, `tabFontSize`, `sidebarWidth`, …) since those numbers stayed schema-valid across the redesign and would otherwise keep winning over the new defaults forever.

| Key | Type | Default | Bounds / Values | Doc |
|-----|------|---------|-----------------|-----|
| `theme` | enum | `ink` | `ink`, `paper`, `cathode`, `riso` | Bismuth color theme: ink (default) · paper · cathode · riso. |
| `icon` | enum | `hopper-crystal` | `hopper-crystal`, `node-b`, `square-funnel`, `nested-diamonds`, `pinwheel`, `node-crystal`, `lattice`, `diamond-bloom`, `node-diamond`, `octagon-bloom`, `spin-cross`, `tri-bloom`, `radial-graph`, `node-rings` | App logo mark (favicon + sidebar logo). One of the 14 Bismuth marks. |
| `editorFont` | enum | `Monaspace Xenon` | `Monaspace Xenon`, `Monaspace Neon`, `Monaspace Argon`, `Monaspace Krypton`, `Monaspace Radon` | Editor prose font — a Monaspace variant; the whole app is one monospace grid. |
| `uiFont` | enum | `Monaspace Xenon` | `Monaspace Xenon`, `Monaspace Neon`, `Monaspace Argon`, `Monaspace Krypton`, `Monaspace Radon` | UI chrome font — the Monaspace variant for rail, tabs, tables, buttons, menus. |
| `editorFontSize` | number | `13.5` | min `11`, max `28` | Note prose font size (px) — the design system's own prose size (`--fs-body-lg`), the one thing NOT at the 11.5px `--fs-ui` chrome size, because chrome is scanned and prose is read. |
| `sidebarWidth` | number | `266` | min `200`, max `600` | Left sidebar width (px) — the ASCII design's 266px vault rail (tokens/spacing.css). |
| `sidebarGraphHeight` | number | `305` | min `200`, max `500` | Height of the mini graph panel in the sidebar (px). |
| `uiFontSize` | number | `11.5` | min `11`, max `16` | Base UI font size — sidebar, tabs, menus (px) (the ASCII design's `--fs-ui` workhorse size). |
| `monoScale` | number | `1` | min `0.6`, max `1` | Optical-size factor for Monaspace (the mono UI/code font). The serif-vs-mono optical correction is legacy — the all-mono UI needs none; `1` = no correction. |
| `tabFontSize` | number | `11.5` | min `11`, max `14` | Editor tab label font size (px). |
| `sidebarIconFontSize` | number | `12` | min `11`, max `20` | Sidebar header icon button size (px). 12, not the 11.5px `--fs-ui` text size: the pixel icons are drawn on a 24x24 grid, so 12 is an exact half-scale and every stem lands on whole device pixels. |
| `paletteInputFontSize` | number | `15` | min `13`, max `18` | Command palette search-input font size (px). |

Example:

```yaml
appearance:
  theme: cathode
  icon: lattice
  editorFont: Monaspace Xenon
  editorFontSize: 18
  sidebarWidth: 320
```

---

## `graph`

Knowledge-graph rendering and force-layout behavior.

> **Gotcha — the 2D/3D dimension is NOT a setting.** It is a transient, per-window UI toggle (localStorage-backed in `app/src/GraphView.tsx`). There is no `graph.viewMode` key (a test asserts its absence) — switching dimension never rewrites `.settings`. Likewise the old color keys `graph.palette`, `graph.edgeColor`, `graph.backgroundColor` are gone (graph color is derived from `appearance.theme`).
>
> **Gotcha — `repulsion`, `linkDistance`, `centering`, `nodeSize`, `nodeSizeMinMult`, `nodeSizeDegreeGain`, and `nodeSizeMaxMult` currently have no effect.** They're vocabulary from the pre-ASCII force-directed renderer. The keys still exist in the schema and still validate, but nothing reads them: `GraphView.tsx`'s `buildConfig()` never forwards them into `GraphConfig`, and `core/src/layout.ts`'s force-directed pass uses its own hardcoded constants rather than these settings. Removing the keys is a deliberately deferred product decision — this is a documentation note, not a deprecation.

| Key | Type | Default | Bounds | Doc |
|-----|------|---------|--------|-----|
| `spin` | boolean | `true` | — | Idle rotation of the graph. |
| `showFps` | boolean | `false` | — | Show the frame-rate (FPS) counter on the graph. |
| `spinSpeed` | number | `0.0015` | min `0`, max `0.01` | Idle spin speed (radians/frame). |
| `repulsion` | number | `-10` | min `-40`, max `-1` | No effect currently (see Gotcha above) — was node repulsion; more negative pushed apart harder. |
| `linkDistance` | number | `5` | min `1`, max `40` | No effect currently (see Gotcha above) — was target distance between linked nodes. |
| `centering` | number | `0.13` | min `0`, max `0.5` | No effect currently (see Gotcha above) — was pull toward center; higher = denser ball. |
| `nodeSize` | number | `6` | min `2`, max `16` | No effect currently (see Gotcha above) — was base node radius. |
| `showGraphLabels` | boolean | `true` | — | Master toggle for in-scene labels. |
| `graphLabelHubCount` | number | `10` | min `0`, max `30` | Top-degree nodes that always get a label. |
| `nodeSizeMinMult` | number | `0.4` | min `0.1`, max `1` | No effect currently (see Gotcha above) — was the size multiplier for a 0/1-degree leaf node (the smallest dots). |
| `nodeSizeDegreeGain` | number | `0.45` | min `0.1`, max `1.5` | No effect currently (see Gotcha above) — was how fast node size grows with `sqrt(link count)`. |
| `nodeSizeMaxMult` | number | `6` | min `2`, max `12` | No effect currently (see Gotcha above) — was ceiling on node size (biggest hub vs a leaf). |
| `mapDefaultZoom` | number | `2` | min `1`, max `18` | Default zoom for the Bases map view when it can't fit markers. |
| `refreshDebounceMs` | number | `300` | min `100`, max `1000` | Delay before rebuilding the graph after an edit burst (ms). |
| `backgroundNoise` | boolean | `false` | — | The faint ASCII noise texture under the graph field. Off by default. |

Example:

```yaml
graph:
  spin: false
  repulsion: -18
  linkDistance: 8
  graphLabelHubCount: 15
```

---

## `editor`

CodeMirror editor behavior.

| Key | Type | Default | Bounds / Values | Doc |
|-----|------|---------|-----------------|-----|
| `defaultMode` | enum | `source` | `source`, `visual` | How every note opens: `source` (the raw Markdown editor) or `visual` (the no-code, Notion-like editor — no markdown knowledge needed). This is the only control; there is no per-note toggle. |
| `livePreview` | boolean | `true` | — | Render markdown inline as you type. |
| `lineNumbers` | boolean | `false` | — | Show line numbers. |
| `lineWrapping` | boolean | `true` | — | Wrap long lines. |
| `spellcheck` | boolean | `true` | — | Spell check the note body (Harper). |
| `grammarCheck` | boolean | `false` | — | Grammar + style check the note body (Harper). Independent of spellcheck; off by default. |
| `autoSaveDelay` | number | `800` | min `200`, max `3000` | Milliseconds of idle before saving. |
| `lineHeight` | number | `1.5` | min `0.8`, max `1.8` | Editor prose line height, as a multiplier of the app's row unit (`--row-h`, 18px — `ui.css` `:root`), not the font size. Default `1.5` → 27px, the same row cadence as the sidebar tree, tabs, and graph rows in a 2:3 relationship (two prose lines span exactly three tree rows). Prose is the proportional serif (`--prose-font`) at ~16.9px; 27px of leading gives it a 1.6 ratio, the normal range for serif body text — 18px (the old 13.5px-mono-tuned default) would only give 1.07, visibly cramped. |
| `mathMacros` | string | `""` (empty) | — | LaTeX preamble of `\newcommand` / `\def` definitions applied to ALL math (KaTeX), mirroring Obsidian's `preamble.sty`. e.g. `\newcommand{\R}{\mathbb{R}}`. Available in every `$...$` and `$$...$$` across the vault. |
| `wrapSelection` | boolean | `true` | — | With text selected, type a wrapping character to surround the selection instead of replacing it (e.g. select a word, press `*` → `*word*`; press again → `**word**`). |
| `wrapSelectionChars` | list&lt;string&gt; | `["*", "_", "~", "`"]` | — | Characters that wrap the current selection when typed (each surrounds it with itself; `(` `[` `{` `<` pair to `)` `]` `}` `>`). Brackets and quotes `( [ { ' " $` already wrap via auto-close, so they're omitted by default. |

Example:

> **Surface switch — `defaultMode`.** This picks which editor *surface* notes open into: `source` is the CodeMirror Markdown editor (the rest of this section's keys apply to it), while `visual` is the no-code, Notion-like WYSIWYG editor. It is a global, vault-wide switch with no per-note override.

```yaml
editor:
  defaultMode: source
  livePreview: true
  lineNumbers: true
  autoSaveDelay: 1200
  mathMacros: "\\newcommand{\\R}{\\mathbb{R}}"
  wrapSelection: true
  wrapSelectionChars: ["*", "_", "~", "`"]
```

---

## `vault`

Vault-wide behavior.

| Key | Type | Default | Doc |
|-----|------|---------|-----|
| `backupOnSave` | boolean | `true` | Take a git snapshot after every save. |

Example:

```yaml
vault:
  backupOnSave: true
```

---

## `attachments`

Where pasted/dropped attachments (images, PDFs, audio, video) are saved, and what happens when you drag a file in from outside the vault.

> **Note — embeds resolve by filename, not path** (like wikilinks). So `folder` only sets where NEW files land — moving an attachment later never breaks its `![[name]]` embed.

| Key | Type | Default | Values | Doc |
|-----|------|---------|--------|-----|
| `folder` | string | `attachments` | — | Folder for new pasted/dropped attachments (relative to the vault root). Created automatically if missing; `""` = vault root, `"."` = the current note's folder. |
| `onDrop` | enum | `copy` | `copy`, `reference` | Dragging a file in from outside the vault: `copy` it into the attachment folder (default, keeps the vault self-contained), or `reference` it in place (⌥-drop always references). Pasted clipboard images always copy in. Reference-in-place is best-effort in the browser build (the referenced file isn't in the vault, so the embed only resolves on desktop). |
| `naming` | string | `Pasted image {timestamp}` | — | Filename for pasted clipboard images (the extension is added automatically). `{timestamp}` → a sortable date-time stamp; name collisions get a numeric suffix. |

Example:

```yaml
attachments:
  folder: assets/images
  onDrop: copy
  naming: "Screenshot {timestamp}"
```

---

## `calendar`

Calendar Bases-view defaults. (Calendar is a Bases view kind — see [bases overview](../bases/overview.md) — not a standalone page.)

> **Coupling** — `defaultView`'s enum is coupled to `ViewType` in `app/src/calendar/types.ts`. If that union changes, this enum must be updated in lockstep.

| Key | Type | Default | Bounds / Values | Doc |
|-----|------|---------|-----------------|-----|
| `defaultView` | enum | `week` | `month`, `week`, `3day`, `day` | Default calendar view. |
| `weekStartsOnMonday` | boolean | `true` | — | Start the week on Monday. |
| `militaryTime` | boolean | `false` | — | Use 24-hour time. |
| `monthCellMinHeight` | number | `80` | min `50`, max `160` | Minimum height of a day cell in month view (px). |
| `timeGutterWidth` | number | `50` | min `40`, max `80` | Width of the hour-label gutter in week/day views (px). |
| `defaultCategoryColor` | string | `#4a90e2` | — | Default color for a newly created event category (hex). |

Example:

```yaml
calendar:
  defaultView: month
  weekStartsOnMonday: false
  militaryTime: true
  defaultCategoryColor: "#e2844a"
```

---

## `googleCalendar`

Two-way Google Calendar sync — **connection-level** config, shared by every synced calendar. Connect via the "Connect Google Calendar…" command; the single OAuth scope is `calendar.events` (read+write events only — no Gmail/Drive/contacts access).

**Which calendar base syncs with which Google calendar is now PER-CALENDAR**, declared on each calendar base's own frontmatter (not here): `googleCalendarSync: true` turns sync on for that base, and `googleCalendarId` (default `primary`) picks the Google calendar. Set both from the calendar's settings panel (or hand-edit the base frontmatter). A vault can have several calendars, each synced with a different Google calendar. See `docs/gcal/overview.md`.

| Key | Type | Default | Bounds / Values | Doc |
|-----|------|---------|-----------------|-----|
| `conflictPolicy` | enum | `lastWriteWins` | `lastWriteWins`, `googleWins`, `bismuthWins` | How to resolve an event changed on BOTH sides since the last sync: `lastWriteWins` (newest edit wins) · `googleWins` · `bismuthWins`. Applies to every synced calendar. |
| `syncIntervalMinutes` | number | `15` | min `1`, max `1440` | Auto-sync cadence in minutes for every synced calendar (manual sync is always available). |
| `timeZone` | string | `""` (empty) | — | IANA timezone applied to naive (untimed) events when pushing to Google (blank = system timezone). |
| `enabled` | boolean | `false` | — | **LEGACY** (now per-calendar). Old global on/off switch; honored only as a migration fallback for the base named by `basePath`. New calendars use each base's `googleCalendarSync` frontmatter key. |
| `calendarId` | string | `primary` | — | **LEGACY** (now per-calendar). Old global calendar id; honored only for the base named by `basePath`. New calendars set `googleCalendarId` in their own frontmatter. |
| `basePath` | string | `""` (empty) | — | **LEGACY** (now per-calendar). Old global "which calendar base to sync"; kept as a migration pointer. New setups enable sync per calendar in that calendar's settings. |

Example — connection-level `.settings`:

```yaml
googleCalendar:
  conflictPolicy: googleWins
  syncIntervalMinutes: 30
  timeZone: America/New_York
```

Per-calendar linkage, in a calendar base's own frontmatter:

```yaml
---
type: base
views:
  - type: calendar
googleCalendarSync: true
googleCalendarId: primary        # or another calendar's ID
---
```

---

## `ui`

Miscellaneous layout sizing for panes, palettes, and Bases views.

> **Gotcha — there is no `ui.verticalTabs` key.** The horizontal top tab strip (and its opt-out toggle) was removed; tabs are now always the vertical icon rail on the right edge of the app (`app/src/shell/TabRail.tsx`), which expands to reveal full names on hover. This is not a settable behavior any more.

| Key | Type | Default | Bounds | Doc |
|-----|------|---------|--------|-----|
| `paletteTopOffset` | string | `12vh` | — | How far down the screen the command palette appears (CSS length, e.g. `12vh`). |
| `paneDividerWidth` | number | `5` | min `3`, max `12` | Thickness of the draggable divider between split panes (px). |
| `cardGridMinWidth` | number | `220` | min `150`, max `360` | Minimum card width in the Bases cards view (px). |
| `kanbanColumnMinWidth` | number | `248` | min `180`, max `360` | Minimum Bases kanban column width (px). |
| `kanbanColumnMaxWidth` | number | `288` | min `220`, max `420` | Maximum Bases kanban column width (px). |
| `mapMinHeight` | number | `480` | min `300`, max `800` | Minimum height of the Bases map view (px). |
| `tableMinColWidth` | number | `60` | min `30`, max `150` | Minimum column width when resizing a Bases table (px). |

Example:

```yaml
ui:
  paletteTopOffset: 20vh
  paneDividerWidth: 8
  cardGridMinWidth: 280
```

---

## `server`

Backend timing knobs (read via `appConfig` on the server side).

| Key | Type | Default | Bounds | Doc |
|-----|------|---------|--------|-----|
| `fileWatchDebounceMs` | number | `250` | min `50`, max `2000` | Coalesce rapid file changes for this long before rebuilding caches (ms). |
| `sseHeartbeatMs` | number | `5000` | min `1000`, max `30000` | Keepalive ping interval for the live-update stream (ms). |

Example:

```yaml
server:
  fileWatchDebounceMs: 400
  sseHeartbeatMs: 10000
```

---

## `daemon`

Per-vault daemon integration. The daemon is the in-repo `@bismuth/daemon` workspace — **one machine process that multiplexes per-vault "brains"**. When `enabled`, Bismuth runs this vault's brain (crons/processes/memory + a Claude session), injects the vault's memory into its Claude sessions, and shows the 3rd-brain + daemon graph modes; when off the brain is dormant (state is preserved on disk and the `.daemon` folder is hidden).

Machine-level identity (device-id, `devices.json`, `owner.json`, `daemon.pid`, logs, `vaults.json`) lives at `~/.bismuth/daemon` (`daemonMachineDir()` = `BISMUTH_DAEMON_DIR || ~/.bismuth/daemon`). Each enabled vault's brain — crons, processes, memory, session-id, `identity.md` — lives under `<vault>/.daemon`. The daemon updates **with** the app (no git-pull self-update); install/setup is `core/src/daemonInstall.ts`.

> **Note** — the owner device is the single source of truth in `owner.json`, **not** a setting here. The daemon's NAME lives in its identity file (`<vault>/.daemon/identity.md` frontmatter), not in settings. See the Daemon Integration section of `CLAUDE.md`.

| Key | Type | Default | Bounds / Values | Doc |
|-----|------|---------|-----------------|-----|
| `enabled` | boolean | `false` | — | Master switch for this vault's daemon — the per-vault assistant that runs crons/processes in the background, injects this vault's memory into its Claude sessions, and shows the 3rd-brain + daemon graph modes. Off = dormant: state is preserved on disk and the `.daemon` folder is hidden. Set automatically from the first-run intro; toggle anytime. The daemon's NAME lives in its identity file (`.daemon/identity.md` frontmatter), not here. |
| `inboxRetentionDays` | number | `7` | min `1`, max `90` | How long a resolved daemon-inbox page (sent/discarded/failed) stays listed before it's garbage-collected (days). GC runs opportunistically whenever the inbox is read — no separate cron or ticker. |
| `backend` | enum | `claude` | `claude`, `codex` | Which agent CLI runs this vault's daemon brain (unattended, resumable, headless): `claude` (default) or `codex`. This is a REQUEST, not a guarantee — `resolveDaemonBackend` (`daemon/src/daemon/session.ts`) refuses any non-Claude backend for a vault with even one hidden/chat-only note (only Claude Code can enforce the visibility gate) and degrades to `claude` instead, logging why. Clear the vault's hidden notes to actually run another backend. |
| `inheritUserMcp` | boolean | `false` | — | Let this vault's daemon sessions use the MCP servers and plugins installed for your own `claude` CLI (user scope: `~/.claude.json` servers + `~/.claude/settings.json` plugins), on top of the always-present vault-targeted `bismuth` server. Off by default because a cron runs UNATTENDED with permissions bypassed and no confirmation prompt — turning this on hands it every tool those servers expose. Project- and local-scope settings are never loaded regardless: the session's cwd is the vault root, so a `.mcp.json` sitting in your notes would otherwise auto-execute. |

The `backend` enum (`DAEMON_BACKEND_IDS`, `core/src/schema/settingsSchema.ts`) is derived from the agent-backend catalog, filtered to backends whose `capabilities.daemon` is true — today just `claude` and `codex` — so it never drifts from `BackendCapabilities.daemon`.

Example:

```yaml
daemon:
  enabled: true
  inboxRetentionDays: 14
  backend: claude
```

---

## `update`

Bismuth-app self-update. The bundled app can git-pull + rebuild + swap itself (see `core/src/selfUpdate.ts`); by default that is **manual** via the in-app update banner.

| Key | Type | Default | Doc |
|-----|------|---------|-----|
| `autoUpdate` | boolean | `false` | Auto-apply Bismuth app updates on launch in the background, then relaunch when the rebuild is ready (off = manual via the update banner). |

Example:

```yaml
update:
  autoUpdate: true
```

---

## `terminal`

In-app terminal tab appearance (xterm.js), wired through CSS vars.

| Key | Type | Default | Bounds | Doc |
|-----|------|---------|--------|-----|
| `fontSize` | number | `13` | min `9`, max `20` | Terminal font size (px). |
| `lineHeight` | number | `1.5` | min `1.2`, max `2` | Terminal line height (multiplier). |
| `cursorWidth` | number | `2` | min `1`, max `4` | Terminal cursor bar width (px). |
| `cursorGlideMs` | number | `70` | min `20`, max `200` | Cursor glide animation duration (ms). |
| `cursorBlinkSeconds` | number | `1.2` | min `0.6`, max `2` | Cursor blink cycle duration (seconds). |

Example:

```yaml
terminal:
  fontSize: 14
  lineHeight: 1.6
  cursorWidth: 3
```

---

## `chat`

Visual Claude chat (the `/chat` WS session, `core/src/chat.ts`) behavior.

| Key | Type | Default | Doc |
|-----|------|---------|-----|
| `provider` | enum | `claude` | Which agent backend a chat runs on by default: `claude`, `opencode`, `codex`, `cline`, `gemini`, `goose`, `openclaw`, `claude-code-acp`, `codex-acp`. This is the default for a chat tab that hasn't chosen for itself — the header's backend picker overrides it per tab, and that choice persists (localStorage, keyed by the chat tab id). Each backend's controls render per declared capability, so a backend without permission modes or effort simply hides them. See [agent backends](../chat/backends.md). |
| `computerUse` | boolean | `false` | Enable Claude's browser/computer-use capability (`--chrome`) so the model can see and interact with a Chromium browser. Requires a Chromium-based browser on the system (Chrome/Edge/Brave). This is the **default for a chat that hasn't chosen for itself** — a chat overrides it with `/chrome` / `/chrome off` or the header Globe pill, and that per-chat choice persists (localStorage, keyed by the chat tab id). |

Example:

```yaml
chat:
  provider: opencode
  computerUse: true
```

---

## `mcp`

Multi-CLI MCP registration (`core/src/agentBackends/mcpRegistrars.ts`): which OTHER agent CLIs, besides Claude Code (which always auto-registers on boot via `bismuthInstall.ts`), also get Bismuth's stdio MCP server (docs + `bismuth` CLI + memory tools) written into their own global config. Deliberately opt-in and empty by default — writing into a user's Codex/Cline/OpenClaw/Gemini/Qwen/Copilot/Amp/Droid/Crush/Goose config uninvited is intrusive in a way `claude mcp add` isn't for a Claude-first app.

| Key | Type | Default | Doc |
|-----|------|---------|-----|
| `registerWith` | list (string) | `[]` | Additional agent CLIs (besides Claude Code, which always auto-registers) to register Bismuth's MCP server with, e.g. `["codex", "gemini"]` — so those CLIs get Bismuth's docs/CLI/memory tools. Registrar ids: `codex`, `cline`, `openclaw`, `gemini`, `qwen`, `copilot`, `amp`, `droid`, `crush`, `goose`. Listing a CLI here IS the opt-in: registration runs on the next app start (and on demand via `bismuth install --mcp <cli>` / `--mcp all`). Empty by default, so Bismuth never writes into another CLI's config uninvited. Registration is idempotent and never clobbers an entry it didn't write. |

Example:

```yaml
mcp:
  registerWith: [codex, gemini]
```

---

## `codex`

OpenAI Codex-specific opt-ins (`core/src/agentBackends/agentsMd.ts` + `codexHooks.ts`). Codex has no system-prompt flag and no PATH-shim hook mechanism — `AGENTS.md` and a project-scoped `.codex/hooks.json` are its own designed channels for memory + session telemetry, but both mean writing into files the user may hand-edit, so — same precedent as `mcp.registerWith` — both default off and are opt-in.

| Key | Type | Default | Doc |
|-----|------|---------|-----|
| `writeAgentsMd` | boolean | `false` | Let Bismuth write/refresh a managed block in this vault's `AGENTS.md` with a short persona/memory note for the Codex CLI (its chat + daemon sessions have no system-prompt flag — `AGENTS.md` is Codex's own designed channel for this, and Cursor/Amp/Droid share the same convention). The block is delimited by markers and never touches surrounding prose; off by default because writing into a file you may hand-edit is opt-in. |
| `installRelayHooks` | boolean | `false` | Let Bismuth write a project-scoped `.codex/hooks.json` (+ its small reporting script) into this vault so a Codex session run in a Bismuth terminal tab or chat reports its lifecycle into Bismuth's in-process relay registry — the same role Claude Code's relay plugin plays. Off by default: writing into the vault is opt-in. |

Example:

```yaml
codex:
  writeAgentsMd: true
  installRelayHooks: true
```

---

## `srs`

Spaced-repetition (SM-2-style) scheduling parameters. Consumed by `core/src/srs/scheduler.ts` and shared by markdown and row-based flashcards. See [flashcards / SRS](../flashcards/srs.md).

| Key | Type | Default | Bounds | Doc |
|-----|------|---------|--------|-----|
| `baseEase` | number | `250` | min `130`, max `400` | Starting ease factor for a new flashcard (SM-2; higher = longer intervals). |
| `easyBonus` | number | `1.3` | min `1`, max `2` | Extra interval multiplier when a card is rated 'easy'. |
| `lapsesIntervalChange` | number | `0.5` | min `0.1`, max `1` | Interval multiplier when a card is rated 'hard' (lapse penalty). |
| `minEase` | number | `130` | min `50`, max `250` | Floor on a card's ease factor. |
| `easeStep` | number | `20` | min `5`, max `50` | Ease change per review. |
| `easyGraduatingInterval` | number | `4` | min `1`, max `14` | Days until next review when a new card is rated 'easy'. |
| `goodGraduatingInterval` | number | `1` | min `1`, max `3` | Days until next review when a new card is rated 'good'/'hard'. |

Example:

```yaml
srs:
  baseEase: 270
  easyBonus: 1.4
  minEase: 150
```

---

## `templates`

Template-folder configuration.

| Key | Type | Default | Doc |
|-----|------|---------|-----|
| `folder` | path (`only: "dir"`) | `Templates` | Vault folder holding template `.md` files. `Option+T` inserts one at the cursor. |
| `newNote` | path (`scope: "templates"`) | `""` | Vault path to a template `.md` used to pre-fill a brand-new note (the New Note command and the file-tree "New File" action). Empty (the default) = no template — a brand-new note is created empty, exactly as before this setting existed. Expanded via the same `{{...}}` tokens as `dailyNotes[].template` (see `templates/syntax.md`); a `{{cursor}}` token places the caret. |

Example:

```yaml
templates:
  folder: _templates
  newNote: _templates/Note.md
```

A new note is created under a placeholder name (`Untitled.md`) and drops straight into the file
tree's inline rename, so the template is expanded and written **after that rename settles** —
`{{title}}` is the name you actually typed, not `Untitled`. Abandoning the rename (Escape, or
keeping `Untitled`) still applies the template. A missing or unreadable template file is not an
error: the note is simply created empty.

---

## `properties`

The vault-wide **property registry** — a free-form map `{name: typeString}` linking each frontmatter key to a type. Validated leniently by `registry.loadRegistry`; seeded **empty** on first launch.

- **Type:** `{ kind: "object", fields: {} }` — i.e. an open object with no fixed inner schema (the empty `fields` is a placeholder; a test asserts `SETTINGS_SCHEMA.properties.type` equals exactly `{ kind: "object", fields: {} }`).
- **Default:** `{}` (empty object).

| Key | Type | Default | Doc |
|-----|------|---------|-----|
| `properties` | object (free-form map) | `{}` | Vault property registry: map each frontmatter key to a type. |

Example:

```yaml
properties:
  rating: number
  status: string
  due: date
```

---

## `folderIcons`

Per-folder icons — a free-form map `{folderPath: iconName}` (folders have no frontmatter to hang an icon on). Seeded **empty**; normally written via `POST /folder-icon` rather than hand-edited.

- **Type:** `{ kind: "object", fields: {} }` (a test asserts exactly this).
- **Default:** `{}`.

| Key | Type | Default | Doc |
|-----|------|---------|-----|
| `folderIcons` | object (free-form map) | `{}` | Per-folder icons: map a folder path to a Lucide icon name or emoji. |

Example:

```yaml
folderIcons:
  Projects: FolderGit2
  Journal: BookOpen
  Reading: "📚"
```

---

## `folderVisibility`

Per-folder AI visibility — a free-form map `{folderPath: "chat-only"|"hidden"}` (folders have no frontmatter to hang a `visibility:` key on, unlike notes). Seeded **empty**; normally written via `POST /folder-visibility` rather than hand-edited. This restricts the daemon's and in-app chat's own tool calls from reading a marked note or folder — an HONESTY boundary, not a security boundary — and it never restricts the vault owner (editor/FileTree/graph/CLI) or their own interactive terminal Claude sessions. Nearest-ancestor-wins resolution and the full threat model live in `core/src/visibility.ts` / `docs/vault/visibility.md`. A note's OWN visibility is set via its `visibility:` frontmatter key, not here.

- **Type:** `{ kind: "object", fields: {} }` (a test asserts exactly this).
- **Default:** `{}`.

| Key | Type | Default | Doc |
|-----|------|---------|-----|
| `folderVisibility` | object (free-form map) | `{}` | Per-folder AI visibility: map a folder path to "chat-only" or "hidden" (restricts the daemon + in-app chat, not you). |

Example:

```yaml
folderVisibility:
  private: hidden
  drafts: chat-only
```

---

## `toolbar`

The sidebar header bar buttons, **in order**. Each button runs a command-palette command. Seeded with **three** built-ins so a fresh install is unchanged.

- **Type:** `{ kind: "list", item: { kind: "object", fields: {...} } }` — a list of button objects.
- **Default:**
  ```yaml
  toolbar:
    - command: create-menu
      icon: Plus
    - command: search
      icon: Search
    - command: open-inbox
      icon: Inbox
  ```

  The first button is `create-menu` — the "+Create" chooser (new note / folder / spreadsheet / drawing / base submenu) — followed by `search`, then `open-inbox` — the daemon inbox button, hidden while the daemon is off and carrying a due-count badge (see `App.tsx`'s toolbar render). The older three-button seed (`new-note` / `new-folder` / `search`) was replaced by this `create-menu` + `search` + `open-inbox` set.

### Toolbar item fields

| Field | Type | Doc |
|-------|------|-----|
| `command` | enum of command ids (allows the `daily-note:` prefix) | Which command this button runs (a catalog id or `daily-note:<id>`). Use `command:` OR `commands:`, not both. |
| `commands` | list of command-id enums (allows the `daily-note:` prefix) | Multiple commands to run in sequence (alternative to the `command:` field). Use `command:` OR `commands:`, not both. |
| `icon` | icon | Lucide icon name (e.g. `"FilePlus"`) or an emoji shown on the button. |
| `tooltip` | string | Optional hover text (defaults to the command's label). |

> **Rule** — `commands` (plural) wins over `command` if both are set. Unresolved ids are skipped; a button is disabled only if none of its commands resolve. The `daily-note:<id>` form references a daily-note type declared in the `dailyNotes` section below.

### Valid command ids (the `command`/`commands` enum)

Derived from `COMMAND_CATALOG` (`core/src/commands.ts`); the enum also accepts any value starting with `daily-note:`.

| id | Default label | Default icon |
|----|---------------|--------------|
| `new-tab` | New tab | `Plus` |
| `close-tab` | Close tab | `X` |
| `reopen-tab` | Reopen closed tab | `RotateCcw` |
| `history-back` | Back | `ArrowLeft` |
| `history-forward` | Forward | `ArrowRight` |
| `open-graph` | Open graph view | `Share2` |
| `open-inbox` | Open daemon inbox | `Inbox` |
| `open-folder` | Open folder… | `FolderOpen` |
| `new-window` | New window | `AppWindow` |
| `create-menu` | Create new… | `Plus` |
| `new-note` | New note | `FilePlus` |
| `new-folder` | New folder | `FolderPlus` |
| `new-base` | New base | `Database` |
| `new-spreadsheet` | New spreadsheet | `Table` |
| `new-drawing` | New drawing | `PenTool` |
| `new-claude-chat` | New Claude Chat | `MessageSquare` |
| `export` | Export current file… | `Download` |
| `archive-tasks` | Archive completed tasks (this note) | `Archive` |
| `archive-all-tasks` | Archive completed tasks (all notes) | `ArchiveX` |
| `detect-ai` | Detect AI text | `Bot` |
| `emoji-library` | Emoji library… | `Smile` |
| `terminal` | Open Terminal | `SquareTerminal` |
| `search` | Search | `Search` |
| `settings` | Open Settings | `Settings` |
| `edit-dictionary` | Edit custom dictionary… | `BookOpen` |
| `graph-2nd` | Graph: 2nd Brain (vault) | `Notebook` |
| `graph-3rd` | Graph: 3rd Brain (memory) | `Brain` |
| `graph-both` | Graph: Both Brains | `Network` |
| `graph-daemon` | Graph: Daemon | `Server` |
| `graph-local` | Graph: Local (open note) | `Pin` |
| `equalize-panes` | Equalize panes | `Columns3` |
| `split-right` | Split right | `PanelRight` |
| `split-down` | Split down | `PanelBottom` |
| `close-pane` | Close pane | `SquareX` |
| `focus-pane-left` | Focus pane left | `ArrowLeft` |
| `focus-pane-right` | Focus pane right | `ArrowRight` |
| `focus-pane-up` | Focus pane up | `ArrowUp` |
| `focus-pane-down` | Focus pane down | `ArrowDown` |
| `toggle-sidebar` | Toggle sidebar | `PanelLeft` |
| `daemon-owner` | Set daemon owner device… | `Server` |
| `daemon-setup` | Set up daemon… | `Download` |
| `daemon-update` | Update daemon… | `RefreshCw` |
| `bismuth-install` | Install Bismuth CLI + MCP… | `Download` |
| `update-app` | Update Bismuth… | `RefreshCw` |
| `gcal-connect` | Connect Google Calendar… | `Calendar` |
| `gcal-sync` | Sync Google Calendar | `RefreshCw` |
| `gcal-disconnect` | Disconnect Google Calendar | `CalendarX` |
| `zoom-in` | Zoom In | `ZoomIn` |
| `zoom-out` | Zoom Out | `ZoomOut` |
| `zoom-reset` | Reset Zoom | `RotateCcw` |

Example — a custom toolbar with a multi-command button, an emoji icon, and a daily-note button:

```yaml
toolbar:
  - command: new-note
    icon: FilePlus
  - command: search
    icon: Search
    tooltip: Find anything
  - commands: [new-tab, open-graph]
    icon: "🕸️"
    tooltip: New graph tab
  - command: daily-note:journal
    icon: BookOpen
```

---

## `tabBar`

The TAB-BAR action buttons (right of the tab strip) — **same item shape and rendering as `toolbar`**, so both bars are configured the same way (`command`/`commands`, `icon`, `tooltip`; see the "Toolbar item fields" table in the `toolbar` section above). Defaults match what used to be hardcoded (new tab + terminal) plus the new-chat button.

- **Type:** `{ kind: "list", item: { kind: "object", fields: {...} } }` — a list of button objects.
- **Default:**
  ```yaml
  tabBar:
    - command: new-tab
      icon: SquarePlus
    - command: terminal
      icon: SquareTerminal
    - command: new-claude-chat
      icon: MessageSquare
  ```

Example — swap in a graph-open button:

```yaml
tabBar:
  - command: new-tab
    icon: SquarePlus
  - command: open-graph
    icon: Share2
  - command: new-claude-chat
    icon: MessageSquare
```

---

## `dailyNotes`

Daily-note types. Each one registers a `daily-note:<id>` command (see `core/commands`) that you reference from `toolbar` to get a button. Pressing it opens today's note for that type, creating it from `template` the first time. Top-level list, read via `readDailyNotesFrom` (mirrors `toolbar`/`folderIcons`).

- **Type:** `{ kind: "list", item: { kind: "object", fields: {...} } }`.
- **Default:**
  ```yaml
  dailyNotes:
    - id: journal
      label: Journal
      icon: BookOpen
      folder: Journal
      fileName: "{{date}} journal"
      template: Templates/Journal.md
  ```

### Daily-note item fields

| Field | Type | Doc |
|-------|------|-----|
| `id` | string | Stable id; forms the command id `daily-note:<id>`. |
| `label` | string | Command-palette label and default button tooltip. |
| `icon` | icon | Lucide icon name (e.g. `"BookOpen"`) or an emoji. |
| `folder` | path (`only: "dir"`) | Vault folder for entries (`""` = vault root). |
| `fileName` | string | Filename via `{{...}}` tokens, no `.md`. e.g. `{{date}} journal`. |
| `template` | path (`scope: "templates"`) | Vault path to a template `.md` to pre-fill the note (optional). |

Example — two daily-note types:

```yaml
dailyNotes:
  - id: journal
    label: Journal
    icon: BookOpen
    folder: Journal
    fileName: "{{date}} journal"
    template: Templates/Journal.md
  - id: standup
    label: Daily Standup
    icon: "☀️"
    folder: Work/Standups
    fileName: "{{date}}"
    template: Templates/Standup.md
```

To surface a daily-note type as a button, add a `toolbar` entry with `command: daily-note:<id>` (see the `toolbar` example above).

---

## `keybindings`

Global keyboard shortcuts. One key per app-level action; the value is a `keybind` combo string. Placed **last** in the schema (a test enforces this) so it sits at the end of a fresh `.settings` file. The section is a nested object (not a list), derived from `KEYBINDING_CATALOG` (`core/src/keybindings.ts`) — the single source of truth for ids + default combos. `App.tsx` reads `settings.keybindings.<id>`; nothing is hardcoded.

### Combo syntax

- `Mod` — Cmd on macOS / Ctrl elsewhere (matches `metaKey` OR `ctrlKey`).
- `Alt` — Option/Alt; `Shift` — Shift.
- The final token is the key, e.g. `P`, `D`, `=`, `` ` ``, `ArrowLeft`.
- Comma-separate alternatives: `Mod+\`, Mod+J` (both combos trigger the action).
- **Matching is EXACT on modifiers**, so `Mod+D` (split-right) and `Mod+Shift+D` (split-down) never collide.

The `keybind` type drives the smart, order-free shortcut autocomplete + a "Record shortcut…" option in `app/src/editor/settingsComplete.ts`.

### Keybinding keys

Each key's value is a `keybind`; the default equals the previously hardcoded combo.

| id | Default combo | Doc |
|----|---------------|-----|
| `find` | `Mod+F` | Open the in-note find bar in the focused editor (searches the current note). |
| `command-palette` | `Mod+P` | Open/close the command palette. |
| `quick-switcher` | `Mod+O` | Open/close the quick file switcher. |
| `terminal` | `Mod+\`, Mod+J` | Open a terminal tab (comma-separated alternatives allowed). |
| `toggle-draw-mode` | `Mod+Shift+I` | Toggle ink/draw mode in the focused note editor — draw freehand over the note (Escape also exits). Mnemonic: Ink. On Linux/Windows Ctrl+Shift+I collides with browser devtools — rebind if needed. |
| `split-right` | `Mod+D` | Split the focused pane into a new pane to the right. |
| `split-down` | `Mod+Shift+D` | Split the focused pane into a new pane below. |
| `equalize-panes` | `Mod+Alt+=` | Reset all split panes to equal sizes. |
| `close-pane` | `Mod+W` | Close the focused pane (closes the whole tab when it's the last pane). |
| `new-tab` | `Mod+T` | Open a new tab (the Knowledge Graph home). |
| `reopen-tab` | `Mod+Shift+T` | Reopen the most recently closed tab. |
| `history-back` | `Mod+[` | Go back in the focused pane's navigation history. |
| `history-forward` | `Mod+]` | Go forward in the focused pane's navigation history. |
| `focus-pane-left` | `Mod+Alt+ArrowLeft` | Move focus to the pane on the left. |
| `focus-pane-right` | `Mod+Alt+ArrowRight` | Move focus to the pane on the right. |
| `focus-pane-up` | `Mod+Alt+ArrowUp` | Move focus to the pane above. |
| `focus-pane-down` | `Mod+Alt+ArrowDown` | Move focus to the pane below. |
| `new-claude-chat` | `Mod+Shift+C` | Open a new Claude Code chat session in its own tab. |
| `insert-template` | `Alt+T` | Open the template-insertion palette (ignored while typing in a form field). |
| `toggle-sidebar` | `Alt+S` | Show/hide the left sidebar (ignored while typing in a form field). |
| `zoom-in` | `Mod+=, Mod+Shift+=` | Increase the whole app's UI zoom one step. `Mod+Shift+=` covers keyboards where the labeled "+" requires Shift. |
| `zoom-out` | `Mod+-` | Decrease the whole app's UI zoom one step. |
| `zoom-reset` | `Mod+0` | Reset the whole app's UI zoom to 100%. |

Example — rebind the command palette and add an alternative for the terminal:

```yaml
keybindings:
  command-palette: Mod+K
  quick-switcher: Mod+O
  terminal: "Mod+`, Mod+J, Mod+Shift+T"
  split-right: Mod+D
  split-down: Mod+Shift+D
```

---

## How defaults are derived (DEFAULTS)

`DEFAULTS` is produced by `deriveDefaults(SETTINGS_SCHEMA)`: it recursively materializes the `default` of every leaf into a plain nested object. For an `object`-kind entry it recurses into its `fields`; for any other leaf with a `default` it copies that value. Sections whose `fields` are empty (`properties`, `folderIcons`) materialize to `{}`. The list sections (`toolbar`, `dailyNotes`) and `keybindings` materialize to their declared `default` arrays/values. `DEFAULTS` is the synchronous seed the frontend store uses on boot (no white-screen), and it round-trips cleanly through `validateDocument(..., { mode: "settings" })` with zero blocking errors (a test asserts this). The exported `AppSettings` type is `ReturnType<typeof deriveDefaults>`, keeping the frontend's structural shape in lockstep with the documented defaults.

## Adding a setting (for maintainers)

The schema is the single source of truth and defaults must equal the current hardcoded value so upgrades are a behavioral no-op:

1. Add an entry (type, `default`, `min`/`max` or enum, `doc`) to `core/src/schema/settingsSchema.ts` — autocomplete, the linter, and `reconcileSettings` (which adds the key to existing files while preserving comments) pick it up automatically.
2. Add the matching field to the `Settings` interface in `app/src/settings.ts` (`settings.parity.test.ts` enforces schema ↔ interface match).
3. Wire the consumer: **CSS-driven** → a `--var` in `settingsCssVars.ts` + `var(--name, <fallback>)` in CSS; **frontend logic** → read `settings.<section>.<key>` (reactive); **backend** → read `appConfig.<section>.<key>` in `server.ts`.

> Adding a new **top-level** schema key also requires updating the hardcoded key lists in `core/test/schema/settingsSchema.test.ts` (two assertions enumerate the exact top-level set).

See also: [bases overview](../bases/overview.md), [commands & toolbar](../settings/toolbar-commands.md), [keybindings](../settings/keybindings.md).

Source: `core/src/schema/settingsSchema.ts`, `core/src/schema/types.ts`, `core/src/theme/tokens.ts`, `core/src/keybindings.ts`, `core/src/commands.ts`, `core/src/agentBackends/catalog.ts`, `core/src/visibility.ts`, `core/src/settings.ts`, `core/test/schema/settingsSchema.test.ts`, `core/test/fixtures/upgrade/settings-schema-snapshot.json`
