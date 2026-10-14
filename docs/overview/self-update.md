# Self-update

A Bismuth app built from source can update itself in place. When the clone it was built from is behind `origin/main`, a banner offers one click that pulls the latest source, rebuilds the app, swaps it into `/Applications` and relaunches it. This page is for anyone who installed with `bun run build:app` ([Install and run](install.md)); an app run from `bun run dev:browser` has no updater.

```text
Bismuth update available — 3 commits behind          [ update ]  [x]
```

## Update the app

The app checks for updates at launch and every 5 minutes after that. To update:

1. Click **update** in the banner at the top of the window, or run **Update Bismuth…** from the command palette.
2. Wait while the button shows **Pulling…**, then **Building… (a few min)**. The build takes several minutes, and the app stays usable until it finishes.
3. The app quits when the build is ready, and a helper relaunches the new copy. Your tabs and vault are unchanged.

Dismiss the banner with the **x** button; it comes back on the next launch. The palette command answers with a toast: it says `Bismuth is up to date` when nothing is pending, and reports why when it cannot check (see the section on a missing banner).

The banner, the progress toast and the palette show one update, whichever of them started it. A running update shows in the banner even after you dismissed it, and in a progress toast at the bottom of the window. Closing that toast with its **x** hides it until you run **Update Bismuth…** again, which brings it back instead of starting a second update. An update started from the CLI (`bismuth update apply`) appears in both within one status check.

## Cancel an update

Click **cancel** in the banner or in the progress toast, or run **Cancel Bismuth update** from the command palette. Both controls then read **cancelling…** until the update stops, and a toast says `Update cancelled`; the banner goes back to **update**.

```text
Bismuth update available — 3 commits behind          Building… (a few min)  [ cancel ]
Building update… (a few min)  [ cancel ]  [x]
```

A cancel stops the dependency install or the build at once. A `git pull` or reset in progress is allowed to finish first, because a pull cut off halfway leaves the clone with uncommitted changes and every later update refuses a dirty clone. The installed app is untouched. The clone may already hold the pulled commits, so the next update skips straight to the build.

An update that has reached **Relaunching…** has already swapped in its helper and cannot be cancelled. Cancelling an automatic update stops automatic updating for the rest of the session. From the CLI, `bismuth update cancel` does the same and prints the final progress.

An update needs the same tools as the original build: `git`, `bun` and Rust. Keep the clone you built from on disk, because the app updates by pulling that clone. Local commits that `origin/main` also has, or that sit on top of it, update normally; a clone whose history has split from `origin/main` needs the reset in the next section.

## Turn on automatic updates

Set `update.autoUpdate` to `true` in the vault's `.settings`, and the app applies a pending update in the background and relaunches without a click. It is off by default.

```yaml
update:
  autoUpdate: true
```

| Key | Type | Default | Effect |
|---|---|---|---|
| `update.autoUpdate` | boolean | `false` | Apply an available update at launch and relaunch when the rebuild is ready |

Automatic updating runs at most once per session. An automatic update shows the same banner progress and cancellable toast as a clicked one, but an ordinary failure leaves no toast. If an attempt ends in an error, a later check tries again, except for a diverged clone, which waits for your click on the reset toast, and a cancelled update, which waits for the next launch. A relaunch still quits your app, so leave this off if you want to choose when that happens.

## Update a clone that has diverged from origin/main

An update stops when the clone and `origin/main` each have commits the other lacks, because a fast-forward is impossible. That happens after upstream history is rewritten, or when the clone holds commits that were never pushed. The toast reads:

```text
Update failed: the Bismuth clone has 4312 commits origin/main lacks — reset saves them on a backup branch and moves to origin/main   [reset]
```

Click **reset** to continue. The update saves the clone's current HEAD as a branch named `backup/pre-update-<UTC time>` (for example `backup/pre-update-20261013T184405Z`), runs `git reset --hard origin/main`, and builds as usual; the progress toast names the backup branch. Your commits stay on that branch, so `git log backup/pre-update-<time>` shows them and `git cherry-pick` brings any back. Uncommitted changes are never touched: an update refuses a dirty clone before it gets this far.

Nothing resets without the click. Automatic updating stops at the same toast and does not retry for the rest of the session. An agent cannot send the reset; only the app's owner can.

## Why does the banner not appear?

