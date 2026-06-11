// core/src/schema/settingsSchema.ts
// The fixed, documented schema for the vault `settings.yaml` file. Every key
// mirrors a current app setting (app/src/settings.ts DEFAULTS) plus its old
// SettingsPage slider bounds, so the first-launch writer can author a fully
// commented file and the same engine validates it. DEFAULTS is the plain nested
// object the frontend store seeds from synchronously (no white-screen on boot).
import type { Schema, SchemaEntry, PropertyType } from "./types";
import { COMMAND_IDS } from "../commands";
import { KEYBINDING_CATALOG } from "../keybindings";

// Kept in lockstep with app/src/settings.ts EDITOR_FONTS.
const EDITOR_FONTS = ["Lora", "Monaspace Xenon", "Georgia", "system-ui"];
// Kept in lockstep with app/src/themes.ts THEME_NAMES (oxide-duotone is the default,
// first) and app/scripts/logoMarks.ts MARK_NAMES.
const THEME_NAMES = [
  "oxide-duotone", "gunmetal-teal", "rose-gold",
  "indigo-oxide", "forest-oxide", "full-sheen",
  "oxide-duotone-light", "gunmetal-teal-light", "rose-gold-light",
  "indigo-oxide-light", "forest-oxide-light", "full-sheen-light",
];
const ICON_NAMES = [
  "hopper-crystal", "node-b", "square-funnel", "nested-diamonds",
  "pinwheel", "node-crystal", "lattice", "diamond-bloom",
  "node-diamond", "octagon-bloom", "spin-cross", "tri-bloom",
  "radial-graph", "node-rings",
];
// CALENDAR_VIEWS must stay in sync with `ViewType` in app/src/calendar/types.ts
// (currently 'month' | 'week' | '3day' | 'day'). If ViewType changes, update here.
const CALENDAR_VIEWS = ["month", "week", "3day", "day"];

const enumType = (values: string[]): PropertyType => ({ kind: "enum", values });
const object = (fields: Schema): SchemaEntry => ({ type: { kind: "object", fields } });

// The `keybindings` section: one string-typed key per global action, derived from
// the KEYBINDING_CATALOG (single source of truth for ids + default combos). A
// nested object (not a list), so the per-key merge — autocomplete, lint, the
// parity test, and POST /set-setting — all work without any special-casing.
const keybindingFields: Schema = {};
for (const k of KEYBINDING_CATALOG) {
  keybindingFields[k.id] = { type: "keybind", default: k.default, doc: k.doc };
}

