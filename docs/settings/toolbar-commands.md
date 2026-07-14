# Toolbar & Commands

> The same item shape drives BOTH bars: `toolbar:` (the sidebar header bar) and `tabBar:`
> (the buttons right of the tab strip — defaults: `new-tab`, `terminal`, `new-claude-chat`).
> Everything below applies to either key.

This document is the canonical reference for Bismuth's command system: the pure command catalog (`COMMAND_CATALOG`), how each command id binds to a runnable action, the `toolbar:` settings configuration that places command buttons in the sidebar header bar, and the dynamic `daily-note:<id>` commands. It covers every command id, label, default icon, the `command`/`commands`/`icon`/`tooltip` button fields, button resolution precedence, and the edge cases found in the source.

## Overview

Commands are split into **pure data** and **behavior** so the command palette and the sidebar header toolbar share one source of truth:

- **`core/src/commands.ts`** — `COMMAND_CATALOG`, a list of `CommandSpec` (`id`, `label`, `icon`). Pure metadata, no frontend imports. The settings schema derives the `toolbar.command` enum from `COMMAND_IDS` (so `.settings` autocomplete and lint know every valid command id). This file is the **single source of truth for command ids**.
- **`app/src/commands.ts`** — `bindCommands(handlers, dailyNotes)` produces a live `Map<string, BoundCommand>` where each catalog id is mapped to a runnable `{ id, label, icon, action }`. The catalog says *what* each command is; the binding says *what it does*. `App.tsx` passes its handlers in once.
- **`core/src/schema/settingsSchema.ts`** — defines the `toolbar:` settings key (a list of button objects) and the `dailyNotes:` key (which registers extra `daily-note:<id>` commands).

The sidebar header bar (`.sidebar-icons` in `App.tsx`) is configured entirely by `toolbar:` in `.settings`. There is no GUI for it — you edit `.settings` directly (see [settings overview](./overview.md)).

## The Command Catalog

`COMMAND_CATALOG` (in `core/src/commands.ts`) is the complete, ordered list of every built-in command. Each entry is a `CommandSpec`:

```ts
export interface CommandSpec {
  /** Stable id referenced by settings.yaml `toolbar` entries and the palette. */
  id: string;
  /** Human label shown in the palette and as a button's default tooltip. */
  label: string;
  /** Default Lucide icon name (the palette icon; toolbar buttons may override). */
  icon: string;
}
```

`COMMAND_IDS` is derived as `COMMAND_CATALOG.map(c => c.id)` (catalog order), and `commandLabel(id)` returns the label for an id or `undefined` for an unknown id.

Invariants enforced by `core/test/commands.test.ts`:

- `COMMAND_IDS` equals `COMMAND_CATALOG.map(c => c.id)`, in catalog order.
- All ids are unique.
- Every command has a non-empty `label` and `icon`.

### Complete command list

The table below lists **every** entry in `COMMAND_CATALOG`, in exact catalog order, with its default Lucide icon and the `CommandHandlers` method it binds to (see "How commands bind to actions").