The banner appears only when an update is available. These states hide it, and the palette command reports them in a toast:

| Toast text | Cause | Fix |
|---|---|---|
| `Bismuth is up to date` | Your build matches `origin/main` | None |
| `This build can't self-update (not built from source)` | A dev run, or a build without origin information | Install with `bun run build:app` |
| `Can't read the update source — grant Bismuth Files & Folders access in System Settings` | macOS blocks the app from the clone, which is common under `~/Documents` | Grant Files and Folders access to Bismuth |
| `No upstream configured to update from` | The clone has no `origin/main` | Add the remote and fetch |
| `Update source unavailable — couldn't check for updates` | `git` is missing, the clone moved, or it is not a git repository | Restore the clone, or rebuild from a current one |

Being offline is not an error: the check reports against the last `origin/main` it fetched.

## What if an update fails?

A failed update leaves the installed app untouched and shows the reason in a toast.

| Message | Meaning | Fix |
|---|---|---|
| `the Bismuth repo has uncommitted changes — won't overwrite` | The clone is dirty | Commit or stash the changes |
| `the Bismuth clone has <n> commits origin/main lacks — reset saves them…` | The clone and `origin/main` diverged | Click **reset** in the toast (see the section on a diverged clone) |
| `git pull failed` | The pull itself failed, for example offline or a broken remote | Read the log, then run `git pull --ff-only origin main` in the clone |
| `git branch failed` or `git reset failed` | The reset could not save the backup branch or move the clone | Read the log; the clone is unchanged when the branch step failed |
| `bun install failed` | A pulled dependency did not resolve | Read the log, then run `bun install` in the clone |
| `build failed` | The Tauri build failed | Read the log |

Every update failure is a red toast. The pull, install and build failure messages name the full log, `bismuth-update-build.log` in the system temp directory (under `/var/folders/` on macOS). The helper that swaps the app writes its own `bismuth-update.log` in the same directory. If the swap itself fails, the helper restores your previous app, so you are never left without one.

## What happens to the daemon and to permissions?

The daemon updates with the app. The new app carries a new daemon binary, which the app copies into place on its next launch; there is no separate daemon update. After the install settles on launch, the app runs the [doctor](doctor.md)'s safe repairs and logs `bismuth doctor: fixed <n>, <d> waiting for consent`. Repairs that delete files wait for the **fix** button in the launch toast, or for `bismuth doctor --fix`. Set `BISMUTH_NO_BOOT_DOCTOR=1` to skip the launch pass.

