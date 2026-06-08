# Toolbar & Commands

This document is the canonical reference for Bismuth's command system: the pure command catalog (`COMMAND_CATALOG`), how each command id binds to a runnable action, the `toolbar:` settings configuration that places command buttons in the sidebar header bar, and the dynamic `daily-note:<id>` commands. It covers every command id, label, default icon, the `command`/`commands`/`icon`/`tooltip` button fields, button resolution precedence, and the edge cases found in the source.

## Overview

Commands are split into **pure data** and **behavior** so the command palette and the sidebar header toolbar share one source of truth:

- **`core/src/commands.ts`** — `COMMAND_CATALOG`, a list of `CommandSpec` (`id`, `label`, `icon`). Pure metadata, no frontend imports. The settings schema derives the `toolbar.command` enum from `COMMAND_IDS` (so `settings.yaml` autocomplete and lint know every valid command id). This file is the **single source of truth for command ids**.
- **`app/src/commands.ts`** — `bindCommands(handlers, dailyNotes)` produces a live `Map<string, BoundCommand>` where each catalog id is mapped to a runnable `{ id, label, icon, action }`. The catalog says *what* each command is; the binding says *what it does*. `App.tsx` passes its handlers in once.
- **`core/src/schema/settingsSchema.ts`** — defines the `toolbar:` settings key (a list of button objects) and the `dailyNotes:` key (which registers extra `daily-note:<id>` commands).

The sidebar header bar (`.sidebar-icons` in `App.tsx`) is configured entirely by `toolbar:` in `settings.yaml`. There is no GUI for it — you edit `settings.yaml` directly (see [settings overview](./overview.md)).

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
| 9 | `new-note` | New note | `FilePlus` | `h.newNote` |
| 10 | `new-folder` | New folder | `FolderPlus` | `h.newFolder` |
| 11 | `new-spreadsheet` | New spreadsheet | `Table` | `h.newSpreadsheet` |
| 12 | `new-drawing` | New drawing | `PenTool` | `h.newDrawing` |
| 13 | `export` | Export current file… | `Download` | `h.exportActive` |
| 14 | `terminal` | Open Terminal | `SquareTerminal` | `h.openTerminal` |
| 15 | `search` | Search | `Search` | `h.openSearch` |
| 16 | `settings` | Open Settings | `Settings` | `h.openSettings` |
| 17 | `graph-2nd` | Graph: 2nd Brain (vault) | `Notebook` | `() => h.setMode("2nd")` |
| 18 | `graph-3rd` | Graph: 3rd Brain (memory) | `Brain` | `() => h.setMode("3rd")` |
| 19 | `graph-both` | Graph: Both Brains | `Network` | `() => h.setMode("both")` |
| 20 | `graph-agents` | Graph: Agents | `Users` | `() => h.setMode("agents")` |
| 21 | `equalize-panes` | Equalize panes | `Columns3` | `h.equalizePanes` |
| 22 | `toggle-sidebar` | Toggle sidebar | `PanelLeft` | `h.toggleSidebar` |
| 23 | `daemon-owner` | Set daemon owner device… | `Server` | `h.openDaemonOwner` |
| 24 | `daemon-setup` | Set up claude-bot daemon… | `Download` | `h.openDaemonSetup` |

Notes on individual commands:

- **`new-tab` vs `open-graph`**: `new-tab` always spawns a fresh graph home tab; `open-graph` focuses an existing graph tab if one is open (else opens one). (Comment in `app/src/commands.ts`.)
- **File-menu commands** (`open-folder`, `new-window`, `export`): `open-folder` opens a chosen folder as its own brain in a new window (a sibling backend); `new-window` reopens the current folder in a new window; `export` acts on the active file.
- **Graph-mode commands** (`graph-2nd`, `graph-3rd`, `graph-both`, `graph-agents`): each calls `h.setMode(...)` with the corresponding graph mode string.
- **`daemon-owner` / `daemon-setup`**: open the claude-bot daemon owner-picker modal and the install/repair (adopt) panel respectively (see Daemon Integration in the project CLAUDE.md).

### Notable absences / gotchas

- **There is no `graph-daemon` command** in the catalog, even though the renderer has a `"daemon"` graph mode. `setMode`'s type accepts `"2nd" | "3rd" | "both" | "agents" | "daemon"`, but only the first four have catalog commands. Daemon mode is reached via the daemon sidebar/UI, not a toolbar command.
- The `export` command and the `daemon-setup` command **share the same default icon** (`Download`). That is intentional and allowed — icon uniqueness is not an invariant (only `id` uniqueness is).
- Icons are **Lucide icon names** by convention (matched against the icon registry on the frontend), but toolbar/daily-note `icon` fields may also be a literal emoji (see "Button fields").

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
  newSpreadsheet: () => void;
  newDrawing: () => void | Promise<void>;
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
  openDaemonOwner: () => void;
  openDaemonSetup: () => void;
}
```

`App.tsx` (around line 530) constructs the bound map reactively:

```ts
const commands = () => bindCommands(
  { openSettings, openTerminal, openSearch, newNote, newFolder, newSpreadsheet,
    newDrawing, openGraph, setMode, openDailyNote, equalizePanes, toggleSidebar,
    openFolder, newWindow, exportActive, newTab, closeActiveTab, reopenClosedTab,
    historyBack, historyForward, openDaemonOwner, openDaemonSetup },
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

The sidebar header bar buttons are configured by the top-level `toolbar:` key in `settings.yaml`. Schema definition (`core/src/schema/settingsSchema.ts`):

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
    { command: "new-note",   icon: "FilePlus" },
    { command: "new-folder", icon: "FolderPlus" },
    { command: "search",     icon: "Search" },
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

## Example `settings.yaml` toolbar

A toolbar mixing built-in commands, a daily-note command, an emoji icon, a custom tooltip, and a multi-command button:

```yaml
toolbar:
  - command: new-note
    icon: FilePlus
  - command: new-folder
    icon: FolderPlus
  - command: search
    icon: Search
    tooltip: Find in vault
  - command: terminal
    icon: SquareTerminal
  - command: graph-both
    icon: Network
  - command: daily-note:journal      # dynamic command from dailyNotes config
    icon: BookOpen
  - command: open-folder
    icon: "📁"                        # an emoji is a valid icon
  - commands: [new-note, terminal]   # runs both, in order (commands wins over command)
    icon: Rocket
    tooltip: Note + terminal
```

## Cross-references

- [Settings overview](./overview.md) — how `settings.yaml` is structured, schema-driven autocomplete, lint, and persistence.
- [Daily notes & templates](../templates/syntax.md) — the `dailyNotes:` config that registers `daily-note:<id>` commands.
- [Keybindings](./keybindings.md) — the parallel split-data system for keyboard shortcuts (`KEYBINDING_CATALOG` + `matchesKeybinding`).

Source: core/src/commands.ts, app/src/commands.ts, core/src/schema/settingsSchema.ts, core/src/schema/types.ts, core/src/schema/validate.ts, core/test/commands.test.ts, app/src/commands.test.ts, app/src/App.tsx, app/src/editor/settingsComplete.ts
