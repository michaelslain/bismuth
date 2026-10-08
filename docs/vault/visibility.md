# Visibility controls

Visibility marks a note or folder off-limits to Bismuth's own AI sessions, the daemon and the in-app chat, without changing your own access to it.
Read this page to mark things, to learn what each level blocks and which AI backends can honour it, and to see where the boundary holds and where it does not.

```yaml
# In a note's frontmatter
---
visibility: hidden
---

# In the vault's .settings, for folders
folderVisibility:
  Private: hidden
  drafts/wip: chat-only
```

## What do the three levels mean?

| Level | Daemon (crons, memory) | In-app chat | You |
|---|---|---|---|
| `all` (the default) | reads | reads | full access |
| `chat-only` | blocked | reads | full access |
| `hidden` | blocked | blocked | full access |

A level never restricts you. You can still open, edit and search a hidden note in the editor, the file tree, the graph and the `bismuth` CLI from your own shell.

A note with no `visibility` key inherits from its folders. That is why an absent key means "inherit", not "visible". An explicit `visibility: all` always wins over a restricted folder.

## How do I mark a note or folder?

- Sidebar: right-click a note or folder, choose **Visibility**, then pick **Visible to Daemon + Chat**, **Chat only** or **Hidden from both**.
  The active row has a check mark.
  Picking the first row clears the override; it does not write `visibility: all`.
  When an ancestor folder forces a stricter level, a disabled row at the top reads `Effective: Hidden — inherited from 'Private/'`.
