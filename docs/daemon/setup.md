# Set up the daemon

The daemon is a background assistant for a vault. It runs prompts on a schedule (crons), keeps long-lived programs running (background processes), folds what you write into a memory graph, and leaves inbox pages when it needs your approval. It runs as a system service, so it keeps working while Bismuth is closed. This page turns it on, checks that it works, and turns it off; [the daemon overview](overview.md) explains what it is.

```yaml
# .settings
daemon:
  enabled: true
```

## What turning it on does

- Crons run in the background on the schedule in each `.daemon/crons/<name>.md` file. A new vault gets one, `dream`, which consolidates your notes into memory every hour. See [crons and processes](crons-and-processes.md).
- Memory becomes available: agents in the app's terminal tabs and chat recall relevant notes automatically and can use the `remember`, `recall` and `forget` tools. See [memory](memory.md).
- Inbox pages appear on the daemon page when the daemon wants you to approve or dismiss something. See [pages](pages.md).
- The `.daemon` folder shows in the file tree under the daemon's name. With the daemon off it is hidden.

## Turn it on

1. Open the vault in Bismuth once. Opening a vault registers it in `~/.bismuth/daemon/vaults.json`, the list the daemon reads to find vaults.
2. Set `daemon.enabled` to `true` in the vault's `.settings`, by any one of these:
   - Pick the daemon on the first-run intro. The app sets the key and registers the service for you.
   - Run **Open Settings** from the command palette (Cmd+P) and add the key shown above.
   - Run `bismuth settings set daemon.enabled true --vault ~/vault`.
3. Wait up to a minute. The daemon re-reads every vault's settings once a minute, starts that vault's background work, and writes a `brain-started` line to its activity log.

The bundled app installs the daemon service each time it launches, so there is no separate install step. Run **Set up daemon…** from the command palette (or `bismuth daemon setup`) to repair the service.

## Verify

Check that the service is running, then that it started your vault:

```bash
bismuth daemon status --pretty
bismuth daemon logs --vault ~/vault --kind daemon --limit 1 --pretty
```

`daemon status` prints `"running": true`, this machine's `thisDeviceId`, and the `owner` (`null` until you claim one). Before the daemon has ever run it prints:

```json
{
  "running": false,
  "thisDeviceId": null,
  "owner": null
}
```

`daemon logs` prints one event for the vault once its brain is up:

```json
[
  {
    "kind": "daemon",
    "name": "daemon",
    "event": "brain-started",
    "ts": "2026-10-08T03:25:25.414Z"
  }
]
```

The daemon page shows the same state. Open it with the **Open daemon** command: the face is awake and the status reads `watching // nothing has run yet` or `watching // last: dream 12m ago`.

## Working example

Add a cron that summarizes your journal every weekday at 8:00. Create the file with the CLI, then fill in the prompt and enable it:

```bash
bismuth daemon cron create "Morning digest" --vault ~/vault
```

The command writes `.daemon/crons/morning-digest.md` as a disabled template:

```markdown
---
name: "Morning digest"
schedule: 0 9 * * *
enabled: false
---

<!-- Write what you want "Morning digest" to do here — this note's body is the prompt sent to
     the daemon's Claude session when the cron fires. Adjust `schedule` above (a
     5-field cron expression) and flip `enabled: true` when ready. -->
```

Edit the note: set `schedule: 0 8 * * 1-5`, replace the comment with your prompt, and change `enabled: false` to `enabled: true`. You can also ask the daemon to create crons in its chat on the daemon page; it runs the same command and asks you to approve the call.

## Approve or dismiss an inbox page

The daemon files an inbox page when something needs you. A toast reads "N pages ready for review", and the inbox section of the daemon page lists each page.

1. Open the daemon page and click the page in the **inbox** section.
2. Read the page and edit its body if you want. The body is the draft the daemon acts on.
3. Press one of the buttons at the bottom. An approve button makes the daemon act on the page in a fresh session; a dismiss button closes the page without involving the daemon. The bar shows `working…` until the daemon finishes, then a result.

