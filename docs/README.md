# Bismuth Documentation

Bismuth is an Obsidian-style knowledge vault, built as a Bun monorepo: a `core` backend, a Solid/Tauri `app`, the `bismuth` CLI, and a `relay` plugin. This is the full reference — every page is code-anchored with copy-pasteable examples.

## Get started (macOS)

Build the app into `/Applications` and run it:

```bash
git clone <repo> && cd bismuth
bun install

# point at your vault + memory dirs (both must already exist)
export OA_VAULT="$HOME/Documents/bismuth-vault"
export OA_MEMORY="$HOME/.claude-bot/memory"

# build the native macOS app, then install it
cd app && bun run tauri build
cp -R src-tauri/target/release/bundle/macos/app.app /Applications/Bismuth.app

# the app talks to the core backend on :4321 — start it, then open the app
bun run ../core/src/server.ts --vault "$OA_VAULT" --memory "$OA_MEMORY" --port 4321 &
open /Applications/Bismuth.app
```

> The bundled app doesn't launch the backend itself yet, so `core` must be running on `:4321` (the command above). To just try it without installing, run `cd app && bun run dev` — that starts the backend + a dev window together. Full detail: [install](overview/install.md).

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
