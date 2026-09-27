# App control — driving a running Bismuth window

App control lets a Claude session or shell operate a running Bismuth window: it can inspect windows and tabs, manage tabs, run an approved UI command, and author a daemon inbox page. It is the only external route into the live webview.

It adds no MCP schemas. The existing `bismuth_cli` tool reaches the `app` CLI group for operations that need a running window and the headless `page` group for inbox pages. This keeps the machine-wide MCP catalog small; see [overview.md](overview.md).

---

## The command channel

```
bismuth app <verb>  ──HTTP──▶  core /ui/command  ──WebSocket──▶  the window  ──reply──▶  back out
```

- Each open window holds a **control WebSocket** to core at `GET /ui?w=<windowId>` (`app/src/uiControlClient.ts`). Core keys windows by their stable `?w=` id (`windowId.ts`; the primary window is `main`).
- The window reports its tab layout as `{type:"tabs", snapshot}` through App's existing tab-persistence effect. `GET /ui/windows` reads that report.
- A command is a request/reply round-trip in `core/src/uiControl.ts`, following `chat.ts`'s pending-reply pattern. Core sends `{type:"command", reqId, action, args}` and the window returns `{type:"reply", reqId, ok, result|error}`. If a window does not reply, the request resolves `{ok:false}` after about 8 seconds instead of hanging.
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
| `open-tab` | `{content, newTab?}` | Open a note path or sentinel — opening a file always opens its own tab and never replaces a pane; `newTab` is accepted and ignored, kept for compatibility |
| `close-tab` | `{tabId}` | Close a tab (whole pane tree) |
| `focus-tab` | `{tabId}` | Activate a tab |
| `rename-tab` | `{tabId, name}` | Set a custom label on a tab, overriding its auto content label |
| `pin-tab` | `{tabId, pinned}` | Pin (or unpin) a tab so pinned tabs lead the tab strip |
| `reorder-tab` | `{tabId, index}` | Move a tab to a new 0-based position in the tab strip |
| `run-command` | `{id}` | Run a command-catalog id (`core/src/commands.ts`) — allowlist-gated; the window awaits the action before replying, and an interactive command's `result` says so (see below) |

`content` is a vault path such as `reading/x.md` or one of `::graph`, `::daemon`, `.settings`, and `::term:<uuid>`. There is no `::search` sentinel: search is the in-window Cmd+O switcher, not a tab. `panes.ts` maps retired values through `LEGACY_CONTENT_IDS`, so an older script opening `::inbox` reaches `::daemon`.

`::chat:*` is refused because opening a live recursive Agent-SDK chat crosses a different trust boundary. `::daemon` is allowed: its inline chat has the real composer but no session until a trusted user press or focus arms it in `app/src/daemon/daemonChatArming.ts`, and app control cannot produce that gesture.

## `run-command`'s result: completed vs. waiting on a person

The window waits for an action before replying `ok:true`. Async commands such as `detect-ai`, `gcal-sync`, and `archive-tasks` report success only after they finish.

A small set of commands — `create-menu`, `emoji-library`, `edit-dictionary`, `daemon-owner`, `daemon-setup`, `bismuth-install`, `gcal-connect` — only opens a modal for a person to complete. They remain available through app control so, for example, an agent can open the Google Calendar connection dialog when asked how to connect it. `CommandSpec.interactive` in `core/src/commands.ts` marks these seven commands, and `run-command` reports that state:

```json
{ "ok": true, "result": { "interactive": true, "label": "Connect Google Calendar…", "note": "Opened \"Connect Google Calendar…\" — this needs a person to finish it in the app." } }
```

An ordinary command returns `{ "ok": true }`. Callers can use `result.interactive` to distinguish finished work from a dialog waiting for someone at the keyboard.

## `bismuth app` (needs a running app)

| Command | Notes |
|---|---|
| `bismuth app windows` | list open windows |
| `bismuth app tabs [--window <id>]` | list tabs + panes |
| `bismuth app open <content> [--new-tab] [--window <id>]` | open a note/sentinel |
| `bismuth app close <tabId> [--window <id>]` | close a tab |
| `bismuth app focus <tabId> [--window <id>]` | focus a tab |
| `bismuth app rename <tabId> <name> [--window <id>]` | set a tab's custom label |
| `bismuth app pin <tabId> [--off] [--window <id>]` | pin (or `--off` to unpin) a tab |
| `bismuth app reorder <tabId> <index> [--window <id>]` | move a tab to a new position |
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

`run-command` refuses `core/src/commands.ts`'s `UI_CONTROL_BLOCKLIST` — heavyweight/system verbs an unattended caller shouldn't fire blindly, plus opening a chat: `new-window`, `open-folder`, `update-app`, `daemon-update`, `new-claude-chat`. Enforced authoritatively by `POST /ui/command` and mirrored in the frontend dispatch (`app/src/uiControlClient.ts`). `bismuth app commands` lists what remains.

Source: `core/src/uiControl.ts`, `core/src/runRegistry.ts`, `core/src/daemonPages.ts`, `app/src/uiControlClient.ts`, `cli/src/commands/app.ts`, `cli/src/commands/page.ts`, `core/src/server.ts`, `core/src/commands.ts`
