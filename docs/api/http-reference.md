# Core HTTP API reference

The core server is the HTTP API behind the app, the `bismuth` CLI and the MCP server.
It serves a vault's files, graph, bases, tasks, settings, daemon state and chat history on one port (default `4321`).
Use this page when you call it from a script, an integration or a debugging session and need a route's request, response, access rule or side effect.

```bash
curl -s http://localhost:4321/version
# {"version":42}

curl -s -X POST http://localhost:4321/search \
    -H 'content-type: application/json' \
    -H "X-Bismuth-Token: $TOKEN" \
    -d '{"query":"neural net","opts":{"caseSensitive":false,"wholeWord":false,"regex":false}}'
```

`$TOKEN` is the running core's owner token, which makes you the vault owner instead of an agent; see [Who is calling](#who-is-calling-channels-and-visibility-gating). The CLI wraps many of these routes; see the [CLI reference](../cli/reference.md).

This page covers server basics, who is calling, then the routes by area:

- [Server basics](#server-basics): dispatch, errors, CORS, change events
- [Visibility gating](#who-is-calling-channels-and-visibility-gating): the owner, chat and daemon channels
- Routes by area:
  [files and notes](#files-and-notes), [attachments](#attachments-and-uploads), [search](#search), [graph](#graph), [bases and rows](#bases-and-rows), [tasks](#tasks), [flashcards](#flashcards),
  [settings and themes](#settings-and-themes), [daemon](#daemon), [memory recall](#memory-recall), [chat history and agents](#chat-history-and-agents), [Google Calendar](#google-calendar),
  [relay and app control](#relay-and-app-control), [install, doctor and update](#install-doctor-and-update), [server state and change events](#server-state-and-change-events)
- [WebSockets](#websockets): `/chat`, `/ui`, `/terminal`

## Server basics

A request is routed by the exact key `<METHOD> <pathname>`.
A key with no handler returns `404` with the body `not found`.
The WebSocket upgrades `GET /chat`, `GET /ui` and `GET /terminal` are matched before the route tables.
An `OPTIONS` request to any path returns an empty response with the CORS headers.

Startup takes `--vault` (required), `--memory` (optional) and `--port` (default `4321`). A route handler runs under a 255-second idle timeout, the longest Bun allows, so slow routes such as `POST /daemon/setup` are not cut off.

### How errors look

Most errors are a plain-text body with an HTTP status, such as `forbidden` or `note not found`. A few routes answer with JSON instead and say so in their table row.

A thrown `AppError` carries its own status. The common codes:

| Code | Status |
|---|---|
| `ENOENT`, `*_NOT_FOUND` | 404 |
| `EACCES` | 403 |
| `EEXIST`, `*_CONTENT_CHANGED` | 409 |
| `EBUSY` | 409 |
| `EINVAL`, `PARSE_ERROR`, `SCHEMA_ERROR`, `*_FORMAT_ERROR`, `BASE_CYCLE` | 400 |
| Any other thrown error | 500 |

A missing required query parameter is `400` with the body `missing ?<param>=`.

### CORS

Every response carries `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET,PUT,POST,OPTIONS`, `Access-Control-Allow-Headers: Content-Type, X-Bismuth-Token` and `Access-Control-Max-Age: 600`.
Any local web page can therefore call the server, which is why routes that run commands, delete data or change credentials require the owner token.

### Cache invalidation and change events

Routes fall into three groups by what they do to caches and the event stream.

| Effect | Meaning |
|---|---|
| none | Reads, and writes outside the vault (daemon state, credentials, relay registry). No cache change, no event. |
| invalidates `<path>` | The route names the paths it wrote. The server re-fingerprints those notes, drops the caches they affect, bumps `version` and publishes an event on `GET /events`. |
| full | The route cannot name its paths up front. Graph and tree are both marked dirty, then `version` bumps and an event publishes. |

A content-only edit that changes no link, tag or icon marks neither graph nor tree dirty. The event still carries the path, so editors reconcile and graph and tree consumers skip their refetch. Search, rows and tasks caches are patched in place for named paths and rebuilt after a full invalidation.

Routes that write a note mark the path as self-written first, so the file watcher does not publish a second event for the server's own write.

## Who is calling: channels and visibility gating

Every request resolves to one of three channels, and the channel decides how much of the vault a route returns.

| Channel | How a request gets it | Sees |
|---|---|---|
| `owner` | `X-Bismuth-Token` equals this boot's token | Everything. Never filtered. |
| `chat` | No valid token, header `X-Bismuth-Channel: chat` | Everything except notes marked `hidden`. |
| `daemon` | No valid token, any other header state | Only notes with no restriction. The default for a bare `curl`. |

The app and the CLI attach the token automatically.
A core started by a spawner can be handed a fixed token through `BISMUTH_OWNER_TOKEN`; otherwise it mints a random one on each boot and writes it to the vault's run record under `~/.bismuth/run` with mode `0600`.
Notes are restricted by a `visibility` frontmatter value or a folder rule in `.settings`; see [visibility](../vault/visibility.md).

Routes use four access rules. The tables below name the rule in the access column.

| Access | Behaviour for a non-owner request |
|---|---|
| open | Not gated. |
| filtered | `200`, with restricted notes dropped from the result. Nothing in the response says a note was left out. |
| path-gated | `403` with the body `forbidden` when the requested path (or its resolved path) is restricted. |
| owner only | `403` for every non-owner request, because the route runs commands, changes credentials, deletes data or returns content with no single path to check. |

`GET /relay/snapshot` is the one route that redacts a field instead of refusing: it drops each subagent's `lastMessage` for non-owners.

An owner-only refusal is the plain body `forbidden`, except for the opencode and free-agent routes, which answer `{"error":"forbidden"}`. `GET /tree` annotates every entry with its resolved visibility but never hides one, because a file's existence is not treated as secret. Writes are not filtered.

If the server cannot determine what is restricted (an unreadable folder, a `.settings` that fails to parse), a gated route returns `500` instead of an unfiltered result.

## Files and notes

These routes read, write and organise notes. Paths are vault-relative.

| Route | Request | Response | Access and effects |
|---|---|---|---|
| `GET /file` | `?path=` required | The file's raw text. A missing file is an empty body with `200`. | path-gated; none |
| `PUT /file` | `{path, contents, baseText?}` | `ok`. | invalidates `path` |
| `GET /meta` | `?path=` required | The note's parsed frontmatter object. `{}` when the file is missing. | path-gated; none |
| `GET /tree` | none | `TreeEntry[]`: `{path, kind, icon?, visibility?, ownVisibility?, isSystemFolder?, label?}`. | open; none |
| `GET /vault-data` | none | `Row[]`, one `{file, note}` row per note. | filtered; none |
| `GET /templates` | none | `[{name, path}]` for the templates folder (setting `templates.folder`, default `Templates`). `[]` when absent. | open; none |
| `GET /terminal/info` | none | `{vault}`, the absolute vault path used as the terminal's working directory. | open; none |
| `GET /abs-path` | `?path=` required, resolved filename-first | `{path}` as an absolute machine path. `404 not found` when unresolvable. | path-gated on the resolved path; none |
| `POST /create` | `{path, kind: "file"\|"dir"}` | `ok`. `409` when the path exists. | invalidates `path` |
| `POST /move` | `{from, to}` | `ok`. | invalidates both paths |
| `POST /delete` | `{path}` | `{trashPath}` under `.trash/`. | invalidates `path` |
| `POST /restore` | `{trashPath, to}` | `ok`. | invalidates `to` |
| `POST /replace` | `{query, replacement, opts, scope}` | `{replaced, files}`. An invalid regex is `400` with the message. | invalidates `scope` for one note, full for the vault |
| `POST /daily-note` | `{id}` | `{path, created}`. `400 unknown daily note: <id>`. | invalidates the new path only when `created` is true |
| `POST /set-property` | `{path, key, value}` | `ok`. `404 note not found` when the note is missing. | invalidates `path` |
| `POST /delete-property` | `{path, key}` | `ok`. `404 note not found`. | invalidates `path` |
| `POST /set-properties` | `{writes: [{path, key, value}]}` | `{skipped: string[]}`: paths that did not exist. | invalidates every written path |
| `POST /backup` | none | `{scheduled: true}`. | none |
| `POST /open-folder` | `{folder, memory?}` | `{url, vault}` of a new core for that folder. `400` when no memory directory is configured. | none |
| `POST /list-dir` | `{path?, only?: "dir"\|"file"}` | `{entries: [{path, kind}]}` for a partial filesystem path, used for path-valued settings. | none |

### PUT /file and the `baseText` guard

`PUT /file` writes `contents` to `path`.
When the body also carries `baseText`, the write proceeds only if the file still holds exactly that text.
On a mismatch nothing is written and the response is `409` with the JSON body `{current}`, the file's text on disk, so the caller can merge.
Without `baseText` the write is unconditional.

A `GET /file` for `.settings` first fills in any missing defaults, so a vault that never had settings returns a seeded file instead of an empty editor.

### Frontmatter and rename side effects

`POST /set-property`, `/delete-property` and `/set-properties` preserve other keys and comments.
Deleting a note's last key removes the whole frontmatter block.
A property write to a base that lists more than one view in `views:` fails with `BASE_VIEWS_FORMAT_ERROR` (`400`) and writes nothing.
A write to the `visibility` key also re-gates open chat sessions.

`POST /move` also remaps the cached graph layout positions of the moved note or folder, so a rename does not cold-start the layout.

`POST /replace` commits a git snapshot of the vault before it rewrites any file, so the change can be undone.

`POST /backup` schedules a debounced snapshot commit: it runs after 30 seconds without another call, or after 5 minutes of continuous calls (tunable with `BISMUTH_BACKUP_DEBOUNCE_MS` and `BISMUTH_BACKUP_MAX_WAIT_MS`).

## Attachments and uploads

These routes move binary data. None of them invalidates caches, because attachments are not part of the graph, tree or search index.

| Route | Request | Response | Access and effects |
|---|---|---|---|
| `GET /asset` | `?path=` required, resolved filename-first | The file's bytes with a `Content-Type` from its extension and `Cache-Control: private, max-age=60`. `404 asset not found`. | path-gated on both the resolved and raw path; none |
| `POST /asset` | `?path=` target, raw bytes as the body | `{path}` actually used; a name clash gets a unique suffix. | open; none |
| `POST /asset/fetch` | `{url, path}` | `{path}` actually used. | owner only; none |
| `POST /convert/heic` | raw HEIC or HEIF bytes | JPEG bytes, `Content-Type: image/jpeg`. `400` when undecodable. | open; none |
| `POST /tmp-file` | `?name=` required, raw bytes | `{path}`, an absolute path outside the vault. | open; none |

Uploads cap at 100 MB and return `413` above it. `POST /asset` and `POST /asset/fetch` reject a target with an empty, `.`, `..` or dot-prefixed segment (`400 invalid attachment path`), which keeps writes out of `.git/`.

`GET /asset` serves `.html` files with a Content Security Policy that blocks network access (`connect-src 'none'`), so an embedded page cannot read the vault through this API. A 403 or 404 from this route carries `Cache-Control: no-store`.

`POST /asset/fetch` downloads a remote image into the vault.
It accepts `http:` and `https:` URLs, follows up to 5 redirects, checks every hop's resolved address and refuses private, loopback and link-local ranges (`400 blocked address`), and requires an `image/*` content type (`415 not an image`).
A fetch failure or too many redirects is `502`.
If the extension in `path` disagrees with the content type, the extension is corrected.

`POST /tmp-file` stages bytes in `~/.bismuth/tmp` (override `BISMUTH_TMP_DIR`) under a sanitised name, so a pasted file gets a path without becoming a vault file. Files older than 24 hours are removed at boot.

## Search

| Route | Request | Response | Access and effects |
|---|---|---|---|
| `POST /search` | `{query, opts: {caseSensitive, wholeWord, regex}, snippetLimit?}` | `[{path, matchCount, snippets}]`, every matching note. `400` on an invalid regex. | filtered; none |
| `POST /search-prompt` | `{query}`, a natural-language question | The `/search` shape plus a `reason` per hit. | filtered; none |

`snippetLimit` caps the snippets per note (default 20) and does not change `matchCount`.
Without `regex`, results are ranked in three tiers: full-text matches, then literal matches the index missed, then typo matches when `caseSensitive` is false.
With `regex`, every note is scanned and results sort by match count.

`POST /search-prompt` re-ranks candidates with one Haiku turn through the user's own `claude` binary. It returns `400` when `claude` is not on the path and `500` when the model call fails. The model may read restricted notes while ranking; only the returned list is filtered.

## Graph

| Route | Request | Response | Access and effects |
|---|---|---|---|
| `GET /graph` | none | `{nodes, edges, views?}` from the graph cache. | filtered; none |
| `GET /graph/views` | none | `{second?, third?}`, each `{pos3d, pos2d}` keyed by node id. | open; attaches `views` to the cached graph |

A node is `{id, label, kind, state?, folder?, parent?, position?, position2d?, community?, communityLabel?, daemon?}`, where `kind` is `note`, `memory`, `agent`, `tag`, `self`, `daemon`, `cron` or `process`.
`position` is `[x, y, z]` and `position2d` is `[x, y]`.
An edge is `{from, to, kind}` with `kind` one of `link`, `message`, `about`, `tag`, `open`, `supervises`.
A restricted node and every edge touching it are dropped for non-owners.

`GET /graph/views` computes the per-brain layouts when the user switches graph mode, and caches them on the live graph object, so a later `GET /graph` includes `views`.

## Bases and rows

| Route | Request | Response | Access and effects |
|---|---|---|---|
| `GET /base` | `?file=` required | `{config, rows}` from parsing the base. `404 not found`. | path-gated; none |
| `POST /rows` | `{spec}` | `Row[]` | filtered; none |
| `POST /row/update` | `{file, index, note}` | `ok` | invalidates `file` |
| `POST /rows/update` | `{file, updates: [{index, note}]}` | `ok` | invalidates `file` |
| `POST /row/delete` | `{file, index}` | `ok` | invalidates `file` |
| `POST /row/reorder` | `{file, from, to}` | `ok` | invalidates `file` |

`spec` in `POST /rows` is a source, one of:

| Shape | Resolves to |
|---|---|
| `{kind: "base", ref}` | Another base's rows, recursively. |
| `{kind: "notes", where?, from?}` | Vault notes filtered by a Bases expression. `from: "[[Base]]"` scopes to that base's notes. |
| `{kind: "tasks", where?, from?}` | Checkbox tasks. `from` scopes extraction to a base's notes; without it the whole vault. |

`index: null` in `POST /row/update` appends a row; an integer replaces that row.
`POST /rows/update` applies a batch to one file in a single parse and write: replacements apply in order, then appends in order, and any non-integer or out-of-range index fails the whole batch with `400` before anything is written.
`POST /row/delete` and `POST /row/reorder` read the file first, so a missing file is `404`.
Base format and sources are in the [bases overview](../bases/overview.md).

## Tasks

`line` is a 0-indexed line number in every task route, matching the `line` field of `GET /tasks`. Task syntax is in [task syntax](../tasks/syntax.md).

| Route | Request | Response | Access and effects |
|---|---|---|---|
| `GET /tasks` | none | Every checkbox task in the vault. | filtered; none |
| `GET /tasks/migration` | none | `{ran: null}` while the boot-time pass runs; then the migration report. | filtered; none |
| `POST /tasks/toggle` | `{path, line, status?}` | `ok` | invalidates `path` |
| `POST /tasks/reschedule` | `{path, line, field: "due"\|"scheduled"\|"start", date}` | `ok` | invalidates `path` |
| `POST /tasks/update` | `{path, line, patch}` | `ok` | invalidates `path` |
| `POST /tasks/delete` | `{path, line}` | `ok` | invalidates `path` |
| `POST /tasks/move` | `{path, line, to}` | `{path}` where the task now lives | full |
| `POST /tasks/archive` | `{path?}` | `{removed, files}` | invalidates `path`, or full without it |
| `POST /tasks/create` | `{file, body}` | `{path}` written | full |

A task line outside the file is `400 line out of range`; a line that is not a checkbox task is `400 not a task line`.

`status` in `/tasks/toggle` sets the checkbox character exactly; without it the route flips done and not done. A recurring task inserts its next occurrence above the completed line, and resolved tasks sink below open ones in their list. CRLF files keep CRLF.

`patch` in `/tasks/update` is `{description?, due?, scheduled?, start?, priority?}`. A key set to `null` clears that field and an absent key is untouched. `priority` is `highest`, `high`, `medium`, `low` or `lowest`. Edited lines re-emit their fields in canonical order.

`/tasks/delete` removes the task line and its deeper-indented continuation lines. `/tasks/move` does the same and appends them to the destination note, creating it if needed; `to` is a note reference (a wikilink, a bare name or a path). Moving a task into its own note is a no-op that succeeds.

`/tasks/create` takes `file` as a note reference, never a literal path, and appends `- [ ] <body>`; `body` is the text after the checkbox. `/tasks/archive` permanently removes done and cancelled tasks, from one note or the whole vault.

`GET /tasks/migration` reports what the boot-time bracket-syntax migration did: `{ran, blocked, snapshotError?, changed, files, flagged, skipped, snapshot}`.
`blocked` means the pre-migration snapshot failed and nothing was rewritten.
The `files`, `flagged` and `skipped` lists are filtered by path, and `changed` is re-summed from the filtered `files`, so a restricted caller cannot infer hidden counts.

## Flashcards

Card syntax and scheduling are in [flashcards](../flashcards/srs.md).

| Route | Request | Response | Access and effects |
|---|---|---|---|
| `GET /cards/decks` | none | Decks with total and due counts, recomputed over visible cards. | filtered; none |
| `GET /cards/all` | none | Every card. | filtered; none |
| `GET /cards/note` | `?path=` required | Every card parsed from one note. | path-gated; none |
| `GET /cards/due` | `?deck=` optional | Cards due today, each with an `id`. | filtered; none |
| `POST /cards/review` | row form or markdown form | `ok` | invalidates `file` for rows, full for markdown cards |

`POST /cards/review` takes one of two bodies:

| Form | Body |
|---|---|
| Base row | `{file, index, response, dueField?, easeField?, intervalField?}` |
| Markdown card | `{id, response, question?}`, where `id` is `notePath::cardIndex::subIndex` |

`response` is `hard`, `good` or `easy`. The three field names choose which scheduling columns to advance; give all three or none. Errors: `400 missing cardId` when neither form is complete, `400 row not found: <file>#<index>`, and `404` for an unknown markdown card id.

## Settings and themes

| Route | Request | Response | Access and effects |
|---|---|---|---|
| `GET /config` | none | `{vault, memory}`; `memory` is `null` when unset. | open; none |
| `GET /settings` | none | Parsed settings merged over defaults. | open; none |
| `GET /themes` | none | A `ThemesFeed` of custom themes. | open; none |
| `GET /schema` | none | The property registry from `.settings`. | open; none |
| `GET /status-bar` | none | `{segments}` from the `statusBar:` setting. | owner only; none |
| `POST /set-setting` | `{path: string[], value}` | `{ok: true}`. `400 bad path` unless `path` is an array of strings. | invalidates `.settings` |
| `POST /folder-icon` | `{path, icon?}` | `ok`. An empty or null `icon` clears it. | invalidates `.settings` |
| `POST /folder-visibility` | `{path, visibility?}` | `ok`. | invalidates `.settings` |
| `POST /status-bar/trust` | `{command}` | `{ok: true}` | owner only; none |

`GET /settings` omits the `properties` registry (read it from `GET /schema`). `appearance.tokens` is the vault's token overrides as a flat map of token key to value, containing only keys the file sets. Settings keys and defaults are in the [settings reference](../settings/reference.md).

`POST /set-setting` merges one value at a path such as `["appearance", "uiFont"]`, preserving comments, the property registry and unknown keys. A dotted string like `"appearance.theme"` is rejected.

`POST /folder-icon` and `POST /folder-visibility` take a vault-relative folder path and reject an empty, absolute or `.`/`..` path with `400`.
`visibility` is `chat-only`, `hidden`, `null` or absent; absent and `null` clear the rule, and anything else is `400 invalid visibility`.
When `.settings` fails to parse, folder-visibility answers `409` and writes nothing.
A successful change re-gates every open chat on its next turn.

### GET /themes

`GET /themes` returns every theme in `<vault>/.themes/*.yaml`, sorted by name, uncached and open to any caller.

```ts
{
    themes: {
        name: string
        label: string
        extends: 'ink' | 'paper' | 'cathode' | 'riso'
        isLight: boolean
        tokens: Record<string, string>   // the file's overrides only
        colors: ColorTokens              // the built-in plus overrides, resolved
    }[]
    invalid: { name: string; diagnostics: { field: string; severity: 'error' | 'warning'; message: string }[] }[]
}
```

A missing folder returns both lists empty.
A symlinked file, or one over 64 KB, is listed under `invalid`.
Editing a theme file publishes an event with its path; creating, deleting or renaming one also marks the tree dirty.
A theme never dirties the graph.
Writing a theme is in [custom themes](../guides/custom-themes.md).

### GET /status-bar

`GET /status-bar` evaluates the vault's `statusBar:` list; an absent or invalid list yields the built-in segments.
A `run:` command that the owner has not approved is reported as `untrusted` and never spawned.
A per-segment failure becomes an `error` on that segment instead of failing the request.
The route is owner only because command output and vault-wide counts cannot be filtered per path.

### POST /status-bar/trust

`POST /status-bar/trust` approves a `run:` command, recording the approval per machine and per vault against the command's exact text. It is owner only, so an agent cannot approve its own command.

The request is refused with `400` unless `command` equals a `run` entry in the vault's current `statusBar`, so an approval can cover only what `.settings` holds right now.
A command containing a newline, a carriage return or a bidi control character (U+202A to U+202E, U+2066 to U+2069) is `400` and can never be approved.
`bismuth api` refuses this path for agents as well.
See [status bar](../settings/status-bar.md).

## Daemon

The daemon routes read and write the daemon's files.
Machine-level state (`status`, `devices`, `install`) lives under `~/.bismuth/daemon`; crons, processes, pages and logs belong to the vault under `<vault>/.daemon`.
None invalidates the vault caches except routes that write a page file; the app polls `GET /daemon/snapshot` and `GET /daemon/pages`.
Concepts are in the [daemon docs](../daemon/setup.md).

| Route | Request | Response | Access and effects |
|---|---|---|---|
| `GET /daemon/status` | none | `{running, thisDeviceId, owner, name}`. `owner` is `{ownerDeviceId, ownerLabel, updatedAt}` or `null`. | open; none |
| `GET /daemon/devices` | none | `{devices: [{deviceId, label, lastSeenISO, isOwner, isThis}], ownerDeviceId}` | open; none |
| `GET /daemon/snapshot` | none | `{daemon, crons, processes, identity}` for this vault. | open; none |
| `GET /daemon/logs` | `?limit=&kind=&name=&since=` | Activity events, newest first. | open; none |
| `GET /daemon/install` | none | `{installed, running, binPath}` | open; none |
| `POST /daemon/setup` | none | `{ok, binPath, error?}` | open; none |
| `POST /daemon/update` | none | `{ok, binPath, error?}`, the same action as setup. | open; none |
| `POST /daemon/owner` | `{deviceId}` | The new owner `{ownerDeviceId, ownerLabel, updatedAt}`. `400` for an unknown device. | open; writes `owner.json` outside the vault and publishes an event with a non-vault sentinel path |
| `POST /daemon/cron/toggle` | `{name, enabled}` | `{ok: true}` | owner only; none |
| `POST /daemon/cron/run` | `{name}` | `{ok: true}` | owner only; none |
| `POST /daemon/cron/delete` | `{name}` | `{ok: true}` | owner only; none |
| `POST /daemon/process/toggle` | `{name, enabled}` | `{ok: true}` | owner only; none |
| `POST /daemon/process/delete` | `{name}` | `{ok: true}` | owner only; none |
| `GET /daemon/pages` | none | `DaemonPage[]` | open; none |
| `POST /daemon/pages` | `{slug, title?, body?, actions?, source?, deliverAt?}` | `{path, slug}` | invalidates the new page path |
| `POST /daemon/pages/resolve` | `{path, actionId}` | `{status, alreadyResolved}` | open; none |
| `POST /daemon/pages/mark-failed` | `{path}` | `{ok: true}` | open; none |
| `POST /daemon/pages/archive` | `{path}` | `{ok: true}` | owner only; none |

`GET /daemon/status` reports `running` when `daemon.pid` exists and the process is alive. `name` is the display name from the vault's daemon identity.

`GET /daemon/snapshot` returns `daemon: {label, running, home}`, `crons`, `processes` and `identity: {name, blurb}`.
A cron is `{name, file, schedule, on, watch, enabled, lastFired, running, startedAt}`, where `on` is `schedule` or `file-change` and `lastFired` is `{timestamp, result, detail?}` or `null`.
A process is `{name, file, enabled, running}`, and its `running` is always `false` because the daemon exposes no per-process liveness file.
`name` is the frontmatter name or the file basename and is the key the toggle, run and delete routes take; `file` is the definition's basename without `.md`.

`POST /daemon/setup` runs the bundled daemon binary's self-install, which writes the launchd or systemd unit.
It is idempotent, never throws, and reports failure in the body.
There is no create route for crons or processes; the daemon creates them through `bismuth daemon cron create` and `bismuth daemon process create`.

The cron and process routes return `400` for a missing field and `404` for an unknown name.
`cron/delete` returns `409` while the daemon has the cron recorded as running.
`process/delete` also tells a running daemon to stop that process.
`cron/run` drops a trigger file the daemon polls, under `<vault>/.daemon/crons/.triggers/`.

### GET /daemon/logs

`GET /daemon/logs` reads `<vault>/.daemon/logs/activity-YYYY-MM-DD.jsonl` and returns events newest first as `{ts, kind, name, event, outcome?, cause?, durationMs?, detail?}`.
All four query parameters are optional: `limit` defaults to 100 and is capped at 1000, `kind` is `cron`, `process`, `daemon` or `session`, `name` is a cron or process name, and `since` is an ISO instant.
The route never fails; it returns `[]` when the daemon has never run in this vault.
The event vocabulary and retention are in [daemon storage](../daemon/storage.md).

### Daemon pages

A page is a daemon-authored note at `<vault>/.daemon/pages/<slug>.md` that asks the user to approve or dismiss an action. Its changing state (status, prompt, model) lives in a JSON sidecar under `.daemon/pages/.state/`, so an editor save of the page can never race a daemon status write.

A `DaemonPage` is `{path, slug, title, createdAt, deliverAt?, source?, actions, body, status, pressedAction?, pressedAt?, daemonNote?, completedAt?}`.
`status` is `pending`, `working`, `done`, `failed` or `dismissed`, and is `pending` when no sidecar exists.
`GET /daemon/pages` also deletes pages whose completion is older than the `daemon.inboxRetentionDays` setting (default 7), so the app's polling is what runs the cleanup.

`POST /daemon/pages` validates the slug (`400` for dots or slashes; `409 page already exists`; it never overwrites) and stamps `type: daemon-page` and `createdAt`.

`POST /daemon/pages/resolve` presses an action.
An action with no `prompt` is a dismiss and resolves without the daemon; one with a `prompt` sets the page to `working` and drops a trigger file the daemon polls about every 5 seconds.
A page already `done`, `dismissed` or `working` returns its status with `alreadyResolved: true`; `failed` is not final, so pressing again retries.
Errors: `400 missing path/actionId`, `404 page not found: <path>`, `400 unknown action "<actionId>" on <path>`, `400 not a daemon page: <path>`.

`POST /daemon/pages/mark-failed` sets a stuck `working` page to `failed`; it leaves a page already `done`, `failed` or `dismissed` unchanged. `POST /daemon/pages/archive` deletes the page and its sidecar whatever its status, and answers `409` while the page is `working`.

## Memory recall

| Route | Request | Response | Access and effects |
|---|---|---|---|
| `POST /memory/recall` | `{mode, sessionId, agentId?, prompt?, transcriptPath?, toolCalls?, source?}` | `{context, injected, reason?}` | open; none |

`mode` is `prompt`, `tool`, `session-start` or `subagent`.
`sessionId` is required and non-empty; `source` is the SessionStart source (`startup`, `resume`, `clear` or `compact`); `toolCalls` is `[{tool_name, tool_input?, tool_response?}]`.
A bad mode, a missing `sessionId`, a wrongly typed field or invalid JSON is `400`.

`context` is the block to inject as additional context, or `null`; `injected` lists the note names it contains; `reason` is `disabled`, `mid-turn-off`, `no-memory` or `no-match` when nothing was injected.
Recall ranks the vault's memory graph and keeps a per-session ledger so a note already shown is not injected again unless it changed.
The ledger clears on `session-start` with source `compact` or `clear` and expires after 6 hours idle.
`transcriptPath` only widens the ranking query.

The settings `daemon.recall.enabled`, `daemon.recall.midTurn` and `daemon.recall.semantic` are read on each call (absent means true), and the memory directory is read only when `daemon.enabled` is true.
Any request carrying an `Origin` header is refused with `403 cross-origin recall refused`, since relay hooks send none.
Recall returns only notes visible to the daemon channel, so the route needs no token.

## Chat history and agents

Chat history routes are owner only because a transcript has no single path to check. The chat itself runs over the [`/chat` WebSocket](#get-chat). Backends are covered in [chat backends](../chat/backends.md).

| Route | Request | Response | Access and effects |
|---|---|---|---|
| `GET /chat/sessions` | `?scope=` optional | `{sessions: [{sessionId, summary, lastModified, origin}]}` | owner only; none |
| `GET /chat/session-messages` | `?id=&provider=` | `{frames: ChatFrame[]}`, empty without `id`. | owner only; none |
| `POST /chat/search` | `{query?, scope?}` | `{hits}`, empty for an empty query. | owner only; none |

`scope` is `user`, `daemon` or `all`; anything else, or absent, is `user`.
`origin` is `user` or `daemon`.
`provider` on `session-messages` selects which backend's session store to replay and defaults to the vault's `chat.provider` setting.
Frames replay in order in the same shape the live socket streams.

### OpenCode provider manager (`/opencode/*`)

Four owner-only routes manage provider credentials over the running `opencode serve`. They change no vault file. Keys go straight to opencode's own store and are never logged or echoed. The guide is [opencode providers](../chat/opencode-providers.md).

| Route | Request | Response |
|---|---|---|
| `GET /opencode/providers` | none | `{connected: [{id, name, kind}], available: [{id, name, methods}]}` |
| `POST /opencode/auth` | `{id, key}` | `{ok: true}`. Re-sends the models and auth frames to live opencode chats. |
| `POST /opencode/oauth/authorize` | `{id, method}` | `{url, method: "auto"\|"code", instructions}` |
| `POST /opencode/oauth/callback` | `{id, method, code?}` | `{ok: true}`. Re-sends the models and auth frames. |

`kind` is `api`, `oauth` or `env`; `env` means one of the provider's environment variables is set.
`available` lists every provider not connected, sorted by name, and each entry's `methods` is never empty.
`method` is the index into the provider's methods.
`code` is the pasted code for a `code` method and is omitted for `auto`.

All four share these errors, as JSON:

| Status | Body | When |
|---|---|---|
| 403 | `{error: "forbidden"}` | The request is not from the owner. |
| 409 | `{error: "opencode-missing", message}` | The opencode binary is absent or its server did not start. |
| 400 | `{error: "bad-request", message}` | A malformed body, or opencode refused it. `message` never contains the key. |

### Free agent (`/agents/free`)

Two owner-only routes manage the one-click opencode install, which downloads opencode's official release into `~/.bismuth/agents/bin/opencode` so chat can use free models. Non-owner requests get `403 {error: "forbidden"}`.

| Route | Request | Response |
|---|---|---|
| `GET /agents/free` | none | `{opencode: {installed, path, managed}, claude: {installed}, backends: [{id, label, installed}], progress}` |
| `POST /agents/free/install` | none | The current `FreeAgentProgress`. |

`FreeAgentProgress` is `{phase, received?, total?, message?, action?, version?, path?}`. `phase` is `idle`, `downloading`, `verifying`, `installing`, `ready` or `error`; `received` and `total` are bytes during `downloading`; `action` is `installed` or `already-installed` when `ready`.

The install starts in the background and returns at once, so poll `GET /agents/free`.
A second call while an install runs returns the running progress and starts no second download.
If opencode is already on the machine, nothing downloads and the progress ends `ready` with `already-installed`.
The download is hashed while it streams and compared with the sha256 digest GitHub publishes; a mismatch, a missing digest, a failed response, an archive without the binary or an unsupported platform ends in `error` and leaves nothing at the final path.

## Google Calendar

Google credentials, the token and the sync manifest live in `~/.bismuth/gcal`, outside any vault, and are shared by every core on the machine.
For that reason the routes that call Google or change that state are refused with `403` and a JSON `{error}` unless the core is the installed app (`BISMUTH_APP_PATH` is set) or `BISMUTH_GCAL_AUTOSYNC=1` is set.
The refusal happens before anything is read, written or sent.
`GET /gcal/status` only reads, so it stays open.
The model is in [Google Calendar sync](../gcal/overview.md).

| Route | Request | Response | Access and effects |
|---|---|---|---|
| `GET /gcal/status` | none | `{connected, needsCredentials, account?, timeZone?, connectedAt?}` | open; none |
| `POST /gcal/credentials` | `{clientId, clientSecret}` | `{ok: true}`. `400 missing clientId/clientSecret`. | app only; none |
| `POST /gcal/auth/start` | none | `{url}`, the Google consent URL. `400` when credentials are not set. | app only; none |
| `GET /gcal/callback` | `?code=&state=` or `?error=` | An HTML page, never JSON. | app only; none |
| `POST /gcal/disconnect` | none | `{ok: true}` | app only; none |
| `POST /gcal/sync` | `{basePath?}` | The sync result with pulled, pushed, deleted and conflict counts. | app only; invalidates the base |

The sign-in uses authorisation code with PKCE and the single scope `calendar.events`.
`POST /gcal/auth/start` builds the redirect `http://127.0.0.1:<port>/gcal/callback`, so Google's redirect lands on the core that started the flow.
`GET /gcal/callback` is a browser navigation: it renders a small page with the outcome, a success message with the account, or an error message, and a refused request renders the same page with status `403`.

`POST /gcal/sync` syncs one calendar base in both directions.
The Google calendar comes from that base's own frontmatter (`googleCalendarId`, default `primary`); the conflict policy (`lastWriteWins` by default), time zone and theme come from the `googleCalendar` setting.
Errors: `400 no calendar base to sync` when no base is named, `404 calendar base not found: <path>`, and `400` with the message when the sync itself fails.

In the installed app (or with `BISMUTH_GCAL_AUTOSYNC=1`), while Google is connected, the core also runs a 60-second timer that syncs every sync-enabled calendar base one after another, once the `googleCalendar.syncIntervalMinutes` interval (default 15, minimum 1) has passed.
Failures for one base are logged and do not stop the rest.

## Relay and app control

The relay routes keep an in-memory registry of agent sessions in the app's terminal tabs. The app-control routes drive a window's tabs. None invalidates vault caches. See [app control](../mcp/app-control.md).

| Route | Request | Response | Access and effects |
|---|---|---|---|
| `POST /relay/session` | `{sessionId, terminalId, cwd?, backend?}` | `{ok: true}`. `400 missing sessionId/terminalId`. | open; registry only |
| `POST /relay/session/end` | `{sessionId}` | `{ok: true}`. `400 missing sessionId`. | open; registry only |
| `POST /relay/subagent/start` | `{parentSessionId, agentId, agentType?, workflowId?}` | `{ok: true}`. `400 missing parentSessionId/agentId`. | open; registry only |
| `POST /relay/subagent/stop` | `{agentId, lastMessage?}` | `{ok: true}`. `400 missing agentId`. | open; registry only |
| `GET /relay/snapshot` | none | `{sessions, subagents}` | redacted for non-owners; none |
| `GET /ui/windows` | none | `[{id, label, activeTabId, tabCount}]`, `[]` when none. | open; none |
| `POST /ui/command` | `{windowId?, action, args?}` | The window's reply `{ok, result?, error?}`. | open; none |

The relay plugin's hooks post to the four ingest routes; they are best-effort and their errors are ignored.
`backend` is the id of the reporting agent CLI and defaults to `claude`; `agentType` defaults to `agent`.
For `GET /relay/snapshot`, a non-owner request gets the same shape with each subagent's `lastMessage` removed; every bookkeeping field is returned to everyone.

`POST /ui/command` sends `action` to the target window over its `/ui` socket.
The route requires only a non-empty `action`; the app handles `list-tabs`, `open-tab`, `close-tab`, `focus-tab`, `rename-tab`, `pin-tab`, `reorder-tab` and `run-command`.
Without `windowId`, the single open window is used: none open is `404 no Bismuth window is open`, several is `409`.
A window that never answers resolves `{ok: false}` after about 8 seconds.
Two guards run first: `run-command` with an id outside the app-control allow-list is `403`, and `open-tab` with `::chat:` content is `403`.
A missing `action` is `400 missing action`.

## Install, doctor and update

These routes act on the machine rather than the vault. They never invalidate vault caches and they never throw; a failure is reported in the body.

| Route | Request | Response | Access and effects |
|---|---|---|---|
| `GET /bismuth/install` | none | `{installed, version, cliPath, cliLinked, mcpRegistered}` | open; none |
| `POST /bismuth/install` | none | `{action, status, warnings}` | open; installs |
| `GET /doctor` | none | A `DoctorReport` from a dry run. | owner only; none |
| `POST /doctor/fix` | `{only?: string[]}` | The `DoctorReport` after repairs. | owner only; applies repairs |
| `GET /update/status` | none | `{available, behind, localSha, remoteSha, builtSha, dirty, reason?}` | open; none |
| `POST /update/apply` | none | The initial `UpdateProgress`. | open; starts a rebuild |
| `GET /update/progress` | none | `{phase, message?, log?}` | open; none |

`POST /bismuth/install` runs the idempotent, version-gated install of the CLI and MCP server from `BISMUTH_INSTALL_SRC`.
`action` is `up-to-date`, `installed`, `updated`, `would-install`, `would-update` or `skipped-no-src`; the last means the source is unset, as in a dev run.
See [install](../overview/install.md).

`GET /doctor` and `POST /doctor/fix` are owner only because findings carry paths and a fix deletes files. `POST /doctor/fix` with an `only` that is not an array of strings is `400`; a malformed list is never widened to fix everything. Findings and repair risks are in [doctor](../overview/doctor.md).

`GET /update/status` fetches `origin/main` and compares it with `HEAD`.
It reports `available: false` with a `reason` when this is not a source build (`not-a-source-build`), `not-a-git-repo`, `access-denied`, `repo-missing`, `git-not-found` or `no-upstream`.
`POST /update/apply` starts `git pull` and a rebuild in the background and returns at once; poll `GET /update/progress`, whose `phase` is `idle`, `pulling`, `building`, `ready` or `error`.
It answers with an error phase for a non-source build or a dirty working tree, and `idle` when already up to date.
See [self-update](../overview/self-update.md).

## Server state and change events

| Route | Request | Response | Access and effects |
|---|---|---|---|
| `GET /version` | none | `{version}` | open; none |
| `GET /events` | none | A server-sent event stream. | open; none |

`version` starts at 0 and rises on every vault change, so a client can poll it when the stream drops. The frontend keeps one `EventSource` and falls back to polling `GET /version`.

`GET /events` answers `text/event-stream` with `Cache-Control: no-store`.
The server sends a `: connected` comment at once, so a client connecting at version 0 gets headers immediately.
When `version` is above 0 it then sends a snapshot frame, and it sends a `: keepalive` comment every `server.sseHeartbeatMs`.
Clients must ignore lines starting with `:`.

Each change is one `data:` line followed by a blank line:

```text
data: {"version":42,"paths":["Notes/Idea.md"],"dirty":{"graph":false,"tree":false}}
```

The snapshot frame is `{"version":42,"paths":[]}` with no `dirty` field. `paths` lists the changed notes; an empty list means the extent is unknown. `dirty.graph` and `dirty.tree` tell consumers whether to refetch those views; editors reconcile on every version bump regardless.

## WebSockets

Three upgrades are handled before the route tables.
All share one origin rule: a request is allowed with no `Origin` header, or with an origin matching `http(s)://localhost` or `127.0.0.1` on any port, `tauri://…`, or `http(s)://10.x.x.x` on any port.
Any other origin gets `403 forbidden origin`.
A failed upgrade is `400 upgrade failed`; success is the Bun-managed `101`.

| Upgrade | Query | Purpose |
|---|---|---|
| `GET /chat` | `chatId?`, `rebind?` | The in-app visual chat. |
| `GET /ui` | `w?` | The per-window app-control channel. |
| `GET /terminal` | `cols`, `rows`, `termId?` | A terminal tab over a PTY. |

### GET /chat

`GET /chat` drives the chat driver over JSON text frames.
`chatId` is a stable id that lets a reconnect resume the same conversation; if absent the server generates one.
`rebind=1` marks a reconnect, so the server can send an error frame when the session it expects has already ended instead of silently starting fresh.

Client to server frames, discriminated by `type`:

| Frame | Effect |
|---|---|
| `{type: "open", provider?}` | Starts the session without a turn, so the header manifest, models and permission mode stream back first. A no-op when a session exists. |
| `{type: "user", text, images?, provider?}` | Runs a turn. `images` is `[{media_type, data}]` in base64; only `image/png`, `image/jpeg`, `image/gif` and `image/webp` with non-empty data are kept. |
| `{type: "resume", sessionId, provider?}` | Binds the socket to an existing session; the next `user` frame continues it. |
| `{type: "permission_response", id, behavior, always?}` | Answers a permission frame. `behavior` is `allow` or `deny`. |
| `{type: "question_response", id, answers?, cancelled?}` | Answers a question frame. `answers` maps each question's text to the chosen string. |
| `{type: "set_permission_mode", mode}` | Switches permission mode live. |
| `{type: "set_model", model}` | Switches model live. |
| `{type: "set_effort", effort}` | Switches reasoning effort live. |
| `{type: "stop"}` | Interrupts the running turn. |

A frame that is not valid JSON, or whose fields do not match, is ignored.
`provider` is resolved against the `chat.provider` setting; a `chatId` with a live session stays on its backend.
The server streams `ChatFrame` JSON back, the same shape `GET /chat/session-messages` replays.
A reconnect with the same `chatId` mid-turn re-points the running session to the new socket, so the rest of the turn arrives there.

A clean close (code 1000) ends the session at once. Any other close keeps it alive for a grace period of 30 seconds (`BISMUTH_CHAT_GRACE_MS`), so a reload resumes the same conversation.

### GET /ui

`GET /ui` registers one window.
`w` is the window's stable id and defaults to `main`.
The client sends `{type: "tabs", snapshot}` as a tab-layout heartbeat that powers `GET /ui/windows`, and `{type: "reply", reqId, ok, result?, error?}` to answer a command.
The server sends `{type: "command", reqId, action, args?}`.
A reconnect re-registers under the same id, and a stale close after a reconnect does not drop the live window.

### GET /terminal

`GET /terminal` requires `cols` and `rows` as integers from 1 to 500, else `400 bad cols/rows`. The socket resolves to a shell in this order:

1. If `termId` names a still-running PTY inside the grace window, the socket reattaches to the same shell, keeping its process, working directory and environment.
2. Otherwise the server claims a pre-warmed login shell from its pool, so the prompt appears at once.
3. Otherwise it spawns a fresh shell in the vault directory, reporting to this core's port.

Frames from the client start with a tag byte.
`0x00` followed by bytes is terminal input.
`0x01` followed by two little-endian `Uint16` values (`cols`, then `rows`) resizes the PTY.
The server sends PTY output as binary frames, flushing buffered output first.
When the shell exits the server closes with code 1000 and the reason `exited`.

A clean close kills the PTY. Any other close keeps it for 30 seconds (`BISMUTH_TERMINAL_GRACE_MS`) so a client can reattach by `termId`. The server pre-warms one shell at boot. Memory injection and relay variables are set in the PTY's environment; see [terminal](../terminal/overview.md).

## How it works

`createServer` in `core/src/server.ts` builds one `Bun.serve` instance.
It owns the state: the graph, tree, rows and tasks caches, the file watcher, the SSE registry, the owner token, `version` and the self-write marks.
It builds a single `RouteContext` and merges per-area route factories from `core/src/routes/`.
Each area exports a read factory (`vault`, `graph`, `settings`, `bases`, `tasks`, `daemon`, `gcal`, `relay`, `agents`, `system`, `memory`) and, where it writes the vault, a mutating factory.

The read table holds reads and the writes that do not touch the vault, such as daemon files and credentials.
The mutating table wraps each handler in `mutatingHandler(run, pathOf?)`, which clones the request, marks the paths from `pathOf` as self-written before `run`, takes the marks back off on an error response, then calls `invalidate`.
`invalidate` with no paths marks graph and tree dirty.
With paths it fingerprints the changed notes (wikilinks, tags, icon) to decide which are dirty, patches the search, rows and tasks caches, increments `version` and publishes the event.

`PUT /file`, `POST /daily-note` and `POST /gcal/sync` sit outside this wrapper's table but invalidate by hand, for the reasons given in their rows: a no-op daily note must not bump `version`, and a save should publish one event, not two.
The route key set is pinned by `core/src/routes/routeTable.test.ts`, so a route moved between modules cannot appear, vanish or change method unnoticed.
The in-process backend for mobile (`core/src/localBackend.ts`) answers the same keys without HTTP and refuses the machine-level ones, including doctor, status-bar trust and the daemon cron and process routes, with `501`; see the [mobile overview](../mobile/overview.md).

Source: `core/src/server.ts`, `core/src/routes/*.ts`, `core/src/ownerToken.ts`, `core/src/sse.ts`