export const SETTINGS_SCHEMA: Schema = {
  appearance: object({
    // Bismuth color theme — selects EVERY color in the app + graph (background,
    // surfaces, border, text, muted, accent, and the graph node palette). The theme
    // is the single source of color; app/src/themes.ts holds the token values that
    // settingsCssVars.ts projects to CSS vars. The app is dark-only.
    theme: {
      type: enumType(THEME_NAMES),
      default: "oxide-duotone",
      doc: "Bismuth color theme: oxide-duotone (default) · gunmetal-teal · rose-gold · indigo-oxide · forest-oxide · full-sheen.",
    },
    // Per-vault app logo mark (favicon + sidebar logo). One of the 14 Bismuth marks.
    icon: {
      type: enumType(ICON_NAMES),
      default: "hopper-crystal",
      doc: "App logo mark: hopper-crystal · node-b · square-funnel · nested-diamonds · pinwheel · node-crystal · lattice · diamond-bloom · node-diamond · octagon-bloom · spin-cross · tri-bloom · radial-graph · node-rings.",
    },
    editorFont: { type: enumType(EDITOR_FONTS), default: "Lora", doc: "Editor font family." },
    editorFontSize: { type: "number", default: 16, min: 11, max: 28, doc: "Editor font size (px)." },
    sidebarWidth: { type: "number", default: 280, min: 200, max: 600, doc: "Left sidebar width (px)." },
    sidebarGraphHeight: { type: "number", default: 305, min: 200, max: 500, doc: "Height of the mini graph panel in the sidebar (px)." },
    uiFontSize: { type: "number", default: 13, min: 11, max: 16, doc: "Base UI font size — sidebar, tabs, menus (px)." },
    monoScale: { type: "number", default: 0.85, min: 0.6, max: 1, doc: "Optical-size factor for Monaspace (the mono UI/code font). Monaspace renders visually larger than the serif body at the same px; this shrinks all mono text — UI chrome and code blocks — so it optically matches. 1 = no correction." },
    tabFontSize: { type: "number", default: 12, min: 11, max: 14, doc: "Editor tab label font size (px)." },
    sidebarIconFontSize: { type: "number", default: 15, min: 12, max: 20, doc: "Sidebar header icon button size (px)." },
    paletteInputFontSize: { type: "number", default: 15, min: 13, max: 18, doc: "Command palette search-input font size (px)." },
  }),
  graph: object({
    spin: { type: "boolean", default: true, doc: "Idle rotation of the graph." },
    showFps: { type: "boolean", default: false, doc: "Show the frame-rate (FPS) counter on the graph." },
    spinSpeed: { type: "number", default: 0.0015, min: 0, max: 0.01, doc: "Idle spin speed (radians/frame)." },
    repulsion: { type: "number", default: -10, min: -40, max: -1, doc: "Node repulsion; more negative pushes apart harder." },
    linkDistance: { type: "number", default: 5, min: 1, max: 40, doc: "Target distance between linked nodes." },
    centering: { type: "number", default: 0.13, min: 0, max: 0.5, doc: "Pull toward center; higher = denser ball." },
    nodeSize: { type: "number", default: 6, min: 2, max: 16, doc: "Base node radius." },
    // NOTE: the graph 2D/3D dimension is intentionally NOT a setting. It's a transient,
    // per-window UI toggle (localStorage-backed) in app/src/GraphView.tsx, so switching it
    // never rewrites settings.yaml (which used to reload an open settings buffer and scroll
    // it to the top).
    showGraphLabels: { type: "boolean", default: true, doc: "Master toggle for in-scene labels." },
    graphLabelHubCount: { type: "number", default: 10, min: 0, max: 30, doc: "Top-degree nodes that always get a label." },
    nodeSizeMinMult: { type: "number", default: 0.4, min: 0.1, max: 1, doc: "Size multiplier for a 0/1-degree leaf node (the smallest dots)." },
    nodeSizeDegreeGain: { type: "number", default: 0.45, min: 0.1, max: 1.5, doc: "How fast node size grows with sqrt(link count)." },
    nodeSizeMaxMult: { type: "number", default: 6, min: 2, max: 12, doc: "Ceiling on node size (biggest hub vs a leaf)." },
    mapDefaultZoom: { type: "number", default: 2, min: 1, max: 18, doc: "Default zoom for the Bases map view when it can't fit markers." },
    refreshDebounceMs: { type: "number", default: 300, min: 100, max: 1000, doc: "Delay before rebuilding the graph after an edit burst (ms)." },
  }),
  editor: object({
    livePreview: { type: "boolean", default: true, doc: "Render markdown inline as you type." },
    lineNumbers: { type: "boolean", default: false, doc: "Show line numbers." },
    lineWrapping: { type: "boolean", default: true, doc: "Wrap long lines." },
    spellcheck: { type: "boolean", default: true, doc: "Spell + grammar check the note body (Harper)." },
    autoSaveDelay: { type: "number", default: 800, min: 200, max: 3000, doc: "Milliseconds of idle before saving." },
    lineHeight: { type: "number", default: 1.65, min: 1.3, max: 2, doc: "Editor prose line height (multiplier)." },
  }),
  vault: object({
    backupOnSave: { type: "boolean", default: true, doc: "Take a git snapshot after every save." },
  }),
  // Where pasted/dropped attachments (images, PDFs, audio, video) are saved, and what
  // happens when you drag a file in from outside the vault. Embeds always RESOLVE by
  // filename (like wikilinks), so `folder` only sets where NEW files land — moving an
  // attachment later never breaks its `![[name]]` embed.
  attachments: object({
    folder: {
      type: "string",
      default: "attachments",
      doc: 'Folder for new pasted/dropped attachments (relative to the vault root). Created automatically if missing; "" = vault root, "." = the current note\'s folder.',
    },
    onDrop: {
      type: enumType(["copy", "reference"]),
      default: "copy",
      doc: "Dragging a file in from outside the vault: copy it into the attachment folder (default, keeps the vault self-contained), or reference it in place (⌥-drop always references). Pasted clipboard images always copy in. Note: reference-in-place is best-effort in the browser build (the referenced file isn't in the vault, so the embed only resolves on desktop).",
    },
    naming: {
      type: "string",
      default: "Pasted image {timestamp}",
      doc: "Filename for pasted clipboard images (the extension is added automatically). {timestamp} → a sortable date-time stamp; name collisions get a numeric suffix.",
    },
  }),
  calendar: object({
    // defaultView enum is coupled to ViewType in app/src/calendar/types.ts.
    defaultView: { type: enumType(CALENDAR_VIEWS), default: "week", doc: "Default calendar view." },
    weekStartsOnMonday: { type: "boolean", default: true, doc: "Start the week on Monday." },
    militaryTime: { type: "boolean", default: false, doc: "Use 24-hour time." },
    monthCellMinHeight: { type: "number", default: 80, min: 50, max: 160, doc: "Minimum height of a day cell in month view (px)." },
    timeGutterWidth: { type: "number", default: 50, min: 40, max: 80, doc: "Width of the hour-label gutter in week/day views (px)." },
    defaultCategoryColor: { type: "string", default: "#4a90e2", doc: "Default color for a newly created event category (hex)." },
  }),
  ui: object({
    paletteTopOffset: { type: "string", default: "12vh", doc: "How far down the screen the command palette appears (CSS length, e.g. 12vh)." },
    paneDividerWidth: { type: "number", default: 5, min: 3, max: 12, doc: "Thickness of the draggable divider between split panes (px)." },
    cardGridMinWidth: { type: "number", default: 220, min: 150, max: 360, doc: "Minimum card width in the Bases cards view (px)." },
    kanbanColumnMinWidth: { type: "number", default: 248, min: 180, max: 360, doc: "Minimum Bases kanban column width (px)." },
    kanbanColumnMaxWidth: { type: "number", default: 288, min: 220, max: 420, doc: "Maximum Bases kanban column width (px)." },
    mapMinHeight: { type: "number", default: 480, min: 300, max: 800, doc: "Minimum height of the Bases map view (px)." },
    tableMinColWidth: { type: "number", default: 60, min: 30, max: 150, doc: "Minimum column width when resizing a Bases table (px)." },
  }),
  server: object({
    fileWatchDebounceMs: { type: "number", default: 250, min: 50, max: 2000, doc: "Coalesce rapid file changes for this long before rebuilding caches (ms)." },
    sseHeartbeatMs: { type: "number", default: 5000, min: 1000, max: 30000, doc: "Keepalive ping interval for the live-update stream (ms)." },
  }),
  // claude-bot daemon supervision. Bismuth reads/writes the daemon's shared state
  // files (device list + owner-device selection) under its home dir. The owner
  // device is the single source of truth in owner.json — NOT a setting here.
  daemon: object({
    enabled: { type: "boolean", default: false, doc: "Supervise the claude-bot daemon." },
    home: { type: { kind: "path", only: "dir", scope: "fs" }, default: "", doc: "Override claude-bot home dir; empty = ~/.claude-bot." },
    autoUpdate: { type: "boolean", default: true, doc: "When the daemon is installed, auto-update it on app launch (git pull + bun install + restart) if it's behind — in the background." },
  }),
  // Bismuth-app self-update. The bundled app can git-pull + rebuild + swap itself
  // (see core/src/selfUpdate.ts); by default that's manual via the update banner.
  update: object({
    autoUpdate: { type: "boolean", default: false, doc: "Auto-apply Bismuth app updates on launch in the background, then relaunch when the rebuild is ready (off = manual via the update banner)." },
  }),
  terminal: object({
    fontSize: { type: "number", default: 13, min: 9, max: 20, doc: "Terminal font size (px)." },
    lineHeight: { type: "number", default: 1.5, min: 1.2, max: 2, doc: "Terminal line height (multiplier)." },
    cursorWidth: { type: "number", default: 2, min: 1, max: 4, doc: "Terminal cursor bar width (px)." },
    cursorGlideMs: { type: "number", default: 70, min: 20, max: 200, doc: "Cursor glide animation duration (ms)." },
    cursorBlinkSeconds: { type: "number", default: 1.2, min: 0.6, max: 2, doc: "Cursor blink cycle duration (seconds)." },
  }),
  srs: object({
    baseEase: { type: "number", default: 250, min: 130, max: 400, doc: "Starting ease factor for a new flashcard (SM-2; higher = longer intervals)." },
    easyBonus: { type: "number", default: 1.3, min: 1, max: 2, doc: "Extra interval multiplier when a card is rated 'easy'." },
    lapsesIntervalChange: { type: "number", default: 0.5, min: 0.1, max: 1, doc: "Interval multiplier when a card is rated 'hard' (lapse penalty)." },
    minEase: { type: "number", default: 130, min: 50, max: 250, doc: "Floor on a card's ease factor." },
    easeStep: { type: "number", default: 20, min: 5, max: 50, doc: "Ease change per review." },
    easyGraduatingInterval: { type: "number", default: 4, min: 1, max: 14, doc: "Days until next review when a new card is rated 'easy'." },
    goodGraduatingInterval: { type: "number", default: 1, min: 1, max: 3, doc: "Days until next review when a new card is rated 'good'/'hard'." },
  }),
  templates: object({
    folder: { type: { kind: "path", only: "dir" }, default: "Templates", doc: "Vault folder holding template .md files. Option+T inserts one at the cursor." },
  }),
  // The vault-wide property registry. Free-form `{name: typeString}`, validated
  // leniently by registry.loadRegistry — seeded empty on first launch.
  properties: { type: { kind: "object", fields: {} }, doc: "Vault property registry: map each frontmatter key to a type." },
  // Per-folder icons. Free-form `{folderPath: iconName}` (folders have no
  // frontmatter), seeded empty and written via POST /folder-icon.
  folderIcons: { type: { kind: "object", fields: {} }, doc: "Per-folder icons: map a folder path to a Lucide icon name or emoji." },
  // Sidebar header bar buttons, in order. Each runs a command-palette command.
  // Seeded with the three built-ins so a fresh install is unchanged.
  toolbar: {
    type: { kind: "list", item: { kind: "object", fields: {
      command: { type: { kind: "enum", values: COMMAND_IDS, allowPrefixes: ["daily-note:"] }, doc: "Which command this button runs (a catalog id or daily-note:<id>). Use command: OR commands:, not both." },
      commands: { type: { kind: "list", item: { kind: "enum", values: COMMAND_IDS, allowPrefixes: ["daily-note:"] } }, doc: "Multiple commands to run in sequence (alternative to command: field). Use command: OR commands:, not both." },
      icon: { type: "icon", doc: 'Lucide icon name (e.g. "FilePlus") or an emoji shown on the button.' },
      tooltip: { type: "string", doc: "Optional hover text (defaults to the command's label)." },
    } } },
    default: [
      { command: "new-note", icon: "FilePlus" },
      { command: "new-folder", icon: "FolderPlus" },
      { command: "search", icon: "Search" },
    ],
    doc: "Buttons in the sidebar header bar, in order. Each runs a command-palette command.",
  },
  // Daily-note types. Each registers a `daily-note:<id>` command (see core/commands)
  // that you reference from `toolbar` to get a button. Pressing it opens today's note
  // for that type, creating it from `template` the first time. Top-level list, read
  // via readDailyNotesFrom (mirrors toolbar/folderIcons).
  dailyNotes: {
    type: { kind: "list", item: { kind: "object", fields: {
      id:       { type: "string", doc: "Stable id; forms the command id daily-note:<id>." },
      label:    { type: "string", doc: "Command-palette label and default button tooltip." },
      icon:     { type: "icon",   doc: 'Lucide icon name (e.g. "BookOpen") or an emoji.' },
      folder:   { type: { kind: "path", only: "dir" }, doc: 'Vault folder for entries ("" = vault root).' },
      fileName: { type: "string", doc: "Filename via {{...}} tokens, no .md. e.g. {{date}} journal." },
      template: { type: { kind: "path", scope: "templates" }, doc: "Vault path to a template .md to pre-fill the note (optional)." },
    } } },
    default: [
      { id: "journal", label: "Journal", icon: "BookOpen", folder: "Journal", fileName: "{{date}} journal", template: "Templates/Journal.md" },
    ],
    doc: "Daily-note types. Each adds a daily-note:<id> command you can put on the toolbar.",
  },
  // Global keyboard shortcuts — placed LAST so it sits at the end of a fresh
  // settings.yaml. One key per app-level action; the value is a `keybind` combo
  // string (e.g. "Mod+P" — Mod = Cmd on macOS / Ctrl elsewhere). Comma-separate
  // alternatives ("Mod+`, Mod+J"). The `keybind` type drives the smart, order-free
  // shortcut autocomplete + "record shortcut" option (app/src/editor/settingsComplete).
  // Defaults equal the previously hardcoded combos; fields derive from KEYBINDING_CATALOG.
  keybindings: object(keybindingFields),
};

/** Recursively materialize the `default` of every leaf into a plain nested object. */
function deriveDefaults(schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(schema)) {
    if (typeof entry.type === "object" && entry.type.kind === "object") {
      out[key] = deriveDefaults(entry.type.fields);
    } else if (entry.default !== undefined) {
      out[key] = entry.default;
    }
  }
  return out;
}

// AppSettings is the structural shape the frontend store consumes; deriving it
// from the schema keeps it in lockstep with the documented defaults.
export type AppSettings = ReturnType<typeof deriveDefaults>;

export const DEFAULTS: AppSettings = deriveDefaults(SETTINGS_SCHEMA);
