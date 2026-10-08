# Status messages

Bismuth tells you what it is doing through short-lived toasts (top-right pop-ups) and readouts in the status bar at the bottom of the window. This page lists the messages you can see, each led by its exact text, with what it means and what to do. For a symptom with no message, start from [troubleshooting](troubleshooting.md).

Messages that end in `: <reason>` carry the underlying error text in place of `<reason>`; include it in a bug report.

## The connection is lost

The status bar label `connection lost — polling` and the toast `Connection lost. Retrying...` mean the window cannot confirm that its local backend is reachable. The toast has a **Retry now** button. Both clear on their own when the connection returns.

What to do: usually nothing. Wait a few seconds, or click **Retry now** to force a reconnect. Files already on disk are not at risk; the worst case is a sidebar or graph that is briefly out of date, and an edit made while the label shows may not reach the backend until it clears.

If the label stays for more than a minute while the rest of the app still responds, the backend process has probably died. Quit and relaunch Bismuth.

The toast does not appear until the window has reached the backend once, so a normal launch never flashes it. The label can show for up to a second on a single stream error before the next check confirms the backend is fine.

## `doctor // 2 repairs need your ok: …`

Bismuth found leftovers from an older build that it will not delete without asking. The toast reads `doctor // <n> repairs need your ok: <title 1>, <title 2>`, and with more than two titles it ends `<title 1>, <title 2> +<n> more`. It shows once at launch and disappears after 20 seconds.

What to do: click **fix** to apply exactly the listed repairs; the toast becomes `doctor // fixed <k> of <n>`. To look first, run `bismuth doctor` in a terminal, where each line says what the repair removes. Ignoring the toast leaves things as they are, and the same findings appear at the next launch. The full list of findings is in [doctor](doctor.md).

No toast appears when nothing is pending or when the backend has no doctor (the iPad and iOS in-process backend).

## Updates

| Message | Meaning and action |
|---|---|
| `Checking for a Bismuth update…` | The **Update Bismuth…** command is asking the update service. Wait. |
| `Bismuth is already up to date` | There is nothing to pull. |
| `Updating Bismuth (<n> commits behind)…` | An update is downloading. It moves through `Pulling update…`, `Building update… (a few min)` and `Relaunching…`; the app restarts itself. |
| `Update failed: <reason>` | The pull or build failed. Retry; [self-update](self-update.md) lists each failure reason. |
| `This build can't self-update (not built from source)` | Self-update only runs for a build made from source. |
| `Can't read the update source — grant Bismuth Files & Folders access in System Settings` | macOS blocked access to the source folder. Grant the permission and retry. |
| `No upstream configured to update from` | The checkout has no `origin/main` to compare against. |
| `Update source unavailable — couldn't check for updates` | The update service could not run its check. Retry later. |
| `Couldn't reach the update service` | The backend did not answer the update check. See the connection message above. |
| `Re-registering the daemon service…` | The **Update daemon…** command is rewriting the launchd or systemd unit. |
| `Daemon service re-registered (it updates with the app)` | Done. The daemon binary ships inside the app, so there is no separate download. |
| `Daemon update failed: <reason>` | Re-registration failed. Run `bismuth doctor` and read the `daemon.*` findings. |

## Folders and windows

| Message | Meaning | What to do |
|---|---|---|
| `Couldn't open the folder picker: <reason>` | The operating system's folder dialog failed to open (desktop app). Cancelling the dialog is silent and shows nothing. | Retry. |
| `Open folder failed: <reason>` | You chose a folder, but no backend could start for it. | Check the folder exists and is readable, then retry; the prompt stays open. |
| `Folder server started, but the window couldn't open` | The folder's backend is running, but the OS refused a new window. | Retry; if it repeats, relaunch Bismuth. |
| `Couldn't open a new window` | The OS refused a new window for **New window**. | Relaunch Bismuth. |
| `Couldn't open window: <reason>` | Creating a window raised an error event. | Relaunch Bismuth. |
| `Copied path` | Clicking the status bar's location readout copied a path to the clipboard. | None. |
| `Couldn't copy path` | The clipboard write failed. | Click again, or read the path from the readout's tooltip. |

Opening a folder never switches the current window's vault. Each folder opens in its own window with its own backend.

## Notes, files and the sidebar

| Message | Meaning | What to do |
|---|---|---|
| `This note changed elsewhere while you were editing — your edits were kept, but check nearby content for an overwritten external change.` | Another program wrote the file while you typed; Bismuth merged both. | Read the lines around your edit. |
| `Deleted <name>` / `Deleted <n> items` | A delete finished. The toast has an **undo** button for 8 seconds. | Click **undo** to restore. |
| `Restored <name>` | An undo or restore finished. | None. |
| `undo failed: <reason>` | An undo could not complete. | Read the reason. |
| `Delete failed: <reason>`, `Create failed: <reason>`, `Move failed: <reason>`, `Rename failed: <reason>`, `Restore failed: <reason>` | The file operation did not happen. | Read the reason; usually a name clash or a permission. |
| `Template failed: <reason>` | Creating a note from a template failed. | Read the reason, then check the template. |
| `Open a note to insert a template` | The template picker needs a note focused. | Focus a note and retry. |
| `Open a note to insert an emoji` | The emoji command needs a note focused. | Focus a note and retry. |
| `Open a note, base, or sheet to export it` | **Export current file…** needs a note, base or sheet focused. | Focus one and retry. |
| `Pick a file inside your vault` | The export picker chose a file outside the vault. | Choose a vault file. |
| `Exported <file> → <path>` | The export is written; on desktop it is revealed in Finder. | None. |
| `Export failed: <reason>` | The export did not complete. | Read the reason. |
| `Couldn't read that drop` | A dropped item carried no readable data. | Drag the file itself. See [draggables](draggables.md). |
| `Couldn't read dropped file — see console` | A dropped file could not be read. | Retry; the console names the file. |
| `Couldn't convert <file> to JPEG — saved as-is` | An HEIC image was attached without conversion. | None; the original file is stored. |
| `Couldn't save attachment: <reason>` | The dropped or pasted file was not written to the attachments folder. | Check the `attachments.folder` setting and disk space. |
| `Query block wasn't inserted — the note was closed` | The query builder finished after its note was closed. | Reopen the note and insert the block again. |