A page that fails keeps its buttons, so pressing again retries. The `[ archive ]` control on an inbox row deletes a page without answering it. Resolved pages are removed after `daemon.inboxRetentionDays` days. [Pages](pages.md) has the file format and the full lifecycle.

## What the daemon writes in your vault

Everything the daemon keeps for a vault lives under `<vault>/.daemon/`:

```
.daemon/
  identity.md       the daemon's name and personality; edit it
  PAGES.md          how the daemon writes inbox pages
  crons/            one .md per cron
  processes/        one .md per background process
  memory/           the memory graph, one .md per note
  pages/            inbox pages
  logs/             activity log and process output
```

The daemon never deletes this folder. [Storage](storage.md) lists every file, including the machine-level state in `~/.bismuth/daemon`.

## Pause or turn it off

- Pause one vault. Set `daemon.enabled: false` in its `.settings`. Within a minute the daemon stops that vault's background processes and file watcher and fires no more crons. Nothing under `.daemon/` is deleted, and turning the key back on resumes it.
- Stop one cron or process. Right-click its row on the daemon page and choose Disable, or run `bismuth daemon cron toggle <name> --off --vault ~/vault` (`daemon process toggle` for a process). A disabled cron that is mid-run finishes the run.
- Stop the service. Run `bismuth daemon stop`. The bundled app registers and starts the service again the next time it launches.

## Config keys

These `.settings` keys control the daemon. Every key is per vault; [the settings reference](../settings/reference.md#daemon) lists them with their full descriptions.

| Key | Type | Default | Effect |
|---|---|---|---|
| `daemon.enabled` | boolean | `false` | Master switch for the vault's daemon and memory. |
| `daemon.backend` | `claude` or `codex` | `claude` | Which agent CLI runs the daemon's sessions. |
| `daemon.inboxRetentionDays` | number, 1 to 90 | `7` | Days a resolved inbox page stays listed. |
| `daemon.inheritUserMcp` | boolean | `false` | Lets daemon sessions use your own `claude` MCP servers and plugins. |
| `daemon.recall.enabled` | boolean | `true` | Automatic memory injection into agent sessions. |
| `daemon.recall.midTurn` | boolean | `true` | Also recall after each batch of tool calls. |

Matching notes by meaning, not only by words, is the separate `embeddings.enabled` setting (boolean, default `false`). [The settings reference](../settings/reference.md#embeddings) has the cost.

## Failure modes

- The vault is not in `vaults.json`. The daemon never sees it and nothing happens, with no error. Open the vault in Bismuth once.
- This device is not the owner. With several devices, only the owner device runs sessions. Crons on the others tick without firing, and an approved inbox page does nothing. Run `bismuth daemon devices --pretty`, then `bismuth daemon owner <deviceId>` on the device that should work.
- The status reads `asleep // daemon not running` while `daemon.enabled` is true. The service is not up. Run `bismuth daemon setup`. A build from source has no bundled daemon binary, so setup reports `daemon binary not installed`.
- Crons that record memory write nothing. The bundled `bismuth-mcp` binary is missing from `~/.bismuth/bin`, so the session has no `remember` tool. Open the bundled app once to install it.
- A cron with a malformed `schedule` never fires. A schedule needs exactly five fields; with any other count the daemon skips the file without an error. See [crons and processes](crons-and-processes.md#schedule-syntax).

## How it works

On launch the bundled app copies a newer compiled `bismuth-daemon` binary to `~/.bismuth/bin/bismuth-daemon` and runs it with `--ensure-installed`, which writes a launchd agent (`~/Library/LaunchAgents/com.bismuth.daemon.plist`) on macOS or a systemd user unit (`~/.config/systemd/user/bismuth-daemon.service`) on Linux. Both restart the daemon if it exits. The service is not a child of the app, which is why it outlives it. [Lifecycle](lifecycle.md) covers boot, shutdown and the reconcile loop.

Source: `core/src/daemonInstall.ts`, `daemon/src/daemon/index.ts`, `daemon/src/lib/platform.ts`, `daemon/src/lib/registry.ts`, `cli/src/commands/daemon.ts`, `app/src/daemon/DaemonSetupModal.tsx`, `app/src/intro/firstRunHandoff.ts`
