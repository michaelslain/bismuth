# Settings reference

Every key you can put in a vault's `.settings` file, with its type, default, allowed values and effect. Look a key up here; to learn how the file behaves (sparse, per vault, silent fallbacks), read the [settings overview](overview.md).

```yaml
appearance:
  theme: cathode
  editorFontSize: 16
editor:
  lineNumbers: true
layout:
  statusBar: false
```

An absent key uses its default. A value of the wrong type, outside a number's bounds, or not in an enum's list reads as the default; it is not clamped. Open `.settings` and press Ctrl+Space to list keys with their descriptions.

## Property types

Each key has one of these types. The type decides what autocomplete offers and what lint accepts.

| Type | Value |
|---|---|
| `string` | Free text. |
| `number` | A number, usually with `min` and `max` bounds. |
| `boolean` | `true` or `false`. |
| `icon` | An icon name (`FilePlus`, or any Phosphor icon such as `Books`) or an emoji. |
| `keybind` | A key combination such as `Mod+P`; see [keybindings](keybindings.md). |
| `path` | A vault path. `only` narrows completion to folders or files; `scope: templates` completes from the templates folder. Any string is valid, and the path need not exist. |
| `enum` | One of a fixed list of strings. `daily-note:<id>` is also accepted where a command id is expected. |
| `list` | A YAML sequence of one item type. |
| `object` | A nested map: a section, or a free-form map where a section has no fixed fields. |

---

## `appearance`

Theme, logo mark, fonts, sizes and the text cursor. The theme is the single source of colour: there are no per-colour keys. To change one colour or length, use `tokens`.

| Key | Type | Default | Bounds / values | Effect |
|---|---|---|---|---|
| `theme` | enum | `ink` | `ink`, `paper`, `cathode`, `riso`, or a custom theme name | Colour theme for the whole app and the graph. |
| `icon` | enum | `hopper-crystal` | `hopper-crystal`, `node-b`, `square-funnel`, `nested-diamonds`, `pinwheel`, `node-crystal`, `lattice`, `diamond-bloom`, `node-diamond`, `octagon-bloom`, `spin-cross`, `tri-bloom`, `radial-graph`, `node-rings` | App logo mark in the favicon and the sidebar. |
| `uiFont` | enum | `Monaspace Xenon` | `Monaspace Xenon`, `Monaspace Neon`, `Monaspace Argon`, `Monaspace Krypton`, `Monaspace Radon` | Monospace face for all chrome, code, frontmatter, math, in-note tags and config buffers. |
| `proseFont` | enum | `Libron` | `Libron`, `IBM Plex Serif`, `Lora`, or any `uiFont` value | Face for note body text, headings, tables, chat messages and the chat composer. A Monaspace value gives an all-mono editor. |
| `editorFontSize` | number | `13.5` | 11 to 28 | Note prose size in px. |
| `uiFontSize` | number | `11.5` | 11 to 16 | Chrome text size in px (sidebar, tabs, menus). The character grid's cell width follows it. |
| `monoScale` | number | `1` | 0.6 to 1 | Size factor for monospace text inside prose. `1` means no correction. |
| `iconSize` | number | `12` | 11 to 20 | Size in px of every icon in the app. |
| `sidebarWidth` | number | `266` | 200 to 600 | Sidebar width in px. Dragging the sidebar edge writes it, and the edge snaps onto this default within 12px. |
| `sidebarGraphHeight` | number | `305` | 200 to 500 | Height in px of the mini graph panel in the sidebar. |
| `tabRailWidth` | number | `232` | 160 to 480 | Open width in px of the tab rail. Dragging its edge writes it, and the edge snaps onto this default within 12px. Collapsed, the rail is always 46px wide. |
| `cursorWidth` | number | `2` | 1 to 4 | Text cursor width in px, in every editor, field and terminal. |
| `cursorGlideMs` | number | `70` | 20 to 200 | Cursor glide between positions, in ms. |
| `cursorBlinkSeconds` | number | `1.2` | 0.6 to 2 | Cursor blink cycle in seconds. |
| `tokens` | map | `{}` | token name to value | Per-vault design-token overrides, applied over the selected theme. |

`tokens` maps a token key (the CSS variable name without `--`) to a value:

