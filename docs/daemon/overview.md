# Daemon

The daemon is Bismuth's background agent. One machine process serves every vault whose `daemon.enabled` setting is on: it fires each vault's scheduled prompts (crons), supervises its background processes, keeps its memory graph, and files inbox pages when it needs your approval. It runs as a launchd or systemd service, so it keeps working while the app is closed. To turn it on, follow [Set up the daemon](setup.md).

A vault's daemon is a folder of plain markdown. This is `<vault>/.daemon/` for a vault with one cron and a few memory notes:

```
.daemon/
  identity.md          name and personality
  crons/dream.md       a cron: frontmatter schedule + the prompt as the body
  processes/           background processes
  memory/              the memory graph
  pages/               inbox pages
```

## What the daemon is made of

| Part | What it does | Page |
|---|---|---|
| Crons | Fire a prompt in a fresh session, on a schedule or when a vault file changes | [crons-and-processes.md](crons-and-processes.md) |
| Background processes | Keep a long-lived command running, restart it when it exits | [crons-and-processes.md](crons-and-processes.md) |
| Memory | The "3rd brain": notes the daemon and your agents read and write | [memory.md](memory.md) |
| Inbox pages | Drafts that wait for you to approve or dismiss | [pages.md](pages.md) |
| Identity | The daemon's name and personality | below |
| Daemon page | The app's view of all of it | below |

[Communication](communication.md) covers how memory reaches agent sessions and how several devices share one daemon. [Storage](storage.md) lists every file. [Lifecycle](lifecycle.md) covers the service, boot and shutdown.

## Name the daemon and set its personality

`identity.md` holds the daemon's name and personality. The `name` in the frontmatter labels the `.daemon` folder in the file tree, the daemon page, and the `You are <name>.` line every daemon session starts with. The body is the personality, added to the system prompt of every cron and page session.

```markdown
---
name: daemon
---

A persistent personal-assistant daemon for this Bismuth vault, running continuously in the
background with durable memory.
```

Edit the file like any note, or hover the daemon's name on the daemon page and choose **edit**. The daemon reads the body fresh for each session, so an edit applies to the next cron or page. The name defaults to `daemon` when the file is missing or has no `name`. A new vault gets a default `identity.md`; the daemon never overwrites one that exists.

## Choose the backend: Claude or Codex

`daemon.backend` picks the agent CLI that runs a vault's daemon sessions: `claude` (the default) or `codex`. The key is a request, not a guarantee. Only Claude Code can enforce [the vault's visibility settings](../vault/visibility.md) on an unattended session, so a vault with any `hidden` or `chat-only` note runs on Claude whatever the key says. The daemon logs the downgrade, and it appears in the result note of an approved page and in the notification of a cron with `notify: true`. The refusal does not stop crons. Clear the vault's hidden notes to run Codex.

Codex runs through your own installed `codex` command. If you opt in with `codex.writeAgentsMd`, the daemon also keeps a managed block in the vault's `AGENTS.md`.

## Let daemon sessions use your own MCP servers

Daemon sessions get exactly one MCP server, Bismuth's, aimed at the vault. Your other MCP servers and plugins stay out because a cron runs unattended with permissions bypassed. Set `daemon.inheritUserMcp: true` to add the MCP servers and plugins from your own Claude Code user configuration (`~/.claude.json` and `~/.claude/settings.json`). Every cron then holds every tool those servers expose, with no confirmation prompt. Project and local scope are never loaded: a daemon session runs with the vault as its working directory, so a `.mcp.json` inside your notes would otherwise execute unattended.

## Daemon page

The daemon page is the tab with id `::daemon`. Open it with the **Open daemon** command, the inbox button in the sidebar toolbar, the status bar's inbox readout, or the **Review** action on a "pages ready for review" toast.

The left column is the daemon: a face, its name, and a chat. The right column has these boxes.