Updates keep your macOS folder permissions only if you signed builds with a stable certificate; see [macOS folder permissions surviving updates](install.md#macos-folder-permissions-surviving-updates).

## How it works

The pipeline spans the build, the backend, the frontend and the Tauri shell.

```text
build time   build-bismuth-tools.ts writes build-origin.json { repoRoot, sha, builtAt }

run time     updateCheck.ts ──poll──> GET /update/status        (selfUpdate.ts)
                │                        └─ git fetch, then builtSha..origin/main
                ▼
             updateRun.ts  <── banner, palette, auto-update, reset, adopt
                │  ── start ──> POST /update/apply  (returns at once)
                                              diverged? stop, or with {reset: true}:
                                                git branch backup/pre-update-<t> + git reset --hard origin/main
                                              else git pull --ff-only
                                              bun install --frozen-lockfile
                                              bun run tauri build --bundles app
                                              spawn the detached relauncher
                poll GET /update/progress: pulling, building, ready, cancelled
                on cancel: POST /update/cancel ──> kill install/build, stop before the next step
                on ready: invoke the Tauri command quit_app
                                              ▼
             relauncher waits for the app pid, swaps the .app with ditto, reopens it
```

### Build origin

`app/scripts/build-bismuth-tools.ts` runs inside `tauri build` and writes `build-origin.json` with `repoRoot`, `sha` (the `git rev-parse HEAD` at build time, or an empty string) and `builtAt` into the tools resource. `repoRoot` is the main worktree, resolved from `git worktree list --porcelain`, not the checkout the build ran in; a build made inside a disposable `.claude/worktrees/*` checkout would otherwise point the updater at a folder that disappears. The sidecar receives the resource directory as `BISMUTH_INSTALL_SRC`, and `readBuildOrigin()` reads the file from it. No variable or no file means no updater.

### Status

`getUpdateStatus()` in `core/src/selfUpdate.ts` never throws. It returns:

```ts
interface UpdateStatus {
  available: boolean
  behind: number          // commits builtSha is behind origin/main
  localSha: string | null
  remoteSha: string | null
  builtSha: string | null // from build-origin.json
  dirty: boolean          // uncommitted changes in the clone
  reason?: string         // why unavailable
}
```

The steps are: read the origin (`reason: "not-a-source-build"` without it), probe the clone with `git rev-parse --is-inside-work-tree`, run `git fetch --quiet origin main` (20-second limit, failure tolerated), resolve `origin/main` (`reason: "no-upstream"` on failure), then count `git rev-list --count <baseRev>..origin/main`. A failed probe is classified by `classifyGitFailure()` into `git-not-found`, `access-denied`, `repo-missing` or `not-a-git-repo`.

`behind` counts from the sha the installed build was made from (`baseRev = builtSha || 'HEAD'`), not from the clone's current HEAD. The clone is often the one you commit from, so after a local commit and push its HEAD already equals `origin/main` while the installed app is still old; counting from HEAD would report no update. `HEAD` is the fallback when the built sha is missing from the clone.

### Apply

`startUpdate()` claims the slot synchronously (a second concurrent call returns the current state), validates the build, and starts `runPipeline` without awaiting it, so `POST /update/apply` returns at once. Validation requires a build origin and `BISMUTH_APP_PATH`, an available update, and a clean clone. The pipeline first counts `git rev-list --count origin/main..HEAD` (ahead) and `HEAD..origin/main` (behind). When both are above zero the clone has diverged: without `resetToUpstream` the run ends in the error phase with `diverged: {ahead, behind}`, and with it the pipeline runs `git branch <backupBranchName()> HEAD` and `git reset --hard origin/main` (60 seconds each) in place of the pull, and every later progress state carries `backupBranch`. `POST /update/apply` passes `resetToUpstream` only for a body of `{reset: true}` from the owner channel. Then the pipeline runs three commands with these time limits:

1. `git pull --ff-only origin main` in the clone (120 seconds), skipped after a reset.
2. `bun install --frozen-lockfile` in the clone (300 seconds). A plain `bun install` could rewrite the committed `bun.lock` and leave the clone dirty, which would block the next update.
3. `bun run tauri build --bundles app` in `app/` (900 seconds). `--bundles app` skips the dmg, because only the `.app` is swapped and dmg packaging is the flakiest step. If a signing identity exists (see [install](install.md#macos-folder-permissions-surviving-updates)) it is passed as `APPLE_SIGNING_IDENTITY`.

`bun` is found with `Bun.which` over `buildPath()`: `claudeLookupPath()` from `core/src/claudeWhich.ts` plus `~/.cargo/bin`. A Finder-launched sidecar inherits only the minimal launchd `PATH`, so git, bun and cargo would not resolve otherwise. `GET /update/progress` returns the in-memory `{ phase, message?, log?, diverged?, backupBranch?, cancelling? }`, where `phase` is `idle`, `pulling`, `building`, `ready`, `error` or `cancelled` and `log` is the last 2000 characters of the failing step. Every command, with its full output and exit code, goes to `bismuth-update-build.log`, truncated at the start of each run.

### Cancel

`startUpdate()` records the run in flight as an `AbortController` plus the promise that settles when it stops. `cancelUpdate()` aborts it, marks the state `cancelling: true` with the message `cancelling…`, waits for that promise and returns the final state; with no run, or once the phase is `ready`, it returns the state unchanged. `POST /update/cancel` calls it and answers only after the run has stopped.

The pipeline passes the signal to `runProc()`, which kills the running `bun install` or `tauri build` on abort. Each step runs in its own process group and the whole group is killed, on a cancel or a time limit, because `bun run tauri build` runs the real build as a child that would otherwise keep running and hold the output pipes open. The git runner gets no signal, so a pull, branch or reset runs to completion. After every step the pipeline checks the signal before it reads the exit code, because a killed process exits non-zero and that exit is the cancel, not a failure. A stopped run ends in `{ phase: 'cancelled', message: 'update cancelled' }`, keeping `backupBranch` when a reset already ran, and the build log ends with a `cancelled` entry. A cancel during `startUpdate()`'s own status check ends the same way without starting the pipeline.

### Relauncher

`spawnRelauncher()` writes a one-shot bash script to the temp directory and starts it with `nohup`, so it reparents to launchd and outlives the sidecar. The script waits up to 120 seconds for `BISMUTH_APP_PID` to exit, moves the installed app to a `.bak-<n>` copy beside it, copies the new `.app` in with `/usr/bin/ditto`, deletes the backup on success, restores it on failure, then runs `open` on the app. It deletes itself on exit.

### Frontend

`app/src/updateCheck.ts` holds the status signal. It retries the first check every 4 seconds for up to 60 tries while the sidecar is still starting, then re-checks every 5 minutes. Each successful check with no run in flight also reads `/update/progress` and adopts a run that is `pulling` or `building`, which is how a CLI-started run or one that outlived a webview reload reaches the window.

`createUpdateRun()` in `app/src/updateRun.ts` is the one run every surface shares; `updateCheck.ts` wires the real instance and exports `updateRun` (the signal), `applyUpdateAndRelaunch()`, `cancelUpdate()` and `showUpdateToast()`. A start while a run is in flight joins it and returns the same promise. The run posts `/update/apply`, polls `/update/progress` every 2 seconds, and on `ready` imports `@tauri-apps/api/core` and invokes `quit_app`; outside Tauri that call fails silently. It owns one persistent progress toast, worded by `updatePhaseText()`, that carries a **cancel** action while the phase is `pulling` or `building`. A caller's own toast passed as `toastId` (the palette's `Checking for a Bismuth update…`) becomes that progress toast. A toast the person closed stays closed until `showToast()`.

The run ends in one outcome and shows its toast once: `Update cancelled`, `Bismuth is already up to date`, or the failure from `showUpdateFailureWith()` in `app/src/updateFailure.ts`. A `quiet` start (automatic updating) skips the up-to-date toast and every failure toast except a diverged clone's, and a loud start joining it makes it loud. The diverged failure's **reset** action starts the shared run with `{reset: true}`.

`maybeAutoUpdate()` runs after each successful check when `settings.update.autoUpdate` is true and an update is available, guarded by a once-per-session flag that resets after an ordinary error or an up-to-date result; a diverged clone or a cancel keeps the flag set. `app/src/UpdateBanner.tsx` renders from `updateRun`: it stays visible while a run is in flight, shows the phase readout, and swaps **update** and its dismiss for **cancel**. The palette commands `update-app` and `cancel-update` call the same functions.

### Tauri shell

When the bundled app spawns its sidecar, `app/src-tauri/src/lib.rs` sets three variables the updater depends on: `BISMUTH_INSTALL_SRC` (the tools resource, which holds `build-origin.json`), `BISMUTH_APP_PATH` (the running `.app`, found by walking up from the executable) and `BISMUTH_APP_PID`. The `quit_app` command calls `app.exit(0)`. In dev the app is not inside a `.app` and the sidecar is not spawned, so none of the three is set and the status reports `not-a-source-build`.

### Daemon install on launch

On every boot the sidecar calls `installDaemonFromBundle()` in `core/src/daemonInstall.ts` without awaiting it. With no `BISMUTH_DAEMON_BUNDLE` it does nothing. Otherwise it compares the bundled binary's `size:mtime` with the marker `~/.bismuth/.daemon-installed`; on a match it only re-ensures the service, and on a mismatch it copies the binary to `~/.bismuth/bin/bismuth-daemon` through a temp file and an atomic rename (a direct copy fails with `ETXTBSY` while the old service runs) and rewrites the marker. `runSetup()` runs `<bin> --ensure-installed`, which registers launchd `com.bismuth.daemon` or systemd `bismuth-daemon`. It never throws, so a failed daemon install cannot block the app. `POST /daemon/update` calls the same `runSetup()`.

Source: `core/src/selfUpdate.ts`, `core/src/claudeWhich.ts`, `core/src/daemonInstall.ts`, `core/src/server.ts`, `core/src/doctor/routes.ts`, `core/src/schema/settingsSchema.ts`, `app/src/updateCheck.ts`, `app/src/updateRun.ts`, `app/src/updateFailure.ts`, `app/src/UpdateBanner.tsx`, `core/src/routes/system.ts`, `cli/src/commands/update.ts`, `app/src/App.tsx`, `app/src/api.ts`, `app/src-tauri/src/lib.rs`, `app/scripts/build-bismuth-tools.ts`
