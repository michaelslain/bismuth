# Bismuth Documentation

Bismuth is an Obsidian-style knowledge vault, built as a Bun monorepo: a `core` backend, a Solid/Tauri `app`, the `bismuth` CLI, and a `relay` plugin. This is the full reference — every page is code-anchored with copy-pasteable examples.

## Get started (macOS)

Build Bismuth from source and install it to `/Applications`.

You need [Bun](https://bun.sh/docs/installation) 1.0+, Node.js 20+, and Rust (for the native build) installed.

Then clone, install, and build — the last command builds the app and opens the installer for you:

```bash
git clone https://github.com/michaelslain/bismuth.git
cd bismuth
bun install
bun run build:app     # builds the app (a few minutes), then opens the dmg
```

When the dmg opens, drag **Bismuth → Applications**, eject, and launch it. First run: pick your vault folder.

<details><summary>Notes</summary>

- A Finder window may flash open and shut **during the build** — that's just the dmg being styled, not the installer. Ignore it.
- Prefer to do it by hand? `cd app && bun run tauri build`, then drag `src-tauri/target/release/bundle/macos/Bismuth.app` into `/Applications` (or open the dmg under `bundle/dmg/`).
- Full prerequisites, env vars, and dev-server details: [Install & run](overview/install.md).

</details>

## Start here

- [Architecture](overview/architecture.md) — workspaces, the three-brain model, how it all fits together
- [Install & run](overview/install.md) — prerequisites, env vars, dev/build, multiple instances
- [Storage](overview/storage.md) — where everything is stored on disk + in the browser
- [Data flow](overview/data-flow.md) — file-watch → SSE → frontend, caching, layouts
- [Self-update](overview/self-update.md) — the git-based in-place app updater (detect → pull → rebuild → swap)

## The vault

- [Structure](vault/structure.md) — markdown tree, folders, how notes become graph nodes
- [Frontmatter & properties](vault/frontmatter.md) — YAML frontmatter, the property registry
- [Wikilinks & tags](vault/wikilinks-tags.md) — `[[links]]`, `#tags`, matching rules
- [Attachments & embeds](vault/attachments.md) — `![[file]]` / `![](url)`, asset storage, sizing
- [Visibility controls](vault/visibility.md) — per-file/folder AI restrictions on the daemon + in-app chat, inheritance, enforcement, threat model

## Editor

- [Markdown & live preview](editor/markdown.md) — every rendered block/inline kind
- [Block editor (WYSIWYG)](editor/blocks.md) — the Milkdown true-WYSIWYG surface + `editor.defaultMode`
- [Tables](editor/tables.md) — editable GFM pipe tables
- [Autocomplete](editor/autocomplete.md) — wikilink/tag/task/query/settings completion
- [Note ink](editor/ink.md) — draw-anywhere mode: freehand strokes over any note (Mod+Shift+I)

## Bases (queries & views)

- [Overview](bases/overview.md) — what a `type: base` note is; the views array
- [Sources & composition](bases/sources.md) — `SourceSpec`, `from:`, base composition
- [Query syntax](bases/query-syntax.md) — the Bases expression grammar
- [Filters](bases/filters.md) — `where:` expressions
- [Functions reference](bases/functions.md) — every built-in function/method
- [The ` ```query ` block](bases/query-block.md) — embedding a base/query in a note

**View kinds**: [table](bases/views/table.md) · [cards](bases/views/cards.md) · [list & bullets](bases/views/list-bullets.md) · [kanban](bases/views/kanban.md) · [calendar](bases/views/calendar.md) · [flashcards](bases/views/flashcards.md) · [map](bases/views/map.md) · [charts](bases/views/charts.md)

## Tasks

- [Task syntax](tasks/syntax.md) — Obsidian-Tasks-compatible status/dates/recurrence/priority
- [Query DSL](tasks/query-dsl.md) — the `tasks:` query language

## Feature subsystems

- [Flashcards / SRS](flashcards/srs.md) — markdown + row cards, SM-2, decks, bidirectional, cram
- [Calendar](calendar/overview.md) — events, recurrence, categories
- [Google Calendar sync](gcal/overview.md) — OAuth/PKCE two-way sync, conflict policies, recurrence, manifest
- [Visual Claude chat](chat/overview.md) — in-app Claude Code chat (`/chat` WS, Agent-SDK sessions, unified with terminals)
- [Export](export/overview.md) — note/base/sheet/drawing → md|html|png|pdf, visual/data modes
- [Drawing](drawing/overview.md) — the `.draw` vector format + export
- [Sheets](sheets/overview.md) — the `.sheet` Univer workbook format
- [Templates & daily notes](templates/syntax.md) — token syntax + daily-note config

## Settings

- [Overview](settings/overview.md) — `.settings` lifecycle (schema-driven, no GUI)
- [Full reference](settings/reference.md) — every section + key + default
- [Keybindings](settings/keybindings.md) — shortcut syntax + catalog
- [Toolbar & commands](settings/toolbar-commands.md) — toolbar config + command catalog
- [Themes](settings/themes.md) — theme/palette/fonts

## Graph & terminal

- [Graph](graph/overview.md) — node/edge kinds, the 5 modes, layout
- [Terminal & relay](terminal/overview.md) — in-app terminals, the agents graph

## Daemon (`@bismuth/daemon`)

The in-repo background runtime — **one machine process that multiplexes per-vault "brains"**. Machine identity lives at `~/.bismuth/daemon`; each enabled vault's brain (crons, processes, memory, session, `identity.md`) lives under `<vault>/.daemon`.

- [Overview](daemon/overview.md) — what the daemon is, the machine-vs-vault split, the `daemon.enabled` switch, the daemon graph mode
- [Lifecycle](daemon/lifecycle.md) — the supervisor: boot order, reconcile loop, per-vault session, single-owner gating, install/service (launchd/systemd)
- [Crons & processes](daemon/crons-and-processes.md) — per-vault crons + background processes: `VaultContext` keying, default crons, triggers, state files
- [Pages (inbox)](daemon/pages.md) — daemon-authored pages awaiting approval/dismissal: format, `.state` sidecar, delivery, the button-press → execution → completion lifecycle, `::inbox`
- [Memory store](daemon/memory.md) — the per-vault markdown memory graph: note format, backlinks, query vs search, the dream cycle
- [Communication & hooks](daemon/communication.md) — the relay recall/collect hooks + single-owner device gating (no cross-machine messaging)
- [Storage](daemon/storage.md) — the two-tier on-disk layout (`~/.bismuth/daemon` + `<vault>/.daemon`) and the legacy-state migration

## Interfaces

- [CLI reference](cli/reference.md) — every `bismuth` command
- [HTTP API reference](api/http-reference.md) — every core server route
- [MCP server](mcp/overview.md) — auto-attaches to app-terminal Claude sessions; serves docs + CLI + (daemon-gated) memory tools
- [App control](mcp/app-control.md) — driving a running window's tabs from a Claude session / the shell (`bismuth app …`), via the CLI (zero new MCP tools)
- [Mobile (iPad/iOS)](mobile/overview.md) — the no-HTTP in-process backend + `FileAccess`/`Transport` seams that run the vault on-device

## Contributing

- [Codebase map](contributing/codebase-map.md) — module-by-module navigation
- [Testing](contributing/testing.md) — how tests work, how to add them