| Box | Rows | Actions |
|---|---|---|
| inbox | One line per open page: status dot, title, age | Click to open the page; `[ archive ]` on hover deletes it |
| crons | Name, schedule or watched path, last result | `[ run ]` on hover; right-click for Run now, Enable or Disable, Delete |
| services | One per background process, `on` or `off` | Right-click for Enable or Disable, Delete |
| log | Recent activity events, newest first | None |

Click a box heading to open that section across the whole page; Esc or **close** returns. Rows that need you (a due or failed page, a failed cron) sort first, and a box too short for its rows ends with a `+N more` line that opens the section. A trailing `N resolved` line opens resolved inbox pages. The page has no create control: ask the daemon in its chat for a cron or a service, and approve the command it runs.

The status at the top right is one of:

| Status | Meaning |
|---|---|
| `asleep // daemon is off` | `daemon.enabled` is false |
| `asleep // daemon not running` | Enabled, but the service is not up; run `bismuth daemon setup` |
| `waking // reading the daemon` | The page has not received its first snapshot |
| `working // dream +1` | A cron is running now, with a count of the others |
| `watching // last: dream 12m ago` | Idle; the most recent run |
| `watching // nothing has run yet` | Idle; nothing has fired |

The face changes with the same state, first match wins: asleep when off or not running; talking or thinking while the chat replies; listening while you type in the chat; hurt when a cron failed in the last 30 minutes; busy while a cron or an approved page runs; alert when pages wait for review; idle otherwise.

The chat under the face is an ordinary Bismuth chat shown under the daemon's name. It is not the session that runs crons, and it does not use `identity.md`. Opening the page starts no session: the chat starts only when you click or focus its composer, so an agent that opens the page through app control cannot start one. With the daemon off, the page shows the sleeping face and `set daemon.enabled: true in .settings to wake it`.

## Print the daemon graph from the CLI

