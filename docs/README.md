# Bismuth documentation

Bismuth is a local-first knowledge vault: your notes are plain markdown files in a folder you
choose, with wikilinks, tags and YAML frontmatter, and the app builds a live graph and queryable
views from them. There is no account, sync service or database. These docs serve three readers:
people using the app, engineers working on it, and AI agents, which read them through Bismuth's MCP
server.

| | what it is | where it lives |
|---|---|---|
| 2nd brain | your vault: notes, links, tags, properties | the folder you chose |
| 3rd brain | the daemon's memory of your work, linked back to your notes | `<vault>/.daemon/memory` |

The graph joins both, so a note and a memory about it sit in one structure. The 3rd brain exists
only when the [daemon](daemon/overview.md) is enabled.

## Start here

- [Getting started](overview/getting-started.md) — first run: pick a vault, write and link notes, open the graph
- [Install and run Bismuth](overview/install.md) — install the macOS app, or build and run it from source
- [Glossary](overview/glossary.md) — one-line definitions of every Bismuth term, linked to its page
- [Troubleshooting](overview/troubleshooting.md) — symptom to fix, for the problems people actually hit
- [Migrating from an older version](overview/migrating.md) — what an older vault or install contains and what to do

## Use Bismuth

**Notes and the vault**

- [Vault structure](vault/structure.md) — what a vault holds and how files become notes, nodes and tree rows
- [Frontmatter and properties](vault/frontmatter.md) — YAML properties, their types, and companion notes for images and PDFs
- [Wikilinks and tags](vault/wikilinks-tags.md) — `[[links]]` matched by file name, `#tags`, and how each resolves
- [Attachments and embeds](vault/attachments.md) — `![[file]]` and `![](url)` embeds, sizing, and where pasted files go

**The editor**

- [Live preview](editor/markdown.md) — what each markdown construct looks like as you type, and when source shows
- [Tables](editor/tables.md) — editing GFM tables cell by cell: rows, columns, merge, reorder
- [Autocomplete](editor/autocomplete.md) — every completion trigger: links, tags, tasks, slash menu, emoji, settings
- [Note ink](editor/ink.md) — draw over any note in draw mode; strokes live in ` ```draw ` fences
- [The graph block](editor/graph-block.md) — a ` ```graph ` fence that renders an editable graph inside a note
- [Template tokens and daily notes](templates/syntax.md) — `{{date}}`-style tokens, templates, and the daily note

**Bases: queries and views**

- [Make your first base](bases/first-base.md) — step by step: a base note, a source, a filter, a view
- [Bases overview](bases/overview.md) — what a base is, its keys, and the list of view kinds
- [Base sources](bases/sources.md) — where rows come from: notes, tasks, or another base
- [Base filters](bases/filters.md) — `where:` filters, filter trees, and how values count as true
- [Bases expression syntax](bases/query-syntax.md) — the expression grammar: operators, equality, dates, durations
- [Bases functions and methods](bases/functions.md) — every built-in function and method, and footer summaries
- [Base properties](bases/properties.md) — declaring a base's own property set and editors
- [The query block](bases/query-block.md) — embed a base or a task query inside a note
- View kinds: [table](bases/views/table.md) · [cards](bases/views/cards.md) · [list and bullets](bases/views/list-bullets.md) · [kanban](bases/views/kanban.md) · [calendar](bases/views/calendar.md) · [flashcards](bases/views/flashcards.md) · [map](bases/views/map.md) · [bar, line, stat, heatmap](bases/views/charts.md)

**Tasks, cards and time**

- [Task syntax](tasks/syntax.md) — a task line and its bracket fields: due dates, priority, recurrence
- [Tasks-plugin query text](tasks/query-dsl.md) — how `tasks:` values written for the Obsidian Tasks plugin are read
- [Flashcards and spaced repetition](flashcards/srs.md) — writing cards in notes, decks, and review scheduling
- [Calendar events](calendar/overview.md) — events, recurrence and categories in a calendar base
- [Google Calendar sync](gcal/overview.md) — two-way sync between a calendar base and Google Calendar

**Other surfaces**

- [Knowledge graph](graph/overview.md) — the home tab: modes, 2D and 3D, zoom, and how layout works
- [Drawing](drawing/overview.md) — `.draw` sketches, annotating images and PDFs, and the file format
- [Sheets](sheets/overview.md) — `.sheet` spreadsheets inside the vault
- [Export](export/overview.md) — notes, bases, sheets and drawings to markdown, HTML, PNG or PDF

## Connect AI