```yaml
appearance:
  theme: cathode
  uiFont: Monaspace Xenon
  tokens:
    accent: '#ff6b6b'
    r-card: 0
    sp-3: 10px
```

A bad value is an error and that key is dropped. An unknown key is a warning (`unknown token: <key>`) with a did-you-mean hint.
The keys `uiFont`, `proseFont`, `monoScale`, `editorFontSize`, `uiFontSize`, `iconSize` and the three cursor keys each set one token too, and an explicit `tokens` entry beats the matching key. The [design tokens](tokens.md) page lists every token.

Quote colours: an unquoted `#` starts a YAML comment and the value is lost.

---

## `graph`

Knowledge-graph rendering. The 2D/3D choice is not a setting: it is a per-window toggle on the graph and never writes `.settings`.

| Key | Type | Default | Bounds | Effect |
|---|---|---|---|---|
| `spin` | boolean | `true` | | Idle rotation of the graph. |
| `spinSpeed` | number | `0.0015` | 0 to 0.01 | Idle spin speed in radians per frame. |
| `showFps` | boolean | `false` | | Show the frame-rate counter on the graph. |
| `showGraphLabels` | boolean | `true` | | Show labels in the graph. |
| `graphLabelHubCount` | number | `10` | 0 to 30 | How many top-degree nodes always get a label. |
| `backgroundNoise` | boolean | `false` | | The faint ASCII noise texture under the graph field. |
| `gradient` | boolean | `false` | | The glow behind dense regions and the darkened vignette at the edges. Off gives a flat ground. |
| `refreshDebounceMs` | number | `300` | 100 to 1000 | Delay in ms before rebuilding the graph after a burst of edits. |
| `mapDefaultZoom` | number | `2` | 1 to 18 | Default zoom of the Bases map view when it cannot fit all markers. |
| `repulsion` | number | `-10` | -40 to -1 | Accepted, not read. |
| `linkDistance` | number | `5` | 1 to 40 | Accepted, not read. |
| `centering` | number | `0.13` | 0 to 0.5 | Accepted, not read. |
| `nodeSize` | number | `6` | 2 to 16 | Accepted, not read. |
| `nodeSizeMinMult` | number | `0.4` | 0.1 to 1 | Accepted, not read. |
| `nodeSizeDegreeGain` | number | `0.45` | 0.1 to 1.5 | Accepted, not read. |
| `nodeSizeMaxMult` | number | `6` | 2 to 12 | Accepted, not read. |

The seven keys marked "Accepted, not read" validate, but nothing in the graph reads them: the layout uses its own constants and node size comes from the renderer. Changing them changes nothing.

```yaml
graph:
  spin: false
  graphLabelHubCount: 15
  gradient: true
```

---

## `editor`

Note editor behaviour.

| Key | Type | Default | Bounds | Effect |
|---|---|---|---|---|
| `livePreview` | boolean | `true` | | Render markdown inline as you type. |
| `lineNumbers` | boolean | `false` | | Show line numbers. |
| `lineWrapping` | boolean | `true` | | Wrap long lines. |
| `spellcheck` | boolean | `true` | | Spell-check the note body. |
| `grammarCheck` | boolean | `false` | | Grammar and style check the note body, independent of spellcheck. |
| `autoSaveDelay` | number | `800` | 200 to 3000 | Milliseconds of idle before a note saves. |
| `lineHeight` | number | `1.25` | 0.8 to 1.8 | Prose line height as a multiple of the 18px row unit, not of the font size. |
| `mathMacros` | string | `""` | | LaTeX preamble of `\newcommand` and `\def` definitions, available in every `$...$` and `$$...$$` in the vault. |
| `wrapSelection` | boolean | `true` | | With text selected, typing a wrapping character surrounds the selection. |
| `wrapSelectionChars` | list of string | `` ["*", "_", "~", "`"] `` | | Characters that wrap a selection when typed. |

`lineHeight` 1.25 gives 22.5px of leading, so four prose lines span exactly five tree rows. Every row of a note takes this height, whatever it holds: paragraphs, list items, tasks, code-block lines, and lines with links, inline code, tags or inline math. Headings and the fence rows that open and close a code block or frontmatter are taller. Chat messages and terminal tabs use the same row height, and code in all three is the same size, so `lineHeight` and `appearance.editorFontSize` set the text of every one of them. A `wrapSelectionChars` entry surrounds the selection with itself; `(`, `[`, `{` and `<` pair with their closers. Brackets and quotes already wrap through auto-close, so they are not in the default.