`bismuth daemon graph --vault <vault>` prints a JSON graph of the daemon: one hub (`::daemon`, labeled with the daemon's name), a `cron:<name>` node per cron, a `process:<name>` node per process, and a `supervises` edge from the hub to each. Each node carries its `enabled` and `running` state, and a cron also carries `schedule`, `on`, `watch` and `lastResult`. The app's graph view draws none of this. `daemon_list` in [the MCP daemon tools](../mcp/daemon-tools.md) returns the same output.

```bash
bismuth daemon graph --vault ~/vault --pretty
```

## How it works

### One runtime, many brains

There is one daemon process per machine. At boot it starts a "brain" for every registered vault with `daemon.enabled` true, and a reconcile loop re-checks every vault each minute, so flipping the key takes effect with no restart. A brain is a vault's processes, trigger watchers and file watcher; crons run from one scheduler that visits every enabled vault each tick. Disabling a vault pauses its brain and never deletes its files.

State is split in two. Machine state (device identity, the owner, the pid, the vault list) lives in `~/.bismuth/daemon`, resolved by `MACHINE_DIR` in `daemon/src/lib/config.ts` (override: `BISMUTH_DAEMON_DIR`). Each vault's brain lives under `<vault>/.daemon`, resolved by `vaultPaths(root)` into a `VaultContext` that every cron, process and session function takes, so two vaults never share state. [Storage](storage.md) has the file-by-file layout.

### How a daemon session is built

Every cron fire, approved page and similar run calls `sendMessage` in `daemon/src/daemon/session.ts` with `newSession: true`, so each starts its own session; the daemon holds no always-on conversation. `buildQueryOptions` assembles each Claude session:

- `cwd` is the vault root and `permissionMode` is `bypassPermissions`.
- The environment adds `BISMUTH_MEMORY_DIR` (this vault's `.daemon/memory`), `BISMUTH_CLI`, an augmented `PATH`, and `BISMUTH_AGENT_CHANNEL=daemon`, which marks the session's own `bismuth` calls as an agent's for the visibility gate.
- The system prompt is the `claude_code` preset with the persona from `buildDaemonPersona` appended: `You are <name>.`, the `identity.md` body, and, when notes are restricted, an advisory list of them.
- The model defaults to `haiku`, run through your own installed `claude` binary with its login (no API key). A cron's `model` and `effort` keys override the model and effort.
- `mcpServers` holds one `bismuth` server: `~/.bismuth/bin/bismuth-mcp` with `BISMUTH_VAULT`, `BISMUTH_MEMORY_DIR`, `BISMUTH_DOCS_DIR`, `BISMUTH_CLI`, and the two channel stamps. `settingSources` is `[]`, or `['user']` when `daemon.inheritUserMcp` is true. The programmatic `bismuth` entry wins a name collision with your own, so the vault stamps hold either way.
- When the vault restricts any note, the options add `managedSettings.permissions.deny`, a sandbox with `denyRead` on the restricted files, and `disallowedTools` for `mcp__bismuth__bismuth_cli`, `Grep` and `Glob`. A restricted vault therefore gives up the `bismuth_cli` tool in daemon sessions.

The MCP path is absolute because launchd's `PATH` is minimal. If the bundled tools are not installed, the session gets no MCP block, logs an error line for each send, and has no `remember`, `recall` or `forget` tools. `settingSources` stays pinned on that path. `cronMemoryInstruction` in `daemon/src/daemon/cron.ts` appends the memory directory to every cron prompt and tells a session without `remember` to write nothing.

An owner check opens `sendMessage`: a device that is not the owner throws, so only one device's daemon drives sessions. See [communication](communication.md#which-device-runs-the-daemon).

### Backend selection and Codex

`resolveDaemonBackend` is the one place a backend is chosen. Only `claude` is in `DAEMON_BACKENDS_WITH_VISIBILITY_GATE`, so any other request with a restricted note count above zero returns `claude` plus a refusal string. `sendMessage` returns that string as `backendRefusal` for callers to show.

The Codex path (`daemon/src/daemon/codexSession.ts`) spawns `codex exec` directly, with `--sandbox workspace-write`, `--cd <vault root>`, `approval_policy="never"` and `developer_instructions` set to the same persona text, on every call. Thread continuity is `<vault>/.daemon/codex-session-id`, separate from Claude's `session-id`. `CODEX_HOME` points at `<vault>/.daemon/codex`, and `buildCodexEnv` always sets `BISMUTH_MEMORY_DIR`, `BISMUTH_VAULT` and `BISMUTH_AGENT_CHANNEL`. The effort values are `minimal`, `low`, `medium`, `high` and `xhigh`.

### How the app reads the daemon

Core reads and lightly writes the daemon's files; it never calls the daemon process. `daemonSnapshot()` in `core/src/daemonGraph.ts` reads a vault's crons, processes and identity for `GET /daemon/snapshot`, and `daemonGraph()` turns the same snapshot into the CLI graph. Liveness is machine-level (`daemon.pid` plus a signal-0 check), while crons and processes are per vault. A process's `running` field is always false in the snapshot, so the app shows a service as live when it is enabled and the daemon is up. Every reader returns an empty value instead of throwing, so a daemon that has never run does not break core.

`app/src/daemon/DaemonPageHost.tsx` polls `GET /daemon/snapshot` every 4 seconds and `GET /daemon/logs` every 5 seconds while the page is mounted and the daemon is enabled, and skips ticks while the document is hidden. The inbox list is the app-wide `GET /daemon/pages` poll. The chat is armed by a trusted pointer or focus event on its composer (`daemonChatArming.ts`).

### Install and update

The bundled app ships the compiled daemon. On every launch it copies a newer build to `~/.bismuth/bin/bismuth-daemon` and runs `--ensure-installed` (`core/src/daemonInstall.ts`). The daemon updates with the app. [Lifecycle](lifecycle.md#install) has the details.

Source: `daemon/src/daemon/{index,session,codexSession,persona,cron,seeds}.ts`, `daemon/src/lib/{config,registry,owner,bismuthPaths}.ts`, `core/src/{daemon,daemonGraph,daemonInstall}.ts`, `core/src/schema/settingsSchema.ts`, `app/src/daemon/{DaemonPage,DaemonPageHost,DaemonHub,daemonFaceModel,daemonPageModel}.ts*`
