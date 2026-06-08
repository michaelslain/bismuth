# Bismuth Documentation

Bismuth is an Obsidian-style knowledge vault, built as a Bun monorepo: a `core` backend, a Solid/Tauri `app`, the `bismuth` CLI, and a `relay` plugin. This is the full reference — every page is code-anchored with copy-pasteable examples.

## Get started (macOS)

Build the app into `/Applications` and run it:

```bash
git clone <repo> && cd bismuth
bun install

# build the native macOS app (compiles the frontend + the core sidecar binary), then install it
cd app && bun run tauri build
cp -R src-tauri/target/release/bundle/macos/app.app /Applications/Bismuth.app

open /Applications/Bismuth.app   # first launch: pick your vault folder
```

The bundled app **runs its own backend** — it spawns the embedded `core` server (a compiled sidecar) on a free port at launch and kills it on quit. On first launch it prompts for your vault folder and remembers it (in `~/Library/Application Support/com.michael.obsidian/config.json`); memory defaults to `~/.claude-bot/memory`.

> To just try it without installing: `cd app && bun run dev` (starts core + a dev window together; uses `OA_VAULT`/`OA_MEMORY` env). Full detail: [install](overview/install.md).

## Start here

- [Architecture](overview/architecture.md) — workspaces, the three-brain model, how it all fits together
- [Install & run](overview/install.md) — prerequisites, env vars, dev/build, multiple instances
- [Storage](overview/storage.md) — where everything is stored on disk + in the browser
- [Data flow](overview/data-flow.md) — file-watch → SSE → frontend, caching, layouts

## The vault

- [Structure](vault/structure.md) — markdown tree, folders, how notes become graph nodes
- [Frontmatter & properties](vault/frontmatter.md) — YAML frontmatter, the property registry
- [Wikilinks & tags](vault/wikilinks-tags.md) — `[[links]]`, `#tags`, matching rules
- [Attachments & embeds](vault/attachments.md) — `![[file]]` / `![](url)`, asset storage, sizing

## Editor

- [Markdown & live preview](editor/markdown.md) — every rendered block/inline kind
- [Tables](editor/tables.md) — editable GFM pipe tables
- [Autocomplete](editor/autocomplete.md) — wikilink/tag/task/query/settings completion

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
- [Drawing](drawing/overview.md) — the `.draw` vector format + export
- [Sheets](sheets/overview.md) — the `.sheet` Univer workbook format
- [Templates & daily notes](templates/syntax.md) — token syntax + daily-note config

## Settings

- [Overview](settings/overview.md) — `settings.yaml` lifecycle (schema-driven, no GUI)
- [Full reference](settings/reference.md) — every section + key + default
- [Keybindings](settings/keybindings.md) — shortcut syntax + catalog
- [Toolbar & commands](settings/toolbar-commands.md) — toolbar config + command catalog
- [Themes](settings/themes.md) — theme/palette/fonts

## Graph, terminal, daemon

- [Graph](graph/overview.md) — node/edge kinds, the 5 modes, layout
- [Terminal & relay](terminal/overview.md) — in-app terminals, the agents graph
- [Daemon integration](daemon/overview.md) — the claude-bot daemon graph + controls
- [Daemon storage](daemon/storage.md) — the `~/.claude-bot` on-disk layout

## Interfaces

- [CLI reference](cli/reference.md) — every `bismuth` command
- [HTTP API reference](api/http-reference.md) — every core server route

## Contributing

- [Codebase map](contributing/codebase-map.md) — module-by-module navigation
- [Testing](contributing/testing.md) — how tests work, how to add them
