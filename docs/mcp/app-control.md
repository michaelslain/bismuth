# App control

App control lets an AI agent or a shell script operate a running Bismuth window: list windows and tabs, open, close, focus, rename, pin and reorder tabs, run a safe command, and author an inbox page. It is the only outside route into the live window. It adds no MCP tools: an agent reaches it through `bismuth_cli`, using the `app` command group for window operations and the `page` group for inbox pages. See [the MCP overview](overview.md) for why the tool list stays short.

```bash
bismuth app windows --pretty
bismuth app tabs --pretty
bismuth app open ::daemon
```

The `app` commands need a running app. When none answers they fail with `could not reach a running Bismuth app at <url> — open the app, or pass --api <url>`.

## Commands

| Command | Effect |
|---|---|
| `bismuth app windows` | List open windows: id, label, active tab, tab count |
| `bismuth app tabs [--window <id>]` | List a window's tabs and the panes in each |
| `bismuth app open <content> [--new-tab] [--window <id>]` | Open a note path or a sentinel in its own tab |
| `bismuth app close <tabId> [--window <id>]` | Close a tab and its panes |
| `bismuth app focus <tabId> [--window <id>]` | Make a tab active |
| `bismuth app rename <tabId> <name> [--window <id>]` | Give a tab a custom label |
| `bismuth app pin <tabId> [--off] [--window <id>]` | Pin a tab so it leads the strip; `--off` unpins |
| `bismuth app reorder <tabId> <index> [--window <id>]` | Move a tab to a 0-based position |
| `bismuth app run <commandId> [--window <id>]` | Run a command from the palette's catalog |
| `bismuth app commands` | List the ids `app run` accepts |

`content` for `app open` is a vault path such as `reading/x.md`, or one of the sentinels `::graph`, `::daemon`, `.settings` and `::term:<uuid>`. Opening a file always opens its own tab, and `--new-tab` is accepted without effect. Search is the Cmd+O switcher inside the window, so there is no sentinel for it. Tab ids come from `app tabs`.

With one window open, every command targets it. With none, the command fails with `no Bismuth window is open`; with several it fails and asks for `--window <id>`, which `app windows` lists.

Which running app the command reaches is decided in this order: `--api <url>`, the `BISMUTH_API` variable, `CLAUDE_RELAY_URL`, the app registered for `--vault` or `BISMUTH_VAULT` (else the only running app) in `~/.bismuth/run`, and finally `http://localhost:4321`. A terminal tab inside the app already has `BISMUTH_API` set, so `bismuth app …` there drives its own window with no flags.

## Inbox pages without a window

The `page` group works on the daemon inbox with no running app. `page create` writes a validated page so a caller never hand-writes the nested `actions` YAML.

| Command | Effect |
|---|---|
| `bismuth page list [--retention-days <n>]` | Pages with their status |
| `bismuth page create <slug> [--title …] [--body …] [--actions '<json>'] [--source …] [--deliver-at <iso>]` | Write a page |
| `bismuth page resolve <page-path> <actionId>` | Press a page's button |
| `bismuth page mark-failed <page-path>` | Force a stuck `working` page to `failed` |

All of them take `--vault <dir>`. The format and lifecycle are in [pages](../daemon/pages.md).

## Run a command

`app run <commandId>` runs a command from the palette catalog and waits for it to finish before it replies, so an async command such as `gcal-sync` reports success only after it completes.

Some commands only open a dialog that a person must finish: `create-menu`, `emoji-library`, `edit-dictionary`, `daemon-owner`, `daemon-setup`, `bismuth-install`, `free-agent-setup`, `gcal-connect` and `quick-ask`. All but `quick-ask` stay available so an agent can open, for example, the Google Calendar connection dialog when you ask how to connect it. For these the reply says so:

```json
{ "ok": true, "result": { "interactive": true, "label": "Connect Google Calendar…", "note": "Opened \"Connect Google Calendar…\" — this needs a person to finish it in the app." } }
```

An ordinary command replies `{ "ok": true }`. Read `result.interactive` to tell finished work from a dialog waiting for someone at the keyboard.

## What app control refuses

| Refused | Why |
|---|---|
| `app run` with `new-window`, `open-folder`, `update-app`, `daemon-update`, `new-claude-chat` or `quick-ask` | Heavy or system-level actions, or a live agent session, that an unattended caller should not fire blindly. A person has to type a quick ask |
| `app open` with any `::chat:` content | A chat is a live agent session, a different trust boundary from opening a note |

Both refusals return HTTP 403 with a message. `app commands` lists the ids that remain. Opening the daemon page (`::daemon`) is allowed because its chat starts nothing until a person clicks or focuses the composer, and app control cannot produce that gesture.

## How it works

```
bismuth app <verb>  --HTTP-->  core /ui/command  --WebSocket-->  the window  --reply-->  back out
```

Each open window holds a control WebSocket to core at `/ui?w=<windowId>` (`app/src/uiControlClient.ts`), keyed by a stable window id; the primary window is `main`. The window reports its tab layout through the same effect that persists tabs, and `GET /ui/windows` reads that report.

`POST /ui/command` takes `{windowId?, action, args?}`. Core picks the window (`windowId` if given and connected, else the only one: 404 for none, 409 for several), sends `{type: "command", reqId, action, args}`, and waits for the window's `{type: "reply", reqId, ok, result | error}`. A window that does not answer within 8 seconds resolves `{ok: false}` instead of hanging (`core/src/uiControl.ts`). Both routes are read-table routes with no cache invalidation; any vault change a command causes runs its own invalidation.

| Route | Body | Returns |
|---|---|---|
| `GET /ui/windows` | none | `[{id, label, activeTabId, tabCount}]`, or `[]` |
| `POST /ui/command` | `{windowId?, action, args?}` | `{ok, result?, error?}` |

| Action | `args` |
|---|---|
| `list-tabs` | none. Replies `{tabs: [{tabId, label, active, leaves: [{leafId, content, label, icon?, active}]}], activeTabId}` |
| `open-tab` | `{content, newTab?}` |
| `close-tab`, `focus-tab` | `{tabId}` |
| `rename-tab` | `{tabId, name}` |
| `pin-tab` | `{tabId, pinned}` |
| `reorder-tab` | `{tabId, index}` |
| `run-command` | `{id}` |

The two refusals run twice, in the route before dispatch and again in the window's handler. `UI_CONTROL_BLOCKLIST` in `core/src/commands.ts` holds the blocked command ids, and the commands that only open a dialog carry `interactive: true` in `COMMAND_CATALOG` in the same file.

Source: `core/src/uiControl.ts`, `core/src/routes/relay.ts`, `core/src/runRegistry.ts`, `core/src/commands.ts`, `core/src/daemonPages.ts`, `app/src/uiControlClient.ts`, `cli/src/commands/{app,page}.ts`, `cli/src/http.ts`
