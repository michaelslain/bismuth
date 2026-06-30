# Settings Overview

Bismuth's settings system is entirely schema-driven: there is no settings GUI page. The file `settings.yaml` at the root of every vault IS the settings page — it is opened as a normal note in the editor, where schema-aware autocomplete (Ctrl-Space) and inline lint provide discovery and validation. All settings changes go through the backend as the single writer, ensuring the YAML document structure (comments, unknown keys, the `properties:` registry) is never clobbered by a frontend toggle. The schema (`core/src/schema/settingsSchema.ts`) is the single source of truth for field names, types, defaults, numeric bounds, and documentation strings; the frontend `Settings` interface (`app/src/settings.ts`) and the CSS custom-property projection (`app/src/settingsCssVars.ts`) are kept in lockstep with it by parity tests.

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

The 2D/3D graph dimension is intentionally **not** a setting — it is a transient per-window localStorage toggle in `GraphView.tsx` and never rewrites `settings.yaml`.

---

## The `settings.yaml` File

### Location

Always at `<vault-root>/settings.yaml` (the constant `SETTINGS_FILE = "settings.yaml"`). There is no global settings file; every vault has its own.

### First Launch

On first open of a vault `initializeSettings` is called. If `settings.yaml` is absent, a clean, **comment-free** file is written from the schema's materialized defaults. The file ships without comments by design — discoverability is via the editor's Ctrl-Space autocomplete, which shows each key's `doc` string and valid range. Example of the generated file:

```yaml
appearance:
  theme: oxide-duotone
  icon: hopper-crystal
  editorFont: Lora
  editorFontSize: 16
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
1. If `settings.yaml` is absent, calls `initializeSettings` to write full defaults.
2. If the file exists, parses it via the YAML CST (`parseDocument`).
3. If the file has YAML parse errors, leaves it **completely untouched** (avoids clobbering a half-edited file).
4. If the top-level value is not a YAML map (empty/scalar/corrupt), leaves it untouched.
5. Otherwise calls `fillMissing` recursively: for every schema key absent from the file, inserts the default. **Does not remove unknown keys.**
6. Writes back only if something actually changed (no spurious writes/SSE churn).

Key properties of `reconcileSettings`:
- Preserves all user-written comments (including inline `# ...` after values).
- Preserves existing user values; never overwrites them.
- Preserves any keys not present in the schema (unknown keys survive).
- Adding a new schema entry self-reconciles on next vault open — no migration code needed.
- A corrupt file is never written to; the user must fix it manually.

```typescript
// Real test demonstrating preservation:
await writeNote(vault, "settings.yaml",
  "# my notes\nappearance:\n  theme: oxide-duotone # inline\n");
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
await setSettingInFile(vault, ["appearance", "theme"], "indigo-oxide");
await setSettingInFile(vault, ["graph", "nodeSize"], 12);

// Unknown keys and siblings are preserved:
// Before: appearance:\n  theme: oxide-duotone\n  myCustom: 1\n# hdr
// After:  appearance:\n  theme: indigo-oxide\n  myCustom: 1\n# hdr
```

### Serving Settings to the Frontend: `serializeSettingsForFrontend`

`GET /settings` returns `serializeSettingsForFrontend(vault)`:
1. Starts from `structuredClone(DEFAULTS)`.
2. Reads and parses `settings.yaml` (tolerates malformed YAML → `data = {}`).
3. For each known section:
   - `folderIcons` — passed through as a free-form string map via `readFolderIconsFrom`.
   - `toolbar` — parsed via `readToolbarFrom` (validates item structure, drops malformed items).
   - `dailyNotes` — parsed via `readDailyNotesFrom` (validates item structure, drops malformed items).
   - All other sections: per-key `typeof` check; wrong-type values are silently dropped back to defaults. Numeric keys with out-of-range values (below `min` or above `max`) are dropped. Enum keys with unknown values are dropped.
4. Strips the `properties` section (delivered separately by `GET /schema`).

