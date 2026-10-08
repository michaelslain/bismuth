# Bismuth CLI reference

`bismuth` is the shell interface to a vault: read and write notes, query and edit Bases, manage calendars, tasks and flashcards, run the daemon, and drive an open app window. It suits scripts, agents, and working without the app.

Commands that touch files run headlessly against the vault directory, and a running app's file watcher picks the writes up live.
A few commands call a running server instead; [Which commands need a running server](#which-commands-need-a-running-server) lists them.
For where the CLI sits among the workspaces, see [architecture](../overview/architecture.md).

```bash
export BISMUTH_VAULT=~/vault
bismuth search "neural net" --pretty
bismuth task toggle "Projects/Todo.md" 12
bismuth calendar add Calendar.md --date 2026-11-02 --title "Dentist" --start 09:00 --end 10:00
```

## Set the vault and other global flags

Most commands need a vault. The vault comes from `--vault <dir>`, then the `BISMUTH_VAULT` environment variable. With neither, the command exits `1` with `error: no vault — pass --vault <dir> or set BISMUTH_VAULT`.

| Flag or variable | Applies to | Effect |
|---|---|---|
| `--vault <dir>` | nearly every command | Vault directory. Wins over `BISMUTH_VAULT`. |
| `BISMUTH_VAULT` | nearly every command | Vault directory when `--vault` is absent. |
| `--memory <dir>` | `graph`, `serve` | Memory (3rd brain) directory. Falls back to `BISMUTH_MEMORY`. The `memory` commands take `--memory` too but fall back to `BISMUTH_MEMORY_DIR`. |
| `--pretty` | every command that prints JSON | Indents JSON with two spaces. |
| `--api <url>` | server commands | Base URL of a running server. See [Which commands need a running server](#which-commands-need-a-running-server). |
| `--json` | `backends`, `backends setup-free`, `doctor` | Prints JSON instead of a readable report. |
| `--json '<body>'` | `api`, `row add`, `row update`, `calendar` writes | A JSON object value for the command's body. A different flag from the one above. |
| `BISMUTH_DAEMON_DIR` | `daemon` | Machine-level daemon directory. Default `~/.bismuth/daemon`. Per-vault crons and processes live under `<vault>/.daemon` and are addressed with `--vault`. |
| `BISMUTH_MEMORY_DIR` | `memory` | Memory directory when `--memory` is absent. The app's terminal tabs set it. |
| `BISMUTH_DOCS_DIR` | `docs` | Directory of doc pages to read. Falls back to the repo's `docs/`, then `~/.bismuth/docs`. |
| `BISMUTH_INSTALL_SRC` | `install` | Source directory when `--src` is absent. |

`bismuth`, `bismuth --help` and `bismuth help` print every command with its summary. `bismuth help <word>` and `bismuth <word> --help` print only the commands that start with that word, such as `bismuth task --help`. An unknown command prints `unknown command: …` plus the full list and exits `1`.

## Which commands need a running server

These commands call a running core server (the app, or `bismuth serve`) and fail with `could not reach a running Bismuth server at <url>` when none answers. Every other command works on files alone.

| Commands | Why a server |
|---|---|
| `api` | Calls any route. |
| `app windows`, `app tabs`, `app open`, `app close`, `app focus`, `app rename`, `app pin`, `app reorder`, `app run` | Drive a window through the server's `/ui/*` channel. `app commands` is the exception: it prints a list and needs nothing. |
| `chat list`, `chat read`, `chat search` | Read chat history through owner-only routes. |
| `gcal status`, `gcal connect`, `gcal sync`, `gcal disconnect` | The OAuth and sync lifecycle lives in the server. `gcal targets` and `gcal health` are headless. |
| `relay list` | The relay registry is in-memory in the server process. |
| `update status`, `update apply` | Self-update runs in the server. |

The server address resolves in this order:

1. `--api <url>`
2. `BISMUTH_API`
3. `CLAUDE_RELAY_URL` (set inside the app's terminal tabs)
4. The run registry in `~/.bismuth/run`, matched by `--vault` or `BISMUTH_VAULT`, else the single running core
5. `http://localhost:4321`

A non-2xx reply fails with `<METHOD> <path> → <status>: <message>`, using the reply's `error` text when it has one.

## Understand owner identity on server commands

A server command presents itself as the vault owner when it can. It attaches an `X-Bismuth-Token` header holding the running core's per-boot secret, read from the core's run record in `~/.bismuth/run` (mode `0600`).

The token attaches only when the target host is loopback (`localhost`, `127.0.0.1`, `::1`) and a run record with the same port carries a token.
In every other case the CLI sends no header, and the server answers as it would to a plain `curl`: owner-only routes return `403` and `relay list` returns the redacted snapshot.

Attaching the token does not check who is asking. The line between a person's shell and a Bismuth-spawned agent is the `BISMUTH_AGENT_CHANNEL` variable plus an OS-sandbox deny-read on the run record, covered in [visibility](../vault/visibility.md).

## Read the output

Every command prints through one helper.

| The command returns | Printed |
|---|---|
| Nothing | Nothing. |
| A string | The string as-is, such as `ok` or `wrote out.pdf`. |
| An object or array | One line of JSON, or two-space indented with `--pretty`. |

Errors print `error: <message>` to stderr and exit `1`. `base validate`, `theme validate`, `daemon stop`, `daemon restart` and `backends setup-free` also exit `1` when their result reports failure, after printing it.

## Use the CLI as an AI agent

A process is an agent when `BISMUTH_AGENT_CHANNEL` is set to a non-empty value (`chat`, or anything else, which counts as `daemon`) or `BISMUTH_MCP_CHANNEL` is set. Bismuth sets these when it spawns an agent or the MCP server. A person's own shell sets neither and is never filtered.

Channel `chat` hides notes marked `hidden`; channel `daemon` hides `hidden` and `chat-only`. The CLI sorts commands into four tiers when the vault restricts anything:

| Tier | Commands | Behaviour |
|---|---|---|
| Always allowed | `backends`, `backup`, `daemon`, `docs`, `doctor`, `folder-icon`, `install`, `memory`, `page`, `uninstall`, `app`, `settings get`, `settings schema`, `settings deny-list`, `checkpoint advance`, `checkpoint ref` | Cannot print a note body. |
| Path-scoped | `read`, `write`, `move`, `delete`, `restore`, `mkdir`, `prop`, `render` | Refused when an argument names a restricted note or folder. |
| Filtered | `tree`, `templates`, `graph`, `search`, `replace`, `rows`, `row`, `base`, `task`, `card`, `calendar`, `gcal`, `relay`, `note`, `daily` | Run, with restricted notes dropped before any count, group or summary. |
| Refused | `api`, `serve`, `export`, `chat`, `update`, `checkpoint diff`, `settings set`, `settings status-bar`, `folder-visibility`, any unlisted command | Exit non-zero with a reason. |

Three rules apply on top of the tiers:

- The vault's `.settings` file, `settings.yaml` and `.daemon/processes` are off-limits to every path-taking command for an agent, even in a vault that restricts nothing.
- When visibility cannot be determined, such as an unparseable `.settings`, a command exits non-zero with no output instead of printing unfiltered results.
- A path argument naming a restricted note is refused with `Refused: "<path>" is marked off-limits…`.

The full model and the reason for each tier are in [visibility](../vault/visibility.md).

## Avoid argument-parsing traps

The shared parser is simple, and a few cases fail silently.

- A value flag takes the next token, or the text after `=`: `--q=a=b` gives `a=b`. A bare value flag in last position has no value and is treated as absent. If a flag appears in both spellings, the first wins.
- A boolean flag is true only as the exact token `--name`. `--pretty=1` is not true.
- Positional parsing skips the token after any `--flag` unless that token starts with `--`.
  Put boolean flags last, or use the listed boolean flags (`--pretty`, `--off`, `--clear`, `--regex`, `--case`, `--word`, `--dry-run`, `--no-template`, `--no-snapshot`, `--no-frontmatter`, `--no-commit`, `--new-tab`, `--markdown-syntax`, `--installed`, `--pdf`), which never swallow a positional.
- Values are not type-coerced. `prop set` and `settings set` parse the value as JSON and fall back to the raw string, so `true` becomes a boolean and `"true"` a string. Quote values containing spaces or shell characters.

## api

Calls any server route and prints the reply. The method is upper-cased. JSON replies print as JSON and anything else prints as text. It needs a running server.

| Command | Arguments and flags | What it does |
|---|---|---|
| `api` | `<GET\|POST\|PUT> <path> [--json '<body>'] [--api <url>]` | Sends the request. `--json` is parsed first, so malformed JSON fails before any request is made. |

An agent may only `GET`.
An agent is also refused any path under `status-bar/trust` (approving a status-bar command is the owner's decision), `doctor` and `doctor/…` (repairs go through `bismuth doctor`), and any path naming a protected file.
The path is normalised the way the request URL is, so `./doctor/fix`, `%2e/doctor` and `a/../doctor` are caught.
The routes themselves are in the [HTTP reference](../api/http-reference.md).

## app

Drives the tabs of a running app window.
These commands need a running app; `--window <id>` targets one window.
Without it the single open window is used, and a request with no window or several windows fails with the server's `404` or `409` message.
Run `app windows` for window ids and `app tabs` for tab ids.

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `app windows` | `[--api <url>]` | Lists open windows: id, label, active tab, tab count. | yes |
| `app tabs` | `[--window <id>]` | Lists the open tabs and panes in a window. | yes |
| `app open` | `<content> [--new-tab] [--window <id>]` | Opens a note path or a sentinel (`::graph`, `::daemon`, `.settings`, `::term:<uuid>`). | yes |
| `app close` | `<tabId> [--window <id>]` | Closes a tab. | yes |
| `app focus` | `<tabId> [--window <id>]` | Activates a tab. | yes |
| `app rename` | `<tabId> <name> [--window <id>]` | Sets a custom tab label. | yes |
| `app pin` | `<tabId> [--off] [--window <id>]` | Pins a tab to the start of the strip. `--off` unpins. | yes |
| `app reorder` | `<tabId> <index> [--window <id>]` | Moves a tab to a 0-based position. | yes |
| `app run` | `<commandId> [--window <id>]` | Runs a UI command by id. Chat and heavyweight commands are blocked. | yes |
| `app commands` | none | Lists the ids `app run` accepts. | no |

The same commands are reachable from the MCP server, covered in [app control](../mcp/app-control.md).

## backends

Reports which agent CLIs are installed on this machine and which surfaces each supports (chat, terminal, relay, daemon, MCP, memory, local models). It never runs an agent turn, authenticates, or writes config.

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `backends` | `[--json] [--installed]` | Prints a table, or JSON with `--json`. `--installed` hides backends that are not installed. | no |
| `backends setup-free` | `[--json]` | Downloads opencode into `~/.bismuth/agents/bin` so chat can run on free models without an account. Verifies the download against the release's sha256 digest and exits `1` on failure. | no |

Registering Bismuth's MCP server with an agent CLI is `install --mcp`, not a backends command. The backend catalog is in [backends](../chat/backends.md).

## base, row and rows

Reads, validates and edits Bases, and resolves a source to rows. A base is a `type: base` note; the file format is in [bases overview](../bases/overview.md).

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `base create` | `<path> --view <kind> [--source <spec>] [--group-by <property>] [--lat <property>] [--lng <property>] [--x <property>]` | Creates a base with one view. `.md` is appended when missing. Fails if the path exists. | no |
| `base read` | `<path>` | Prints the parsed config and the table rows. | no |
| `base validate` | `<path>` | Checks view kind, property defaults, sources, filters, formulas and stat expressions. Prints `{ok, errors}` and exits `1` when `ok` is false. | no |
| `base render` | `<path>` | Resolves the rows and runs the view's grouping, sorting and summaries. Chart kinds (`bar`, `line`, `stat`, `heatmap`) return a computed series. | no |
| `base migrate-queries` | `[--dry-run]` | Rewrites `query` blocks whose `tasks:` holds Tasks-query text into `tasks:` plus `where:` and `sort:`. | no |
| `rows` | `[--of '[[Base]]' \| --where EXPR \| --tasks EXPR]` | Resolves one source to rows. Without a selector it returns every note. | no |
| `row add` | `<basePath> --json '{...}'` | Appends a row to the base's table. | no |
| `row update` | `<basePath> <index> --json '{...}'` | Replaces the row at a 0-based index. | no |
| `row delete` | `<basePath> <index>` | Removes the row at an index. | no |
| `row reorder` | `<basePath> <from> <to>` | Moves a row between indices. | no |

`base create` writes a blank value and lists the key under `missing` when its view needs configuration it was not given: `kanban` needs `--group-by`, `map` needs `--lat` and `--lng`, and `bar`, `line`, `stat` and `heatmap` need `--x`. `source` defaults to `notes`.

`base validate` reads the raw frontmatter, because the normal parser silently turns an unknown `view:` into `table`. It also reports a YAML comment that truncated a value (`#` after a space starts a comment inside a plain scalar) and a base that lists more than one view.

A hidden `--of` base answers like a missing one: no rows, no refusal. `base migrate-queries` and `--dry-run` print `{changed, files, unconvertible, degraded, skipped}`; blocks that already carry their own `where:` or `sort:` are left alone and counted under `unconvertible`.

## calendar

Edits a calendar base (`type: base`, `view: calendar`) without hand-editing YAML. Every write keeps the whole frontmatter and changes only events and categories. Event and recurrence fields are described in the [calendar overview](../calendar/overview.md).

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `calendar bases` | none | Lists calendar bases: path, title, event count, category names. | no |
| `calendar create` | `<basePath> [--title '...']` | Creates an empty calendar. Fails if the path exists. | no |
| `calendar list` | `<basePath> [--from YYYY-MM-DD --to YYYY-MM-DD]` | Lists stored events, recurring masters unexpanded, with real ids. | no |
| `calendar range` | `<basePath> <from> <to>` | Lists concrete instances in a date range, recurrences expanded. | no |
| `calendar day` | `<basePath> <date>` | Lists one day's instances. | no |
| `calendar get` | `<basePath> <id>` | Prints one event as stored. | no |
| `calendar search` | `<basePath> <text> [--from … --to …]` | Searches title, description, location and category. With both dates it searches expanded instances. | no |
| `calendar overlaps` | `<basePath> <date>` | Finds overlapping timed events on a day. | no |
| `calendar add` | `<basePath> --date YYYY-MM-DD --title '...' [--start HH:MM --end HH:MM] [--location] [--link] [--description] [--category] [--recurrence '{...}'] [--rrule '...'] [--json '{...}']` | Adds an event. Flags override `--json` fields. | no |
| `calendar move` | `<basePath> <id> [--date …] [--start …] [--end …] [other event flags]` | Edits an event's fields. Fails when nothing is given. | no |
| `calendar delete` | `<basePath> <id>` | Deletes an event. | no |
| `calendar override` | `<basePath> <id> <date> [--title] [--start] [--end] [--json '{...}']` | Changes one occurrence of a recurring event. | no |
| `calendar delete-occurrence` | `<basePath> <id> <date>` | Removes one occurrence of a recurring event. | no |
| `calendar categories` | `<basePath>` | Lists categories as `{name, color}`. | no |
| `calendar category add` | `<basePath> <name> [--color <c>]` | Adds a category. `--color` is any CSS colour or a theme token; default `accent`. | no |
| `calendar category update` | `<basePath> <name> [--rename <new>] [--color <c>]` | Renames (updating events) and recolours. | no |
| `calendar category remove` | `<basePath> <name> [--reassign <other>]` | Removes a category, clearing it from events or moving them to `--reassign`. | no |

`calendar add` requires `--date`.
`--rrule` takes an iCal RRULE such as `FREQ=WEEKLY;BYDAY=MO`; `--recurrence` (a JSON object) wins when both are given.
When the date falls on a weekday the rule excludes, the event's date moves to the first matching day.
A recurrence without a `seriesId` gets a generated one.

`calendar override` and `calendar delete-occurrence` split the series around the date. A `--date` flag on `override` is ignored, because the date is positional.

## card

Lists and reviews flashcards. Syntax, scheduling and the `flashcards` tag requirement are in [flashcards](../flashcards/srs.md).

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `card all` | none | Lists every card parsed from the vault. | no |
| `card decks` | none | Lists decks with total and due counts. | no |
| `card due` | `[--deck <name>]` | Lists cards due today, optionally for one deck. | no |
| `card note` | `<path>` | Lists the cards in one note regardless of due date. | no |
| `card review` | `<id> <response>` | Reviews a markdown card. `<id>` is `notePath::cardIndex::subIndex`; `<response>` is `hard`, `good` or `easy`. | no |
| `card review` | `--file <base> --index <n> --response <hard\|good\|easy> [--dueField <c> --easeField <c> --intervalField <c>]` | Reviews a base row and rewrites its scheduling columns. | no |

The row form activates when both `--file` and `--index` are present. The three field flags apply only when all three are given; otherwise the default column names are used.

## chat

Reads the owner's chat history (terminal and in-app sessions). The three routes are owner-only, so these commands rely on the [owner token](#understand-owner-identity-on-server-commands) and need a running server. A plain `curl` gets `403`.

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `chat list` | `[--scope user\|daemon\|all]` | Lists past sessions. | yes |
| `chat read` | `<id> [--provider <p>]` | Replays one session's messages. | yes |
| `chat search` | `<query> [--scope user\|daemon\|all]` | Searches sessions by content. | yes |

An agent is refused `chat` whenever the vault restricts anything.

## checkpoint

Bookmarks how far a periodic job has processed a git repository, using a ref named `refs/bismuth/<ref>`. The daemon's crons use it to handle only what changed since their last run.

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `checkpoint diff` | `<ref> --dir <path> [--no-commit]` | Lists files changed since the checkpoint. | no |
| `checkpoint advance` | `<ref> --dir <path> [--no-commit]` | Moves the checkpoint to HEAD and prints `{ref, head}`. | no |
| `checkpoint ref` | `<ref> --dir <path>` | Prints `{ref, sha}`; `sha` is `null` when unset. | no |

The repository is `--dir`, else `--vault`, else `BISMUTH_VAULT`.
`diff` and `advance` first commit pending changes with a `checkpoint snapshot` message so the result reflects what is on disk; `--no-commit` skips that.
`checkpoint diff` is the only subcommand an agent is refused in a restricted vault, because it prints a raw diff.

## daemon

Manages the daemon, the machine process behind crons, background processes and the 3rd brain.
Machine-level commands read `~/.bismuth/daemon` (or `BISMUTH_DAEMON_DIR`) and need no vault.
Commands that touch crons, processes, logs or the graph need `--vault`, because those live in `<vault>/.daemon`.
Setup is in [daemon setup](../daemon/setup.md) and the file formats in [crons and processes](../daemon/crons-and-processes.md).

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `daemon status` | none | Prints liveness, this device's id and the current owner. | no |
| `daemon devices` | none | Lists heartbeating devices, flagging the owner and this device. | no |
| `daemon owner` | `[<deviceId>]` | Prints the owner device, or claims `<deviceId>` as owner. | no |
| `daemon install` | none | Prints install status. Read-only. | no |
| `daemon setup` | none | Runs the idempotent, adopt-only setup and prints the result. | no |
| `daemon update` | none | Same body as `setup`: re-registers the bundled service. | no |
| `daemon stop` | none | Unloads the service (`launchctl unload`, or `systemctl stop` plus `disable`). It does not restart on its own. Exits `1` on failure. | no |
| `daemon restart` | none | Restarts the service in place without rewriting its config. Exits `1` on failure. | no |
| `daemon graph` | `--vault <dir>` | Prints the vault's daemon graph (daemon hub, crons, processes). | no |
| `daemon logs` | `--vault <dir> [--limit n] [--kind cron\|process\|daemon\|session] [--name <name>] [--since <iso>]` | Prints the activity log, newest first. | no |
| `daemon cron create` | `<name...> --vault <dir>` | Creates a cron from a template, disabled. | no |
| `daemon cron delete` | `<name...> --vault <dir>` | Deletes a cron definition. | no |
| `daemon cron toggle` | `<name> --vault <dir> [--off]` | Sets the cron's `enabled` frontmatter. | no |
| `daemon cron run` | `<name> --vault <dir>` | Asks the daemon to run the cron now. | no |
| `daemon process create` | `<name...> --vault <dir>` | Creates a background process from a template, disabled. | no |
| `daemon process delete` | `<name...> --vault <dir>` | Deletes a process definition. | no |
| `daemon process toggle` | `<name> --vault <dir> [--off]` | Sets the process's `enabled` frontmatter. | no |

`create` and `delete` join all positionals into the name, so a multi-word name needs no quotes. The name is a display name; the file is its slug. `create` refuses an empty slug and an existing file.

`cron run` drops a trigger file the daemon polls, so it succeeds (prints `ok`) even when the daemon is not running, and nothing happens until it is. `cron delete` refuses a cron the daemon has recorded as running.

`daemon stop` and `daemon restart` call the daemon's service control directly, so they need no server. An agent may run the whole `daemon` group.

## docs

Reads Bismuth's own documentation, the same pages the MCP docs tools serve. The docs directory is `BISMUTH_DOCS_DIR`, else the repo's `docs/`, else `~/.bismuth/docs`.

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `docs list` | none | Lists every page as `{path, title}`. Start here. | no |
| `docs search` | `<query…> [--limit <n>]` | Prints ranked `{path, heading, snippet}` hits. | no |
| `docs read` | `<path> [--section <heading>]` | Prints one page raw, or one `##` section. | no |

## doctor

Checks the machine and, when a vault is given, the vault for leftovers from older builds, version skew and pending migrations. The MCP tool `bismuth_doctor` runs this same command. Findings and fixes are described in [doctor](../overview/doctor.md).

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `doctor` | `[--fix] [--safe-only] [--only <id>[,<id>…]] [--section <id>[,<id>…]] [--vault <path>] [--json]` | Prints a report, or JSON with `--json`. `--fix` applies repairs. | no |

`--section` limits the run to the sections `legacy`, `install`, `daemon`, `runtime`, `vault` and `backends`. `--only` limits repairs to finding ids. `--safe-only` skips destructive repairs.

An agent always runs with safe repairs only, and the `vault` section is dropped in a vault that hides anything, because its finding ids carry note paths. The report ends with `agent mode // destructive repairs need the owner` when repairs were held back.

## export and render

Turns a note, base, sheet or drawing into a file. Everything is headless. PDF and PNG of notes, bases and sheets drive a headless Chrome against the same HTML the app's exporter produces.

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `export` | `<file> [--format md\|html\|png\|pdf\|csv] [--out FILE] [--mode data\|visual] [--cal-start YYYY-MM-DD] [--cal-span month\|week\|3day\|day] [--no-frontmatter] [--markdown-syntax] [--theme dark\|light] [--vault <dir>]` | Exports a file and prints `wrote <path>`. | no |
| `render` | `<file.draw> [--pdf] [--out FILE] [--theme dark\|light]` | Renders a drawing to PNG, or PDF with `--pdf`. | no |

`--format` defaults to `md`, or `png` for a `.draw` file. A `.draw` file exports only to `png` or `pdf` and needs no vault. `--theme` defaults to `dark`; any other value fails. `--out` defaults to a name derived from the input (`<file>.png` or `<file>.pdf` for drawings).

`--mode`, `--cal-start` and `--cal-span` apply to bases.
`--no-frontmatter` drops the frontmatter from the output, and `--markdown-syntax` keeps Markdown markers in it.
Prose leading, code scale and fonts follow the vault's `editor.lineHeight` and `appearance` settings; colours use the built-in palette for the chosen theme, because no live theme is available headlessly.

`export` is refused for an agent in a restricted vault. `render` is path-scoped.

## File commands

Creates, reads, moves and trashes vault entries. All need a vault.

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `read` | `<path>` | Prints a note's raw contents. | no |
| `write` | `<path> [--content <text>]` | Writes a note from `--content`, or from stdin when omitted. Prints `{"ok":true}`. | no |
| `move` | `<from> <to>` | Moves or renames an entry. | no |
| `delete` | `<path>` | Moves an entry to the trash and prints `{trashPath}`. | no |
| `restore` | `<trashPath> <to>` | Moves a trashed entry to a destination. | no |
| `mkdir` | `<path>` | Creates a directory. | no |
| `tree` | none | Prints the vault file tree as JSON. | no |

`write` reads stdin whenever `--content` is absent, so a call with neither blocks waiting for input. For an agent, `tree` omits hidden files and any hidden folder that holds no visible file.

## gcal

Syncs calendar bases with Google Calendar. The model, sign-in and conflict handling are in [Google Calendar sync](../gcal/overview.md).

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `gcal status` | `[--api <url>]` | Prints whether Google is connected, whether credentials are missing, the account and the timezone. | yes |
| `gcal connect` | `[--client-id <id> --client-secret <secret>] [--api <url>]` | Stores the credentials when given, starts OAuth, and prints the consent URL. | yes |
| `gcal sync` | `<basePath> [--api <url>]` | Runs a two-way sync of one base and prints the pulled, pushed, deleted and conflict counts. | yes |
| `gcal disconnect` | `[--api <url>]` | Revokes the token and wipes local sync state. Event links are not recoverable. | yes |
| `gcal targets` | none | Lists calendar bases with Google sync enabled, using the scan the auto-sync ticker runs. | no |
| `gcal health` | `--vault <dir> [<basePath>]` | Prints each base's calendar id, last sync time, linked-event count and whether a sync token is held. | no |

A person finishes `gcal connect` in a browser; the CLI cannot complete OAuth. Re-run `gcal status` afterwards. Passing only one of `--client-id` and `--client-secret` fails.

`gcal connect`, `gcal sync` and `gcal disconnect` are refused with `403` unless the core is the installed app or has `BISMUTH_GCAL_AUTOSYNC=1`, because the Google connection on a machine belongs to the real app and a core on a vault copy would otherwise sync the copy against the real calendar.
`gcal status` is always allowed.

`gcal health` reads `~/.bismuth/gcal/sync.json`, which lives outside the vault.
With no `<basePath>` it lists only bases recorded for this vault.
An entry from before sync records were keyed by vault has no vault association and shows only when you name its exact path, marked `legacy: true`.
Per-sync conflict counts are not stored; read them from `gcal sync` output.

An agent must pass `--vault` to `gcal sync`, and a hidden base is refused.

## graph

Builds the knowledge graph and prints it as JSON.

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `graph` | `[--vault <dir>] [--memory <dir>]` | Prints nodes and edges for the vault, plus the memory graph when `--memory` is given. | no |

For an agent, hidden notes disappear with their edges, tags used only by them, and community labels taken from their titles. An agent's `--memory` must be exactly `<vault>/.daemon/memory`; any other directory is refused because only that one can be visibility-checked.

## install and uninstall

Installs or removes the CLI and MCP server machine-wide. Neither touches the vault. The packaged app installs the CLI and MCP server itself on launch; see [install](../overview/install.md).

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `install` | `[--src <dir>] [--status] [--dry-run] [--mcp <cli>[,<cli>…]\|all]` | Installs from `--src` or `BISMUTH_INSTALL_SRC`. Idempotent, and a no-op when binaries are unchanged. | no |
| `uninstall` | none | Removes the CLI symlink, the global MCP registration and `~/.bismuth`. | no |

`--status` prints the install state, including other agent CLIs detected on the machine. `--mcp` registers Bismuth's MCP server with the named agent CLIs (`all` for every detected one); it takes precedence over the other flags and is always opt-in.

## memory

Saves, searches and removes notes in the vault's memory graph (the 3rd brain). The MCP server exposes the same operations as `remember`, `recall` and `forget`; see [daemon tools](../mcp/daemon-tools.md).

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `memory remember` | `--name <n> --content <md> [--type <t>] [--tags a,b] [--folder <f>] [--description <text>] [--memory <dir>] [--vault <dir>]` | Saves a note. Overwrites any note with the same name. | no |
| `memory recall` | `<query…> [--folder <f>] [--memory <dir>] [--vault <dir>]` | Searches the graph. Queries accept `tag:`, `type:`, `keyword:`, `link:`, `after:` and `before:` filters. | no |
| `memory forget` | `<name> [--memory <dir>] [--vault <dir>]` | Removes a note. The name may be folder-prefixed. | no |

The memory directory is `--memory`, else `BISMUTH_MEMORY_DIR` (set inside the app's terminal tabs), else `<vault>/.daemon/memory`. That last fallback applies only when the vault has the daemon enabled; otherwise the command fails with the same message the MCP server gives.

For an agent, `--memory` must be the vault's own `.daemon/memory`, and notes inside hidden folders are refused or left out of recall.

## note

Creates notes from templates and opens daily notes.

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `note new` | `<path> [--template NAME] [--template-folder DIR] [--no-template]` | Creates a note and prints `{path, created: true}`. `.md` is appended when missing. | no |
| `templates` | `[--template-folder DIR]` | Lists the note templates. | no |
| `daily` | `[--id <id\|n>]` | Opens today's daily note, creating it when missing. Prints `{path, created}`. | no |

`note new` fails when the path exists.
With `--template NAME`, the template matches by name or path inside the template folder (`--template-folder`, else `templates.folder` in `.settings`, default `Templates`) and is expanded with the current date and the note's title.
Without `--template`, the vault's `templates.newNote` template is used when it is set and the file exists; `--no-template` skips that.

`daily` reads the daily-note types in `dailyNotes`.
`--id` is a 0-based index or a type's `id`; the default is the first type.
A vault that configures none gets one type with id `daily`, an empty folder and the file name `{{date}}`.
An id that matches nothing, or an index out of range, fails with the valid values.

For an agent, a hidden template makes `note new --template` fail with `refused: that template is not visible to this agent`, and a missing template gives the same message so names do not leak. A hidden default template yields a blank note and a `warning:` line on stderr.

## page

Manages the daemon inbox, the pages under `<vault>/.daemon/pages`. All four commands work on files. Page format and states are in [daemon pages](../daemon/pages.md).

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `page list` | `[--vault <dir>] [--retention-days <n>]` | Lists pages, each merged with its state sidecar. Retention defaults to 7 days. | no |
| `page create` | `<slug> [--title <t>] [--body <md>] [--actions '<json>'] [--source <s>] [--deliver-at <iso>] [--vault <dir>]` | Creates a page with validated frontmatter. `--actions` is a JSON array of action buttons. | no |
| `page resolve` | `<page-path> <actionId> [--vault <dir>]` | Presses an action. `approve` makes the daemon run the page's prompt; `dismiss` resolves it with no daemon. | no |
| `page mark-failed` | `<page-path> [--vault <dir>]` | Forces a stuck `working` page to `failed`. | no |

## prop

Sets and deletes frontmatter properties without disturbing YAML formatting.

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `prop set` | `<file> <key> <value>` | Sets a property. The value is parsed as JSON, else kept as a string. | no |
| `prop delete` | `<file> <key>` | Deletes a property. | no |

An image or PDF has no frontmatter of its own, so both commands route it to its companion note, `<file>.<ext>.md` (for example `paper.pdf.md`).
`prop set` creates the companion on first use; `prop delete` on a missing companion succeeds without doing anything.
Both fail with `ENOENT` when the binary itself does not exist, so a typo cannot create an orphan companion.
See [frontmatter](../vault/frontmatter.md).

## relay

Reads the in-process registry of Claude Code sessions and subagents running in this vault's terminal tabs.

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `relay list` | `[--api <url>]` | Prints the sessions and subagents live in the app's terminal tabs. | yes |

From an owner shell with the token attached, the snapshot includes each subagent's `lastMessage`. Without a token, and always for an agent, `lastMessage` is dropped and only bookkeeping fields remain (ids, types, timestamps, `cwd`, `backend`).

## search and replace

Full-text search and vault-wide find-and-replace. Both share three booleans: `--regex`, `--case` (case-sensitive) and `--word` (whole word).

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `search` | `<query> [--regex] [--case] [--word]` | Prints ranked matches with snippets, with no cap on results. | no |
| `replace` | `<query> <replacement> [--scope <path>] [--no-snapshot] [--regex] [--case] [--word]` | Replaces across the vault, or in one note with `--scope`. Prints the result object. | no |

Without `--regex`, search is mid-word and typo tolerant.
`replace` commits a git snapshot of the vault first, so the change can be undone.
A failed snapshot prints a `warning:` and the replace still runs; `--no-snapshot` skips the snapshot.
For an agent, restricted notes are never rewritten or named in the report.

## serve and backup

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `serve` | `[--port N] [--vault <dir>] [--memory <dir>]` | Starts the core HTTP server (default port `4321`) and prints `core listening on http://localhost:<port>`. | starts one |
| `backup` | `[--vault <dir>]` | Commits a local git snapshot of the vault. Prints `committed` or `nothing to commit`. | no |

`serve` stays running. It starts another core HTTP server, which is why an agent is refused it in a restricted vault. The port is only settable with `--port`; the `PORT` variable does nothing. Snapshots never leave the machine. See [storage](../overview/storage.md).

## settings

Reads and writes the vault's `.settings`, and sets per-folder icons and visibility. Keys and defaults are in the [settings reference](../settings/reference.md).

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `settings get` | `[--key a.b.c]` | Prints the merged settings, or one dotted path. | no |
| `settings set` | `<key.path> <value>` | Sets a value at a dotted path, keeping comments and key order. The value is parsed as JSON, else kept as a string. | no |
| `settings schema` | none | Prints the vault's property and validation schema. | no |
| `settings deny-list` | `[--channel chat\|daemon]` | Prints the visibility deny plan for a channel; default `daemon`. | no |
| `settings status-bar` | none | Prints the evaluated segments of `statusBar:`. Runs only shell commands the owner already approved and never approves one. | no |
| `folder-icon` | `<folder> <icon> [--clear]` | Sets or clears a folder's icon. | no |
| `folder-visibility` | `<folder> <chat-only\|hidden> [--clear]` | Sets or clears a folder's AI visibility. | no |

`settings get --key` returns nothing for a path that does not exist.
`settings deny-list` returns the full path list to the owner, and only `{channel, determined, count}` to an agent, so it cannot be used to list hidden paths.
When the plan cannot be determined it returns `{channel, determined: false, reason}`.

Writes to `.settings` can change the visibility rules themselves, so an agent is refused `settings set` and `folder-visibility` whenever the vault restricts anything. Status-bar approval and trust are covered in [status bar](../settings/status-bar.md).

## task

Lists and edits checkbox tasks. Line syntax is in [task syntax](../tasks/syntax.md).

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `task list` | `[--query <expr>]` | Lists every checkbox task. With `--query`, prints `{tasks, errors}` filtered by a Bases filter expression. | no |
| `task toggle` | `<file> <line> [--status <char>]` | Toggles a task's done state at a 1-based line, or sets the status character. Prints `ok`. | no |
| `task archive` | `[<file>]` | Permanently removes done and cancelled tasks from one note, or the whole vault. Prints `{removed, files}`. | no |
| `task migrate` | `[--dry-run]` | Rewrites emoji signifiers to bracket fields across the vault. Prints `{changed, files, flagged, skipped}`. | no |

`--query` accepts a Bases expression such as `!note.resolved and note.due < today()`.
Tasks-query text such as `not done` or `due before tomorrow`, with an optional `sort by …`, is translated first and the sort is applied.
`errors` lists parts that did not translate as `unrecognized filter: <leaf>`; those parts match everything, so a typo filters nothing instead of failing.

`task toggle` splits the note on newlines, changes the target line, and writes the note back with resolved tasks sunk below open ones within each run of task items.
A resolved task can therefore move, not just change its checkbox.
A recurring task inserts its next occurrence.
`--status` must be one printable character; control characters other than tab are rejected.
A line number below 1 or past the end fails.
`task toggle` takes a 1-based line, but the `line` field in `task list` output is 0-indexed, so add 1 when passing it on; the HTTP task routes take the 0-indexed value.

`task archive` has no confirmation prompt; a vault with a git snapshot retains the removed lines.

`task migrate` handles each file separately, so an unreadable file is reported under `skipped` and the rest proceed.
A line whose date cannot round-trip (such as `2026-02-30`) is rewritten with the date left as description text and listed under `flagged`.
`--dry-run` reports without writing.
The app also runs this once when it first opens a vault.

## theme

Manages custom colour themes in `<vault>/.themes/<name>.yaml`. The app repaints live on a write. Authoring is covered in [custom themes](../guides/custom-themes.md) and the token list in [tokens](../settings/tokens.md).

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `theme tokens` | `[--group <group>] [--kind <kind>]` | Lists every overridable token: key, kind, group, default, doc. Needs no vault. | no |
| `theme list` | none | Lists built-in and custom themes with validity and override counts, plus the configured and active theme. | no |
| `theme show` | `<name>` | Prints a theme's label, `extends`, token overrides and diagnostics. | no |
| `theme create` | `<name> [--label <text>] [--from <theme>] [--extends <builtin>] [--force]` | Writes a minimal theme file, or with `--from` a complete commented copy of that theme. | no |
| `theme validate` | `[<name>]` | Validates one theme, or every file in `.themes/`. Prints `{ok, results}` and exits `1` on any error; warnings pass. | no |
| `theme use` | `<name>` | Validates a theme, then sets `appearance.theme` in `.settings`. | no |

A theme name uses lowercase letters, digits and dashes, starts with a letter or digit, and is at most 40 characters.
Built-in names cannot be created over.
`theme create` refuses an existing file without `--force`, and `--extends` must name a built-in theme.
`theme list` reports `ink` as the active theme when `appearance.theme` names an unknown or invalid one.

## update

Checks for and applies a git-based self-update. It applies only to a source build; elsewhere `update status` reports `available: false` with a reason, and `update apply` reports an error phase.

| Command | Arguments and flags | What it does | Server |
|---|---|---|---|
| `update status` | `[--api <url>]` | Reports whether this build is behind `origin/main`. | yes |
| `update apply` | `[--api <url>]` | Pulls, rebuilds and relaunches in the background, then returns immediately. Poll `update status` for progress. | yes |

An agent is refused `update` in a restricted vault. The flow is described in [self-update](../overview/self-update.md).

## How it works

The `bismuth` binary is the `cli` workspace, a thin wrapper over `@bismuth/core` that runs under Bun.
`cli/src/index.ts` dispatches over one merged registry keyed by the full command string.
`resolveCommand` tries the three-word phrase first (`daemon cron toggle`), then the two-word phrase (`task toggle`), then the single word.
Everything after the matched words is the command's `args`.

Each group lives in `cli/src/commands/<group>.ts` and exports a `CommandMap`; the merge order in `registry.ts` is load-bearing, because a later group's key overwrites an earlier one.
The same registry backs `cli/test/mcpParity.test.ts`, which requires every MCP tool to have a CLI twin, and `cli/test/guideCommands.test.ts`, which checks that every `bismuth …` phrase in the agent guides resolves.

Argument parsing is in `cli/src/args.ts`.
The visibility gate in `core/src/visibilityCliGate.ts` runs once in `index.ts` before any command, so no invocation skips it.
Server commands share `cli/src/http.ts`: `resolveCore` picks the address and `call` attaches the owner token and turns failures into messages.
The run registry is `core/src/runRegistry.ts`.

Source: `cli/src/index.ts`, `cli/src/registry.ts`, `cli/src/args.ts`, `cli/src/http.ts`, `cli/src/commands/*.ts`, `core/src/visibilityCliGate.ts`
