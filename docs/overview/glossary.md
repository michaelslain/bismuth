# Glossary

Bismuth's terms in one table, in alphabetical order. Each row gives a one-line definition and the page that owns the full explanation.

| Term | Definition | Full explanation |
|---|---|---|
| 2nd brain | The vault: your markdown notes plus their tags, shown as the `2nd` graph mode. | [Graph overview](../graph/overview.md) |
| 3rd brain | The daemon's memory graph, shown as the `3rd` graph mode; present only while the daemon is enabled. | [Memory store](../daemon/memory.md) |
| backend | An agent CLI that Bismuth can drive, such as Claude Code, Codex or opencode; chat, terminal tabs, the daemon and MCP registration each read the same catalog of backends. | [Agent backends](../chat/backends.md) |
| base | A file that declares `type: base`, a source, filters and one view: a `<name>.base.jsonl` file (line 1 the config, each later line a row) or a markdown note with `type: base` in its frontmatter. | [Bases overview](../bases/overview.md) |
| brain | One vault's slice of the daemon: its memory, crons, processes and conversation session, run by the single machine daemon. | [Daemon overview](../daemon/overview.md) |
| companion note | The note `<file>.md` that carries the tags and properties of an image or PDF, such as `paper.pdf.md`; it is created on the first edit. | [Frontmatter](../vault/frontmatter.md) |
| cron | A markdown file in `<vault>/.daemon/crons` that fires a Claude session on a time schedule or when a watched vault file changes. | [Crons and processes](../daemon/crons-and-processes.md) |
| daemon | The background agent runtime: one machine process, started by launchd or systemd, that runs every enabled vault's brain. | [Daemon overview](../daemon/overview.md) |
| deck | A set of flashcards named by a tag suffix: `flashcards/spanish` is the deck `spanish`. | [Flashcards](../flashcards/srs.md) |
| design token | A CSS custom property on `:root` (colour, spacing, type) that is registered with its default and documentation. | [Design tokens](../settings/tokens.md) |
| flashcard | A card written as markdown in a note tagged `flashcards`, or a row of a base shown in the flashcards view, scheduled with SM-2. | [Flashcards](../flashcards/srs.md) |
| frontmatter | The YAML block between two `---` lines at the top of a note; its keys are the note's properties. | [Frontmatter](../vault/frontmatter.md) |
| inbox page | A `type: daemon-page` note the daemon writes under `<vault>/.daemon/pages/` to ask you to approve or dismiss something. | [Daemon pages](../daemon/pages.md) |
| MCP server | The stdio Model Context Protocol server that gives a coding agent the docs and the `bismuth` CLI as tools. | [MCP overview](../mcp/overview.md) |
| memory | The daemon's store of markdown notes under `<vault>/.daemon/memory`, shown in the graph as `mem:` nodes. | [Memory store](../daemon/memory.md) |
| note | A markdown (`.md`) file in the vault. | [Vault structure](../vault/structure.md) |
| owner token | A random per-launch secret sent as `X-Bismuth-Token` that marks a request as the vault's own app or CLI, exempt from visibility filtering. | [Visibility](../vault/visibility.md) |
| pane | One region of a tab's split layout, showing a note or a special view such as the graph, a terminal or a chat. | [Getting started](getting-started.md#step-7-use-tabs-and-split-panes) |
| process | A markdown file in `<vault>/.daemon/processes` that the daemon supervises as a long-lived child process. | [Crons and processes](../daemon/crons-and-processes.md) |
| property | A key in a note's frontmatter; the `properties:` registry in `.settings` can give it a type. | [Frontmatter](../vault/frontmatter.md) |
| query block | A fenced `query` block inside a note that renders a view of a base or of your tasks in place. | [Query block](../bases/query-block.md) |
| register | A calendar view's mode: the events register draws events stored in the base, and the tasks register (`mode: tasks`) draws checkbox tasks. | [Calendar view](../bases/views/calendar.md) |
| relay | The Claude Code plugin that reports each terminal-tab session and its subagents to core's in-process registry. | [Terminal and relay](../terminal/overview.md) |
| sidecar | A file stored beside the file it describes, named by appending an extension, such as the ink file `photo.png.draw`. | [Drawing](../drawing/overview.md) |
| source | Where a base's rows come from: other notes (`notes`), checkbox lines (`tasks`), or another base (`base`). | [Sources](../bases/sources.md) |
| switcher | The `Mod+O` search takeover: file names, note contents and an AI fallback in one panel; the app's only search surface. | [Getting started](getting-started.md#step-6-find-anything-with-the-switcher) |
| tab | One entry in the vertical tab rail; it holds a tree of one or more panes. | [Getting started](getting-started.md#step-7-use-tabs-and-split-panes) |
| tag | A label from the `tags` frontmatter key or an inline `#tag`; each tag is a node in the graph. | [Wikilinks and tags](../vault/wikilinks-tags.md) |
| task | A markdown checkbox line whose dates, priority and recurrence are bracketed fields, such as `[due 2026-09-14]`. | [Task syntax](../tasks/syntax.md) |
| theme | A named set of colour tokens: `ink`, `paper`, `cathode` and `riso` are built in, and a custom theme is a `.themes/<name>.yaml` file. | [Themes](../settings/themes.md) |
| view kind | The one way a base draws its rows, such as table, kanban or calendar. | [Bases overview](../bases/overview.md) |
| visibility | A per-note or per-folder setting (`all`, `chat-only`, `hidden`) that keeps a note away from the daemon and in-app chat without limiting you. | [Visibility](../vault/visibility.md) |
| vault | The folder that holds your notes; Bismuth keeps its settings in `.settings` and the daemon's state in `.daemon` inside it. | [Vault structure](../vault/structure.md) |
| wikilink | A `[[Note Name]]` reference that links to the note by file name, wherever it sits in the vault. | [Wikilinks and tags](../vault/wikilinks-tags.md) |
