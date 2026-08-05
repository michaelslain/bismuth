# Bismuth

**A knowledge vault that thinks with you.** Bismuth keeps your notes as plain markdown on your own
disk — wikilinks, tags, YAML frontmatter, no lock-in — and builds a live knowledge graph on top of
them. Around that it adds the things a vault usually makes you leave: queryable database views,
tasks, spaced repetition, a calendar, drawing, spreadsheets, terminals, and AI that can actually
read your vault.

### The three-brain model

The idea the whole app is organised around:

| | what it is | where it lives |
|---|---|---|
| **You** | the person at the centre | — |
| **2nd brain** | your vault — markdown notes, links, tags | your chosen folder |
| **3rd brain** | the daemon's memory — what the assistant has learned about your work, linked back into your notes | `<vault>/.daemon/memory` |

The graph merges all three, so a note and the thing an agent remembered about it are one connected
structure rather than two disconnected tools.

### What's in the box

- **Knowledge graph** — 2D/3D, rendered as a character grid; five modes including a *local* view of one note's neighbourhood
- **Bases** — a `type: base` note is a query over your vault, rendered through any of 12 view kinds (table, cards, kanban, calendar, map, charts, flashcards, …)
- **Tasks** (Obsidian-Tasks compatible) and **flashcards** (SM-2 spaced repetition) that read straight out of your notes
- **Calendar** with two-way Google Calendar sync · **drawing** (`.draw`) · **spreadsheets** (`.sheet`) · **export** to md/html/png/pdf
- **AI, on your terms** — in-app terminals, a visual chat that runs on any of **nine** agent backends (Claude Code, opencode, Codex, and six more), a **skill** (`skills/`) that teaches any of them how to author a Bases view correctly, and per-file/folder **visibility controls** that fence agents out of what you don't want read
- **A daemon** — an optional background brain per vault: crons, processes, a memory graph, and an inbox of work awaiting your approval
- **Drive it from anywhere** — the `bismuth` CLI, an MCP server, and an iPad build that runs the whole backend in-process

Everything is local-first and file-based: no account, no sync service, no database.

---

## About this documentation

Bismuth is a Bun monorepo of **seven workspaces** — `core` (backend), `app` (Solid + Tauri),
`cli`, `relay`, `mcp`, `memory`, and `daemon` — plus two top-level directories that are **not**
workspaces: `skills/` (agent-facing skill guides) and `app/.storybook/` (the Storybook 9
component catalog for `app/src/`, `bun run storybook`, port `6006`). This is the full
reference: every page is code-anchored, with copy-pasteable examples drawn from the real
implementation.

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
- [Status messages](overview/status-messages.md) — what "connection lost — polling", "Open folder failed", and the rest actually mean
- [Data flow](overview/data-flow.md) — file-watch → SSE → frontend, caching, layouts
- [Self-update](overview/self-update.md) — the git-based in-place app updater (detect → pull → rebuild → swap)

## The vault

- [Structure](vault/structure.md) — markdown tree, folders, how notes become graph nodes
- [Frontmatter & properties](vault/frontmatter.md) — YAML frontmatter, the property registry
- [Wikilinks & tags](vault/wikilinks-tags.md) — `[[links]]`, `#tags`, matching rules
- [Attachments & embeds](vault/attachments.md) — `![[file]]` / `![](url)`, asset storage, sizing
- [Visibility controls](vault/visibility.md) — per-file/folder AI restrictions on the daemon + in-app chat, inheritance, enforcement, threat model
- [Visibility acceptance run](vault/visibility-acceptance.md) — the recorded adversarial pass: every route tried, what closed, what leaked, and what is explicitly NOT verified

## Editor

- [Markdown & live preview](editor/markdown.md) — every rendered block/inline kind
- [Block editor (WYSIWYG)](editor/blocks.md) — the Milkdown true-WYSIWYG surface + `editor.defaultMode`
- [Tables](editor/tables.md) — editable GFM pipe tables
- [The ` ```graph ` block](editor/graph-block.md) — embedded editable graph (markdown ⇄ graph round-trip)
- [Autocomplete](editor/autocomplete.md) — wikilink/tag/task/query/settings completion
- [Note ink](editor/ink.md) — draw-anywhere mode: freehand strokes over any note (Mod+Shift+I)

## Bases (queries & views)

- [Overview](bases/overview.md) — what a `type: base` note is; the views array
- [Per-base properties](bases/properties.md) — `properties:` map vs list form; declaring a base's own property set
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
- [Chat providers](chat/providers.md) — the provider seam behind all nine backends: routing, the opencode/codex drivers, per-capability graceful degradation
- [Agent backends](chat/backends.md) — the backend catalog + capability model, the six integration surfaces, ACP, the MCP-registration policy, the daemon's visibility constraint
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

- [Graph](graph/overview.md) — node/edge kinds, the graph modes, layout
- [Terminal & relay](terminal/overview.md) — in-app terminals, the relay registry

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
- [Daemon MCP tools](mcp/daemon-tools.md) — the ten daemon-gated tools: crons, background processes, the inbox, status + device ownership
- [App control](mcp/app-control.md) — driving a running window's tabs from a Claude session / the shell (`bismuth app …`), via the CLI (zero new MCP tools)
- [Mobile (iPad/iOS)](mobile/overview.md) — the no-HTTP in-process backend + `FileAccess`/`Transport` seams that run the vault on-device

## Contributing

- [Codebase map](contributing/codebase-map.md) — module-by-module navigation
- [Testing](contributing/testing.md) — how tests work, how to add them
- [Third-party notices](overview/third-party-notices.md) — attribution for bundled assets (the CC BY 4.0 icon set)