- [Connect an AI agent](chat/connect-an-agent.md) — the ways an agent reaches your vault, and which to pick
- [Chat](chat/overview.md) — the in-app chat: backends, controls, permissions, history
- [Agent backends](chat/backends.md) — every chat backend and what each one supports
- [opencode providers](chat/opencode-providers.md) — connect a model provider to opencode chats from the app
- [Local models](chat/local-models.md) — run chats on LM Studio or Ollama models
- [Terminal tabs and the relay](terminal/overview.md) — in-app terminals and how agent sessions report back
- [MCP server](mcp/overview.md) — the tools any MCP client gets: docs, the CLI, memory
- [MCP daemon tools](mcp/daemon-tools.md) — crons, processes and the inbox, for agents
- [App control](mcp/app-control.md) — drive a running window's tabs from a shell or an agent
- [Visibility controls](vault/visibility.md) — hide notes and folders from agents, per channel
- [Visibility acceptance](vault/visibility-acceptance.md) — which routes are verified to honour visibility, and which are not

**The daemon**

- [Set up the daemon](daemon/setup.md) — turn on the background brain, name it, approve its pages
- [Daemon](daemon/overview.md) — what the daemon is, the machine and vault halves, its page
- [Daemon pages](daemon/pages.md) — inbox pages awaiting your approval: format and lifecycle
- [Crons and background processes](daemon/crons-and-processes.md) — scheduled jobs and long-running processes per vault
- [Daemon memory](daemon/memory.md) — the markdown memory graph, recall, and the dream cycle
- [Memory injection and device ownership](daemon/communication.md) — how memory reaches agent sessions, and which device runs the brain
- [Daemon service and lifecycle](daemon/lifecycle.md) — the launchd or systemd service, boot, and the reconcile loop
- [Daemon storage](daemon/storage.md) — the machine directory and each vault's `.daemon` folder

## Configure

- [Settings](settings/overview.md) — the `.settings` file: how it is read, edited, and validated
- [Settings reference](settings/reference.md) — every settings key, its type and its default
- [Themes and fonts](settings/themes.md) — pick a built-in theme and the two font settings
- [Design tokens](settings/tokens.md) — every token, its default, and where to override it
- [Keybindings](settings/keybindings.md) — rebind any shortcut; the full keybinding catalog
- [Toolbar and commands](settings/toolbar-commands.md) — the sidebar toolbar and the command catalog
- [Shell layout](settings/layout.md) — which side the sidebar and tab rail sit on
- [Status bar and home page](settings/status-bar.md) — the bottom bar's segments, counts and shell commands

## Reference

- [CLI reference](cli/reference.md) — every `bismuth` command, its flags, and whether it needs the app
- [HTTP API reference](api/http-reference.md) — every core server route, its body, response and auth
- [Status messages](overview/status-messages.md) — what each toast and banner means and what to do
- [Doctor](overview/doctor.md) — `bismuth doctor`: find and repair version skew and leftovers
- [Self-update](overview/self-update.md) — how the app updates itself in place
- [Draggables](overview/draggables.md) — what each drag does on each drop surface
- [Storage](overview/storage.md) — where everything lives on disk and in the browser

## Agent guides

Agents read these before acting; the MCP server's instructions name each one.

- [Authoring bases](bases/authoring.md) — read before creating, editing or debugging a base or query block; one page per view kind under `bases/authoring/`
- [Converting an Obsidian vault to Bismuth](guides/converting-obsidian-to-bismuth.md) — with topic pages under `guides/converting-obsidian-to-bismuth/`
- [Converting a Bismuth vault to Obsidian](guides/converting-bismuth-to-obsidian.md) — with topic pages under `guides/converting-bismuth-to-obsidian/`
- [Make a custom colour theme](guides/custom-themes.md) — the `.themes/<name>.yaml` format and its validate loop

## Contribute

- [Architecture](overview/architecture.md) — the workspaces, what each owns, and how they talk
- [Codebase map](contributing/codebase-map.md) — a directory-level map and where to add things
- [Data flow](overview/data-flow.md) — file watch to caches to SSE to the frontend
- [Testing](contributing/testing.md) — the test runner, the commit and push gates, guard tests
- [Visual checks](contributing/visual-checks.md) — Storybook and the `bench/` tools that verify the UI
- [Chat providers](chat/providers.md) — the provider seam behind every chat backend
- [Mobile (iPad and iOS)](mobile/overview.md) — the in-process backend and its two seams
- [Third-party notices](overview/third-party-notices.md) — attribution for bundled fonts and icons
