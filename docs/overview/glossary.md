# Glossary

Bismuth's terms, the words the app, the docs, the code comments and the people working on Bismuth all use for the same things. Each level of the two maps below answers one question, and the term table that follows defines every word with a link to the page that owns it.

## Where things sit in the window

The window is named by role, never by position: the sidebar and the tab rail can each sit on either window edge ([shell layout](../settings/layout.md)).

- **window**
    - **top strip**: the fixed strip with the wordmark and the window buttons
    - **sidebar**
        - toolbar
        - file tree
        - mini graph
            - toolbar
    - **tab rail**
        - toolbar
        - tabs
            - **tab**
                - **pane**: one region of the tab, split side by side or stacked
                    - toolbar
                    - one file or one page
    - **status bar**

## What a pane shows

A pane shows exactly one file from the vault or one page, which has no file behind it.

- **file**: lives in the vault
    - **note**: `.md`
    - **base**: `.base.jsonl`, or a note with `type: base`
        - **kind**: where the rows come from
            - **view**: rows come from notes, tasks or another base
            - **collection**: rows are stored in the file itself
        - **layout**: how the rows are drawn
            - **row layouts**: every row stays a visible item you can edit
                - table, cards, list, bullets, kanban, calendar, map, flashcards
            - **charts**: rows are summarized into numbers or shapes
                - stat, bar, line, heatmap
    - **sheet**: `.sheet`, the spreadsheet
    - **drawing**: `.draw`
    - **config file**: `.settings`, `.yaml`; opens as text in the editor
    - **previewed file**: opens read-only in the preview
        - **image**: png, jpg, svg, heic and the other image formats
        - **PDF**: adds pages, highlights, bookmarks, an outline and dark mode
        - **code file**: `.ts`, `.json`, `.py` and other text formats
        - **unsupported file**: `.psd`, `.fig` and others; offers to open in the default app
- **page**: no file behind it
    - graph, terminal, chat, daemon, export, feedback

## How the terms fit together

The rules below keep the two maps consistent.

- Calendar and stat are layouts, so a calendar and a stats board are each a base. Stat is a chart, beside bar, line and heatmap.
- A sheet is not a base: it holds free-form cells, where the table layout shows one row per item with typed columns.
- The graph is a page, because no file sits behind it.
- A PDF is not an image. Both open in the preview and both carry tags (in a companion note) and ink (in a sidecar); a PDF also has pages, highlights, bookmarks, an outline and dark mode.
- A base's kind and its layout are independent: a collection can be a kanban board and a view can be a calendar. `mode: tasks` is a third, independent choice that draws every row as a task.
- Every region has a toolbar on top: a pane, the sidebar, the mini graph and the tab rail. A pane's toolbar has a leading half (identity, locus, facet) and a trailing half (readouts, config, actions).

## Which aliases mean the same thing?

An alias is fine in conversation; the docs, UI text and code comments use the term.

| Alias | Term |
|---|---|
| left sidebar | sidebar |
| right sidebar | tab rail |
| view bar | toolbar (of a pane) |
| spreadsheet | sheet |
| view kind | layout |
| stats | the `stat` layout |
| binary | image or PDF |

## Terms

The table lists every term in alphabetical order, with a one-line definition and the page that owns the full explanation.

