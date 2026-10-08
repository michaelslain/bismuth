# Toolbar and commands

A command is a named action: open a graph tab, split a pane, create a note.
Every command appears in the command palette (Cmd+P), and the same command ids fill the buttons of the sidebar toolbar (`toolbar:`), the buttons beside the tab strip (`tabBar:`), a clickable [status bar](status-bar.md) segment (`command:`), and the `bismuth app run` CLI.
This page lists the commands and shows how to put them on a button.

```yaml
toolbar:
  - command: create-menu
    icon: Plus
  - command: search
    icon: Search
    tooltip: Find in vault
  - command: daily-note:journal
    icon: BookOpen
  - commands: [new-note, terminal]
    icon: Rocket
    tooltip: Note, or a terminal if there is none
```

## Add a button

1. Open `.settings` (command **Open Settings**) and find `toolbar:` or `tabBar:`. Writing the key replaces the whole list, so include the buttons you want to keep.
2. Add an item with a `command` id from [the catalog below](#the-command-catalog) and an `icon`.
3. Save. The bar updates at once. To restore the defaults, delete the key.

[Settings reference](reference.md#toolbar) has the defaults and the field list. The fields in short:

| Field | Meaning |
|---|---|
| `command` | One command id, or `daily-note:<id>` for a daily-note type. |
| `commands` | A list of ids; the button runs the first one that resolves. |
| `icon` | An icon name (any Phosphor icon) or an emoji. Required. |
| `tooltip` | Hover text. Defaults to the command's label. |

Use `command` or `commands`, not both. If both are present and `commands` is non-empty, `commands` wins.

## How a button resolves its command

- `commands` is a fallback list, not a sequence. `commands: [a, b]` runs `a`; it runs `b` only if `a` is not a known command. Once `a` resolves, `b` never runs. The schema's autocomplete text says "run in sequence", which overstates it.
- An unknown id is skipped. If no id in the button resolves, the button shows disabled with the tooltip `Unknown command: <id>`.
- An empty `commands` list falls back to `command`.
- A button without an `icon` disappears. An item missing a non-empty `icon`, or missing both `command` and `commands`, is dropped when settings load, with no error. An explicit empty list `[]` is honoured and gives an empty bar.
- The button icon is yours. It replaces the command's default icon on that button.
- `open-inbox` hides while the daemon is off. It also carries a badge with the due count.
- An unknown id fails lint. Lint accepts any catalog id and any `daily-note:`-prefixed value, and reports others with the nearest matches. Whether a `daily-note:<id>` exists is only known when the app runs.

## Daily-note commands

Each entry in [`dailyNotes`](reference.md#dailynotes) registers a command `daily-note:<id>`. It appears in the palette as `Create Daily Note: <label>` and opens today's note of that type, creating it from the entry's template the first time.
Put the id in a button's `command` to get a button for it. Autocomplete offers the ids of your configured daily notes.

## The create menu

The command `create-menu` (**Create new…**) is one button that opens a menu instead of running a single action. The menu lists, in order:

1. New note
2. New folder
3. **New base**, a submenu with one entry per Bases view kind (the kinds are listed in [Bases overview](../bases/overview.md)); each creates `Untitled <kind>.md` with that view
4. New spreadsheet
5. New drawing
6. New Claude Chat
7. A separator, then each daily-note command

The menu opens under the button you clicked, or at a fixed spot when run from the palette.

## The command catalog

These are the built-in commands, grouped by area. `COMMAND_CATALOG` in `core/src/commands.ts` is the source of truth; every command in it is valid for `command` and `commands`. A "yes" in the dialog column marks a command whose action only opens a dialog that a person finishes.

### Tabs and navigation

| id | label | default icon | dialog |
|---|---|---|---|
| `new-tab` | New tab | `Plus` |  |
| `close-tab` | Close tab | `X` |  |
| `reopen-tab` | Reopen closed tab | `RotateCcw` |  |
| `history-back` | Back | `ArrowLeft` |  |
| `history-forward` | Forward | `ArrowRight` |  |
| `open-graph` | Open graph view | `Share2` |  |
| `open-daemon` | Open daemon | `Bot` |  |
| `open-inbox` | Open daemon inbox | `Inbox` |  |
| `search` | Search | `Search` |  |
| `terminal` | Open Terminal | `SquareTerminal` |  |
| `new-window` | New window | `AppWindow` |  |
| `open-folder` | Open folder… | `FolderOpen` |  |

### Create

| id | label | default icon | dialog |
|---|---|---|---|
| `create-menu` | Create new… | `Plus` | yes |
| `new-note` | New note | `FilePlus` |  |
| `new-folder` | New folder | `FolderPlus` |  |
| `new-base` | New base | `Database` |  |
| `new-spreadsheet` | New spreadsheet | `Table` |  |
| `new-drawing` | New drawing | `PenTool` |  |
| `new-claude-chat` | New Claude Chat | `MessageSquare` |  |

### Notes and tasks

| id | label | default icon | dialog |
|---|---|---|---|
| `export` | Export current file… | `Download` |  |
| `archive-tasks` | Archive completed tasks (this note) | `Archive` |  |
| `archive-all-tasks` | Archive completed tasks (all notes) | `ArchiveX` |  |
| `detect-ai` | Detect AI text | `Bot` |  |
| `emoji-library` | Emoji library… | `Smile` | yes |
| `edit-dictionary` | Edit custom dictionary… | `BookOpen` | yes |

### Graph modes

| id | label | default icon | dialog |
|---|---|---|---|
| `graph-2nd` | Graph: 2nd Brain (vault) | `Notebook` |  |
| `graph-3rd` | Graph: 3rd Brain (memory) | `Brain` |  |
| `graph-both` | Graph: Both Brains | `Network` |  |
| `graph-local` | Graph: Local (open note) | `Pin` |  |

### Panes

| id | label | default icon | dialog |
|---|---|---|---|
| `equalize-panes` | Equalize panes | `Columns3` |  |
| `split-right` | Split right | `PanelRight` |  |
| `split-down` | Split down | `PanelBottom` |  |
| `close-pane` | Close pane | `SquareX` |  |
| `focus-pane-left` | Focus pane left | `ArrowLeft` |  |
| `focus-pane-right` | Focus pane right | `ArrowRight` |  |
| `focus-pane-up` | Focus pane up | `ArrowUp` |  |
| `focus-pane-down` | Focus pane down | `ArrowDown` |  |

### Window layout and zoom

| id | label | default icon | dialog |
|---|---|---|---|
| `toggle-sidebar` | Toggle sidebar | `PanelLeft` |  |
| `toggle-tab-rail` | Toggle tab rail | `PanelRight` |  |
| `move-sidebar-side` | Move sidebar to other side | `Columns2` |  |
| `move-tab-rail-side` | Move tab rail to other side | `Columns2` |  |
| `toggle-status-bar` | Toggle status bar | `PanelBottom` |  |
| `zoom-in` | Zoom In | `ZoomIn` |  |
| `zoom-out` | Zoom Out | `ZoomOut` |  |
| `zoom-reset` | Reset Zoom | `RotateCcw` |  |

### Setup and updates

| id | label | default icon | dialog |
|---|---|---|---|
| `settings` | Open Settings | `Settings` |  |
| `daemon-owner` | Set daemon owner device… | `Server` | yes |
| `daemon-setup` | Set up daemon… | `Download` | yes |
| `daemon-update` | Update daemon… | `RefreshCw` |  |
| `bismuth-install` | Install Bismuth CLI + MCP… | `Download` | yes |
| `free-agent-setup` | Set up free agent… | `Download` | yes |
| `update-app` | Update Bismuth… | `RefreshCw` |  |

### Google Calendar

| id | label | default icon | dialog |
|---|---|---|---|
| `gcal-connect` | Connect Google Calendar… | `Calendar` | yes |
| `gcal-sync` | Sync Google Calendar | `RefreshCw` |  |
| `gcal-disconnect` | Disconnect Google Calendar | `CalendarX` |  |

### Ask the daemon

| id | label | default icon | dialog |
|---|---|---|---|
| `quick-ask` | Ask the daemon… | `MessageSquare` | yes |

Notes on individual commands:

- `new-tab` and `open-graph`. `new-tab` always opens a fresh home tab, which is the knowledge graph. `open-graph` focuses an existing graph tab and opens one only if none is open.
- `open-daemon` and `open-inbox`. Both open the daemon page, where the inbox lives. They keep separate ids so the default toolbar can carry the inbox button, with its badge.
- `new-base`. As a plain command it creates a `type: base` note. As the create menu's **New base** submenu it offers one entry per view kind.
- `archive-tasks` and `archive-all-tasks`. They permanently remove completed and cancelled tasks, from the active note or from every note.
- `detect-ai`. It estimates how AI-generated the active page reads and shows the score in a toast. The detector runs on your device with no network call, other than a one-time model download of about 34 MB on first use. It needs at least 40 words of prose.
  It was trained on a corpus without Claude text, so treat the score as a rough hint and not as proof.
- `quick-ask`. It opens the [quick ask popover](../chat/overview.md#how-do-i-ask-a-quick-question), the same as its `Mod+K` shortcut, anchored at the caret in a note or at the top of another pane. It only opens the popover, so it counts as a dialog command. App control refuses it, because a person has to type the question.
- `emoji-library`. It opens the emoji picker and inserts your pick at the cursor of the focused note.
- `edit-dictionary`. It opens the list of words you added to the spellcheck dictionary, so you can remove them.
- Graph modes. `graph-2nd` shows the vault, `graph-3rd` the memory graph, `graph-both` both with their cross-links, and `graph-local` the neighbourhood of the open note. See [graph overview](../graph/overview.md).
- Pane commands run the same logic as the matching [keybindings](keybindings.md).
- Layout commands. `move-sidebar-side`, `move-tab-rail-side` and `toggle-status-bar` flip the `layout` keys and write `.settings`; `toggle-sidebar` and `toggle-tab-rail` show or pin the panels. See [shell layout](layout.md).
  The panel edge lines run the same toggles: drag one to resize, click it to toggle.
- `daemon-update` and `update-app`. They run the daemon and app updates by hand, for when the update banner was dismissed or missed.
- `free-agent-setup`. It downloads opencode and defaults chats to a rotating free model, with no account. The intro's free-agent option runs the same setup.
- `zoom-in`, `zoom-out`, `zoom-reset`. They zoom the whole window like a browser's page zoom. The level is a per-machine preference, not a `.settings` value.
- Several commands share an icon. That is allowed; only ids are unique.

## Run commands from outside the app

`bismuth app run <id>` (and the matching MCP tool) runs a command in an open window. `bismuth app commands` lists the ids it accepts. [App control](../mcp/app-control.md) covers the routes and tools.

- Dialog commands stay runnable. An agent can open the Google Calendar connect dialog to show you how. The reply says `interactive: true` with a note that a person needs to finish it, instead of implying the task is done.
- Some commands are refused. `new-window`, `open-folder`, `update-app`, `daemon-update`, `new-claude-chat` and `quick-ask` return `command "<id>" is not allowed via app control`.
  They are heavyweight, or open a live agent session or a quick ask, and an unattended caller should not trigger them blindly. Everything else in the catalog is allowed.

## How it works

`COMMAND_CATALOG` is an ordered list of `CommandSpec` (`id`, `label`, `icon`, optional `interactive`) in `core/src/commands.ts`, with no frontend imports.
`COMMAND_IDS` is derived from it, and the schema uses that list for the `toolbar.command`, `tabBar.command` and `statusBar.command` enums, with `allowPrefixes: ['daily-note:']`.
`core/test/commands.test.ts` asserts that ids are unique and that every command has a label and an icon.

`bindCommands(handlers, dailyNotes)` in `app/src/commands.ts` turns the catalog into a `Map<string, BoundCommand>`.
A `BoundCommand` is `{ id, label, icon, interactive, action }`, and `action` takes an optional `MouseEvent` so the create menu can anchor under the clicked button.
`App.tsx` passes one `CommandHandlers` object, every field required, so dropping a handler fails the typecheck. The palette, the toolbar, the tab bar and app control all read this one map. A catalog id with no binding is skipped silently.

`resolveButtonCommands(btn, map)` returns the resolvable ids of a button in order. `ToolbarButton` in `App.tsx` takes index `[0]` and renders a disabled `CommandButton` (`app/src/shell/CommandButton.tsx`) when the list is empty. A non-empty `commands` beats `command`; an empty one defers to it.

App control reaches a command through `POST /ui/command`, then `runCommand` in `App.tsx`. It checks `UI_CONTROL_BLOCKLIST`, looks up the command, awaits `cmd.action()`, and adds the `interactive` note.
`isUiControlAllowed` and `uiControlAllowedIds` in `core/src/commands.ts` back `bismuth app commands`.

`detect-ai` uses transformers.js in the webview, never the core sidecar (`app/src/ai/aiDetect.ts`). It splits prose into windows of about 280 words, scores at most 16 evenly spaced ones, and returns the mean and peak probability.

### Add a command

1. Add `{ id, label, icon }` to `COMMAND_CATALOG`.
2. Add a field to `CommandHandlers` and an entry in `bindCommands`'s `actions` map in `app/src/commands.ts`, and supply the handler from `App.tsx`.

The toolbar enum, autocomplete and palette pick the id up automatically.

Source: `core/src/commands.ts`, `app/src/commands.ts`, `app/src/baseViews.ts`, `app/src/ai/aiDetect.ts`, `core/src/schema/settingsSchema.ts`, `core/src/schema/validate.ts`, `core/test/commands.test.ts`, `app/src/commands.test.ts`, `app/src/App.tsx`, `app/src/editor/settingsComplete.ts`, `app/src/shell/CommandButton.tsx`
