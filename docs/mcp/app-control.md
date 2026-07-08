# App control — driving a running Bismuth window

A Claude session (or any shell) can drive a **running Bismuth app**: list its open windows, list/open/close/focus tabs, run a safe UI command, and author a daemon inbox page. This is the one surface that reaches into the live webview from outside it.

It adds **zero new MCP tools**. Everything routes through the existing `bismuth_cli` tool via two CLI groups — `app` (needs a running app) and `page` (headless). See [overview.md](overview.md) for why (a machine-wide MCP mustn't grow its always-listed tool set).

---

## The command channel

```
bismuth app <verb>  ──HTTP──▶  core /ui/command  ──WebSocket──▶  the window  ──reply──▶  back out
```

- Each open window holds a **control WebSocket** to core at `GET /ui?w=<windowId>` (`app/src/uiControlClient.ts`). Core keys windows by their stable `?w=` id (`windowId.ts`; the primary window is `main`).
- The window **heartbeats** its tab layout (`{type:"tabs", snapshot}`), piggybacked on App's existing tab-persistence effect — that's what `GET /ui/windows` lists.
- A command is a request/reply round-trip (`core/src/uiControl.ts`, modeled on `chat.ts`'s pending-reply idiom): core pushes `{type:"command", reqId, action, args}`, the window answers `{type:"reply", reqId, ok, result|error}`. A window that never answers resolves `{ok:false}` after ~8s — it never hangs the caller.
- Both `/ui/windows` and `/ui/command` are **read-table** routes (no cache invalidation): any vault mutation a command triggers runs its own invalidation path.

## HTTP routes

| Route | Body | Returns |
|---|---|---|
| `GET /ui/windows` | — | `[{id, label, activeTabId, tabCount}]` — connected windows (`[]` when none) |
| `POST /ui/command` | `{windowId?, action, args?}` | `{ok, result?, error?}` — the window's reply |

`POST /ui/command` picks the target window: `windowId` when given (must be connected), else the single open window — **zero windows → 404**, **several → 409** (pass `windowId`). Two gates run **before** dispatch (mirrored client-side): `run-command` refuses a blocklisted id (403), `open-tab` refuses `::chat:` content (403).

## Actions

| Action | args | Effect |
|---|---|---|
| `list-tabs` | — | `{tabs:[{tabId, label, active, leaves:[{leafId, content, label, icon?, active}]}], activeTabId}` |
| `open-tab` | `{content, newTab?}` | Open a note path or sentinel; `newTab` opens its own tab vs. the focused pane |
| `close-tab` | `{tabId}` | Close a tab (whole pane tree) |
| `focus-tab` | `{tabId}` | Activate a tab |
| `run-command` | `{id}` | Run a command-catalog id (`core/src/commands.ts`) — allowlist-gated |

`content` is a vault path (`reading/x.md`) or a sentinel: `::graph`, `::inbox`, `.settings`, `::term:<uuid>`. (There is no `::search` sentinel — search is the in-window Cmd+O switcher, not a tab.) **`::chat:*` is refused** — opening a live recursive Agent-SDK chat is a deliberately different trust boundary.

## `bismuth app` (needs a running app)

| Command | Notes |
|---|---|
| `bismuth app windows` | list open windows |
| `bismuth app tabs [--window <id>]` | list tabs + panes |
| `bismuth app open <content> [--new-tab] [--window <id>]` | open a note/sentinel |
| `bismuth app close <tabId> [--window <id>]` | close a tab |
| `bismuth app focus <tabId> [--window <id>]` | focus a tab |
| `bismuth app run <commandId> [--window <id>]` | run a safe command |
| `bismuth app commands` | the ids `app run` accepts (catalog − blocklist) |

**Core discovery** (which running core to reach): `--api <url>` → `BISMUTH_API` → `CLAUDE_RELAY_URL` → the **run-registry** (`~/.bismuth/run/<b64url(vault)>.json = {port, vault, pid}`, written by every core on boot — `core/src/runRegistry.ts`; matched by `--vault`/`BISMUTH_VAULT`, else the single running core) → `:4321`. In-app terminal tabs already carry `BISMUTH_API`/`CLAUDE_RELAY_URL` (`core/src/terminal.ts`), so `bismuth app …` from inside a tab targets its own window with no flags.

## `bismuth page` (headless — the daemon inbox)

| Command | Notes |
|---|---|
| `bismuth page list [--retention-days <n>]` | pages merged with their `.state` sidecar |
| `bismuth page create <slug> [--title …] [--body …] [--actions '<json>'] [--source …] [--deliver-at <iso>]` | authored via the validated `createDaemonPage` (`POST /daemon/pages`) |
| `bismuth page resolve <page-path> <actionId>` | press an action (approve → daemon runs; dismiss → resolved locally) |
| `bismuth page mark-failed <page-path>` | force a stuck `working` page to `failed` |

`create` validates the slug and stamps `type: daemon-page` + `createdAt`, serializing the nested `actions[]` correctly — see [daemon/pages.md](../daemon/pages.md).

## The blocklist (auditable, at two layers)

`run-command` refuses `core/src/commands.ts`'s `UI_CONTROL_BLOCKLIST` — heavyweight/system verbs an unattended caller shouldn't fire blindly, plus opening a chat: `new-window`, `open-folder`, `update-app`, `update-daemon`, `new-claude-chat`. Enforced authoritatively by `POST /ui/command` and mirrored in the frontend dispatch (`app/src/uiControlClient.ts`). `bismuth app commands` lists what remains.

Source: core/src/uiControl.ts, core/src/runRegistry.ts, core/src/daemonPages.ts, app/src/uiControlClient.ts, cli/src/commands/app.ts, cli/src/commands/page.ts, core/src/server.ts, core/src/commands.ts