```yaml
editor:
  lineNumbers: true
  autoSaveDelay: 1200
  mathMacros: "\\newcommand{\\R}{\\mathbb{R}}"
```

---

## `vault`

| Key | Type | Default | Effect |
|---|---|---|---|
| `backupOnSave` | boolean | `true` | Take a local git snapshot after every save. |

---

## `attachments`

Where pasted and dropped files (images, PDFs, audio, video) land. Embeds resolve by filename, like wikilinks, so moving an attachment later never breaks its `![[name]]` embed: `folder` only decides where new files go.

| Key | Type | Default | Values | Effect |
|---|---|---|---|---|
| `folder` | string | `attachments` | | Folder for new attachments, relative to the vault root. Created if missing. `""` is the vault root and `"."` is the current note's folder. |
| `onDrop` | enum | `copy` | `copy`, `reference` | Dragging in a file from outside the vault: `copy` puts it in `folder`, `reference` links it in place. Option-drop always references. |
| `naming` | string | `Pasted image {timestamp}` | | Filename for pasted clipboard images. `{timestamp}` is a sortable date-time stamp, and a name clash gets a numeric suffix. |

Pasted clipboard images always copy in. In the browser build a referenced file is outside the vault, so its embed resolves only on desktop.

```yaml
attachments:
  folder: assets/images
  naming: "Screenshot {timestamp}"
```

---

## `calendar`

Defaults for the Bases calendar view. Per-view settings are in [the calendar view page](../bases/views/calendar.md).

| Key | Type | Default | Values / bounds | Effect |
|---|---|---|---|---|
| `defaultView` | enum | `week` | `month`, `week`, `3day`, `day` | View a calendar opens in. |
| `weekStartsOnMonday` | boolean | `true` | | Start the week on Monday. |
| `militaryTime` | boolean | `false` | | Use 24-hour time. |
| `monthCellMinHeight` | number | `80` | 50 to 160 | Minimum day-cell height in month view, in px. |
| `timeGutterWidth` | number | `50` | 40 to 80 | Width of the hour-label gutter in week and day views, in px. |
| `defaultCategoryColor` | string | `#8296C6` | hex colour | Colour given to a newly created event category. |

```yaml
calendar:
  defaultView: month
  weekStartsOnMonday: false
  defaultCategoryColor: "#e2844a"
```

---

## `googleCalendar`

Connection-level settings for two-way Google Calendar sync, shared by every synced calendar.
Which calendar base syncs with which Google calendar is set per base, in its frontmatter: `googleCalendarSync: true` turns sync on and `googleCalendarId` (default `primary`) picks the Google calendar.
[Google Calendar sync](../gcal/overview.md) covers connecting and syncing.

| Key | Type | Default | Values / bounds | Effect |
|---|---|---|---|---|
| `conflictPolicy` | enum | `lastWriteWins` | `lastWriteWins`, `googleWins`, `bismuthWins` | Which side wins when an event changed on both since the last sync. |
| `syncIntervalMinutes` | number | `15` | 1 to 1440 | Minutes between automatic syncs. Manual sync is always available. |
| `timeZone` | string | `""` | IANA zone | Zone applied to untimed events pushed to Google. Blank uses the system zone. |
| `enabled` | boolean | `false` | | Global on/off for the base named by `basePath`. |
| `calendarId` | string | `primary` | | Google calendar id for the base named by `basePath`. |
| `basePath` | string | `""` | | Single calendar base to sync; the target of `enabled` and `calendarId`. |

`enabled`, `calendarId` and `basePath` are a fallback for one calendar base. A base with its own `googleCalendarSync` and `googleCalendarId` frontmatter does not need them.

```yaml
googleCalendar:
  conflictPolicy: googleWins
  syncIntervalMinutes: 30
  timeZone: America/New_York
```

Per-calendar linkage lives in the calendar base:

```yaml
---
type: base
view: calendar
googleCalendarSync: true
googleCalendarId: primary
---
```