This means a corrupt or partial `settings.yaml` degrades gracefully to defaults — nothing explodes.

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
| `theme` | enum | `oxide-duotone` | 12 values | Bismuth color theme; selects all colors in the app and graph. Dark themes: `oxide-duotone`, `gunmetal-teal`, `rose-gold`, `indigo-oxide`, `forest-oxide`, `full-sheen`. Light: same names suffixed `-light`. |
| `icon` | enum | `hopper-crystal` | 14 values | App logo mark (favicon + sidebar). Values: `hopper-crystal`, `node-b`, `square-funnel`, `nested-diamonds`, `pinwheel`, `node-crystal`, `lattice`, `diamond-bloom`, `node-diamond`, `octagon-bloom`, `spin-cross`, `tri-bloom`, `radial-graph`, `node-rings`. |
| `editorFont` | enum | `Lora` | `Lora`, `Monaspace Xenon`, `Georgia`, `system-ui` | Editor font family. |
| `editorFontSize` | number | `16` | 11–28 | Editor font size in px. |
| `sidebarWidth` | number | `280` | 200–600 | Left sidebar width in px. |
| `sidebarGraphHeight` | number | `305` | 200–500 | Mini graph panel height in the sidebar in px. |
| `uiFontSize` | number | `13` | 11–16 | Base UI font size (sidebar, tabs, menus) in px. |
| `monoScale` | number | `0.85` | 0.6–1.0 | Optical-size multiplier for Monaspace. Monaspace renders visually larger than the serif body at the same px; this shrinks all mono text (UI chrome and code blocks) so it optically matches. `1` = no correction. |
| `tabFontSize` | number | `12` | 11–14 | Editor tab label font size in px. |
| `sidebarIconFontSize` | number | `15` | 12–20 | Sidebar header icon button size in px. |
| `paletteInputFontSize` | number | `15` | 13–18 | Command palette search-input font size in px. |

There are **no per-color override keys** in `appearance` — the theme is the single source of color. Flat keys like `background`, `foreground`, `accent`, or `accentPalette` do not exist in the schema and are stripped by the type check in `serializeSettingsForFrontend`.

### `graph`

| Key | Type | Default | Range | Description |
|---|---|---|---|---|
| `spin` | boolean | `true` | — | Idle rotation of the 3D graph. |
| `showFps` | boolean | `false` | — | Show the frame-rate (FPS) counter. |
| `spinSpeed` | number | `0.0015` | 0–0.01 | Idle spin speed in radians/frame. |
| `repulsion` | number | `-10` | -40 – -1 | d3-force `forceManyBody` strength; more negative = nodes push apart harder. |
| `linkDistance` | number | `5` | 1–40 | Target distance between linked nodes. |
| `centering` | number | `0.13` | 0–0.5 | `forceX/Y/Z` strength toward the origin; higher = denser ball. |
| `nodeSize` | number | `6` | 2–16 | Base node radius. |
| `showGraphLabels` | boolean | `true` | — | Master toggle for in-scene labels. |
| `graphLabelHubCount` | number | `10` | 0–30 | Count of top-degree nodes that always have a label. |
| `nodeSizeMinMult` | number | `0.4` | 0.1–1.0 | Size multiplier for a 0/1-degree leaf (smallest dot). |
| `nodeSizeDegreeGain` | number | `0.45` | 0.1–1.5 | How fast node size grows with `sqrt(link count)`. |
| `nodeSizeMaxMult` | number | `6` | 2–12 | Ceiling on node size (largest hub vs leaf). |
| `mapDefaultZoom` | number | `2` | 1–18 | Default zoom for the Bases map view when it can't fit all markers. |
| `refreshDebounceMs` | number | `300` | 100–1000 | Delay before rebuilding the graph after an edit burst in ms. |

The graph's 2D/3D view mode is **intentionally absent** from this section. It is a transient `localStorage` toggle in `GraphView.tsx` and never writes `settings.yaml`.

### `editor`

| Key | Type | Default | Range | Description |
|---|---|---|---|---|
| `livePreview` | boolean | `true` | — | Render markdown inline as you type. |
| `lineNumbers` | boolean | `false` | — | Show line numbers. |
| `lineWrapping` | boolean | `true` | — | Wrap long lines. |
| `spellcheck` | boolean | `true` | — | Spell check the note body (Harper). |
| `grammarCheck` | boolean | `false` | — | Grammar + style check the note body (Harper); independent of spellcheck, off by default. |
| `autoSaveDelay` | number | `800` | 200–3000 | Milliseconds of idle before auto-saving. |
| `lineHeight` | number | `1.65` | 1.3–2.0 | Editor prose line height multiplier. |

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

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `false` | Supervise the claude-bot daemon and show the "daemon" graph mode. |
| `home` | string | `""` | Override claude-bot home directory. Empty string = `~/.claude-bot`. |

### `terminal`

| Key | Type | Default | Range | Description |
|---|---|---|---|---|
| `fontSize` | number | `13` | 9–20 | Terminal font size in px. |
| `lineHeight` | number | `1.5` | 1.2–2.0 | Terminal line height multiplier. |
| `cursorWidth` | number | `2` | 1–4 | Terminal cursor bar width in px. |
| `cursorGlideMs` | number | `70` | 20–200 | Cursor glide animation duration in ms. |
| `cursorBlinkSeconds` | number | `1.2` | 0.6–2.0 | Cursor blink cycle duration in seconds. |

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

