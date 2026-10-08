# Settings

Each vault has one settings file, `.settings`: a hidden YAML file with no extension at the vault root. It holds only the values you change; every key you leave out uses its default. There is no settings screen. You open `.settings` in the editor like any note, with autocomplete and inline lint.

```yaml
# .settings: only what you change lives here
appearance:
  theme: paper
  editorFontSize: 15
layout:
  sidebarSide: right
keybindings:
  command-palette: Mod+Shift+K
```

Read this page to learn how `.settings` behaves. [Settings reference](reference.md) lists every section, key and default.

## Open and edit .settings

Run the command **Open Settings** from the command palette (Cmd+P) to open `.settings` as a tab. A fresh vault starts with a two-line comment and no keys.

Press Ctrl+Space (the `open-completion` binding) inside the file to list the keys valid at the cursor. Each suggestion shows the key's description, its allowed range or values, and its default. Lint underlines a wrong type, an out-of-range number or an unknown enum value as you type.

Settings apply as soon as you save. Comments, key order and keys the schema does not know are never touched when the app writes the file.

## How defaults work

An absent key is its default. Writing a key at its default value is allowed and is kept. To restore a default, delete the key.

The file is per vault: there is no global settings file, and two vaults can differ. A value you set applies only to the vault that holds the file.

## What happens to a wrong value

A value that fails its check reads as the key's default, without an error in the app:

- A value of the wrong type (`sidebarWidth: wide`).
- A number below the key's minimum or above its maximum (`sidebarWidth: 9000`). The value is not clamped; the default applies.
- An enum value not in the list (`theme: dark`).
- A list item of the wrong shape. `toolbar`, `tabBar` and `dailyNotes` drop malformed items and keep the rest.

If the YAML itself does not parse, every key reads as its default and the app leaves the file untouched so you can fix it.

## Which changes the app writes for you

Some actions in the app write `.settings` directly, one key at a time:

- Dragging the sidebar or tab rail edge writes `appearance.sidebarWidth` and `appearance.tabRailWidth`; each edge snaps onto its default within 12px.
- The commands **Move sidebar to other side**, **Move tab rail to other side** and **Toggle status bar** write the `layout` keys.
- Setting a folder icon from the file tree writes `folderIcons`.

## Where do I change X?

| I want to | Go to |
|---|---|
| Pick a theme or a font | [Themes and fonts](themes.md) |
| Override one colour, size or radius | [Design tokens](tokens.md) |
| Move the sidebar or tab rail, hide the status bar | [Shell layout](layout.md) |
| Change the bottom bar | [Status bar and home page](status-bar.md) |
| Rebind a shortcut | [Keybindings](keybindings.md) |
| Rearrange the toolbar or tab bar buttons | [Toolbar and commands](toolbar-commands.md) |
| Look up any key | [Settings reference](reference.md) |
| Make a custom theme | [Custom themes guide](../guides/custom-themes.md) |

## Change settings from the shell

The `bismuth` CLI reads and writes `.settings` without the app running:

```bash
bismuth settings get --key appearance.theme --vault ~/vault
bismuth settings set appearance.theme paper --vault ~/vault
bismuth settings schema --vault ~/vault --pretty
```

`settings set` takes a dotted key path and a value parsed as JSON, falling back to a plain string. It merges that one key into the file. The [CLI reference](../cli/reference.md) lists the options.

## How it works

The schema in `core/src/schema/settingsSchema.ts` (`SETTINGS_SCHEMA`) is the single source of truth. Every leaf has a type, a default, a description and, for numbers, bounds. These are derived from it, so none is a second copy:

- `DEFAULTS`, the plain nested object the app store seeds from.
- The `keybindings` section, one `keybind` field per `KEYBINDING_CATALOG` entry.
- The `appearance.tokens` fields, one per `DESIGN_TOKENS` entry.
- The `toolbar.command` enum, from `COMMAND_IDS`.
- Autocomplete (`app/src/editor/settingsComplete.ts`) and lint (`app/src/editor/yamlSchema.ts`).

`app/src/settings.parity.test.ts` fails when a schema leaf has no default or no description, or when the `Settings` type in `app/src/settings.ts` disagrees with the schema.

### The backend

- `reconcileSettings(vault)` in `core/src/settings.ts` runs when core starts, when `.settings` is saved from the editor, and before every programmatic write.
  It writes the seed when the file is absent, applies the key renames and moves listed in the code, and deletes the keys on its retired list. It never adds a key.
  It leaves a file with YAML errors, or a top-level value that is not a map, untouched, and writes only when something changed.
- `setSettingInFile(vault, path, value)` is the one backend write path. It reconciles, sets one path in the parsed YAML document, and writes the result, so comments, order and unknown keys survive. A per-vault mutex serializes concurrent writes. `POST /set-setting` calls it.
- `serializeSettingsFromText` in `core/src/settingsSerialize.ts` builds the `GET /settings` response: it clones `DEFAULTS`, then overlays each valid value from the file.
  It applies the checks in [What happens to a wrong value](#what-happens-to-a-wrong-value), drops `properties` (served by `GET /schema`), and folds the settings that alias tokens into `appearance.tokens`.
- Top-level scalar keys are not overlaid, so a stored `homePage` never reaches the app. A top-level list such as `statusBar` is overlaid per index onto the default list; the status bar itself re-reads the raw file, so only `settings get` shows the overlaid list.

The settings routes (`GET /settings`, `GET /schema`, `GET /config`, `POST /set-setting`) are listed in the [HTTP reference](../api/http-reference.md).

### The app

`app/src/settings.ts` seeds a Solid store synchronously from a `localStorage` copy of the last response (`bismuth-settings-cache-v1`), so the right theme and fonts paint on the first frame. It then fetches `GET /settings`, and again whenever an SSE event lists `.settings`.

A 600 ms debounced effect diffs the store against its last snapshot (`diffLeaves` in `app/src/settingsDiff.ts`) and sends one `POST /set-setting` per changed leaf. Persistence starts after the first fetch, so the seed never overwrites your file.

`app/src/settingsCssVars.ts` projects settings and the resolved theme onto `:root` custom properties. The terminal font size and line height are read directly by `app/src/Terminal.tsx`. The 2D/3D graph toggle is a per-window `localStorage` flag, never a setting.

### Add a setting

1. Add the entry to `SETTINGS_SCHEMA`, with a default equal to the current behaviour and a description. A new top-level section also goes in the key lists of `core/test/schema/settingsSchema.test.ts`.
2. Add the matching field to the `Settings` type in `app/src/settings.ts`.
3. Wire the consumer: a CSS value goes in `settingsToCssVars`, app logic reads `settings.<section>.<key>`, and backend logic reads `loadAppConfig(vault)`.

Existing files need no migration; the key reads as its default until set.

Source: `core/src/settings.ts`, `core/src/settingsSerialize.ts`, `core/src/schema/settingsSchema.ts`, `core/src/schema/types.ts`, `core/src/routes/settings.ts`, `app/src/settings.ts`, `app/src/settingsDiff.ts`, `app/src/settingsCssVars.ts`, `app/src/settings.parity.test.ts`