## Bases and tasks

| Message | Meaning | What to do |
|---|---|---|
| `The rows changed while you were editing — that edit was not saved.` | A table cell edit lost a race with a refresh. | Re-enter the value. |
| `Row added — click it to fill in its properties` | A new row exists with no values. | Open the row and fill in properties. |
| `Add row failed: <reason>`, `Save failed: <reason>` | The row write was rejected. | Read the reason. |
| `Archived <n> completed tasks` / `No completed tasks to archive` | Result of **Archive completed tasks (this note)** on the focused note. | None. |
| `Open a note to archive its completed tasks` | The command needs a note focused. | Focus a note and retry. |
| `Converted <n> task lines in <m> notes to the bracket syntax` | At launch Bismuth rewrote emoji-style task lines into bracketed fields, see [task syntax](../tasks/syntax.md). When a snapshot was taken the message ends `// snapshot taken`. | None. |
| `Task syntax could not be converted — a vault snapshot failed, so nothing was changed` | The pre-conversion backup failed, so Bismuth left every note alone. | Fix the backup problem (disk space or git), then relaunch. |
| `<n> lines could not be converted — see the console` | Some task lines did not parse. | Rewrite them by hand per the task syntax page. |

## Google Calendar and the daemon

| Message | Meaning | What to do |
|---|---|---|
| `Syncing Google Calendar…` | A sync is running. | Wait. |
| `Approve access in your browser, then return here…` | The Google consent screen is open in your browser. | Approve, then return to Bismuth. |
| `Enter both the Client ID and Client Secret` | The connect form is missing a field. | Fill both. |
| `Connect failed: <reason>`, `sync failed: <reason>`, `Disconnect failed: <reason>` | The Google Calendar step failed. | Read the reason; see [Google Calendar sync](../gcal/overview.md). |
| `Disconnected from Google Calendar` | The connection is removed. | None. |
| `Daemon setup failed: <reason>` | Enabling the daemon service failed. | See [daemon setup](../daemon/setup.md). |
| `Already resolved` | An inbox page was already answered elsewhere. | None. |

## What the status bar shows

The status bar renders the `statusBar:` list in `.settings`. With no `statusBar:` key it shows these built-in readouts, left to right.

| Readout | Meaning |
|---|---|
| a path | The focused file's full absolute path. A graph, terminal, chat or daemon pane, or no focus, shows `<vault path> // <label>` instead. Hover for the full text; click to copy it. |
| `connection lost — polling` | Appears only while the live connection is down. |
| `inbox: <n>` | Daemon inbox pages awaiting review; present at zero while the daemon is on, with a gold dot when something waits. Click it to open the inbox. Hidden when the daemon is off. |
| `daemon: off`, `daemon: idle` or `daemon: working` | Whether this machine's daemon is running for this vault and whether it is busy. |

A `statusBar:` list can also hold templated text, query counts and `run:` shell segments. A `run:` command a vault asks for does not execute until you approve it on this machine: until then the bar shows the truncated command as an `[ allow ]` prompt, and clicking it opens the trust dialog. See [status bar and home page](../settings/status-bar.md).

## How it works

The window is a frontend talking over HTTP on your own machine to a local backend, the `core` server; nothing leaves the machine. The window holds one Server-Sent Events stream open to `/events`, and the backend pushes a frame down it when a file changes. The window refetches only what the frame marks stale.

Two mechanisms keep a quiet vault's stream alive. The backend writes a `: keepalive` comment every `server.sseHeartbeatMs` (default 5000 ms, [settings reference](../settings/reference.md)), and `Bun.serve` runs with a 255-second idle timeout. A network path that vanishes (sleep, Wi-Fi switch, VPN) drops the stream with no close frame, so the window also polls `GET /version` every 5 seconds. When neither signal confirms the backend, the connection state turns disconnected, the poll speeds to every second and the stream retries in the background. The status-bar label and the toast both read that one state.

Toasts come from `pushToast`; the connection toast is pushed by `serverVersion.ts` and the label rendered by the status bar. Each folder you open gets its own backend process on its own port (`POST /open-folder`), and its window is pinned to that backend with `?api=<url>`, so two open folders share no caches, watchers or tabs.

Source: `app/src/serverVersion.ts`, `app/src/App.tsx`, `app/src/doctorToast.ts`, `app/src/UpdateBanner.tsx`, `app/src/shell/StatusBar.tsx`, `app/src/shell/InboxIndicator.tsx`, `app/src/ExportView.tsx`, `app/src/Editor.tsx`, `app/src/ui/ToastHost.tsx`, `core/src/server.ts`, `core/src/openFolder.ts`, `core/src/statusBarItems.ts`
