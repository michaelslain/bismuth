# Status Bar & Home Page

The bottom bar is configured by the `statusBar:` key in `.settings`; the note a new tab opens is `homePage:`. This page is written so you can act on a request like *"make the bottom bar show how many files are in the vault"* without reading anything else.

**The fast path** (file count example):

1. Add `{text: 'files: {files}', align: right}` to `statusBar:`, keeping the existing built-ins (see [Changing the bar](#changing-the-bar)).
2. Check it: `bismuth settings status-bar --vault <vault>` prints `"text": "files: 412"`.
3. Nothing needs approving — only `run:` (shell) segments do. If you used one, **tell the user to click `[ allow ]` in the bar**; you cannot approve it for them.

---

## Changing the bar

`statusBar:` is an ordered list. **Writing the key replaces the whole list**, so include every built-in you want to keep. The default (what you get with no `statusBar:` key) is:

```yaml
statusBar:
  - builtin: location
  - builtin: connection
  - builtin: inbox
    align: right
  - builtin: daemon
    align: right
```

Add a file count to the right side, between inbox and daemon:

```bash
bismuth settings set statusBar '[{"builtin":"location"},{"builtin":"connection"},{"builtin":"inbox","align":"right"},{"text":"files: {files}","align":"right"},{"builtin":"daemon","align":"right"}]' --vault <vault>
```

Or edit `.settings` directly (it is a YAML file). Left items render left-to-right from the left edge, right items from the right edge, each group in list order.

**Restore the default:** delete the `statusBar:` key. A value that is not a list also falls back to the default.

## Item fields

Each item is a `builtin`, a `query`, a `run`, or a bare `text`; `text` may also accompany `query`/`run` as its template. If several are set, `builtin` wins, then `run`, then `query`. An item with none of them, or with an unknown `builtin`, is silently dropped (the rest of the bar is unaffected). Unknown `tone`/`align` values are ignored.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `builtin` | `location` \| `connection` \| `inbox` \| `daemon` | — | A built-in readout. `location` = path of the focused file; `connection` = shown only while the backend is disconnected; `inbox` = pending daemon pages; `daemon` = daemon state. |
| `text` | string | — | Text with `{tokens}` (below). Alone, it is a template over vault statistics. |
| `query` | `{source, ref?, where?}` | — | Count rows from the vault; the number is `{count}`. With no `text`, the bare number is shown. |
| `run` | string | — | A shell command; its first output line is `{output}`. Needs the owner's approval — see [Shell commands](#shell-commands-run). |
| `every` | number (seconds) | `60` (minimum `5`) | How often a `run:` command re-runs. |
| `align` | `left` \| `right` | `right` (`location` and `connection`: `left`) | Which end of the bar. |
| `tone` | `faint` `muted` `fg` `accent` `warning` `danger` `success` `teal` `blue` `violet` `green` `gold` `rose` | `faint` | Text colour (a theme token, never a hex). |
| `command` | a command id (e.g. `daily-note:journal`) | — | Run when the segment is clicked. List ids with `bismuth app commands`. |
| `tooltip` | string | — | Hover text. |
| `icon` | Lucide icon name or emoji | — | Shown before the text. |

`query.source` is `notes`, `tasks` or `base`. `query.ref` is a base as `"[[Name]]"` (for `source: base` it counts what that base shows, after its filters; for `notes`/`tasks` it scopes to the notes the base draws from, before its filters). `query.where` is a [Bases filter expression](../bases/filters.md). Dates compare as dates only through `date(...)`/`today()`; a bare `today` is an unknown name and matches everything.

## Tokens

Used in `text:`. `{{` and `}}` are literal braces. An unknown token renders as empty.

| Token | Value |
|---|---|
| `{files}` | Files in the vault (the `.settings` file is not counted) |
| `{notes}` | Markdown notes |
| `{folders}` | Folders |
| `{tags}` | Distinct tags across notes |
| `{tasks.open}` | Tasks not done or cancelled |
| `{tasks.done}` | Completed tasks |
| `{tasks.due}` | Open tasks due today |
| `{tasks.overdue}` | Open tasks due before today |
| `{date}` | Today, `YYYY-MM-DD` |
| `{count}` | The `query:` row count (only with `query:`) |
| `{output}` | The command's output line (only with `run:`) |

A segment whose text renders empty takes no space in the bar.

## Examples

```yaml
statusBar:
  - builtin: location
  - builtin: connection
  # token text
  - text: '{notes} notes // {tasks.open} open'
    align: right
  # open tasks due today or overdue, in gold
  - query: {source: tasks, where: 'date(due) <= today() && !resolved'}
    text: '{count} due'
    tone: gold
    align: right
  # size of a reading list base
  - query: {source: base, ref: '[[Reading]]'}
    text: '{count} to read'
    align: right
  # clicking it opens today's journal
  - text: 'journal'
    command: daily-note:journal
    tooltip: open today's journal
    align: right
  - builtin: inbox
    align: right
  - builtin: daemon
    align: right
```

## Shell commands (`run:`)

```yaml
  - run: git -C . branch --show-current
    icon: GitBranch
    every: 30
    align: right
  - run: find . -name '*.md' -not -path './.*' -print0 | xargs -0 cat | wc -w
    text: '{output} words'
    every: 300
    align: right
```

How it runs: `/bin/sh -c <command>` with the vault as the working directory; the environment is the server's minus the owner token (`BISMUTH_OWNER_TOKEN`, `VITE_OWNER_TOKEN`), plus `BISMUTH_VAULT`; stdin is closed. Items refresh concurrently. Killed after **5 seconds**. The segment shows the **first non-empty stdout line**, ANSI codes stripped, capped at **120 characters** (if stdout is empty and the exit code is non-zero, the first stderr line is shown as the error). The result is cached for `every` seconds, so a burst of file changes never re-spawns it.

**Trust model.** A command from `.settings` never runs on its own, because a cloned or downloaded vault could contain anything. Until the user approves it, the bar shows the command (truncated at 24 characters) with **`[ allow ]`**. Clicking it opens a dialog showing the full command; only that dialog's **allow** approves it. Approval is per machine and per vault, against the exact command text: changing one character makes it untrusted again. It covers only the text of the command, not any script that command calls, so a trusted `./status.sh` runs whatever that file says later. A command containing a line break or a bidi control character can never be approved, so keep `run:` to one line: no `|`/`>` multi-line block, use `;` or `&&` to chain. You must not approve it yourself (AI sessions are refused by the CLI; a terminal session must still leave it to the user); tell the user: *"click `[ allow ]` in the bottom bar and confirm."*

A failing query or command shows `err` in red with the message as its tooltip; the rest of the bar is unaffected.

## Verify

```bash
bismuth settings status-bar --vault <vault> --pretty
```

In a vault that marks any note `hidden` or `chat-only`, AI sessions are refused this preview; ask the user to look at the bar.

Prints `{ "segments": [...] }` — one entry per kept item, with `text` rendered. A `run:` item the user has not approved appears as `"untrusted": {"command": "..."}` with empty `text` (the command is **not** executed); once approved, the same command prints its output. A failure appears as `"error"`. Builtins carry placement only (`text` is empty; the app draws them). The same data is served to the app by the owner-only `GET /status-bar`.

## Home page

`homePage:` is the note a new tab opens: **Cmd+T**, first launch, and closing the last tab. **Empty (the default) = the knowledge graph.**

```bash
bismuth settings set homePage Home.md --vault <vault>
```

Write the note like any other. Put live content in ` ```query ` blocks (syntax: [query block](../bases/query-block.md)):

````markdown
# Home

## Due today
```query
tasks:
where: date(due) <= today() && !resolved
as: list
```

## Reading
```query
of: [[Reading]]
as: cards
```
````

To go back to the graph, set `homePage` to `""`.
