# Status bar and home page

The bottom bar of the window is configured by the `statusBar:` list in `.settings`: built-in readouts, text with live vault counts, query counts, and approved shell commands.
The `homePage:` key names the note a new tab should open; the app does not apply it, so a new tab always opens the knowledge graph (see [Home page](#home-page)).

```yaml
statusBar:
  - builtin: location
  - builtin: connection
  - text: '{notes} notes // {tasks.open} open'
    align: right
  - builtin: inbox
    align: right
  - builtin: daemon
    align: right
```

## Add a file count to the bar

To act on a request like "show how many files are in the vault":

1. Add `{text: 'files: {files}', align: right}` to `statusBar:`, keeping the built-ins you want (see [Change the bar](#change-the-bar)).
2. Check it: `bismuth settings status-bar --vault <vault>` prints `"text": "files: 412"`.
3. Nothing needs approval. Only `run:` (shell) segments do. If you used one, tell the user to click **[ allow ]** in the bar; you cannot approve it for them.

## Change the bar

`statusBar:` is an ordered list. Writing the key replaces the whole list, so include every built-in you want to keep. With no `statusBar:` key the bar is:

```yaml
statusBar:
  - builtin: location
  - builtin: connection
  - builtin: inbox
    align: right
  - builtin: daemon
    align: right
```

Left items render left to right from the left edge, right items from the right edge, each group in list order. To add a file count between inbox and daemon from the shell:

```bash
bismuth settings set statusBar '[{"builtin":"location"},{"builtin":"connection"},{"builtin":"inbox","align":"right"},{"text":"files: {files}","align":"right"},{"builtin":"daemon","align":"right"}]' --vault <vault>
```

To restore the default, delete the `statusBar:` key. A value that is not a list also gives the default. The layout key `layout.statusBar: false` hides the whole bar; see [shell layout](layout.md).

## Item fields

Each item is a `builtin`, a `query`, a `run`, or a bare `text`. `text` may also accompany `query` or `run` as its template. If several are set, `builtin` wins, then `run`, then `query`.
An item with none of them, or with an unknown `builtin`, is dropped silently and the rest of the bar is unaffected. An unknown `tone` or `align` is ignored.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `builtin` | `location`, `connection`, `inbox`, `daemon` | | A built-in readout. |
| `text` | string | | Text with `{tokens}` (below). Alone, it is a template over vault statistics. |
| `query` | `{source, ref?, where?}` | | Count rows from the vault; the number is `{count}`. With no `text`, the bare number shows. |
| `run` | string | | A shell command; its first output line is `{output}`. Needs your approval. |
| `every` | number of seconds | `60`, minimum `5` | How often a `run:` command re-runs. |
| `align` | `left`, `right` | `right`; `location` and `connection` default `left` | Which end of the bar. |
| `tone` | `faint`, `muted`, `fg`, `accent`, `warning`, `danger`, `success`, `teal`, `blue`, `violet`, `green`, `gold`, `rose` | `faint` | Text colour, always a theme token and never a hex. |
| `command` | command id | | Command to run when the segment is clicked. `bismuth app commands` lists ids. |
| `tooltip` | string | | Hover text. |
| `icon` | icon name or emoji | | Shown before the text. |

The built-ins:

| `builtin` | Shows |
|---|---|
| `location` | Path of the focused file. |
| `connection` | A notice, only while the backend is disconnected. |
| `inbox` | Pending daemon pages. |
| `daemon` | Daemon state. |

`query.source` is `notes`, `tasks` or `base`. `query.ref` is a base written as `"[[Name]]"`. With `source: base` it counts what that base shows, after its filters. With `notes` or `tasks` it scopes to the notes the base draws from, before its filters.
`query.where` is a [Bases filter expression](../bases/filters.md). A date compares as a date only through `date(...)` or `today()`: a bare `today` is an unknown name and matches everything.

`command` takes any command id, including `daily-note:<id>`; see [toolbar and commands](toolbar-commands.md).

## Tokens in text

Tokens work in `text:`. `{{` and `}}` are literal braces. An unknown token renders empty, and a segment whose text renders empty takes no space.

| Token | Value |
|---|---|
| `{files}` | Files in the vault. `.settings`, system folders and everything under `.daemon/` are not counted. |
| `{notes}` | Markdown notes. |
| `{folders}` | Folders. System folders and `.daemon/` are not counted. |
| `{tags}` | Distinct tags across notes. |
| `{tasks.open}` | Tasks not done or cancelled. |
| `{tasks.done}` | Completed tasks. |
| `{tasks.due}` | Open tasks due today. |
| `{tasks.overdue}` | Open tasks due before today. |
| `{date}` | Today, `YYYY-MM-DD`. |
| `{count}` | The `query:` row count. Only with `query:`. |
| `{output}` | The command's output line. Only with `run:`. |

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

A failing query or command shows `err` in red, with the message as its tooltip. The rest of the bar is unaffected.

## Show the output of a shell command

A `run:` item runs a shell command in the vault folder and shows the first line it prints.

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

The command runs with `/bin/sh -c`, with the vault as working directory and standard input closed. It is killed after 5 seconds. The segment shows the first non-empty output line, ANSI codes stripped, capped at 120 characters.
If the output is empty and the exit code is non-zero, the first line of error output shows as the error. The result is cached for `every` seconds, so a burst of file changes never re-runs it.

Keep `run:` to one line: no `|` or `>` multi-line block, and chain commands with `;` or `&&`.

On iPad and iOS `run:` segments do not work: the in-process backend answers `shell segments are desktop-only`. Text and query segments work there.

## Approve a shell command

A command from `.settings` never runs on its own, because a cloned or downloaded vault could contain anything. Until you approve it, the bar shows the command (cut at 24 characters) with **[ allow ]**. Click it to see the full command; only that dialog's **allow** approves it.

- Approval is exact. It is per machine, per vault and per command text. Changing one character makes the command untrusted again.
- Approval covers the command text only, not any script it calls. A trusted `./status.sh` runs whatever that file says later.
- Some commands can never be approved. A command containing a line break or a bidirectional-text control character is refused.
- An agent cannot approve for you. AI sessions are refused by the CLI, and so is the raw API route `status-bar/trust`, including disguised paths such as `./status-bar/trust`. Tell the user: "click `[ allow ]` in the bottom bar and confirm."

Approvals are stored in `~/.bismuth/trusted-commands.json` (override the path with `BISMUTH_TRUST_FILE`), as a map from the vault's real path to a list of SHA-256 hashes of approved command texts. To revoke one, delete its hash, or the vault's entry, from that file.

## Verify the bar

```bash
bismuth settings status-bar --vault <vault> --pretty
```

It prints `{ "segments": [...] }`, one entry per kept item with `text` rendered. A `run:` item you have not approved appears with `"untrusted": {"command": "..."}` and empty `text`; the command is not executed. Once approved, the same item prints its output.
A failure appears as `"error"`. Built-ins carry placement only, with empty `text`, because the app draws them.

In a vault that marks any note `hidden` or `chat-only`, AI sessions are refused this preview; ask the user to look at the bar.

## Home page

`homePage:` names the note a new tab should open: Cmd+T, first launch, and closing the last tab. Empty, the default, means the knowledge graph.

The app never receives the key. `GET /settings` skips every top-level value that is not a map, so a stored `homePage` string never reaches the app, and a new tab always opens the knowledge graph. The key is still accepted, linted, and written by `bismuth settings set`:

```bash
bismuth settings set homePage Home.md --vault <vault>
```

A home note holds live content in ` ```query ` blocks like any note (syntax: [query block](../bases/query-block.md)):

````markdown
# Home

## Due today
```query
tasks:
where: date(due) <= today() && !resolved
view: list
```

## Reading
```query
of: [[Reading]]
view: cards
```
````

To clear the key, set `homePage` to `""`.

## How it works

`core/src/statusBarItems.ts` is the item model: the builtin, tone and query-source lists, the default bar, and `normalizeStatusBar`, which drops invalid items, clamps `every` to at least 5, and defaults `align`. The schema imports these lists, so the enums cannot drift.

`core/src/statusBarEval.ts` evaluates items into segments, concurrently and in list order. It never throws; a per-item failure becomes the segment's `error`. File counts and task statistics are computed only when a template references them, and at most once per evaluation.

`core/src/statusBarRun.ts` runs shell items: `/bin/sh -c`, working directory the vault, the server's environment minus `BISMUTH_OWNER_TOKEN` and `VITE_OWNER_TOKEN` plus `BISMUTH_VAULT`, standard input ignored, its own process group so a timeout kills the shell and everything it spawned.
`core/src/statusBarTrust.ts` stores and checks the approval hashes.

The app polls the owner-only `GET /status-bar` every `min(shortest every, 60)` seconds, at least 1, while any `run:` or unapproved segment exists. It also refetches on each server version bump and each `statusBar` change.
An `every: 300` command therefore polls every 60 seconds but runs once per 300; the polls are answered from the runner's cache. An approval appears on the next poll, or at once because the dialog refreshes the feed (`app/src/shell/statusBarFeed.ts`).

`POST /status-bar/trust` is owner-only on the server.
`bismuth api` refuses it, and `doctor` routes, when `BISMUTH_AGENT_CHANNEL` is not the owner or `BISMUTH_MCP_CHANNEL` is set; the route is normalised the way the request URL is, so `./status-bar/trust` and `%2e/status-bar/trust` are caught.
See the [HTTP reference](../api/http-reference.md#post-status-bartrust). The in-process mobile backend treats every command as trusted without running it, and `POST /status-bar/trust` there is `NOT_SUPPORTED`.

`GET /settings` reports `statusBar` overlaid per index onto the default list, so `settings get --key statusBar` can show a different list from the one the bar renders; the bar re-reads the raw file through `normalizeStatusBar`.

`homeContent` in `app/src/homePage.ts` turns `settings.homePage` into the new-tab content. The stored value never reaches the app, so `settings.homePage` is always empty and `homeContent` returns the graph.

Source: `core/src/schema/settingsSchema.ts`, `core/src/settingsSerialize.ts`, `core/src/statusBarItems.ts`, `core/src/statusBarEval.ts`, `core/src/statusBarRun.ts`, `core/src/statusBarTrust.ts`, `core/src/localBackend.ts`, `app/src/shell/statusBarFeed.ts`, `app/src/App.tsx`, `app/src/homePage.ts`, `cli/src/commands/api.ts`, `cli/src/commands/settings.ts`
