# Status messages

What the messages Bismuth shows actually mean, and what (if anything) you should do about
them. Short-lived pop-ups (toasts, top-right) come from `pushToast` (`app/src/Toast.tsx`). The
connection messages below are both driven by the `ConnectionState` tracked in
`app/src/serverVersion.ts`: the status-bar label is rendered from it in `app/src/App.tsx`, and
the toast is pushed directly from `serverVersion.ts` itself.

## The connection

Bismuth's window is a frontend talking to a small local backend — the `core` server — over
HTTP on your own machine. Nothing leaves your computer. The window keeps one long-lived
[Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) stream open
to `/events`; the backend pushes a frame down it whenever a file changes, and the window
refetches only what that frame says is stale.

The backend also writes an `: keepalive` comment down that same stream every
`appConfig.server.sseHeartbeatMs` (default 5 seconds — `core/src/schema/settingsSchema.ts`), and
`Bun.serve` is configured with a 255-second idle timeout, specifically so a quiet vault (no file
changes for minutes at a time) doesn't get its stream reaped as "idle" by Bun or an OS/proxy in
between. A stream on an otherwise-idle vault is expected to survive indefinitely on those
keepalives alone.

What the keepalive can't protect against is the network path actually going away — a laptop
sleeping, Wi-Fi switching, a VPN reconnecting. Those drop the stream with no close frame at all,
silently. So there's a second, independent safety net: the window also polls `GET /version`
every 5 seconds regardless of the stream's state, purely to notice a dead stream that the
keepalive couldn't save.

### "connection lost — polling" / "Connection lost. Retrying..."

You may see this as two different things at once, and they mean the same thing:

- A small **`connection lost — polling`** label appears in the status bar at the bottom of the
  window, next to the vault name.
- A **`Connection lost. Retrying...`** toast pops up in the corner, with a **Retry now** button.

Both are driven by the same underlying connection state, they just surface it in two places —
the status bar is the persistent indicator, the toast is the one-time nudge with an action
attached.

**What happened:** the indicator means the window does not currently have positive confirmation
the backend is reachable via either signal — not strictly that both have failed at once. That
covers a genuine outage where the SSE stream dropped *and* the `/version` poll is also failing,
but also two milder cases that flip the same indicator: a single SSE-only error by itself (the
label can appear for up to ~1 second, until the very next fast poll confirms the backend is fine
again), and the brief `"reconnecting"` state while a manual **Retry now** attempt is in flight.

**What Bismuth does about it:** switches the poll from every 5 seconds to every 1 second and
keeps retrying the stream in the background. When either succeeds, both the status-bar label and
the toast are meant to clear on their own — no action needed.

**What you should do:** usually nothing — wait a few seconds. The **Retry now** button on the
toast forces an immediate reconnect attempt. Your notes are files on disk and are never at risk
from this; the worst case is a sidebar or graph that's briefly out of date.

**When to worry:** if it persists for more than a minute while the app is otherwise responsive
(you can still click around, switch tabs, etc.), that usually means the backend process died.
Quit and relaunch Bismuth.

**On launch:** the toast is deliberately suppressed until the window has reached the backend at
least once, because the backend takes a second or two to start after launch. A "connection lost"
flash on every launch would be noise, not information — see the comment above
`everConnected` in `app/src/serverVersion.ts`.

## Folders and windows

| Message | Meaning | What to do |
|---|---|---|
| `Couldn't open the folder picker: <reason>` | The native OS folder dialog itself failed to open (desktop app only) — a genuine dialog error, not you clicking Cancel. Shown both when opening a folder as a new vault and when browsing for an export destination folder. Cancelling the picker is silent by design and shows nothing at all. | Retry. If it repeats, the reason names the underlying failure — include it in a bug report. |
| `Open folder failed: <reason>` | A folder was chosen, but no backend could be started for it. | Check the folder still exists and is readable, then retry — the prompt stays open for another attempt. |
| `Folder server started, but the window couldn't open` | The backend for that folder is running, but the OS refused to open a new window for it. | Retry; if it repeats, relaunch Bismuth. |
| `Couldn't open a new window` | The OS refused to open a new window (used by "New window", which reopens your current vault in another window). | Relaunch Bismuth. |
| `Copied vault path` | Clicking the vault name in the status bar copied the vault's full filesystem path to your clipboard (`copyVaultPath` in `app/src/App.tsx`). | None — the path is on your clipboard. |
| `Couldn't copy vault path` | The clipboard write failed after clicking the vault name (e.g. clipboard permissions, or an insecure context — the `.catch` in `copyVaultPath`, `app/src/App.tsx`). | Try clicking again, or read the path from the tooltip shown on hover. |

## One folder, one backend, one window

Opening a folder does **not** switch the current window's vault. Bismuth follows a
process-per-vault model (`core/src/openFolder.ts`, `POST /open-folder`): each folder you open
gets its own backend process on its own port, and its own window pinned to that backend via
`?api=<url>`. So two open folders are two windows that cannot interfere with each other's
caches, watchers, or tabs.

The vault's folder name is shown at the left of the status bar at the bottom of the window, next
to the connection indicator described above. The full path is not shown inline, but it is one
hover away: point at the folder name for a `title` tooltip with the full path, or click it to
copy the full path to your clipboard (`copyVaultPath` in `app/src/App.tsx`) — see the `Copied vault path` /
`Couldn't copy vault path` toasts in the table above.

## What the status bar shows

Left to right (`app/src/shell/StatusBar.tsx`):

| Item | Meaning |
| --- | --- |
| Vault name | The open vault's folder name. Hover for the full path, click to copy it. |
| `//` + path | The focused pane's content — a note path, or a label for a non-file pane. This is the one item allowed to shrink to nothing on a narrow window, so nothing else gets clipped mid-character. |
| `connection lost — polling` | Only while SSE is down. See [The connection](#the-connection) above. |
| `inbox: N` | Daemon-inbox pages awaiting review. Always present while the daemon is on, **including at zero**, so it is a findable place rather than a control that only exists when it has something to say. Quiet at zero; a `--gold` dot appears and the count brightens when something is waiting. Click it to open the inbox. Hidden entirely when the daemon is off, since the whole inbox surface is gated behind `daemon.enabled`. |
| `daemon: off / idle / working` | Whether this machine's daemon is running for this vault, and whether it is currently doing something. Only the state word is coloured — `--faint` for `off`, `--gold` for `idle`, `--green` for `working` — and the blinking `_` caret sits directly after it, marking it as the live value on the line. |

The graph mode (`2ND` / `3RD` / `BOTH` / `DAEMON` / `LOCAL`) used to appear here and **no longer
does**. It lives on the graph pane's own header toolbar instead — it is a per-pane setting, and the
status bar is app-scoped.

---

Source: `app/src/serverVersion.ts`, `app/src/App.tsx`, `app/src/shell/StatusBar.tsx`,
`app/src/shell/InboxIndicator.tsx`, `app/src/ExportView.tsx`,
`app/src/pickResult.ts`, `app/src/Toast.tsx`, `core/src/server.ts`,
`core/src/schema/settingsSchema.ts`, `core/src/openFolder.ts`.
