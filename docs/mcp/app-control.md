# App control

App control lets an AI agent or a shell script operate a running Bismuth window: list windows and tabs, open, close, focus, rename, pin and reorder tabs, scroll a pane, run a safe command, and author an inbox page. It is the only outside route into the live window. It adds no MCP tools: an agent reaches it through `bismuth_cli`, using the `app` command group for window operations and the `page` group for inbox pages. See [the MCP overview](overview.md) for why the tool list stays short.

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
| `bismuth app open <content> [--new-tab] [--window <id>]` | Open a vault file of any type, or a sentinel, in its own tab, and print `{"opened": "<content>"}` |
| `bismuth app close <tabId> [--window <id>]` | Close a tab and its panes |
| `bismuth app focus <tabId> [--window <id>]` | Make a tab active |
| `bismuth app rename <tabId> <name> [--window <id>]` | Give a tab a custom label |
| `bismuth app pin <tabId> [--off] [--window <id>]` | Pin a tab so it leads the strip; `--off` unpins |
| `bismuth app reorder <tabId> <index> [--window <id>]` | Move a tab to a 0-based position |
| `bismuth app scroll [<tabId>] [--pane <leafId>] [--by <px> \| --pages <n> \| --to <where>] [--window <id>]` | Scroll a pane in the active tab and print where it sits |
| `bismuth app run <commandId> [--window <id>]` | Run a command from the palette's catalog |
| `bismuth app commands` | List the ids `app run` accepts |

`content` for `app open` is a vault-relative path such as `reading/x.md` or `papers/y.pdf`, or one of the sentinels `::graph`, `::daemon`, `.settings` and `::term:<uuid>`. An absolute path inside the vault is accepted and opened as its vault-relative path, and a path with no extension that names a note opens that note (`reading/x` opens `reading/x.md`). Opening a file always opens its own tab, and `--new-tab` is accepted without effect.

A path that names no file fails with exit code 1 and `404: no file "<path>" in the vault`, and no tab opens. `app open` opens the whole file: a `#page=` or `#heading` suffix is not a jump target, so `papers/y.pdf#page=12` is refused as a missing file. Search is the Cmd+O switcher inside the window, so there is no sentinel for it. Tab ids come from `app tabs`.

With one window open, every command targets it. With none, the command fails with `no Bismuth window is open`; with several it fails and asks for `--window <id>`, which `app windows` lists.

Which running app the command reaches is decided in this order: `--api <url>`, the `BISMUTH_API` variable, `CLAUDE_RELAY_URL`, the app registered for `--vault` or `BISMUTH_VAULT` (else the only running app) in `~/.bismuth/run`, and finally `http://localhost:4321`. A terminal tab inside the app already has `BISMUTH_API` set, so `bismuth app …` there drives its own window with no flags.

## Inbox pages without a window

The `page` group works on the daemon inbox with no running app. `page create` writes a validated page so a caller never hand-writes the nested `actions` YAML.

| Command | Effect |
|---|---|
| `bismuth page list [--retention-days <n>]` | Pages with their status |
| `bismuth page create <slug> [--title …] [--body …] [--actions '<json>'] [--source …] [--deliver-at <iso>]` | Write a page |
| `bismuth page resolve <page-path> <actionId>` | Press a page's button |
| `bismuth page reply <page-path> <text...>` | Answer a page in plain words |
| `bismuth page mark-failed <page-path>` | Force a stuck `working` page to `failed` |

All of them take `--vault <dir>`. The format and lifecycle are in [pages](../daemon/pages.md).

## Scroll a pane

`app scroll` scrolls a pane in the window's active tab: a note, a PDF, a base, a terminal's scrollback, or any other view with content taller than its pane. It targets the focused pane unless `--pane <leafId>` names another pane of the active tab; leaf ids come from `app tabs`.

```bash
bismuth app scroll --pages 1        # down one page
bismuth app scroll --by -400        # up 400 pixels
bismuth app scroll --to 0.5         # halfway down
bismuth app scroll --to bottom
bismuth app scroll                  # read the position, move nothing
```

| Flag | Moves |
|---|---|
| `--by <px>` | By pixels; negative scrolls up |
| `--pages <n>` | By pages; one page is 90% of the visible height, so a line of context carries over |
| `--to top`, `--to bottom`, `--to <0-1>` | To the top, the bottom, or a fraction of the way down |

Pass at most one of the three. Every call prints where the pane ended up, which a reader of a long note uses to know when it reached the end:

```json
{ "leafId": "250d6653-…", "content": "long.md", "top": 8718, "max": 17436, "height": 759, "fraction": 0.5 }
```

`top` is the scroll offset in pixels, `max` the largest offset, `height` the visible height, and `fraction` is `top / max`. A scroll past either end stops there without an error. A note's `max` can shift by a few pixels after a jump, because the editor measures the lines it has scrolled into view.

Only the active tab's panes are on screen, so naming another tab fails with `tab "<id>" is not the active tab` and names `bismuth app focus <id>` as the step to run first. A pane whose content fits fails with `nothing scrolls in pane "<label>"`.

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
| `app run` with `new-window`, `open-folder`, `update-app`, `daemon-update`, `new-claude-chat` or `quick-ask` | Heavy or system-level actions, or a live agent session, that an unattended caller should not fire blindly. A quick ask opens a live agent session |
| `app open` with any `::chat:` content | A chat is a live agent session, a different trust boundary from opening a note |
| `app open` with a path that names no file in the vault (404) | A tab for a missing file opens blank, and the caller would read the reply as success |

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
| `scroll-pane` | `{tabId?, leafId?, op?}`, `op` one of `{by}`, `{pages}`, `{to}`. Replies the position as `result` |
| `run-command` | `{id}` |

`scroll-pane` searches the pane's element for its main scroller, the largest descendant that overflows vertically and is styled to scroll, and sets its `scrollTop`; every view listens to its scroller's own scroll event, so this drives it the way a wheel does (`app/src/paneScroll.ts`). A terminal's xterm sits in an overlay above its pane, marked `data-terminal-overlay`, so the search starts there.

Before dispatching `open-tab`, the route resolves `content` against the vault with `resolveOpenTarget` (`core/src/openTarget.ts`) and sends the window the vault-relative result; a path that names no file returns 404 without reaching the window. The two refusals run twice, in the route before dispatch and again in the window's handler. `UI_CONTROL_BLOCKLIST` in `core/src/commands.ts` holds the blocked command ids, and the commands that only open a dialog carry `interactive: true` in `COMMAND_CATALOG` in the same file.

Source: `core/src/uiControl.ts`, `core/src/openTarget.ts`, `core/src/routes/relay.ts`, `core/src/runRegistry.ts`, `core/src/commands.ts`, `core/src/daemonPages.ts`, `app/src/uiControlClient.ts`, `app/src/paneScroll.ts`, `cli/src/commands/{app,page}.ts`, `cli/src/http.ts`