| Term | Definition | Full explanation |
|---|---|---|
| 2nd brain | The vault: your markdown notes plus their tags, shown as the `2nd` graph mode. | [Graph overview](../graph/overview.md) |
| 3rd brain | The daemon's memory graph, shown as the `3rd` graph mode; present only while the daemon is enabled. | [Memory store](../daemon/memory.md) |
| backend | An agent CLI that Bismuth can drive, such as Claude Code, Codex or opencode; chat, terminal pages, the daemon and MCP registration each read the same catalog of backends. | [Agent backends](../chat/backends.md) |
| base | A file that declares `type: base` and draws rows with one layout: a `<name>.base.jsonl` file (line 1 the config, each later line a row) or a markdown note with `type: base` in its frontmatter. Every base is a view or a collection. | [Bases overview](../bases/overview.md) |
| brain | One vault's slice of the daemon: its memory, crons, processes and conversation session, run by the single machine daemon. | [Daemon overview](../daemon/overview.md) |
| chart | A layout that summarizes rows into numbers or shapes instead of showing each row: `stat`, `bar`, `line` or `heatmap`. | [Charts](../bases/views/charts.md) |
| code file | A text file such as `.ts`, `.json` or `.py` that opens read-only in the preview. | [Vault structure](../vault/structure.md) |
| collection | A base whose rows are stored in the file itself: the lines after line 1 of a `.base.jsonl` file, or the body of a markdown base. A calendar of events is a collection. | [Bases overview](../bases/overview.md) |
| companion note | The note `<file>.md` that carries the tags and properties of an image or PDF, such as `paper.pdf.md`; it is created on the first edit. | [Frontmatter](../vault/frontmatter.md) |
| config file | `.settings` or a `.yaml` file; it opens as text in the note editor. | [Settings overview](../settings/overview.md) |
| cron | A markdown file in `<vault>/.daemon/crons` that fires a Claude session on a time schedule or when a watched vault file changes. | [Crons and processes](../daemon/crons-and-processes.md) |
| daemon | The background agent runtime: one machine process, started by launchd or systemd, that runs every enabled vault's brain. | [Daemon overview](../daemon/overview.md) |
| deck | A set of flashcards named by a tag suffix: `flashcards/spanish` is the deck `spanish`. | [Flashcards](../flashcards/srs.md) |
| design token | A CSS custom property on `:root` (colour, spacing, type) that is registered with its default and documentation. | [Design tokens](../settings/tokens.md) |
| drawing | A `.draw` file of hand-drawn pages, opened in the drawing editor. | [Drawing](../drawing/overview.md) |
| file tree | The sidebar section that lists the vault's folders and files. | [Vault structure](../vault/structure.md) |
| flashcard | A card written as markdown in a note tagged `flashcards`, or a row of a base drawn with the flashcards layout, scheduled with SM-2. | [Flashcards](../flashcards/srs.md) |
| frontmatter | The YAML block between two `---` lines at the top of a note; its keys are the note's properties. | [Frontmatter](../vault/frontmatter.md) |
| image | A raster or vector image file (png, jpg, svg, heic and the other image formats) that opens in the preview. A PDF is not an image. | [Vault structure](../vault/structure.md) |
| inbox page | A `type: daemon-page` note the daemon writes under `<vault>/.daemon/pages/` to ask you to approve or dismiss something; it is a note, shown inside the daemon page. | [Daemon pages](../daemon/pages.md) |
| kind | Whether a base is a view (rows from a source) or a collection (rows stored in the file). | [Bases overview](../bases/overview.md) |
| layout | How a base draws its rows, set by the base's `view:` key: a row layout or a chart. | [Bases overview](../bases/overview.md) |
| MCP server | The stdio Model Context Protocol server that gives a coding agent the docs and the `bismuth` CLI as tools. | [MCP overview](../mcp/overview.md) |
| memory | The daemon's store of markdown notes under `<vault>/.daemon/memory`, shown in the graph as `mem:` nodes. | [Memory store](../daemon/memory.md) |
| mini graph | The graph docked at the bottom of the sidebar. | [Graph overview](../graph/overview.md) |
| mode | A base's `mode:` key: `normal`, or `tasks`, which draws every row as a task in any layout. | [Bases overview](../bases/overview.md) |
| note | A markdown (`.md`) file in the vault. | [Vault structure](../vault/structure.md) |
| owner token | A random per-launch secret sent as `X-Bismuth-Token` that marks a request as the vault's own app or CLI, exempt from visibility filtering. | [Visibility](../vault/visibility.md) |
| page | What a pane shows when no file sits behind it: the graph, a terminal, a chat, the daemon page, export or feedback. | [Getting started](getting-started.md#step-7-use-tabs-and-split-panes) |
| pane | One region of a tab's split layout; it shows one file or one page under its toolbar. | [Getting started](getting-started.md#step-7-use-tabs-and-split-panes) |
| PDF | A `.pdf` file; it opens in the preview with pages, highlights, bookmarks, an outline and dark mode. | [Drawing](../drawing/overview.md) |
| preview | The read-only surface that opens an image, a PDF, a code file or an unsupported file; images and PDFs can be inked there. | [Drawing](../drawing/overview.md) |
| process | A markdown file in `<vault>/.daemon/processes` that the daemon supervises as a long-lived child process. | [Crons and processes](../daemon/crons-and-processes.md) |
| property | A key in a note's frontmatter; the `properties:` registry in `.settings` can give it a type. | [Frontmatter](../vault/frontmatter.md) |
| query block | A base written inside a note, in a fenced `query` block; it renders in place. | [Query block](../bases/query-block.md) |
| register | A calendar layout's mode: the events register draws events stored in the base, and the tasks register (`mode: tasks`) draws tasks. | [Calendar layout](../bases/views/calendar.md) |
| relay | The Claude Code plugin that reports each terminal session and its subagents to core's in-process registry. | [Terminal and relay](../terminal/overview.md) |
| row layout | A layout that shows every row as an item you can open and edit: `table`, `cards`, `list`, `bullets`, `kanban`, `calendar`, `map` or `flashcards`. | [Bases overview](../bases/overview.md) |
| sheet | A `.sheet` file: a spreadsheet of free-form cells, opened in the spreadsheet editor. It is not a base. | [Sheets](../sheets/overview.md) |
| sidebar | The column holding the sidebar toolbar, the file tree and the mini graph; it sits on the left by default. | [Shell layout](../settings/layout.md) |
| sidecar | A file stored beside the file it describes, named by appending an extension, such as the ink file `photo.png.draw`. | [Drawing](../drawing/overview.md) |
| source | Where a view's rows come from: other notes (`notes`), checkbox lines (`tasks`), or another base (`base`). | [Sources](../bases/sources.md) |
| status bar | The strip along the bottom of the window with readouts such as the inbox count; it can be hidden. | [Shell layout](../settings/layout.md) |
| switcher | The `Mod+O` search takeover: file names, note contents and an AI fallback in one panel; the app's only search surface. | [Getting started](getting-started.md#step-6-find-anything-with-the-switcher) |
| tab | One entry in the tab rail; it holds a tree of one or more panes. | [Getting started](getting-started.md#step-7-use-tabs-and-split-panes) |
| tab rail | The column of open tabs, with its own toolbar; it sits on the right by default and widens on hover. | [Shell layout](../settings/layout.md) |
| tag | A label from the `tags` frontmatter key or an inline `#tag`; each tag is a node in the graph. | [Wikilinks and tags](../vault/wikilinks-tags.md) |
| task | A markdown checkbox line whose dates, priority and recurrence are bracketed fields, such as `[due 2026-09-14]`, or a row of a base in tasks mode. A view whose source is `tasks` lists the checkbox lines; a collection in tasks mode stores its own. | [Task syntax](../tasks/syntax.md) |
| theme | A named set of colour tokens: `ink`, `paper`, `cathode` and `riso` are built in, and a custom theme is a `.themes/<name>.yaml` file. | [Themes](../settings/themes.md) |
| toolbar | The bar on top of a region: every pane, the sidebar, the mini graph and the tab rail has one. A pane's toolbar names what the pane shows and holds its controls. | [Toolbar and commands](../settings/toolbar-commands.md) |
| top strip | The fixed strip across the top of the window with the wordmark and, on macOS, the window buttons. | [Shell layout](../settings/layout.md) |
| unsupported file | A file the preview cannot draw, such as `.psd`; its pane offers to open it in the default app. | [Vault structure](../vault/structure.md) |
| vault | The folder that holds your notes; Bismuth keeps its settings in `.settings` and the daemon's state in `.daemon` inside it. | [Vault structure](../vault/structure.md) |
| view | A base whose rows come from a source: vault notes, checkbox tasks or another base. | [Sources](../bases/sources.md) |
| visibility | A per-note or per-folder setting (`all`, `chat-only`, `hidden`) that keeps a note away from the daemon and in-app chat without limiting you. | [Visibility](../vault/visibility.md) |
| wikilink | A `[[Note Name]]` reference that links to the note by file name, wherever it sits in the vault. | [Wikilinks and tags](../vault/wikilinks-tags.md) |

## How it works

Code keeps its own identifiers; the table maps each term to the name it has in source.

| Term | Name in code |
|---|---|
| layout | the `view:` key; `ViewType` and `VIEW_TYPE_VALUES` (`core/src/bases/types.ts`); `BASE_VIEW_KINDS` (`app/src/baseViews.ts`) |
| view, collection | a base with a `source`, or none and stored rows (`core/src/bases/source.ts`) |
| page | a sentinel content id such as `::graph`, `::term:`, `::chat:`, `::daemon`, `::export:`, `::feedback` (`app/src/tabIds.ts`) |
| toolbar of a pane | `ViewBar` (`app/src/ui/ViewBar.tsx`), or `PaneHeader` when the view draws none; a view returns `ViewBarSlots` |
| toolbar of the sidebar, mini graph, tab rail | `IconBar` with its `band` look; every toolbar renders through `ui/Band` |
| sidebar, tab rail | `Sidebar`, `TabRail` in `app/src/shell/`; settings `layout.sidebarSide`, `layout.tabRailSide` |
| preview, previewed file | `PreviewView`, `PreviewKind` (`image`, `pdf`, `code`, `external`) in `app/src/preview/previewKind.ts` |
| image or PDF | "binary", `isCompanionable` in `core/src/fileKinds.ts` |

Source: `core/src/bases/types.ts`, `app/src/baseViews.ts`, `app/src/tabIds.ts`, `app/src/ui/ViewBar.tsx`, `app/src/preview/previewKind.ts`, `core/src/fileKinds.ts`, `core/src/shellLayout.ts`
