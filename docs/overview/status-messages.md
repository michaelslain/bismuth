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

**What happened:** the SSE stream dropped *and* the `/version` poll also failed, so the window
currently cannot reach the backend at all.

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
| `Open folder failed: <reason>` | A folder was chosen, but no backend could be started for it. | Check the folder still exists and is readable, then retry — the prompt stays open for another attempt. |
| `Folder server started, but the window couldn't open` | The backend for that folder is running, but the OS refused to open a new window for it. | Retry; if it repeats, relaunch Bismuth. |
| `Couldn't open a new window` | The OS refused to open a new window (used by "New window", which reopens your current vault in another window). | Relaunch Bismuth. |

## One folder, one backend, one window

Opening a folder does **not** switch the current window's vault. Bismuth follows a
process-per-vault model (`core/src/openFolder.ts`, `POST /open-folder`): each folder you open
gets its own backend process on its own port, and its own window pinned to that backend via
`?api=<url>`. So two open folders are two windows that cannot interfere with each other's
caches, watchers, or tabs.

The vault's folder name (not the full path) is shown at the left of the status bar at the bottom
of the window, next to the connection indicator described above.

---

Source: `app/src/serverVersion.ts`, `app/src/App.tsx`, `app/src/Toast.tsx`, `core/src/server.ts`,
`core/src/schema/settingsSchema.ts`, `core/src/openFolder.ts`.