- By hand: add `visibility: hidden` or `visibility: chat-only` to a note's frontmatter.
- CLI: `bismuth prop set "Private/secret.md" visibility hidden` marks a note.
  `bismuth folder-visibility Private hidden` marks a folder, and `bismuth folder-visibility Private --clear` removes the rule.
  An AI session cannot run these (see [rule files](#gate-rules-for-agents)).
- Settings file: edit `folderVisibility` in `.settings` directly.

A row in the sidebar shows a small badge for a restricted level, including a note that is restricted only by its folder. The tooltip says who it is hidden from.

The daemon builds its deny list again for every message, so it sees any edit on its next message.
An open Claude chat builds its deny list when it starts.
It re-reads the list on the next turn only after an edit that reaches the app's HTTP routes `POST /set-property`, `POST /delete-property` or `POST /folder-visibility`, which is what the sidebar menu calls.
The chat then restarts its sandbox with the new rules and resumes the same conversation.
A hand edit of a note or of `.settings`, a `bismuth prop set` or `bismuth folder-visibility` run, and a move into or out of a restricted folder do not re-gate an open chat; start a new chat to apply them.

## How does inheritance work?

A note's level is its own `visibility` value if it has one. Otherwise it is the setting of the nearest ancestor folder that has a rule, not necessarily the immediate parent. With no rule anywhere, it is `all`.

| Path | Own frontmatter | Folder rules | Effective |
|---|---|---|---|
| `Private/a.md` | none | `Private` is `hidden` | `hidden` |
| `Private/exposed.md` | `visibility: all` | `Private` is `hidden` | `all` |
| `Private/Drafts/b.md` | none | only `Private` is `hidden` | `hidden` |
| `notes/c.md` | `visibility: chat-only` | none | `chat-only` |
| `d.md` | none | none | `all` |

The explicit override has a cost: a `visibility: all` copied from a template into a note inside a hidden folder exposes it. The **Effective** row in the sidebar menu is where you see this.

Moving a note into or out of a restricted folder changes its level, because levels are worked out from the current path whenever the deny list is built.

Three silent traps, all of which fail toward more restriction:

- A `visibility:` value that is not exactly `all`, `chat-only` or `hidden` (`Hidden`, a list, a number) reads as `hidden`.
- A closed frontmatter block whose YAML does not parse reads as `hidden`.
- A `folderVisibility` entry with another value, such as `hiden`, or a `folderVisibility` that is not a map, makes the vault unavailable to AI sessions until you fix the file.

An empty `visibility:` counts as absent and inherits.

## What does visibility protect, and what does it not?

Visibility is an honesty boundary, not a security boundary.
This is its threat model: it stops Bismuth's own agent sessions from reading a marked file through their normal tool calls and through the local surfaces Bismuth exposes (the HTTP API and the `bismuth` CLI).
It does not defend against a process that is determined to get around it.

It restricts:

- the daemon's crons, its memory recall and its tool calls;
- the in-app chat's tool calls and the editor-context text added to each message;
- a `bismuth` command or HTTP request made by one of those sessions, which sees the vault minus the hidden notes;
- the vault's git history, which holds earlier plaintext copies, because the agent's sandbox cannot read `.git`.

It does not restrict:

- you, in the editor, tree, graph or CLI;
- your own terminal sessions, including a bare `claude` in a Bismuth terminal tab. They run as you and are never marked as an agent channel;
- content copied elsewhere before a note was hidden, such as text already captured into a memory note, or a copy of the file with its `visibility` line removed;
- the existence of a hidden file. Its name, size and modified time still show in a directory listing, a refusal message and the sidebar badge;
- a selection made in a base view. Text you select there goes to the chat tagged with the base file's path, so a hidden note's row content that a base you can see displays can reach the chat if you select it. Selecting inside the hidden note itself is filtered;
- a change made during a turn. A note hidden mid-turn is not covered until the turn ends.

## Which AI backends can honour hidden notes?

Claude Code is the only backend that enforces visibility, on both channels. A vault that restricts nothing works with every backend.

| Backend | In-app chat | Daemon | Verified |
|---|---|---|---|
| Claude Code | enforced | enforced | yes, [with live and unit tests](visibility-acceptance.md#claude-code) |
| opencode | refused | cannot run the daemon | no; no live acceptance run is complete |
| Codex | refused | falls back to Claude Code | no; Codex applies its own sandbox, so Bismuth cannot wrap it |
| Other agents (ACP backends) | refused | cannot run the daemon | no |

A refused chat does not start. The chat shows `<backend> can't honour this vault's hidden notes`, a message that gives only a count of restricted notes and never their names, and a **use claude code instead** button. Unhide the notes to use the backend you picked.

The daemon never throws on this. When a vault has any restricted note and `daemon.backend` names another backend, the run uses Claude Code instead. The reason is written at the top of the inbox page the run produces and in the cron's desktop notification.

The mechanism behind each value is described under [Per-backend/per-channel enforcement](#per-backendper-channel-enforcement).

In a restricted vault the Claude chat and the Claude daemon also lose the Grep and Glob tools and the `bismuth_cli` MCP tool. A per-file rule cannot stop a vault-wide scan, so those tools are switched off whole.

## Agents and the `bismuth` CLI: filtered, not refused

When an AI session runs a `bismuth` command, hiding a note costs it that one note and nothing more.
A command that lists or aggregates notes (`search`, `tree`, `graph`, `task`, `rows`, `base render`, `card`, `calendar` and others) returns its normal result minus the notes hidden from that session's channel.
An explicit path to a hidden note, such as `read Private/secret.md`, is refused.
A short list of commands that cannot be filtered is refused whenever the vault restricts anything.
Your own shell is never gated.

Which notes are hidden depends on the channel: the daemon loses `hidden` and `chat-only` notes, and chat loses `hidden` ones. A hidden folder hides everything under it.

The gate classifies every command by name into four tiers, and a command nobody classified is refused.

| Tier | Commands | Agent behaviour |
|---|---|---|
| Always safe | `backends` `doctor` `docs` `install` `uninstall` `app` `daemon` `agent-graph` `folder-icon` `backup` `page` `memory`, most of `settings`, `checkpoint advance` and `checkpoint ref` | Runs. None can return a note body. |
| Path-scoped | `read` `write` `move` `delete` `restore` `mkdir` `prop` `render` | Runs unless an argument names a restricted path. |
| Filtered | `tree` `templates` `graph` `search` `replace` `rows` `row` `base` `task` `card` `calendar` `gcal` `relay` `note` `daily` `checkpoint diff` | Runs with hidden notes left out; an explicit restricted path is still refused. |
| Refused when the vault restricts anything | `api` `serve` `export` `chat` `update` `checkpoint` (other than `diff`, `advance`, `ref`) `folder-visibility` `settings set` `settings unset` `settings status-bar`, and anything unclassified | Refused. |

Why each refused command stays refused:

- `api` passes through to any HTTP route, and many routes have no per-channel filter.
- `serve` starts a second unauthenticated core that the session could query with `curl`.
- `export` follows embeds and base sources, so a hidden note could be pulled in by an embed.
- `chat` holds session transcripts, which have no single path to filter.
- `folder-visibility`, `settings set` and `settings unset` rewrite the rules; a session that could clear a folder's `hidden` could read what it guarded.
- `settings status-bar` runs shell output and counts notes by a filter, neither of which can be filtered.
- `update` rebuilds the installed app with owner-level rights.

`memory` is always allowed and protects itself: `remember` and `forget` on a hidden memory note are refused for an agent, `recall` hides memory notes marked `chat-only` or `hidden` whatever the channel, and an agent's `--memory` must be exactly `<vault>/.daemon/memory`.

### What counts as a leak

Link text inside a visible note is visible content: `[[secret]]` written in `open.md` shows, because the agent can read `open.md`. What must not leak is anything derived from a hidden note.

| Derived surface | What an agent gets |
|---|---|
| Graph nodes and edges | A hidden note's node, and every edge touching it, is dropped. |
| Backlinks | A hidden note's link to a visible one is not a backlink. |
| Tag nodes and counts | A tag used only by hidden notes is dropped. A tag a visible note also uses stays. |
| Community labels | Communities are computed again on the filtered graph, so no label is a hidden note's title. |
| Tree entries | A hidden file is omitted. A folder is omitted when it is restricted, when it held a hidden file, or when an ancestor is omitted, unless a visible file sits beneath it. |
| Search hits, rows, tasks, cards, calendar events | Dropped before counting, grouping or sorting, so no total includes a hidden note. |
| Aggregates | Base summaries, charts, deck totals and match counts cover visible notes only. |
| Template bodies | A hidden template is never pulled in by name. A hidden and a missing template give the same message. |

If visibility cannot be determined for an agent (an unparseable `.settings`, an unreadable subtree), the command exits non-zero with no output and never falls back to unfiltered results.

### Gate rules for agents

These apply to the CLI's own dispatch and to the MCP `bismuth_cli` tool alike. They share one decision function. The owner, with neither `BISMUTH_AGENT_CHANNEL` nor `BISMUTH_MCP_CHANNEL` set, is never gated.

- Every candidate vault is checked. The gate collects each value of `--dir`, `--vault` and `BISMUTH_VAULT`, builds the deny list for each, and refuses if any refuses. Pointing `--dir` at an empty folder does not swap which vault is checked.
- A subfolder cannot stand in for the vault. Outside the always-safe tier, a root inside a vault that holds the `.settings` file is refused, because it would drop the vault's folder rules. A root at or under `<vault>/.daemon/memory` is exempt.
- Rule files and runnable definitions are off-limits. `.settings`, `settings.yaml`, `.daemon/processes` and the `.daemon` folder itself are refused for every command that is not always-safe, even in a vault that restricts nothing. A process definition is code the daemon runs outside any sandbox.
- Folder arguments are checked.
  A folder that is an ancestor of a hidden note, an ancestor of a restricting `folderVisibility` key, or itself restricted is refused by path-scoped commands.
  `move "Vault Hidden" Pub` and `delete "Vault Hidden"` are refused.
  Moving a folder that holds nothing hidden is not.
- The `.md` twin is checked. Every argument is checked as written and with `.md` appended, because `calendar create` and `base create` add the extension after the gate looks.
- `bismuth api` allows only GET for an agent, because a path inside a JSON body has no boundary for the gate to scan.
- HTTP-routed commands (`api`, `chat`, `gcal`, `relay`, `update`) are gated against the vault of every running core, not only the one named.
- Spellings are normalised. `..`, doubled slashes, symlinks, percent-encoding and case differences collapse to the real folder before the check.
- `.trash` follows the vault. When anything is restricted for a channel, everything under `.trash/` is too, because a trashed copy sits outside its original folder rule. A vault that restricts nothing keeps zero restricted entries, so a full trash never causes a refusal.
- Channel precedence. With both variables set, the stricter wins: `chat` only if both say `chat`, otherwise `daemon`. A garbled value counts as `daemon`. An empty `BISMUTH_AGENT_CHANNEL` counts as unset, so a stray `export BISMUTH_AGENT_CHANNEL=` does not lock you out.

### Accepted existence signals

An agent can still tell whether a path it already guessed exists.
The gate answers `Refused` for a hidden path and `ENOENT` for a missing one, because the refusal must say why.
`memory remember` and `memory forget` answer `refused` for a hidden memory note and `{ok:false}` for a missing one.
Both reveal only a name the agent supplied itself.

Known gaps: `settings get` prints the whole merged settings, including the `folderVisibility` map that names hidden folders.
The HTTP routes `/tree`, `/templates`, `/graph/views`, `/daily-note` and `/settings` have no per-channel filter of their own; the CLI filters in process and refuses `api`, so an agent cannot reach them through it.

## The deny-list preflight (`settings deny-list`)

An agent in a restricted vault can ask whether and how much is restricted without triggering a refusal. `bismuth settings deny-list [--channel chat|daemon]` reports the vault's restricted set for a channel; the default is `daemon`, the stricter one.

What it returns depends on who asks, so the command is never an enumeration oracle:

- You, from your own shell: `{ "channel": "daemon", "determined": true, "count": 12, "entries": ["Private/secret.md", ...] }` with the full path list.
- Any AI session (`chat` or `daemon` channel, or a CLI started by the MCP server): `{ "channel": "daemon", "determined": true, "count": 12 }`. The `entries` key is absent. It gives a count and never a path.
- When the walk fails: `{ "channel": "daemon", "determined": false, "reason": "..." }`. The reason names why the walk failed, never a path, so it is shown in full to everyone.

`settings` is in the always-safe tier, so the gate lets this command through even in a heavily restricted vault; the count-only branch is what protects an agent caller.
`settings status-bar`, `settings set` and `settings unset` are the exceptions: an agent is refused on them in a restricted vault.
Every `settings` subcommand is in the [CLI reference](../cli/reference.md).

## How it works

### Per-backend/per-channel enforcement

Each backend's `capabilities.visibilityGate` in the agent-backend catalog is an object with a value per channel, `{ chat, daemon }`. A value claims that a mechanism is wired and that it was verified live on that specific backend, never that it should work because it resembles one that does.

| Value | Meaning |
|---|---|
| `native` | The CLI's own policy and sandbox layers enforce it. Claude Code only. |
| `wrapper-macos` | Bismuth wraps the spawned process in an OS read-deny sandbox (Seatbelt). Where that is unavailable, it refuses at run time. |
| `none` | Nothing enforces it. A vault with any restricted note refuses this backend on this channel. |

Claude Code is `native` on both channels. Every other backend in the catalog is `none` on both, so a backend added to the catalog is refused until a recorded live acceptance run changes its entry. What each value rests on is in [Visibility acceptance](visibility-acceptance.md).

### Resolving a note's level

`core/src/visibility.ts` is the pure core, ported into `daemon/src/lib/visibility.ts` because the daemon workspace does not depend on `@bismuth/core`; `daemon/test/visibilityParity.test.ts` pins the two together.

```typescript
type Visibility = 'all' | 'chat-only' | 'hidden'

resolveVisibility(path, fileVisibility, folderVisibility)   // own value, else nearest ancestor, else 'all'
resolveFolderVisibility(path, folderVisibility)             // a folder's own entry counts as the deepest ancestor
isVisibleToChat(v)   // v !== 'hidden'
isVisibleToDaemon(v) // v === 'all'
```

A file's value is stored in its frontmatter, written through the generic `POST /set-property` and `POST /delete-property` routes.
A folder's value is stored in `.settings` under `folderVisibility`, written by `POST /folder-visibility` (`setFolderVisibility` in `core/src/settings.ts`).
A write through those routes re-gates open chats through `invalidateChatVisibility()`.
`GET /tree` stamps each entry with its resolved `visibility` and its `ownVisibility`; the sidebar badge and the enforcement gate call the same resolver, so the badge cannot disagree with what is enforced.
Memory notes under `.daemon/memory` carry their own `visibility` field (`memory/src/graph.ts`), have no folder cascade, and are gated by that field alone.

`buildDenyPaths(root, channel)` resolves every file's level and returns the restricted subset as `DenyEntry` objects (`rel`, `abs`, and `aliases` for other absolute spellings).
Entries are per file, so an explicit `all` inside a hidden folder is honoured by emitting no entry.
`resolveDenyPlan` wraps it with a third state, `determined: false`, for a vault it could not read, which every fail-safe consumer treats as restricted.
It is recomputed each time, with no cache.

### The discovery walk

`listVisibilityFiles` visits every regular file under the vault, any extension, in every directory including dot-directories.
It skips only `.git` (denied as its own subtree) and `.settings`.
Symlinked directories are followed, with the chain of canonical directory paths catching cycles and `MAX_WALK_ENTRIES` (200,000) bounding fan-out; a vault that hits the bound is undetermined, not empty.
A directory that cannot be read is undetermined too, except one that disappeared mid-walk.

1. The folder cascade is resolved first with no file I/O, memoised per directory.
2. A file's own frontmatter is read on every file, not only `.md`: a 512-byte head, re-read up to 64 KiB only when truncated without a closing fence. A file that does not start with `---` costs one small read. A fence still open at 64 KiB reads as `hidden`.
3. Stem inheritance: a file with no explicit value whose name before its first dot matches a restricted sibling in the same folder inherits the strictest such value.
   `sketch.draw.png` inherits from a hidden `sketch.draw`.
   It is deliberately over-inclusive, since a non-markdown file cannot opt back out.
4. When anything is restricted for the channel, `.trash/` is restricted too. Memory notes skip the folder cascade.

### Closing the ambient surfaces

A per-backend lock is useless beside an open window. These surfaces leak on every backend, so they are closed first.

- Local HTTP API.
  A per-boot random owner token (`core/src/ownerToken.ts`), sent as `X-Bismuth-Token`, identifies the app and CLI.
  A request without it resolves to a channel (`X-Bismuth-Channel: chat`, else `daemon`) and gets the same per-path filter as Claude's own tools.
  Content routes drop restricted rows and nodes.
  The transcript routes `GET /chat/sessions`, `GET /chat/session-messages` and `POST /chat/search` have no per-path filter and are owner-only.
- The token file.
  `~/.bismuth/run/<vault>.json` holds the token at mode `0600`, which does not stop an agent running as the same user.
  `buildSandboxDenyPaths` adds it, in both its spellings, to every channel's read-deny list.
- The `bismuth` CLI as a subprocess.
  The gate in `core/src/visibilityCliGate.ts` is hooked at the CLI's single dispatch point (`cli/src/index.ts`) and at the MCP server (`mcp/src/cli.ts`).
  An agent is a process with `BISMUTH_AGENT_CHANNEL` or `BISMUTH_MCP_CHANNEL` set, and every place Bismuth spawns an agent sets one.
  With neither set the caller is the owner.
- Git history.
  `<vault>/.git` is a subtree entry in every channel's deny list, so `git show` and `git log -p` fail while a visible file still reads.
  History is not rewritten, because it is the owner's backup.
- Case, Unicode and `..` spellings.
  `isDeniedPath` compares paths after resolving `.` and `..`, collapsing slashes, normalising Unicode to NFC and case-folding.
  It also matches anything under a restricted entry.
  A raw string comparison is never used for a live check.
- MCP tool coverage.
  The MCP `bismuth_cli` tool and the raw CLI share one gate.
  Every spawner sets `BISMUTH_MCP_CHANNEL`, and an unset value defaults to `daemon`.

An installed `bismuth-mcp` binary is a compiled copy (`core/src/bismuthInstall.ts`). If it predates a gate change, relaunch the app or run `bismuth install`; `bismuth install --status` shows the installed version.

`GET /asset` applies the same per-channel filter to the bytes it serves. A native `<img>` or `<video>` element cannot send the owner token header, so a request from one resolves to the `daemon` channel.

### Claude Code enforcement

For a restricted vault, `spawnChatQuery` in `core/src/chat.ts` and `buildQueryOptions` in `daemon/src/daemon/session.ts` configure the session with all of these together.

- `managedSettings.permissions.deny`: `Read`, `Edit`, `Grep` and `Glob` rules for each restricted file in both its relative and absolute form. Claude Code's Read does not consistently match a relative path against an absolute rule, so both are emitted.
- `sandbox.filesystem.denyRead`: the OS-level deny for the same files, `.git` and the token file. This is what stops a Bash `cat`, `python3 -c` or `bismuth read`; `managedSettings` only covers the tool-call convention.
- `sandbox.failIfUnavailable`: `true` whenever anything is restricted, so a sandbox that cannot start refuses the session instead of running it unprotected. An unrestricted vault omits the whole sandbox block.
- `sandbox.allowUnsandboxedCommands: false`: the model cannot switch its sandbox off with the Bash tool's `dangerouslyDisableSandbox` parameter.
- `disallowedTools`: `bismuth_cli`, `Grep` and `Glob`.
- `canUseTool` (chat): an in-process check that denies, with no prompt and no "always allow", any tool whose `file_path`, `notebook_path` or `path` is restricted.
- Environment: `BISMUTH_AGENT_CHANNEL` and `BISMUTH_MCP_CHANNEL` set to `chat` or `daemon`.

The sandbox and `managedSettings` are fixed when the session starts, so a visibility change respawns the chat's `query()` with fresh rules and resumes the same conversation (`respawnSession`).
If the new rules cannot be determined, the session ends with a `visibility-refused` error rather than continuing on the old list.
The daemon builds its deny list again for every message.
The daemon's persona also gets an advisory note naming off-limits notes; that is never counted as enforcement.

### The OS-sandbox wrapper

`core/src/agentBackends/sandboxWrapper.ts` wraps a backend's spawn arguments in `/usr/bin/sandbox-exec` with a generated Seatbelt profile.
The kernel enforces the read-deny on the whole process tree, so the structured read tool and a Bash fallback are blocked alike.
It is available only when all of these hold:

- the host is macOS and `sandbox-exec` exists;
- the backend does not apply its own Seatbelt profile (`selfSandboxes` in the catalog), because profiles do not nest and a nested spawn fails with `sandbox_apply: Operation not permitted` (exit 71). Claude Code and Codex both sandbox themselves;
- the wrapped process serves one vault, which rules out opencode's shared `serve` process and the daemon, one process for every vault;
- an exit code of 71 from a wrapped spawn is treated as a refusal, never retried unwrapped.

The profile denies `file-read*` by `subpath` for each restricted file or folder, `.git` and the token file.
A `literal` deny would not block the files inside a directory.
No backend in the catalog holds `wrapper-macos`.
Landlock and bubblewrap on Linux are untested, so `checkSandboxWrapperAvailability` reports the wrapper unavailable on every non-macOS host.

### The chokepoint, and why it lives in the router

`resolveVisibilityGate(backendId, channel, root)` in `core/src/agentBackends/visibilityGate.ts` is the single decision: may this backend serve this channel for this vault?
The chat router calls it from its session-creating verbs in `core/src/chatProviders/index.ts`.
It allows everything when nothing is restricted, and refuses in three more cases: the walk is undetermined, the backend id is unknown (validated before `backendOf()` could substitute the default backend's answer), and the catalog says `none` for that channel.

One chokepoint matters because separately written drivers cannot be kept in agreement by review, and a new backend is refused by default: its catalog entry starts at `none`, and the router reads the catalog rather than trusting the driver.
`core/test/agentBackends/visibilityGate.test.ts` pins this.
The refusal reaches the app as a `visibility-refused` `ChatFrame` error carrying the backend id and a count built by `visibilityRefusalMessage`; `app/src/chat/ChatSetupGate.tsx` renders it.

For the daemon, `resolveDaemonBackend` in `daemon/src/daemon/session.ts` holds the matching rule: only backends in `DAEMON_BACKENDS_WITH_VISIBILITY_GATE` (a hand-kept copy of the catalog's `native` daemon column) keep their place; any other backend with a restricted vault degrades to Claude Code.

### Memory recall

`searchMemory` (`memory/src/search.ts`) and the structured `query` (`memory/src/query.ts`) drop any memory note whose own `visibility` is `chat-only` or `hidden`, using `isMemoryNoteVisibleToDaemon` in `memory/src/graph.ts`.
Recall is a daemon-facing operation, so the stricter rule applies on every channel.
Memory frontmatter is parsed by hand; a duplicate `visibility` key resolves to the strictest value, and a malformed head counts as `hidden`.

Source: `core/src/visibility.ts`, `core/src/ownerToken.ts`, `core/src/visibilityCliGate.ts`, `core/src/visibilityFilter.ts`, `core/src/agentBackends/catalog.ts`, `core/src/agentBackends/sandboxWrapper.ts`, `core/src/agentBackends/visibilityGate.ts`, `core/src/chat.ts`, `core/src/chatProviders/index.ts`, `core/src/routes/vault.ts`, `core/src/settings.ts`, `daemon/src/lib/visibility.ts`, `daemon/src/daemon/session.ts`, `memory/src/graph.ts`, `memory/src/search.ts`, `memory/src/query.ts`, `mcp/src/cli.ts`, `cli/src/index.ts`, `cli/src/commands/settings.ts`, `app/src/FileTree.tsx`, `app/src/VisibilityBadge.tsx`, `app/src/chat/ChatSetupGate.tsx`