| # | id | label | default icon | bound handler / action |
|---|---|---|---|---|
| 1 | `new-tab` | New tab | `Plus` | `h.newTab` |
| 2 | `close-tab` | Close tab | `X` | `h.closeActiveTab` |
| 3 | `reopen-tab` | Reopen closed tab | `RotateCcw` | `h.reopenClosedTab` |
| 4 | `history-back` | Back | `ArrowLeft` | `h.historyBack` |
| 5 | `history-forward` | Forward | `ArrowRight` | `h.historyForward` |
| 6 | `open-graph` | Open graph view | `Share2` | `h.openGraph` |
| 7 | `open-folder` | Open folder… | `FolderOpen` | `h.openFolder` |
| 8 | `new-window` | New window | `AppWindow` | `h.newWindow` |
| 9 | `create-menu` | Create new… | `Plus` | `h.openCreateMenu` |
| 10 | `new-note` | New note | `FilePlus` | `h.newNote` |
| 11 | `new-folder` | New folder | `FolderPlus` | `h.newFolder` |
| 12 | `new-base` | New base | `Database` | `h.newBase` |
| 13 | `new-spreadsheet` | New spreadsheet | `Table` | `h.newSpreadsheet` |
| 14 | `new-drawing` | New drawing | `PenTool` | `h.newDrawing` |
| 15 | `new-claude-chat` | New Claude Chat | `MessageSquare` | `h.newClaudeChat` |
| 16 | `export` | Export current file… | `Download` | `h.exportActive` |
| 17 | `archive-tasks` | Archive completed tasks (this note) | `Archive` | `h.archiveTasks` |
| 18 | `archive-all-tasks` | Archive completed tasks (all notes) | `ArchiveX` | `h.archiveAllTasks` |
| 19 | `detect-ai` | Detect AI text | `Bot` | `h.detectAiActive` |
| 20 | `emoji-library` | Emoji library… | `Smile` | `h.openEmojiLibrary` |
| 21 | `terminal` | Open Terminal | `SquareTerminal` | `h.openTerminal` |
| 22 | `search` | Search | `Search` | `h.openSearch` |
| 23 | `settings` | Open Settings | `Settings` | `h.openSettings` |
| 24 | `edit-dictionary` | Edit custom dictionary… | `BookOpen` | `h.openEditDictionary` |
| 25 | `graph-2nd` | Graph: 2nd Brain (vault) | `Notebook` | `() => h.setMode("2nd")` |
| 26 | `graph-3rd` | Graph: 3rd Brain (memory) | `Brain` | `() => h.setMode("3rd")` |
| 27 | `graph-both` | Graph: Both Brains | `Network` | `() => h.setMode("both")` |
| 28 | `graph-agents` | Graph: Agents | `Users` | `() => h.setMode("agents")` |
| 29 | `equalize-panes` | Equalize panes | `Columns3` | `h.equalizePanes` |
| 30 | `toggle-sidebar` | Toggle sidebar | `PanelLeft` | `h.toggleSidebar` |
| 31 | `daemon-owner` | Set daemon owner device… | `Server` | `h.openDaemonOwner` |
| 32 | `daemon-setup` | Set up daemon… | `Download` | `h.openDaemonSetup` |
| 33 | `daemon-update` | Update daemon… | `RefreshCw` | `h.updateDaemon` |
| 34 | `bismuth-install` | Install Bismuth CLI + MCP… | `Download` | `h.openBismuthInstall` |
| 35 | `update-app` | Update Bismuth… | `RefreshCw` | `h.updateApp` |
| 36 | `gcal-connect` | Connect Google Calendar… | `Calendar` | `h.gcalConnect` |
| 37 | `gcal-sync` | Sync Google Calendar | `RefreshCw` | `h.gcalSync` |
| 38 | `gcal-disconnect` | Disconnect Google Calendar | `CalendarX` | `h.gcalDisconnect` |
| 39 | `zoom-in` | Zoom In | `ZoomIn` | `h.zoomIn` |
| 40 | `zoom-out` | Zoom Out | `ZoomOut` | `h.zoomOut` |
| 41 | `zoom-reset` | Reset Zoom | `RotateCcw` | `h.zoomReset` |

Notes on individual commands:

- **`new-tab` vs `open-graph`**: `new-tab` always spawns a fresh graph home tab; `open-graph` focuses an existing graph tab if one is open (else opens one). (Comment in `app/src/commands.ts`.)
- **`create-menu`** is the **`+Create` chooser** — a single button that opens a context menu of all the "create" commands instead of running one. See ["The `create-menu` chooser"](#the-create-menu-chooser) below.
- **File-menu commands** (`open-folder`, `new-window`, `export`): `open-folder` opens a chosen folder as its own brain in a new window (a sibling backend); `new-window` reopens the current folder in a new window; `export` acts on the active file.
- **`new-base`** creates a `type: base` markdown file. As a plain command (palette / toolbar `command: new-base`) it calls `h.newBase` directly; as the `create-menu` "New base ▸" submenu it offers one entry per Bases view kind (see the chooser section).
- **`archive-tasks` / `archive-all-tasks`**: permanently remove completed/cancelled tasks — from the **active note** (`h.archiveTasks`) or across **all notes** (`h.archiveAllTasks`).
- **`detect-ai`**: estimates how AI-generated the active page reads and toasts the score. It runs a **local, offline** detector — see ["The `detect-ai` command"](#the-detect-ai-command).
- **`emoji-library`**: opens the emoji grid picker (`h.openEmojiLibrary` → `openGallery({ source: emojiSource })`) and inserts the chosen glyph at the focused editor's caret (`insertIntoFocusedEditor`; toasts "Open a note to insert an emoji" when no note is focused). It is the **always-visible home** for the full library and ships in the **default sidebar toolbar** (beside `create-menu`). This is why the `:emoji` completion popup no longer carries an "Open emoji gallery" row — that buried the library and could outrank a real match like `:rocket` (#67; see `docs/editor/autocomplete.md`).
- **`edit-dictionary`**: opens the modal to view/remove the user's custom spellcheck dictionary words (`h.openEditDictionary`).
- **Graph-mode commands** (`graph-2nd`, `graph-3rd`, `graph-both`, `graph-agents`): each calls `h.setMode(...)` with the corresponding graph mode string.
- **`daemon-owner` / `daemon-setup` / `daemon-update`**: open the daemon owner-picker modal (`h.openDaemonOwner`), the install/repair (adopt) panel (`h.openDaemonSetup`), and trigger an update of the daemon respectively. `daemon-update` binds to its **own** handler `h.updateDaemon` (POST `/daemon/update`, idempotent + fetch-gated, toasts progress) — the daemon updates *with* the app via `runSetup` (`core/src/daemonInstall.ts`), not a separate git-pull. See Daemon Integration in the project CLAUDE.md.
- **`bismuth-install`**: opens the panel to install the `bismuth` CLI + MCP machine-wide (`h.openBismuthInstall`).
- **`update-app`**: manually updates the Bismuth app (same pipeline as the `UpdateBanner` button) for when the banner was dismissed or missed; no-op-with-toast when already up to date / in dev (`h.updateApp`).
- **`new-claude-chat`**: opens a fresh Claude Code chat session in its own tab (`h.newClaudeChat`).
- **`gcal-connect` / `gcal-sync` / `gcal-disconnect`**: open the "Connect Google Calendar" OAuth panel (`h.gcalConnect`), pull events from Google Calendar into the configured base (`h.gcalSync`), and disconnect Google Calendar — revoke + wipe stored tokens (`h.gcalDisconnect`).
- **`zoom-in` / `zoom-out` / `zoom-reset`**: step the whole app's UI zoom in/out or reset it to 100% (`app/src/zoom.ts`) — the same feature as the `zoom-in`/`zoom-out`/`zoom-reset` keybindings (default `Mod+=`/`Mod+Shift+=`, `Mod+-`, `Mod+0`; see [keybindings](./keybindings.md)). Zoom uses native webview page-zoom (`tauri::WebviewWindow::set_zoom`, the same mechanism as a real browser's Cmd+=/Cmd+-), applied to the invoking window; the level is a per-machine `localStorage` preference (like the graph's 2D/3D toggle), not a `.settings` value, since it's a display preference rather than vault content.

### Notable absences / gotchas

- **There is no `graph-daemon` command** in the catalog, even though the renderer has a `"daemon"` graph mode. `setMode`'s type accepts `"2nd" | "3rd" | "both" | "agents" | "daemon"`, but only the first four have catalog commands. Daemon mode is reached via the daemon sidebar/UI, not a toolbar command.
- **Several commands share an icon**: `Download` (`export`, `daemon-setup`, `bismuth-install`), `RefreshCw` (`daemon-update`, `update-app`, `gcal-sync`), and **`new-tab` shares `Plus` with `create-menu`**. That is intentional and allowed — icon uniqueness is not an invariant (only `id` uniqueness is).
- Icons are **Lucide icon names** by convention (matched against the icon registry on the frontend), but toolbar/daily-note `icon` fields may also be a literal emoji (see "Button fields").

### The `create-menu` chooser

`create-menu` (`Create new…`, icon `Plus`) is a **single button that opens a `+Create` context menu** instead of running one create command. It binds to `h.openCreateMenu(e?)`, and unlike every other handler it takes the triggering `MouseEvent` so the menu can anchor under the clicked button (it falls back to a fixed spot — `x: 8, y: 48` — when invoked without an event, e.g. from the command palette). This is why `BoundCommand.action` is typed `(e?: MouseEvent) => void`.

`openCreateMenu` (`App.tsx`) assembles the menu from the bound command map, in order:

1. `new-note`
2. `new-folder`
3. **`New base ▸`** — a submenu (icon `Database`), **not** the flat `new-base` command. It maps over `BASE_VIEW_KINDS` (`app/src/baseViews.ts`), one entry per Bases view kind; each entry dispatches an `bismuth-new` event (`{ kind: "base", view }`) that seeds a `type: base` file with that view via the same `bismuth-new` → `FileTree.doCreate` path.
4. `new-spreadsheet`
5. `new-drawing`
6. Then each **resolving** `daily-note:<id>` command (a config with a blank id is skipped), with a separator before the first daily-note entry when any static entry preceded it.

The **12 base view kinds** in the `New base ▸` submenu (from `BASE_VIEW_KINDS`, in declared order) — `view` value, menu label, icon:

| # | view | label | icon |
|---|---|---|---|
| 1 | `table` | Table | `Table` |
| 2 | `cards` | Cards | `LayoutGrid` |
| 3 | `list` | List | `List` |
| 4 | `bullets` | Bullets | `TextQuote` |
| 5 | `kanban` | Kanban | `SquareKanban` |
| 6 | `calendar` | Calendar | `Calendar` |
| 7 | `flashcards` | Flashcards | `Layers` |
| 8 | `map` | Map | `Map` |
| 9 | `bar` | Bar chart | `ChartColumn` |
| 10 | `line` | Line chart | `ChartLine` |
| 11 | `stat` | Stat | `Sigma` |
| 12 | `heatmap` | Heatmap | `Grid3x3` |

Each kind seeds a file named `Untitled <label>.md` (`baseFileName`) with starter frontmatter (`baseTemplate`): `calendar` gets `---\ntype: base\nview: calendar\n---\n` (it stores its events in the body, so no `source:`); every other view gets `---\ntype: base\nsource: notes\nview: <view>\n---\n` so it renders the vault immediately. The same list backs the folder context menu's "New base ▸" in `FileTree`, keeping the two menus in sync.

### The `detect-ai` command

`detect-ai` (`Detect AI text`, icon `Bot`) binds to `h.detectAiActive`. It estimates how AI-generated the **active page** reads and toasts a whole-document score. The detection runs **entirely on-device, offline** — there is no network call to any model API:

- It uses **transformers.js** (`@huggingface/transformers`, onnxruntime-web WASM) in the **frontend webview**, never in the core sidecar (the same `$bunfs` WASM-path limitation that keeps Harper spellcheck frontend-only). See `app/src/ai/aiDetect.ts`.
- The classifier (`onnx-community/e5-small-lora-ai-generated-detector-ONNX`, int8 `q8`, ~34MB) is **lazy-loaded + code-split**, so it costs nothing at boot; the model downloads on **first use** and is then cached by transformers.js, so later runs are effectively offline.
- `detectAiScore(text, onProgress?)` strips frontmatter, splits prose into ~280-word windows, evenly samples at most 16 of them, scores each window, and returns `{ score, peak, chunks }` (mean P(AI), highest single-window P(AI), window count). `onProgress` reports a `load` phase (first-run download, 0–100) then an `analyze` phase (window-by-window) so the UI can show real progress.
- It throws `TooShortError` when there are fewer than 40 words of prose.
- **Accuracy caveat baked into the code**: the model is trained on the RAID corpus, which contains **no Claude**, so it is unvalidated on Claude-class text and unreliable on edited/paraphrased prose. It is a rough hint, never proof — the UI must say so.

## How Commands Bind to Actions

`bindCommands(handlers, dailyNotes)` in `app/src/commands.ts` turns the pure catalog into a runnable map.

```ts
export function bindCommands(
  h: CommandHandlers,
  dailyNotes: DailyNoteConfig[] = [],
): Map<string, BoundCommand>
```

`BoundCommand` is the runnable shape consumed by both the palette and the toolbar:

```ts
export interface BoundCommand {
  id: string;
  label: string;
  icon: string;
  action: () => void;
}
```

### CommandHandlers

`App` supplies one `CommandHandlers` object (`app/src/commands.ts`). It is the full set of behaviors bound to catalog ids:

```ts
export interface CommandHandlers {
  openSettings: () => void;
  openTerminal: () => void;
  openSearch: () => void;
  newNote: () => void;
  newFolder: () => void;
  newBase: () => void;
  newSpreadsheet: () => void;
  newDrawing: () => void | Promise<void>;
  // The "+" create chooser. Receives the triggering click (when run from a toolbar
  // button) so the menu can anchor under that button; falls back to a fixed spot
  // when invoked without an event (e.g. from the command palette).
  openCreateMenu: (e?: MouseEvent) => void;
  openGraph: () => void;
  setMode: (mode: GraphMode) => void;        // GraphMode = "2nd"|"3rd"|"both"|"agents"|"daemon"
  openDailyNote: (id: string) => void;
  equalizePanes: () => void;
  toggleSidebar: () => void;
  newTab: () => void;
  closeActiveTab: () => void;
  reopenClosedTab: () => void;
  historyBack: () => void;
  historyForward: () => void;
  openFolder: () => void | Promise<void>;
  newWindow: () => void | Promise<void>;
  exportActive: () => void;
  // Estimate how AI-generated the active page reads (local, offline) and toast the score.
  detectAiActive: () => void | Promise<void>;
  // Open the modal to pick which device owns the daemon.
  openDaemonOwner: () => void;
  // Open the panel to install/repair (adopt) the daemon.
  openDaemonSetup: () => void;
  // Update the daemon to the latest version (POST /daemon/update, idempotent +
  // fetch-gated) — toasts progress. Distinct from openDaemonSetup, which only installs/adopts.
  updateDaemon: () => void | Promise<void>;
  // Open the panel to install the bismuth CLI + MCP machine-wide.
  openBismuthInstall: () => void;
  // Manually update the Bismuth app (same pipeline as the UpdateBanner button) — for when
  // the banner was dismissed or missed. No-op-with-toast when already up to date / in dev.
  updateApp: () => void | Promise<void>;
  // Open the modal to view/remove the user's custom spellcheck dictionary words.
  openEditDictionary: () => void;
  // Permanently remove completed/cancelled tasks — from the active note, or all notes.
  archiveTasks: () => void | Promise<void>;
  archiveAllTasks: () => void | Promise<void>;
  // Open the "Connect Google Calendar" panel (OAuth connect/disconnect/status).
  gcalConnect: () => void;
  // Pull events from Google Calendar into the configured base (one-way sync).
  gcalSync: () => void | Promise<void>;
  // Disconnect Google Calendar (revoke + wipe stored tokens).
  gcalDisconnect: () => void | Promise<void>;
  // Open the emoji library (grid picker) and insert the pick at the focused editor's caret.
  openEmojiLibrary: () => void | Promise<void>;
  // Open a fresh Claude Code chat session in its own tab.
  newClaudeChat: () => void;
}
```

Because actions may anchor a popover or run async, `BoundCommand.action` is `(e?: MouseEvent) => void` (most actions ignore the event; `create-menu` uses it to anchor its chooser to the clicked button).

`App.tsx` (around line 793) constructs the bound map reactively:

```ts
const commands = () => bindCommands(
  { openSettings, openTerminal, openSearch, newNote, newFolder, newBase, newSpreadsheet,
    newDrawing, openCreateMenu, openGraph, setMode, openDailyNote, equalizePanes,
    toggleSidebar, openFolder, newWindow, exportActive, detectAiActive, newTab,
    closeActiveTab, reopenClosedTab, historyBack, historyForward, openDaemonOwner,
    openDaemonSetup, updateDaemon, openBismuthInstall, updateApp, openEditDictionary,
    archiveTasks, archiveAllTasks, gcalConnect: openGcalConnect, gcalSync, gcalDisconnect,
    newClaudeChat, openEmojiLibrary },
  settings.dailyNotes,
);
```

### Binding algorithm

Inside `bindCommands` an internal `actions: Record<string, () => void | Promise<void>>` maps every catalog id to a closure over a handler. Then:

1. For each `spec` in `COMMAND_CATALOG`, look up `actions[spec.id]`.
2. If there is no action, **skip defensively** (a catalog entry with no binding is dropped silently).
3. Otherwise `map.set(spec.id, { id, label, icon, action })`, carrying the catalog's `label` and `icon`.

This means the produced map keys are the catalog ids that have a binding, plus the dynamic daily-note ids (below).

Verified behavior (`app/src/commands.test.ts`):

- `map.get("terminal")?.label === "Open Terminal"`, `map.get("graph-both")?.icon === "Network"`, `map.get("nope") === undefined`.
- Running `map.get("new-note")!.action()`, then `graph-2nd`, then `settings` records `["new-note", "mode:2nd", "settings"]` — confirming `graph-2nd` calls `setMode("2nd")`.

## Dynamic Daily-Note Commands

`bindCommands` also registers a command per entry in the `dailyNotes` config (passed as `settings.dailyNotes`). These are **NOT** in the static `COMMAND_CATALOG`; they are generated at bind time:

```ts
for (const dn of dailyNotes) {
  if (!dn.id) continue;                          // entries with no id are skipped
  const id = `daily-note:${dn.id}`;
  map.set(id, {
    id,
    label: `Create Daily Note: ${dn.label || dn.id}`,
    icon: dn.icon || "CalendarDays",             // default icon if none configured
    action: () => h.openDailyNote(dn.id),
  });
}
```

Key facts:

- The command id is `daily-note:<id>` where `<id>` is the daily-note config's `id`.
- Label is `Create Daily Note: <label-or-id>`.
- Icon falls back to `CalendarDays` when the config has no `icon`.
- Entries with an empty/missing `id` are skipped.
- The action calls `h.openDailyNote(dn.id)` (opens today's note for that type, creating it from `template` on first use).

Verified (`app/src/commands.test.ts`): with `[{ id: "journal", label: "Journal", icon: "BookOpen", ... }]`, `map.get("daily-note:journal")` has label `"Create Daily Note: Journal"`, icon `"BookOpen"`, and its action records `daily:journal`.

The `dailyNotes` settings key is configured separately — see [daily notes & templates](../templates/syntax.md) for its full field set (`id`, `label`, `icon`, `folder`, `fileName`, `template`).

## The `toolbar:` Setting

The sidebar header bar buttons are configured by the top-level `toolbar:` key in `.settings`. Schema definition (`core/src/schema/settingsSchema.ts`):

```ts
toolbar: {
  type: { kind: "list", item: { kind: "object", fields: {
    command:  { type: { kind: "enum", values: COMMAND_IDS, allowPrefixes: ["daily-note:"] },
                doc: "Which command this button runs (a catalog id or daily-note:<id>). Use command: OR commands:, not both." },
    commands: { type: { kind: "list", item: { kind: "enum", values: COMMAND_IDS, allowPrefixes: ["daily-note:"] } },
                doc: "Multiple commands to run in sequence (alternative to command: field). Use command: OR commands:, not both." },
    icon:     { type: "icon",
                doc: 'Lucide icon name (e.g. "FilePlus") or an emoji shown on the button.' },
    tooltip:  { type: "string",
                doc: "Optional hover text (defaults to the command's label)." },
  } } },
  default: [
    { command: "create-menu",   icon: "Plus" },
    { command: "emoji-library",  icon: "Smile" },   // always-visible home for the emoji library (#67)
    { command: "search",         icon: "Search" },
    { command: "open-inbox",     icon: "Inbox" },
  ],
  doc: "Buttons in the sidebar header bar, in order. Each runs a command-palette command.",
}
```

`toolbar:` is a **list of button objects**, rendered left-to-right in declared order. The default (seeded on a fresh install) is three buttons: **New note**, **New folder**, **Search** — chosen so a fresh install is unchanged from before the toolbar was configurable.

### Button fields

| field | type | required | meaning |
|---|---|---|---|
| `command` | enum of `COMMAND_IDS`, plus the `daily-note:` prefix | no* | The single command id this button runs. |
| `commands` | list of those same enum values | no* | An ordered list of command ids to run in sequence (alternative to `command`). |
| `icon` | `icon` (Lucide name or emoji) | no | The glyph drawn on the button. Falls back to `CircleHelp` when the command is unknown. |
| `tooltip` | string | no | Hover text. Defaults to the resolved command's `label`. |

\* Use **`command:` OR `commands:`, not both**. If both are present, `commands` (when non-empty) wins (see precedence below).

#### `command` / `commands` enum values

Both fields are validated against the enum `values: COMMAND_IDS` with `allowPrefixes: ["daily-note:"]`. Validation logic (`core/src/schema/validate.ts`):

- A value is accepted if it is exactly one of `COMMAND_IDS`, **or** it starts with an allowed prefix (`daily-note:`).
- So `daily-note:journal`, `daily-note:anything` pass lint even though the literal isn't in the enum (the actual id existence is resolved at bind time, not at lint time).
- An unrecognized value (not a catalog id, not `daily-note:`-prefixed) produces an error diagnostic: `expected one of: <comma-separated COMMAND_IDS>`, with up to 3 nearest-match suggestions.

Autocomplete (`app/src/editor/settingsComplete.ts`) augments the enum list for `command:`/`commands:` with the document's configured daily-note ids, so typing offers `daily-note:<id>` completions with the daily note's label as detail. The completion popup's `validFor` is widened to `/^[\w:-]*$/` so it survives typing the `:` in `daily-note:<id>`.

#### `icon` field

The `icon` PropertyType is a literal `"icon"` (see `core/src/schema/types.ts`). It accepts a Lucide icon **name** (e.g. `FilePlus`, `Search`, `SquareTerminal`) or an **emoji**. Autocomplete offers an icon gallery plus name matches. The button uses `btn.icon` directly when rendering, **independent of the command's catalog icon** — i.e. a toolbar button's icon overrides the palette/catalog icon for that command.

#### `tooltip` field

Optional hover text. When omitted, the rendered button's label is the resolved command's `label` (`btn.tooltip ?? c().label` in `App.tsx`).

### How the toolbar renders (single-command path)

`App.tsx` (`.sidebar-icons`) iterates `settings.toolbar` and, for each button, looks up its **single** `command` id in the bound map:

```tsx
<For each={settings.toolbar}>
  {(btn) => {
    const cmd = () => commands().get(btn.command);
    return (
      <Show
        when={cmd()}
        fallback={
          <IconButton icon={btn.icon || "CircleHelp"} iconSize={18} disabled
                      label={`Unknown command: ${btn.command}`} />
        }
      >
        {(c) => (
          <IconButton icon={btn.icon} iconSize={18}
                      label={btn.tooltip ?? c().label}
                      onClick={() => c().action()} />
        )}
      </Show>
    );
  }}
</For>
```

Behavior of the current renderer:

- It resolves `btn.command` directly against the bound map.
- If the command resolves, it renders an `IconButton` with `btn.icon`, tooltip `btn.tooltip ?? command.label`, and `onClick` running the command's `action()`.
- If the command does **not** resolve (unknown/unbound id), it renders a **disabled** `IconButton` with icon `btn.icon || "CircleHelp"` and label `Unknown command: <id>`.

### Button resolution precedence (`resolveButtonCommands`)

`resolveButtonCommands(btn, map)` (`app/src/commands.ts`) is the pure helper for resolving a button's command reference to an ordered list of `BoundCommand`s. It supports both the single `command` and the multi-`commands` forms:

```ts
export function resolveButtonCommands(
  btn: { command?: string; commands?: string[] },
  map: Map<string, BoundCommand>,
): BoundCommand[] {
  const ids = btn.commands && btn.commands.length > 0
    ? btn.commands
    : btn.command
      ? [btn.command]
      : [];
  return ids.map((id) => map.get(id)).filter((c): c is BoundCommand => c !== undefined);
}
```

Precedence and edge cases (verified in `app/src/commands.test.ts`):

- **Single `command`** → list of one bound command: `{ command: "new-note" }` → `["new-note"]`.
- **`commands` list** → resolved in declared order: `{ commands: ["new-note", "terminal"] }` → `["new-note", "terminal"]`.
- **A non-empty `commands` wins over `command`**: `{ command: "settings", commands: ["new-note", "terminal"] }` → `["new-note", "terminal"]` (the `settings` command is ignored).
- **Unknown ids are silently dropped**, keeping the resolvable subset in order: `{ commands: ["new-note", "nope", "terminal"] }` → `["new-note", "terminal"]`.
- **Unknown single command** → `[]`: `{ command: "nope" }` → `[]`.
- **Empty `commands` list** → `[]`: `{ commands: [] }` → `[]`.
- **Empty `commands` falls back to `command`**: an empty list is *not* a "win", so `{ command: "new-note", commands: [] }` → `["new-note"]`.
- **Neither key present** → `[]`: `{}` → `[]`.

When `resolveButtonCommands` returns `[]`, the intended caller behavior is to render a **disabled** button (per the function's doc comment: "Returns [] when nothing resolves — the caller renders that as a disabled button").

> Implementation note: the helper supports `commands:` (sequence) but the current `.sidebar-icons` render path in `App.tsx` reads only `btn.command`. The schema and `resolveButtonCommands` fully model the `commands:` list form; treat `resolveButtonCommands` as the authoritative resolution contract.

## Adding a New Command

Per the project conventions (CLAUDE.md "Commands & Sidebar Toolbar"):

1. **Add an entry to `COMMAND_CATALOG`** in `core/src/commands.ts` (`{ id, label, icon }`).
2. **Add a matching `action` binding** in `bindCommands` in `app/src/commands.ts`, and a corresponding method on `CommandHandlers` (and supply it from `App.tsx`).

The `toolbar.command` enum, its autocomplete, and the command palette pick the new id up automatically (because the schema derives the enum from `COMMAND_IDS`).

> Note: adding any new **top-level** schema key (not a new command) also requires updating the hardcoded key lists in `core/test/schema/settingsSchema.test.ts`. Adding a *command* does not touch any top-level key, so that step does not apply to commands.

## Example `.settings` toolbar

A toolbar mixing built-in commands, a daily-note command, an emoji icon, a custom tooltip, and a multi-command button:

```yaml
toolbar:
  - command: create-menu             # the "+Create" chooser (New note/folder/base ▸/…)
    icon: Plus
  - command: search
    icon: Search
    tooltip: Find in vault
  - command: terminal
    icon: SquareTerminal
  - command: graph-both
    icon: Network
  - command: detect-ai               # local, offline "Detect AI text"
    icon: Bot
  - command: daily-note:journal      # dynamic command from dailyNotes config
    icon: BookOpen
  - command: open-folder
    icon: "📁"                        # an emoji is a valid icon
  - commands: [new-note, terminal]   # runs both, in order (commands wins over command)
    icon: Rocket
    tooltip: Note + terminal
```

## Cross-references

- [Settings overview](./overview.md) — how `.settings` is structured, schema-driven autocomplete, lint, and persistence.
- [Daily notes & templates](../templates/syntax.md) — the `dailyNotes:` config that registers `daily-note:<id>` commands.
- [Keybindings](./keybindings.md) — the parallel split-data system for keyboard shortcuts (`KEYBINDING_CATALOG` + `matchesKeybinding`).

Source: core/src/commands.ts, app/src/commands.ts, app/src/baseViews.ts, app/src/ai/aiDetect.ts, core/src/daemonInstall.ts, core/src/schema/settingsSchema.ts, core/src/schema/types.ts, core/src/schema/validate.ts, core/test/commands.test.ts, app/src/commands.test.ts, app/src/App.tsx, app/src/editor/settingsComplete.ts