---

## `ui`

Sizes for the command palette, pane dividers and Bases views.

| Key | Type | Default | Bounds | Effect |
|---|---|---|---|---|
| `paletteTopOffset` | string | `12vh` | CSS length | How far down the screen the command palette opens. |
| `paneDividerWidth` | number | `5` | 3 to 12 | Grab width in px of the divider between split panes. The visible line is always 1px. |
| `cardGridMinWidth` | number | `220` | 150 to 360 | Minimum card width in the Bases cards view, in px. |
| `kanbanColumnMinWidth` | number | `248` | 180 to 360 | Minimum kanban column width, in px. |
| `kanbanColumnMaxWidth` | number | `288` | 220 to 420 | Maximum kanban column width, in px. |
| `mapMinHeight` | number | `480` | 300 to 800 | Minimum height of the Bases map view, in px. |
| `tableMinColWidth` | number | `60` | 30 to 150 | Minimum column width when resizing a Bases table, in px. |

```yaml
ui:
  paletteTopOffset: 20vh
  paneDividerWidth: 8
```

---

## `layout`

Which edge the sidebar and tab rail sit on, which sidebar sections show, and the status bar. [Shell layout](layout.md) explains the placement rules.

| Key | Type | Default | Values | Effect |
|---|---|---|---|---|
| `sidebarSide` | enum | `left` | `left`, `right` | Window edge the sidebar sits on. |
| `tabRailSide` | enum | `right` | `left`, `right` | Window edge the tab rail sits on. |
| `sidebar` | list of enum | `[toolbar, files, graph]` | `toolbar`, `files`, `graph` | Sidebar sections, top to bottom. A section you leave out is hidden. |
| `statusBar` | boolean | `true` | | Show the status bar along the bottom edge. |

```yaml
layout:
  sidebarSide: right
  sidebar: [files, graph, toolbar]
  statusBar: false
```

---

## `server`

Backend timing.

| Key | Type | Default | Bounds | Effect |
|---|---|---|---|---|
| `fileWatchDebounceMs` | number | `250` | 50 to 2000 | Milliseconds to coalesce rapid file changes before rebuilding caches. |
| `sseHeartbeatMs` | number | `5000` | 1000 to 30000 | Keepalive ping interval of the live-update stream, in ms. |

---

## `daemon`

The vault's daemon: a background assistant that runs crons and processes, injects the vault's memory into agent sessions, and adds the 3rd-brain graph mode and the daemon page.
When `enabled` is off the daemon is dormant: its state stays on disk and the `.daemon` folder is hidden. The daemon's name lives in `<vault>/.daemon/identity.md`, not here. [Daemon overview](../daemon/overview.md) covers setup.

| Key | Type | Default | Values / bounds | Effect |
|---|---|---|---|---|
| `enabled` | boolean | `false` | | Master switch for this vault's daemon. The first-run intro sets it. |
| `inboxRetentionDays` | number | `7` | 1 to 90 | Days a resolved inbox page (sent, discarded or failed) stays listed. |
| `backend` | enum | `claude` | `claude`, `codex` | Agent CLI that runs the daemon's brain. |
| `inheritUserMcp` | boolean | `false` | | Let daemon sessions use the MCP servers and plugins of your own `claude` CLI. |
| `recall.enabled` | boolean | `true` | | Master switch for automatic memory injection into agent sessions. Needs `daemon.enabled`. |
| `recall.midTurn` | boolean | `true` | | Also recall memory once per tool batch inside a long turn. |
| `recall.semantic` | boolean | `true` | | Use embedding (meaning-based) search in recall. |

`backend` is a request. For a vault with even one hidden or chat-only note, a non-Claude backend is refused and the brain runs on `claude`, with the reason logged, because only Claude Code can enforce the visibility gate. The `backend` enum lists the backends that can run a daemon at all.

`inheritUserMcp` is off by default because a cron runs unattended with permissions bypassed: turning it on hands the daemon every tool those servers expose.
User-scope servers (`~/.claude.json`) and plugins (`~/.claude/settings.json`) are loaded; project and local scope never are, because the session's working directory is the vault and a `.mcp.json` in your notes would otherwise run on its own.

