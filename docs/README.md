# Bismuth Documentation

Bismuth is an Obsidian-style knowledge vault, built as a Bun monorepo: a `core` backend, a Solid/Tauri `app`, the `bismuth` CLI, and a `relay` plugin. This is the full reference — every page is code-anchored with copy-pasteable examples.

## Get started (macOS)

From a fresh clone to the app in `/Applications`.

**Prerequisites:** [Bun](https://bun.sh/docs/installation) 1.0+, Node.js 20+, and Rust (only needed for `tauri build`). Install Rust:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # accept the default "1) Proceed"
source "$HOME/.cargo/env"                                        # load cargo into THIS shell (installer only adds it to new shells)
cargo --version && rustc --version                               # verify
```

**Build & install:**

```bash
# Clone bismuth AND the claude-bot sibling next to it. claude-bot is required:
# `bun install` resolves it via core/package.json (file:../../claude-bot), and the
# build bundles its source into the app (the daemon ships inside the .app).
git clone https://github.com/michaelslain/bismuth.git
git clone https://github.com/michaelslain/claude-bot.git
cd bismuth

bun install                                                     # all workspaces, from repo root
cd app
bun run prebundle:claudebot                                     # stage the bundled daemon from ../../claude-bot
bun run tauri build                                             # builds the app + core sidecar + a .dmg
```

> Already have `../claude-bot`? Refresh it before building so the bundled daemon is current:
> `git -C ../claude-bot pull --ff-only origin main` (run from the bismuth repo root).

**Install the built app.** `tauri build` does **not** pop an installer window — it just writes the artifacts. Open the dmg yourself and drag **Bismuth → Applications** (or skip the dmg and drag the `.app` straight in):

```bash
open src-tauri/target/release/bundle/dmg/Bismuth_*.dmg          # then drag Bismuth → Applications, eject
# or, no dmg: drag this straight into /Applications in Finder
#   src-tauri/target/release/bundle/macos/Bismuth.app
```

> A Finder window may flash open and closed **during the build** — that's `bundle_dmg.sh` styling the dmg, not the installer. Ignore it; the dmg is still written to the path above.

First launch: pick your vault folder. See [Install & run](overview/install.md) for the full prerequisites + dev-server details.

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
- [Daemon integration](daemon/overview.md) — the claude-bot daemon graph + controls (Bismuth's consumer side)
- [Daemon storage](daemon/storage.md) — the `~/.claude-bot` on-disk layout Bismuth reads

## claude-bot

The persistent AI daemon Bismuth integrates with — a **separate project** (sibling repo) documented here from its own (producer) side, alongside Bismuth's integration seams.

- [Overview](claude-bot/overview.md) — what claude-bot is, the three layers, how it relates to Bismuth, section index
- [Daemon supervisor](claude-bot/daemon.md) — `daemon/index.ts` + `session.ts`: boot/shutdown, the persistent session, owner gating
- [Crons & processes](claude-bot/crons-and-processes.md) — file-based crons + background processes: frontmatter, scheduling, state files, triggers
- [Memory store](claude-bot/memory.md) — the markdown memory graph: note format, backlinks, query vs search, the dream cycle
- [MCP server](claude-bot/mcp.md) — claude-bot's own stdio MCP server + full 26-tool catalog (distinct from Bismuth's MCP)
- [Communication & hooks](claude-bot/communication.md) — the recall/collect hooks + single-owner device gating (no cross-machine messaging)
- [Installation](claude-bot/install.md) — `bin/ensure-installed.ts` (adopt-only), launchd/systemd, the relocatable bundle, how Bismuth invokes it
- [Storage](claude-bot/storage.md) — the `~/.claude-bot` on-disk tree from claude-bot's writer view

## Interfaces

- [CLI reference](cli/reference.md) — every `bismuth` command
- [HTTP API reference](api/http-reference.md) — every core server route
- [MCP server](mcp/overview.md) — auto-attaches to app-terminal Claude sessions; serves docs + CLI

## Contributing

- [Codebase map](contributing/codebase-map.md) — module-by-module navigation
- [Testing](contributing/testing.md) — how tests work, how to add them