Default toolbar has three buttons: `new-note`, `new-folder`, `search`.

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
  command-palette: Mod+P
  quick-switcher: Mod+O
  terminal: "Mod+`, Mod+J"
  split-right: Mod+Shift+L
  split-down: Mod+Shift+D
  equalize-panes: Mod+Shift+E
  close-pane: Mod+Shift+W
  new-tab: Mod+T
  reopen-tab: Mod+Shift+T
  history-back: Mod+[
  history-forward: Mod+]
  focus-pane-left: Mod+Left
  focus-pane-right: Mod+Right
  focus-pane-up: Mod+Up
  focus-pane-down: Mod+Down
  insert-template: Alt+T
  toggle-sidebar: Mod+Shift+S
```

The `keybindings` section is placed **last** in the schema so it appears at the bottom of a freshly generated `settings.yaml`.

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
3. **SSE re-hydrate**: when `settings.yaml` appears in an SSE change event, `GET /settings` is refetched. If the merged result equals the live store (own write echo), the update is a no-op.
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
  daemon: { enabled: boolean; home: string };
  templates?: { folder: string };
  srs: SrsConfig;        // identity match for core/src/srs/scheduler.ts SrsConfig
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

When `settings.yaml` is open in the Bismuth editor:

- **Autocomplete** (`editor/settingsComplete.ts`): Ctrl-Space suggests setting keys (scoped to the current section) and values (enum members, `true`/`false`, property type names, Lucide icon names, keybind combos with a "Record shortcut…" option). Each suggestion shows the key's `doc` string and a compact range label (e.g. `11–28` for bounded numbers, `option1 | option2 | …` for enums). The autocomplete is nested-schema-aware (knows which section the cursor is in).
- **Lint** (`editor/yamlSchema.ts`): inline diagnostics highlight wrong types, out-of-range numbers, and unknown enum values.

The `doc` field on each `SchemaEntry` is the text shown in the autocomplete. A parity test (`app/src/settings.parity.test.ts`) enforces that every settable leaf has both a materialized `default` AND a non-empty `doc`.

---

## HTTP API for Settings

| Endpoint | Description |
|---|---|
| `GET /settings` | Returns `serializeSettingsForFrontend(vault)` — file merged over defaults, `properties` section stripped. |
| `GET /schema` | Returns the vault property registry (from `settings.yaml` `properties:` section) for note validation and autocomplete. |
| `GET /config` | Read-only launch config: `{ vault, memory }`. |
| `POST /set-setting` | Merges one value at `path` into `settings.yaml` in place. Body: `{ path: string[], value: unknown }`. Goes through `mutatingHandler` — invalidates caches and broadcasts an SSE event with `paths: ["settings.yaml"]`. |

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

After this change, `DEFAULTS` is automatically updated (derived from the schema). `reconcileSettings` will add the key to existing `settings.yaml` files on next vault open. The autocomplete and lint pick it up automatically. The `settings.parity.test.ts` parity tests enforce that the default and doc are present.

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
- The backend re-reads `loadAppConfig` per-request (it is not cached indefinitely); `settings.yaml` changes are reflected within the next request after an SSE cycle.

**Adding a new top-level section** additionally requires updating the hardcoded key list in `core/test/schema/settingsSchema.test.ts` (the test asserting `Object.keys(SETTINGS_SCHEMA).sort()` — this is a guard, not a source of truth).

---

## Edge Cases and Gotchas

- **Corrupt `settings.yaml`**: if the file has YAML parse errors or the top-level value is not a map, `reconcileSettings` leaves it untouched. The user must fix it manually. Reading a corrupt file via `readSettings` returns `{ raw, data: {} }` — callers fall back to defaults.
- **`properties:` is stripped from `GET /settings`**: the property registry is delivered by `GET /schema`, not `GET /settings`. A `properties` key in the parsed server data is never forwarded to the frontend settings store.
- **Unknown keys survive reconcile AND `setSettingInFile`**: custom YAML keys not in the schema are never removed by any of the backend write operations. The parity-test and `serializeSettingsForFrontend` simply ignore them.
- **`toolbar` and `dailyNotes` are list sections**: they are validated item-by-item; malformed items are silently dropped (not errored). In `mergeServerSettings` on the frontend, array-typed top-level sections are replaced wholesale — the default is only used if the server sends a non-array.
- **Empty-path `setSettingInFile` call is a no-op**: `if (!path.length) return;` at the top of the function.
- **Per-vault mutex scope**: the mutex is keyed by vault path, so concurrent requests against different vaults run in parallel.
- **`folderIcons` written by `POST /folder-icon`**: folder icons are not set via `POST /set-setting`; they go through the dedicated `setFolderIcon(vault, path, icon)` helper which also acquires the per-vault mutex. An empty/null/undefined icon deletes the entry.

Source: `core/src/settings.ts`, `core/src/schema/settingsSchema.ts`, `core/src/schema/types.ts`, `app/src/settings.ts`, `app/src/settingsCssVars.ts`, `app/src/settingsDiff.ts`, `core/test/settings.test.ts`, `core/test/schema/settingsSchema.test.ts`, `app/src/settings.parity.test.ts`