`recall.midTurn` costs one extra lookup per tool batch. `recall.semantic` starts a helper process on first use that holds a roughly 35 MB embedding model (about 260 to 280 MB of RAM while it runs).
The helper exits after 10 minutes idle and returns that memory. Prompt and subagent recall also run a small relevance model in a second helper with the same idle exit. With the setting off, recall is keyword-only and neither helper starts. Both need `recall.enabled`.

```yaml
daemon:
  enabled: true
  inboxRetentionDays: 14
```

---

## `update`

| Key | Type | Default | Effect |
|---|---|---|---|
| `autoUpdate` | boolean | `false` | Apply app updates in the background on launch and relaunch when ready. Off means manual, from the update banner. |

---

## `chat`

Chat tabs. There is no `chat.computerUse` setting; whether a backend can drive Chrome comes from its catalog capabilities (see [agent backends](../chat/backends.md)).

| Key | Type | Default | Values | Effect |
|---|---|---|---|---|
| `provider` | enum | `auto` | `auto`, or a backend id | Default agent backend for a new chat tab. |
| `presets` | list of object | `[]` | | Saved provider, model and effort combinations for the model dialog. |

`auto` runs the first agent whose CLI is installed on this machine, in the catalog's auto order. With none installed, the chat shows its setup screen. A named backend is never swapped for another. The chat header's picker overrides `provider` for that tab, and the pick is remembered per tab.

The backend ids are `claude`, `opencode`, `codex`, `cline`, `gemini`, `goose`, `openclaw`, `hermes`, `claude-code-acp` and `codex-acp`; [agent backends](../chat/backends.md) describes each.

Each `presets` item has four string fields:

| Field | Meaning |
|---|---|
| `name` | Label shown in the model dialog. |
| `provider` | Backend id the preset runs on. |
| `model` | Model id as the backend reports it. Empty uses the backend's default. |
| `effort` | Reasoning effort the model supports, such as `low` or `high`. Empty uses the model's default. |

The dialog's `[+ save]` appends a preset and `[x]` removes one. Applying a preset on another backend starts a new conversation, as any backend switch does.

```yaml
chat:
  provider: opencode
  presets:
    - name: quick
      provider: claude
      model: haiku
      effort: low
```

---

## `localModel`

Run chats on a model served from your own machine: LM Studio, Ollama, llama.cpp, vLLM or anything OpenAI- or Anthropic-compatible.
Bismuth applies it when it starts a chat, through environment and arguments only, so it never edits Claude Code's, Codex's, opencode's or Goose's own config and only Bismuth's chats go local. Other backends run as normal.
[Local models](../chat/local-models.md) is the full guide.

| Key | Type | Default | Effect |
|---|---|---|---|
| `enabled` | boolean | `false` | Run chats on the local server instead of each CLI's own account, from the next chat or turn. |
| `url` | string | `http://localhost:1234` | Server base URL without `/v1`. |
| `model` | string | `""` | Model id as the server lists it at `/v1/models`. Empty uses the first listed model. |
| `apiKey` | string | `""` | Sent as a bearer token when set. Most local servers ignore it. |

LM Studio listens on `http://localhost:1234` and Ollama on `http://localhost:11434`. When `enabled` is on and the server lists no models, the chat shows an error instead of falling back to your cloud account.
A model picked in the chat header wins when the server lists it. Pick a model with tool calling and a context window of 25k or more.

Each backend needs a different endpoint: Claude Code needs `/v1/messages` (LM Studio 0.4.1+, Ollama 0.14+), Codex needs `/v1/responses` (LM Studio 0.3.29+, Ollama 0.13.3+), and opencode and Goose use `/v1/chat/completions`.

```yaml
localModel:
  enabled: true
  url: http://localhost:11434
  model: gpt-oss:20b
```

---

## `mcp`

Bismuth's stdio MCP server is registered with Claude Code automatically. `registerWith` adds other agent CLIs, writing the server into their own global config.

| Key | Type | Default | Effect |
|---|---|---|---|
| `registerWith` | list of string | `[]` | Other agent CLIs to register Bismuth's MCP server with. |

Valid ids are `codex`, `cline`, `openclaw`, `gemini`, `qwen`, `copilot`, `amp`, `droid`, `crush` and `goose`. Listing one is the opt-in: registration runs on the next app start, or on demand with `bismuth install --mcp <cli>` or `--mcp all`.
It is idempotent and never overwrites an entry Bismuth did not write.

