# Settings Reference

This is the canonical, exhaustive reference for Bismuth's vault `.settings` file (a single hidden, extensionless YAML file at the vault root — `SETTINGS_FILE` in `core/src/settings.ts`). It documents **every** top-level section and **every** key in the settings schema (`core/src/schema/settingsSchema.ts`), including each key's name, type, default value, min/max bounds or enum values, and its in-app documentation string. The schema is the single source of truth: the first-launch writer authors a fully commented `.settings` from it, the editor's autocomplete and linter validate against it, and the frontend store seeds from the derived `DEFAULTS`. Defaults always equal the previously hardcoded values, so a fresh install behaves identically to an unconfigured one.

There is **no settings GUI** in Bismuth — the "settings page" is literally `.settings` opened in the editor, with schema-aware autocomplete (each key's doc + valid range) and lint. To change a setting, edit the YAML; the backend is the single writer and merges one key in place via `POST /set-setting` (preserving comments and key order). Editing `.settings` does not require a server restart — it is re-read per request. (A legacy vault-root `settings.yaml` — or the interim `.settings/settings.yaml` folder from an earlier build — is migrated into the `.settings` file automatically on first open; see `migrateSettingsLocation` in `core/src/settings.ts`.)

## Schema overview

The schema is a nested object. Top-level keys, in canonical alphabetical-set membership (the test asserts exactly this set):

`appearance`, `attachments`, `calendar`, `chat`, `daemon`, `dailyNotes`, `editor`, `folderIcons`, `googleCalendar`, `graph`, `keybindings`, `properties`, `server`, `srs`, `templates`, `terminal`, `toolbar`, `ui`, `update`, `vault`.

The **declaration order** in the schema (which determines the order in a freshly written `.settings`) is: `appearance`, `graph`, `editor`, `vault`, `attachments`, `calendar`, `googleCalendar`, `ui`, `server`, `daemon`, `update`, `terminal`, `chat`, `srs`, `templates`, `properties`, `folderIcons`, `toolbar`, `dailyNotes`, `keybindings`. The `keybindings` section is deliberately **last** (a test enforces this) so it sits at the end of a fresh file.

### Property types

Every key's `type` is one of the `PropertyType` kinds (`core/src/schema/types.ts`):

- `"string"` — free-form text.
- `"number"` — numeric; usually carries `min`/`max` slider-style bounds.
- `"boolean"` — `true`/`false`.
- `"date"`, `"datetime"` — date / date-time strings (used in frontmatter, not in the settings sections below).
- `"file"` — a file reference.
- `"icon"` — a Lucide icon name (e.g. `"FilePlus"`) **or** an emoji.
- `"keybind"` — a keyboard combo string (drives order-free shortcut autocomplete + a "record shortcut" option).
- `{ kind: "path"; only?: "dir" | "file"; scope?: "templates" | "fs" }` — a path. `only` narrows completion to directories or files. `scope` selects the completion root: omitted = the vault tree; `"templates"` = the configured templates folder (files only); `"fs"` = the **real filesystem** (absolute or `~`-relative), for paths outside the vault (no current settings key uses `scope: "fs"`, but the kind is supported for filesystem paths). Validated leniently (any string) — the path need not exist yet.
- `{ kind: "enum"; values: string[]; caseInsensitive?; allowPrefixes? }` — one of a fixed value list. `allowPrefixes` lets values beginning with a listed prefix (e.g. `daily-note:`) also pass.
- `{ kind: "list"; item?: PropertyType }` — an array of items.
- `{ kind: "object"; fields: Schema }` — a nested object (a section, or a free-form map when `fields` is empty `{}`).

> **Gotcha — number bounds are lenient hints, not hard clamps.** `min`/`max` drive the autocomplete hint and lint range, but the value is your edited YAML; out-of-range numbers are flagged by lint, not silently clamped here.

---

## `appearance`

Visual chrome: theme, logo mark, fonts, and sizing. **There are no flat per-color keys** (`background`, `foreground`, `neutral`, `accent`, `accentPalette` are intentionally absent) — the theme is the single source of color. `app/src/themes.ts` holds the token values, and `settingsCssVars.ts` projects them to CSS vars. The app is dark-by-default but ships matching `-light` themes.

| Key | Type | Default | Bounds / Values | Doc |
|-----|------|---------|-----------------|-----|
| `theme` | enum | `oxide-duotone` | `oxide-duotone`, `gunmetal-teal`, `rose-gold`, `indigo-oxide`, `forest-oxide`, `full-sheen`, `oxide-duotone-light`, `gunmetal-teal-light`, `rose-gold-light`, `indigo-oxide-light`, `forest-oxide-light`, `full-sheen-light` | Bismuth color theme: oxide-duotone (default) · gunmetal-teal · rose-gold · indigo-oxide · forest-oxide · full-sheen. Selects EVERY color in the app + graph (background, surfaces, border, text, muted, accent, and the graph node palette). |
| `icon` | enum | `hopper-crystal` | `hopper-crystal`, `node-b`, `square-funnel`, `nested-diamonds`, `pinwheel`, `node-crystal`, `lattice`, `diamond-bloom`, `node-diamond`, `octagon-bloom`, `spin-cross`, `tri-bloom`, `radial-graph`, `node-rings` | App logo mark (favicon + sidebar logo). One of the 14 Bismuth marks. |
| `editorFont` | enum | `Lora` | `Lora`, `Monaspace Xenon`, `Georgia`, `system-ui` | Editor font family. |
| `editorFontSize` | number | `16` | min `11`, max `28` | Editor font size (px). |
| `sidebarWidth` | number | `280` | min `200`, max `600` | Left sidebar width (px). |
| `sidebarGraphHeight` | number | `305` | min `200`, max `500` | Height of the mini graph panel in the sidebar (px). |
| `uiFontSize` | number | `13` | min `11`, max `16` | Base UI font size — sidebar, tabs, menus (px). |
| `monoScale` | number | `0.85` | min `0.6`, max `1` | Optical-size factor for Monaspace (the mono UI/code font). Monaspace renders visually larger than the serif body at the same px; this shrinks all mono text — UI chrome and code blocks — so it optically matches. `1` = no correction. |
| `tabFontSize` | number | `12` | min `11`, max `14` | Editor tab label font size (px). |
| `sidebarIconFontSize` | number | `15` | min `12`, max `20` | Sidebar header icon button size (px). |
| `paletteInputFontSize` | number | `15` | min `13`, max `18` | Command palette search-input font size (px). |

Example:

```yaml
appearance:
  theme: forest-oxide
  icon: lattice
  editorFont: Monaspace Xenon
  editorFontSize: 18
  sidebarWidth: 320
```

---

## `graph`

Knowledge-graph rendering and force-layout behavior.

> **Gotcha — the 2D/3D dimension is NOT a setting.** It is a transient, per-window UI toggle (localStorage-backed in `app/src/GraphView.tsx`). There is no `graph.viewMode` key (a test asserts its absence) — switching dimension never rewrites `.settings`. Likewise the old color keys `graph.palette`, `graph.edgeColor`, `graph.backgroundColor` are gone (graph color is derived from `appearance.theme`).

| Key | Type | Default | Bounds | Doc |
|-----|------|---------|--------|-----|
| `spin` | boolean | `true` | — | Idle rotation of the graph. |
| `showFps` | boolean | `false` | — | Show the frame-rate (FPS) counter on the graph. |
| `spinSpeed` | number | `0.0015` | min `0`, max `0.01` | Idle spin speed (radians/frame). |
| `repulsion` | number | `-10` | min `-40`, max `-1` | Node repulsion; more negative pushes apart harder. |
| `linkDistance` | number | `5` | min `1`, max `40` | Target distance between linked nodes. |
| `centering` | number | `0.13` | min `0`, max `0.5` | Pull toward center; higher = denser ball. |
| `nodeSize` | number | `6` | min `2`, max `16` | Base node radius. |
| `showGraphLabels` | boolean | `true` | — | Master toggle for in-scene labels. |
| `graphLabelHubCount` | number | `10` | min `0`, max `30` | Top-degree nodes that always get a label. |
| `nodeSizeMinMult` | number | `0.4` | min `0.1`, max `1` | Size multiplier for a 0/1-degree leaf node (the smallest dots). |
| `nodeSizeDegreeGain` | number | `0.45` | min `0.1`, max `1.5` | How fast node size grows with `sqrt(link count)`. |
| `nodeSizeMaxMult` | number | `6` | min `2`, max `12` | Ceiling on node size (biggest hub vs a leaf). |
| `mapDefaultZoom` | number | `2` | min `1`, max `18` | Default zoom for the Bases map view when it can't fit markers. |
| `refreshDebounceMs` | number | `300` | min `100`, max `1000` | Delay before rebuilding the graph after an edit burst (ms). |

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
| `lineHeight` | number | `1.65` | min `1.3`, max `2` | Editor prose line height (multiplier). |
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

| Key | Type | Default | Bounds | Doc |
|-----|------|---------|--------|-----|
| `verticalTabs` | boolean | `false` | — | Show tabs as a vertical rail on the right edge of the app instead of the classic horizontal strip. Collapsed the rail shows just each tab's icon; hovering it expands to reveal the full tab names. |
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

| Key | Type | Default | Doc |
|-----|------|---------|-----|
| `enabled` | boolean | `false` | Master switch for this vault's daemon — the per-vault assistant that runs crons/processes in the background, injects this vault's memory into its Claude sessions, and shows the 3rd-brain + daemon graph modes. Off = dormant: state is preserved on disk and the `.daemon` folder is hidden. Set automatically from the first-run intro; toggle anytime. The daemon's NAME lives in its identity file (`.daemon/identity.md` frontmatter), not here. |

Example:

```yaml
daemon:
  enabled: true
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
| `computerUse` | boolean | `false` | Enable Claude's browser/computer-use capability (`--chrome`) so the model can see and interact with a Chromium browser. Requires a Chromium-based browser on the system (Chrome/Edge/Brave). This is the **default for a chat that hasn't chosen for itself** — a chat overrides it with `/chrome` / `/chrome off` or the header Globe pill, and that per-chat choice persists (localStorage, keyed by the chat tab id). |

Example:

```yaml
chat:
  computerUse: true
```

---

## `srs`

Spaced-repetition (SM-2-style) scheduling parameters. Consumed by `core/src/srs/scheduler.ts` and shared by markdown and row-based flashcards. See [flashcards / SRS](../flashcards/srs.md) (if present).

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

Example:

```yaml
templates:
  folder: _templates
```

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

## `toolbar`

The sidebar header bar buttons, **in order**. Each button runs a command-palette command. Seeded with **two** built-ins so a fresh install is unchanged.

- **Type:** `{ kind: "list", item: { kind: "object", fields: {...} } }` — a list of button objects.
- **Default:**
  ```yaml
  toolbar:
    - command: create-menu
      icon: Plus
    - command: search
      icon: Search
  ```

  The first button is `create-menu` — the "+Create" chooser (new note / folder / spreadsheet / drawing / base submenu) — followed by `search`. The older three-button seed (`new-note` / `new-folder` / `search`) was replaced by this `create-menu` + `search` pair.

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
| `terminal` | Open Terminal | `SquareTerminal` |
| `search` | Search | `Search` |
| `settings` | Open Settings | `Settings` |
| `edit-dictionary` | Edit custom dictionary… | `BookOpen` |
| `graph-2nd` | Graph: 2nd Brain (vault) | `Notebook` |
| `graph-3rd` | Graph: 3rd Brain (memory) | `Brain` |
| `graph-both` | Graph: Both Brains | `Network` |
| `graph-agents` | Graph: Agents | `Users` |
| `equalize-panes` | Equalize panes | `Columns3` |
| `toggle-sidebar` | Toggle sidebar | `PanelLeft` |
| `daemon-owner` | Set daemon owner device… | `Server` |
| `daemon-setup` | Set up daemon… | `Download` |
| `daemon-update` | Update daemon… | `RefreshCw` |
| `bismuth-install` | Install Bismuth CLI + MCP… | `Download` |
| `update-app` | Update Bismuth… | `RefreshCw` |
| `gcal-connect` | Connect Google Calendar… | `Calendar` |
| `gcal-sync` | Sync Google Calendar | `RefreshCw` |
| `gcal-disconnect` | Disconnect Google Calendar | `CalendarX` |

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

Source: core/src/schema/settingsSchema.ts, core/src/schema/types.ts, core/src/keybindings.ts, core/src/commands.ts, core/test/schema/settingsSchema.test.ts
