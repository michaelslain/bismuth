# Daemon service and lifecycle

The daemon is a single long-lived process that a launchd agent (macOS) or systemd user unit (Linux) starts at login and restarts if it exits. It starts a brain for each vault with `daemon.enabled` on, checks every minute for vaults that switched on or off, and shuts down cleanly on `SIGTERM`. This page is for anyone who needs to restart, stop or debug the service; [Set up the daemon](setup.md) covers first use.

```bash
bismuth daemon status --pretty    # is it running, which device, who owns it
bismuth daemon restart            # bounce the service in place
bismuth daemon stop               # unload it until the next app launch
bismuth daemon setup              # (re)register the service
```

## Restart, stop or repair the service

- `bismuth daemon restart` restarts the running service without rewriting its definition: `launchctl kickstart -k` on macOS, `systemctl --user restart` on Linux. It needs the service to be installed.
- `bismuth daemon stop` runs `launchctl unload` on macOS, or `systemctl --user stop` plus `disable` on Linux. The service stays stopped until something registers it again. The bundled app does that at every launch.
- `bismuth daemon setup` and `bismuth daemon update` both run the idempotent installer. `daemon install` only prints the install status.

`stop` and `restart` print `{ "ok": true }` or `{ "ok": false, "error": "…" }` and exit non-zero on failure. On Linux, `stop` reports `ok` only when both `stop` and `disable` succeed; `setup` and `update` print `{ "ok", "binPath" }` plus `error` on failure. The full flags are in the [CLI reference](../cli/reference.md#daemon).

## Where the service files and logs are

| Item | macOS (launchd) | Linux (systemd) |
|---|---|---|
| Service id | `com.bismuth.daemon` | `bismuth-daemon` |
| Definition | `~/Library/LaunchAgents/com.bismuth.daemon.plist` | `~/.config/systemd/user/bismuth-daemon.service` |
| Restart policy | `RunAtLoad` and `KeepAlive` | `Restart=always`, `RestartSec=5` |
| Output | `~/.bismuth/daemon/logs/bismuth-daemon.stdout.log` and `.stderr.log` | the same files |

The binary is `~/.bismuth/bin/bismuth-daemon` (override: `BISMUTH_DAEMON_BIN`). The service's `PATH` is the launch `PATH` with `/usr/local/bin`, `/opt/homebrew/bin`, `~/.bismuth/bin`, `~/.bun/bin` and `~/.local/bin` appended, so crons find the `bismuth` command even though launchd starts the service with a minimal `PATH`. Every session the daemon starts gets the same widened `PATH`.

## Daemon timing

| Interval | Value | What it paces |
|---|---|---|
| Scheduler tick | 60 s | Cron schedules, catch-up, the vault reconcile loop |
| Trigger poll | 5 s | "Run now" files for crons, processes and inbox pages |
| Shutdown wait | 10 s | How long running cron jobs may finish before they are aborted |
| Default cron timeout | 300 s | A cron's `timeout` when it sets none |
| Process restart backoff cap | 60 s | Longest wait before a crashed process restarts |
| Activity log retention | 30 days | Daily activity files kept per vault |

## How it works

### Install

On every launch the bundled app runs `installDaemonFromBundle()` (`core/src/daemonInstall.ts`). It does nothing in a dev build, because there is no `BISMUTH_DAEMON_BUNDLE`. Otherwise it:

1. Compares the staged binary's size and modification time to the marker `~/.bismuth/.daemon-installed`, and copies only when they differ. The copy goes to a temp file and is renamed over `~/.bismuth/bin/bismuth-daemon`, because a direct write to a running binary fails with `ETXTBSY` on Linux; the old process keeps its inode until the next restart.
2. Runs `<bin> --ensure-installed`.

`--ensure-installed` renders the service definition and chooses an action. With no definition on disk it installs and loads one. With a changed definition it reloads. With an identical definition it reloads only if the daemon is not running; a healthy, current service is left alone, so opening the app never interrupts a running cron. `<bin> --status` prints `{ "installed", "running", "label" }`, where `running` means the pid in `daemon.pid` is alive. Every install function is best-effort and never throws, so a failed install cannot block the app.

### Boot order

`main()` in `daemon/src/daemon/index.ts` runs these steps in order; each depends on the one before.

1. Create the machine directory and its `logs/` folder.
2. Write `daemon.pid`.
3. Heartbeat this device into `devices.json`, so it can be chosen as owner.
4. Log whether this device is the owner. A device that is not the owner idles: it heartbeats and supervises processes but runs no sessions.
5. Start a brain for each enabled vault (`startVault` with `boot: true`).
6. Start the cron scheduler, which re-reads the enabled vaults every tick.
7. Start the reconcile loop, one pass per scheduler tick.
8. Bind `SIGTERM` and `SIGINT` to shutdown.

An unhandled error in `main()` logs `Fatal error: …` and exits 1, and the service manager restarts the process. After boot, an unhandled rejection is logged and does not exit, and a throwing scheduler or reconcile tick is logged and the next tick still runs (`safeTick`).

### Start and pause a vault's brain

`startVault` brings one vault online:

1. Create the vault's `.daemon` directories and run `reconcileSeeds` ([seeding](crons-and-processes.md#seeded-crons-and-files)).
2. Delete activity logs older than 30 days and log `brain-started`.
3. On boot only, kill processes left behind by a previous daemon instance (`reapOrphans`).
4. Start the vault's enabled background processes and its trigger watcher.
5. Start the vault's single recursive file watcher, which feeds file-change crons.
6. On boot only, re-fire crons that were running when the previous daemon died (`recoverInterruptedCrons`).

Reaping and recovery run only at boot because they are unsafe while the scheduler is already ticking: reaping can kill a sibling vault's process with the same command line, and recovery can mark a job that the live tick just started as finished.

`stopVault` stops the vault's trigger loop, processes and file watcher. It never deletes files, so disabling a vault pauses it.

### The reconcile loop

Once per scheduler tick, `reconcileVaults` compares the vault registry against the set of live brains. A vault with `daemon.enabled` true and no brain starts one with `boot: false`. A vault with the key false and a brain stops it. A live brain whose vault left the registry entirely is also stopped, so its processes do not leak. Crons are not part of this loop: the scheduler re-reads the enabled vaults itself on every tick.

### Shutdown

On `SIGTERM` or `SIGINT` the daemon:

1. Stops the reconcile loop and the cron scheduler.
2. Stops every vault's trigger loops and file watchers.
3. Waits up to 10 seconds for running cron jobs, then aborts any that remain.
4. Stops every managed process: `SIGTERM` to its process group, then `SIGKILL` after 3 seconds.
5. Removes `daemon.pid` and exits 0.

A crash or `SIGKILL` leaves `daemon.pid` behind. Liveness checks therefore send signal 0 to the recorded pid instead of trusting the file's presence.

### Detecting the daemon from the app

Core reads `~/.bismuth/daemon/daemon.pid` and signals the pid (`isDaemonAlive` in `core/src/daemonState.ts`) to fill `running` in `GET /daemon/status` and the snapshot. The daemon page and `bismuth daemon status` use that. See [the overview](overview.md#how-the-app-reads-the-daemon).

Source: `daemon/src/daemon/index.ts`, `daemon/src/lib/{config,platform,safeTick}.ts`, `core/src/{daemonInstall,daemonState}.ts`, `cli/src/commands/daemon.ts`