```yaml
mcp:
  registerWith: [codex, gemini]
```

---

## `codex`

Opt-ins for the OpenAI Codex CLI. Both write into files you may edit by hand, so both default off.

| Key | Type | Default | Effect |
|---|---|---|---|
| `writeAgentsMd` | boolean | `false` | Write and refresh a marker-delimited block in the vault's `AGENTS.md` with a persona and memory note. Text outside the markers is never touched. |
| `installRelayHooks` | boolean | `false` | Write a project-scoped `.codex/hooks.json` and a small reporting script, so a Codex session in a Bismuth terminal tab or chat reports its lifecycle to Bismuth. |

```yaml
codex:
  writeAgentsMd: true
  installRelayHooks: true
```

---

## `srs`

Spaced-repetition scheduling for flashcards, SM-2 style. [Flashcards](../flashcards/srs.md) explains the model.

| Key | Type | Default | Bounds | Effect |
|---|---|---|---|---|
| `baseEase` | number | `250` | 130 to 400 | Starting ease factor of a new card. Higher means longer intervals. |
| `easyBonus` | number | `1.3` | 1 to 2 | Extra interval multiplier when a card is rated easy. |
| `lapsesIntervalChange` | number | `0.5` | 0.1 to 1 | Interval multiplier when a card is rated hard. |
| `minEase` | number | `130` | 50 to 250 | Floor on a card's ease factor. |
| `easeStep` | number | `20` | 5 to 50 | Ease change per review. |
| `easyGraduatingInterval` | number | `4` | 1 to 14 | Days to the next review when a new card is rated easy. |
| `goodGraduatingInterval` | number | `1` | 1 to 3 | Days to the next review when a new card is rated good or hard. |

```yaml
srs:
  baseEase: 270
  easyBonus: 1.4
```

---

## `templates`

| Key | Type | Default | Effect |
|---|---|---|---|
| `folder` | path (folders) | `Templates` | Vault folder holding template `.md` files. Option+T inserts one at the cursor. |
| `newNote` | path (templates) | `""` | Template used to pre-fill a brand-new note, from the New note command and the file tree's New File. Empty makes a plain empty note. |

`newNote` expands the same `{{...}}` tokens as daily-note templates (see [template syntax](../templates/syntax.md)), and `{{cursor}}` places the caret.

A new note is created as `Untitled.md` and drops into the file tree's inline rename. The template is expanded and written after the rename settles, so `{{title}}` is the name you typed. Cancelling the rename still applies the template.
A missing or unreadable template file is not an error: the note is created empty.

```yaml
templates:
  folder: _templates
  newNote: _templates/Note.md
```

---

## `properties`

The vault property registry: a free-form map from a frontmatter key to a type. It starts empty, is edited by hand, and is served by `GET /schema` rather than `GET /settings`.

Valid types are `string`, `number`, `boolean`, `date`, `datetime`, `file` and `list`, or a mapping with an `enum` list.

```yaml
properties:
  rating: number
  due: date
  status:
    enum: [todo, doing, done]
```

---

## `folderIcons`

A free-form map from a folder path to an icon name or emoji. The file tree's **Set icon** context action writes it; you can also edit it by hand. Empty or non-string values are dropped.

```yaml
folderIcons:
  Projects: FolderGit2
  Journal: BookOpen
  Reading: "📚"
```

---

## `folderVisibility`

A free-form map from a folder path to `chat-only` or `hidden`. A folder has no frontmatter to carry a `visibility:` key, so the map holds it. `all` is also accepted and restricts nothing.

Any other value, or a value that is not a map, makes the vault unavailable to agents. The nearest marked ancestor wins, and a trailing slash on a key is ignored. The marking limits the daemon's and the in-app chat's own tool calls, not you.
[Visibility](../vault/visibility.md) covers the full model, and a note's own `visibility:` frontmatter key is separate from this map.

```yaml
folderVisibility:
  private: hidden
  drafts: chat-only
```

---

## `toolbar`

The buttons in the sidebar header, in order. Each button runs a command. [Toolbar and commands](toolbar-commands.md) lists the command ids and explains how a button resolves.

