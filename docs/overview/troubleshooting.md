# Troubleshooting

Most problems in Bismuth have a known cause and a one-line fix; the tables below map each symptom to both, grouped by area. Start with `bismuth doctor` when something feels off after an update, then find your symptom below.

```bash
bismuth doctor
```

A healthy machine prints `bismuth doctor // all clear`. Otherwise each line names a finding and, when a repair exists, what it does. Add `--fix` to apply the repairs, or `--fix --safe-only` to skip the ones that delete something. [Doctor](doctor.md) lists every finding. Messages the app itself shows are in [status messages](status-messages.md).

## The app does not start

| Symptom | Cause | Fix |
|---|---|---|
| `set BOTH BISMUTH_VAULT and BISMUTH_MEMORY, or neither` | Only one of the two variables is exported when you start a dev build. | Export both, or unset both to use the generated example vault. |
| `Port 1420 is already in use` or `Port 4321 is already in use` | Another Bismuth dev instance holds the port. | Stop the other instance. A second full dev instance needs its own backend and Vite port; see [install](install.md). |
| A dev app opens, but notes are empty or requests fail with 403 | The backend and the frontend were started by hand with different owner tokens, so the app is treated as a restricted channel. | Start both halves with one shared token; [install](install.md) has the commands. |
| `Couldn't open the folder picker: <reason>` or `Open folder failed: <reason>` | The folder dialog failed, or no backend could start for the chosen folder. | See [folders and windows](status-messages.md#folders-and-windows). |
| Dev data looks wrong after experiments | Dev builds write to their vault. | Delete the generated `.dev-vault/` folder at the repo root and restart. |

## The graph or sidebar looks out of date

| Symptom | Cause | Fix |
|---|---|---|
| A note edit does not change the graph | The graph rebuilds only when a note's wikilinks or tags change, or a file appears or disappears. Prose edits leave it alone by design. | None needed. Add or remove a `[[link]]` or tag and the graph updates. |
| A new link does not draw an edge | Embeds (`![[file]]`) and links inside code fences or inline code are not wikilinks. | Write a plain `[[Note]]` outside code. See [wikilinks and tags](../vault/wikilinks-tags.md). |
| Changes made outside the app appear late | The backend waits for file changes to settle (`server.fileWatchDebounceMs`, default 250 ms) and the window polls its version every 5 seconds as a fallback. | Wait a few seconds. If nothing changes, see the next group. |
| Nothing updates after the laptop slept or the network changed | The live stream dropped silently. | The window recovers by polling; see [connection lost](status-messages.md#the-connection-is-lost). |
| The `3rd` graph mode is missing | The 3rd brain exists only while the daemon is enabled. | See [the daemon is not running](#the-daemon-is-not-running). |

## The connection is lost

| Symptom | Cause | Fix |
|---|---|---|
| `connection lost — polling` in the status bar, or a `Connection lost. Retrying...` toast | The window has no current confirmation that the backend answers. Your notes are safe on disk. | Wait, or click **Retry now**. If it lasts over a minute, relaunch Bismuth. Details in [status messages](status-messages.md#the-connection-is-lost). |

## The CLI or MCP server is missing after an update

| Symptom | Cause | Fix |
|---|---|---|
| `bismuth: command not found` | The `bismuth` link is not on PATH (`install.cli-link-missing`), or points at a Bismuth that is missing (`install.cli-link-stale`). | Relaunch the app, which applies the safe repairs at boot, or run **Install Bismuth CLI + MCP…** from the palette. |
| An agent has no `bismuth` tools | Claude has no `bismuth` MCP registration (`install.mcp-claude-missing`) or a stale one (`install.mcp-claude-stale`). | Relaunch the app, or run `bismuth doctor --fix` in a shell. |
| Doctor reports `install.not-installed` | You are running a dev checkout, which has no machine-wide install. | None needed. Use the repo's own scripts, or install the packaged app. |
| Doctor reports `install.version-skew` | The installed CLI and MCP tools differ from the ones bundled with the app. | `bismuth doctor --fix` reruns the installer. |
| A toast says `doctor // 2 repairs need your ok: …` | Boot applied every safe repair and left the ones that delete something for you. | Click **fix**, or run `bismuth doctor` first to read what each one removes. |

## The daemon is not running

| Symptom | Cause | Fix |
|---|---|---|
| No daemon page, no inbox, no `3rd` graph mode, status bar shows `daemon: off` | `daemon.enabled` is `false`, which is the default. | Run **Set up daemon…** from the palette, or set `daemon:` then `enabled: true` in `.settings`. See [daemon setup](../daemon/setup.md). |
| `bismuth daemon status` prints `"running": false` | The service is not loaded, or its binary is missing. | Run `bismuth daemon setup`, then `bismuth daemon restart`. |
| Doctor reports `daemon.unit-missing-binary` or `daemon.binary-skew` | The service points at a missing binary, or the installed binary differs from the app's. | `bismuth doctor --fix --only daemon.binary-skew` reinstalls it; the missing-binary repair removes the service and needs your consent. |
| The daemon runs but crons never fire on this machine | Another device owns the daemon; a non-owner device heartbeats but runs no sessions. | `bismuth daemon owner` shows the owner. `bismuth daemon owner <deviceId>` claims this device, or use **Set daemon owner device…** in the palette. |
| A cron ran, but you cannot tell what happened | The outcome is in the activity log. | `bismuth daemon logs --vault <dir>` prints it, newest first. |

## A base shows no rows

Run `bismuth base validate <path>` first, then `bismuth base render <path>` to see the rows the app sees.

| Symptom | Cause | Fix |
|---|---|---|
| Zero rows, and validate names a `filters` or `where` error | A filter that fails to parse acts as `false`. | Fix the expression the validate message quotes. |
| Zero rows with `source: base` | A base with `source: base` and no `ref:` resolves to nothing, and validate does not flag it. | Add `ref: "[[That Base]]"`. |
| Zero rows from a tag filter | `file.hasTag("book")` matches that exact tag only, not `book/x`. | List the subtags: `file.hasTag("book", "book/x")`. |
| Every note shows | An unquoted `#book` in `source: notes where #book` is a YAML comment, so the filter is cut off. | Quote it: `source: 'notes where file.hasTag("book")'`. |
| The view is a table, not what you asked for | A mistyped `view:` kind falls back to `table` without an error. | Validate names the allowed kinds. |
| A view option does nothing | A mistyped view key or an invalid enum value silently uses the default. | Compare the `render` output with your config. |

[Bases overview](../bases/overview.md) and [authoring](../bases/authoring.md) cover the keys. A flashcards view finds notes only when they carry the `flashcards` tag; see [flashcards](../flashcards/srs.md).

## A task does not parse

| Symptom | Cause | Fix |
|---|---|---|
| A checkbox line is not listed as a task | A task needs a bullet, one space, a one-character box, one space, then text. `- [ ]buy` and `1. [ ] buy` are not tasks. | Fix the spacing and use `-`, `*` or `+`. |
| A date or priority is kept as plain text | The field is not in bracket form. Emoji signifiers such as a calendar emoji before a date are not read. | Write `[due 2026-10-12]`. Run `bismuth task migrate --dry-run` to see the notes it would convert, then `bismuth task migrate` to rewrite them. |
| `[due 2026-13-45]` stays in the description | The date is not a real calendar date. | Correct the date. |

[Task syntax](../tasks/syntax.md) lists every field.

## Notes, links and tags

| Symptom | Cause | Fix |
|---|---|---|
| A wikilink opens the wrong note | Wikilinks match by file name, so two notes with the same name make a bare `[[Note]]` ambiguous. | Write the path: `[[reading/Note]]`. |
| A wikilink opens an empty note | No note has that name. | Create the note or fix the name. |
| Tags on an image or PDF do not stick | A binary keeps its tags in a companion note named `<file>.<ext>.md`. | Use `bismuth prop set <file.pdf> tags '["a","b"]'`, which creates the companion. See [frontmatter](../vault/frontmatter.md). |

## Settings

| Symptom | Cause | Fix |
|---|---|---|
| A setting has no effect | A value of the wrong type, out of range, or not in the allowed list reads as the default, without an error in the app. | Open `.settings` and look for the underline; `Ctrl+Space` lists valid values. |
| Every setting reads as its default | The YAML does not parse. The app leaves the file untouched. | Fix the syntax in `.settings`. |

[Settings overview](../settings/overview.md) explains defaults and wrong values; [settings reference](../settings/reference.md) lists every key.

## AI agents and visibility

| Symptom | Cause | Fix |
|---|---|---|
| Chat or the daemon cannot find a note you can see | The note or its folder is `hidden`, or `chat-only` for the daemon. Visibility never limits you. | Change the note's `visibility:` frontmatter or the folder rule. See [visibility](../vault/visibility.md). |
| Chat finds no agent | No supported agent CLI is on PATH; doctor reports `backends.claude` when `claude` is missing. | Install an agent or set up the free one; see [connect an agent](../chat/connect-an-agent.md). |
| A `run:` status bar segment shows an `allow` button | The command comes from the vault and is not approved on this machine. | Click **allow** after reading the command. See [status bar](../settings/status-bar.md). |