Default:

```yaml
toolbar:
  - command: create-menu
    icon: Plus
  - command: search
    icon: Search
  - command: open-inbox
    icon: Inbox
```

| Field | Type | Effect |
|---|---|---|
| `command` | command id or `daily-note:<id>` | The command this button runs. Use `command` or `commands`, not both. |
| `commands` | list of command ids | A fallback list: the button runs the first id that resolves. |
| `icon` | icon | Glyph shown on the button. Required. |
| `tooltip` | string | Hover text. Defaults to the command's label. |

A button without a non-empty `icon`, or with neither `command` nor `commands`, is dropped silently. An explicit empty list `[]` is honoured and gives an empty bar.

---

## `tabBar`

The action buttons right of the tab strip, in order. It has the same item shape as `toolbar`.

Default:

```yaml
tabBar:
  - command: new-tab
    icon: SquarePlus
  - command: terminal
    icon: SquareTerminal
  - command: new-claude-chat
    icon: MessageSquare
```

---

## `statusBar`

The bottom status bar, in order. Each item is a built-in readout, a `{token}` template, a query count or a shell command. With no `statusBar` key the bar shows `location`, `connection`, `inbox` and `daemon`. [Status bar and home page](status-bar.md) lists every item field and token.

---

## `homePage`

The note a new tab, first launch and closing the last tab should open. Empty (the default) means the knowledge graph. Type: file path. Default: `""`.

The key is accepted and linted, but the app never receives it, so a new tab always opens the knowledge graph. See [Home page](status-bar.md#home-page).

---

## `dailyNotes`

Daily-note types. Each registers a `daily-note:<id>` command that opens today's note of that type, creating it from `template` the first time. Reference the command from `toolbar` to get a button.
An item needs a non-empty `id` and `fileName`; malformed items are dropped and an explicit `[]` is honoured.

| Field | Type | Default | Effect |
|---|---|---|---|
| `id` | string | required | Stable id; forms the command `daily-note:<id>`. |
| `label` | string | the `id` | Command-palette label and default button tooltip. |
| `icon` | icon | `CalendarDays` | Icon name or emoji. |
| `folder` | path (folders) | `""` | Folder for entries. `""` is the vault root. |
| `fileName` | string | required | Filename pattern with `{{...}}` tokens, without `.md`. |
| `template` | path (templates) | `""` | Template used to pre-fill the note. |

Default: one `journal` type.

```yaml
dailyNotes:
  - id: journal
    label: Journal
    icon: BookOpen
    folder: Journal
    fileName: "{{date}} journal"
    template: Templates/Journal.md
  - id: standup
    label: Daily standup
    folder: Work/Standups
    fileName: "{{date}}"
```

---

## `keybindings`

One key per app-level shortcut, each a `keybind` combo string. The section is a nested map and appears in the file only for ids you rebind. [Keybindings](keybindings.md) has the combo syntax and every id with its default.

```yaml
keybindings:
  command-palette: Mod+Shift+K
  terminal: "Mod+`, Mod+J, Mod+Alt+T"
```

---

## How it works

`SETTINGS_SCHEMA` in `core/src/schema/settingsSchema.ts` defines every key on this page.
The enums for `theme`, `chat.provider` and `daemon.backend` are derived from the theme tokens and the agent-backend catalog, `keybindings` from `KEYBINDING_CATALOG`, `toolbar.command` from `COMMAND_IDS`, and `appearance.tokens` from `DESIGN_TOKENS`, so none needs a schema edit when the source grows.
Lint and autocomplete read the same schema.

`DEFAULTS` is `deriveDefaults(SETTINGS_SCHEMA)`: every leaf's `default`, recursively. Free-form map sections (`properties`, `folderIcons`, `folderVisibility`) materialize to `{}`. The settings overview describes [how defaults and wrong values behave](overview.md#what-happens-to-a-wrong-value).

Source: `core/src/schema/settingsSchema.ts`, `core/src/schema/types.ts`, `core/src/settingsSerialize.ts`, `core/src/theme/tokens.ts`, `core/src/theme/fontFamilies.ts`, `core/src/keybindings.ts`, `core/src/commands.ts`, `core/src/agentBackends/catalog.ts`
