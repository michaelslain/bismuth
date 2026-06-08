# claude-bot Installation

How the **claude-bot** daemon installs itself, and how Bismuth bundles and invokes that installer. claude-bot is a separate repository and a separate process; Bismuth never starts, stops, or repoints a live daemon — it only **adopts** one. This page documents the claude-bot side of that contract (the installer entrypoint, the adopt-vs-install decision, the platform service files, identity/ownership state, and the relocatable bundle), then defers the Bismuth-side bridge to [../daemon/overview.md](../daemon/overview.md) and [../daemon/storage.md](../daemon/storage.md).

## The entrypoint Bismuth spawns: `bin/ensure-installed.ts`

A non-interactive installer that imports `getInstallStatus` + `ensureInstalled` from `../lib/install.ts` and prints **exactly one line of JSON to stdout** — designed to be spawned and parsed by another program (Bismuth), never run interactively.

Flag dispatch reads `args = new Set(Bun.argv.slice(2))`:

| Invocation | Action | Printed JSON |
|---|---|---|
| `--status` | `getInstallStatus()` | `InstallStatus` |
| `--dry-run` | `ensureInstalled({ dryRun: true })` | `EnsureResult` |
| _(no flag)_ | `ensureInstalled({ dryRun: false })` | `EnsureResult` |

Any thrown error is caught, printed as a single JSON line `{ "error": "<message>" }`, and the process exits `1`.

### `--status` → `InstallStatus`

Key order is as constructed:

```json
{
  "installed": true,
  "running": true,
  "daemonLabel": "com.claude-bot.daemon",
  "home": "/Users/you/.claude-bot",
  "plistPath": "/Users/you/Library/LaunchAgents/com.claude-bot.daemon.plist"
}
```

- `daemonLabel` — `LAUNCHD_LABEL` `"com.claude-bot.daemon"` on macOS, or `SYSTEMD_SERVICE_NAME` `"claude-bot"` on Linux.
- `home` — `BOT_DIR` (`~/.claude-bot`).
- `plistPath` — `daemonConfigPath()`: macOS `~/Library/LaunchAgents/com.claude-bot.daemon.plist`, Linux `~/.config/systemd/user/claude-bot.service`.

### Default / `--dry-run` → `EnsureResult`

```json
{ "action": "adopted", "status": { "installed": true, "running": true, "daemonLabel": "com.claude-bot.daemon", "home": "/Users/you/.claude-bot", "plistPath": "/Users/you/Library/LaunchAgents/com.claude-bot.daemon.plist" } }
```

`action` is one of `"adopted"`, `"would-install"`, or `"installed"`. `status` is an `InstallStatus`.

### Error

```json
{ "error": "<message string>" }
```

## Adopt-vs-install decision (`lib/install.ts` `ensureInstalled`)

Idempotent and **adopt-only**. The steps:

1. `status = getInstallStatus(probes)`.
2. If `status.installed` is `true` → return `{ action: "adopted", status }` **immediately** — no `performInstall`, no `launchctl`/`systemctl`, no file writes, no restart. **This is the adopt path.**
3. Else if `opts.dryRun` → `{ action: "would-install", status }` — no side effects.
4. Else `performInstall()`; on failure `throw new Error(result.error ?? "daemon install failed")`; on success `{ action: "installed", status: getInstallStatus(probes) }` (status is re-read post-install).

`installed` means **service loaded OR config file present**:

```ts
installed = probes.configExists(plistPath) || probes.isLoaded(label)
```

So an already-running **or** merely-installed daemon is adopted untouched — confirmed idempotent and adopt-only.

## Install logic & probes (`lib/install.ts`)

`InstallProbes` are injectable so tests never touch real launchd, the live pid, or the filesystem:

| Probe | Default behavior |
|---|---|
| `isLoaded(label)` | macOS `launchctl list <label>` status `=== 0`; Linux `systemctl --user is-active <label>` status `=== 0` |
| `configExists(path)` | `existsSync(path)` |
| `pidAlive(pidFile)` | read `PID_FILE`, `parseInt`, `process.kill(pid, 0)` liveness — the v1 `daemon.pid` liveness check |

`getInstallStatus()` sets `running = probes.pidAlive(PID_FILE)`. It is **read-only** — it never mutates.

`defaultPerformInstall` (the fresh-machine path):

1. Find bun via `Bun.which("bun")`, else `/opt/homebrew/bin/bun` (macOS), else `~/.bun/bin` (Linux). If none → `{ ok: false, error: "could not find bun binary — install bun first: https://bun.sh" }`.
2. Build a config with `generateDaemonConfig({ bunPath, daemonEntry: join(import.meta.dir, "..", "daemon", "index.ts"), logsDir: LOGS_DIR, workDir: BOT_DIR, envPath: buildPath() })`.
3. Call `installDaemon(daemonConfigPath(), config)`.

`buildPath()` merges `process.env.PATH` with `/usr/local/bin`, `/usr/bin`, `/bin`, `/opt/homebrew/bin`, `~/.bun/bin`, `~/.local/bin` (dedup, order-preserving). This becomes the launchd/systemd `PATH` so the daemon can find `bun` and `claude`.

The install does **not** create state dirs itself — the daemon self-creates them on boot (`daemon/index.ts` `ensureDirs`).

## launchd vs systemd (`lib/platform.ts`)

`daemonConfigPath()`: Linux `~/.config/systemd/user/claude-bot.service`; macOS `~/Library/LaunchAgents/com.claude-bot.daemon.plist`.

On both platforms the daemon launch command is:

```
<bunPath> run <daemonEntry>
```

where `daemonEntry` is `.../daemon/index.ts`.

**macOS plist** (`generatePlist`):

| Key | Value |
|---|---|
| `Label` | `com.claude-bot.daemon` |
| `ProgramArguments` | `[<bunPath>, "run", <daemonEntry>]` |
| `EnvironmentVariables.PATH` | the built path (`buildPath()`) |
| `RunAtLoad` | `true` |
| `KeepAlive` | `true` |
| `StandardOutPath` | `~/.claude-bot/logs/claude-bot.stdout.log` |
| `StandardErrorPath` | `~/.claude-bot/logs/claude-bot.stderr.log` |
| `WorkingDirectory` | `BOT_DIR` |

**Linux systemd unit** (`generateSystemdUnit`):

```ini
[Unit]
Description=claude-bot daemon
After=network.target

[Service]
Type=simple
ExecStart=<bunPath> run <daemonEntry>
WorkingDirectory=<BOT_DIR>
Environment=PATH=...
Restart=always
RestartSec=5
StandardOutput=append:~/.claude-bot/logs/claude-bot.stdout.log
StandardError=append:~/.claude-bot/logs/claude-bot.stderr.log

[Install]
WantedBy=default.target
```

`installDaemon(configPath, config)`:

- **Linux** — `mkdir ~/.config/systemd/user`, write the unit, `systemctl --user daemon-reload`, then `systemctl --user enable --now claude-bot` (non-zero status → `{ ok: false, error }`).
- **macOS** — `Bun.write(configPath, config)` then `launchctl load <configPath>`.

`unloadDaemon`: Linux stop + disable; macOS `launchctl unload`. `reloadDaemon`: rewrite config + restart (systemd) / unload + load (launchctl).

`isDaemonProcess(pidFile = PID_FILE)` returns `true` only when `process.pid` equals the pid in `PID_FILE` — this gates the mutating process MCP tools to the real daemon.

`notify(title, message)`: Linux `notify-send`; macOS `osascript -e 'display notification ...'` (message trimmed to 200 chars).

## Device identity (`lib/device.ts`)

`deviceIdPath(home) = <home>/device-id`. `getDeviceId(home = BOT_DIR)` reads and trims the persisted UUID; the first call generates `randomUUID()`, `mkdir(home, { recursive: true })`, and writes atomically (`<path>.<pid>.tmp` then rename), so it is stable across restarts. `getDeviceLabel() = os.hostname()`. The `device-id` file stores **only the raw UUID string** (no JSON).

## Ownership (`lib/owner.ts`)

Full on-disk shapes live in [../daemon/storage.md](../daemon/storage.md); the summary:

- `devices.json` — `Record<deviceId, { label, lastSeenISO }>`.
- `owner.json` — `{ ownerDeviceId, ownerLabel, updatedAt }`. **Absent = unclaimed → legacy single-device.**

| Function | Behavior |
|---|---|
| `getOwner(home)` | read `owner.json` (or unclaimed) |
| `heartbeatDevice(home)` | upsert `{ label: getDeviceLabel(), lastSeenISO }` |
| `listDevices(home)` | `{ devices: [{ deviceId, label, lastSeenISO, isOwner, isThis }], ownerDeviceId }` |
| `isOwner(home)` | absent `owner.json` → `true` |
| `deviceInfo(home)` | `{ deviceId, label, isOwner, owner }` |
| `setOwnerDevice(deviceId, home)` | **rejects** if `deviceId` not in `devices.json`: `Device "<id>" is not present in devices.json — cannot set as owner`; writes `owner.json` byte-compatibly with what Bismuth reads |

All writes are atomic (`writeJsonAtomic`) and pretty-printed. Owner gating is covered in [communication.md](communication.md).

## Home resolution & service names (`lib/config.ts`)

```ts
BOT_DIR = join(homedir(), ".claude-bot")
```

**There is no env-var override on the claude-bot side.** `BOT_DIR` is hard-derived from `os.homedir()`; tests inject a `home` argument instead of an env var. (Bismuth's `OA_CLAUDEBOT_HOME` / `daemon.home` setting only changes where **Bismuth** looks, not where claude-bot writes — see [../daemon/storage.md](../daemon/storage.md).)

Service names: `LAUNCHD_LABEL = "com.claude-bot.daemon"`, `SYSTEMD_SERVICE_NAME = "claude-bot"`.

## The relocatable bundle (`scripts/bundle.ts`, BUNDLING CONTRACT v3)

Relevant because Bismuth bundles claude-bot. `scripts/bundle.ts` assembles a relocatable, self-contained tree at `dist/claude-bot/` (gitignored).

**Why source + `node_modules` and not a single binary:** the plist/unit runs `<bunPath> run <daemonEntry>`, so the daemon needs on-disk **source** plus a runtime `node_modules`.

**Bundle contents:**

- Source **dirs** copied: `lib`, `daemon`, `bin`, `memory`, `defaults`, `skills`. (`memory/` is required because `server.ts` imports `./memory/*`; `defaults/` + `skills/` are first-boot seed assets.)
- Top-level **files**: `server.ts`, `package.json`.
- Test files stripped (`**/*.test.ts` removed).
- Runtime `node_modules`: `cp -R` of the repo's `node_modules` (preserves `.bin` symlinks for relocatability; requires `bun install` to have run first or it throws `missing node_modules`).

**Self smoke-test** (non-zero exit on failure):

1. `dist/claude-bot/bin/ensure-installed.ts --status` must print JSON with a string `daemonLabel` (read-only check).
2. `dist/claude-bot/node_modules/@anthropic-ai/claude-agent-sdk` must exist.

**`package.json`:** name `"claude-bot"`, version `"0.1.0"`, type `"module"`, `bin: { "claude-bot-ensure-installed": "./bin/ensure-installed.ts" }`, deps `@anthropic-ai/claude-agent-sdk` and `@modelcontextprotocol/sdk`. There is **no `exports` field** — importable functions are reached via a direct `../lib/install.ts` import, not a package `exports` map.

**Manual install** (from the README): add the marketplace, install the plugin (`Plugin "claude-bot@claude-bot-local" is already installed (scope: user)`), restart Claude Code, then run the ensure-installed entrypoint.

## How Bismuth bundles + invokes it (the integration seam)

`OA_CLAUDEBOT_BUNDLE` is a **Bismuth-side** env var — it is **not referenced anywhere in the claude-bot repo**. claude-bot's only job is to produce the relocatable `dist/claude-bot/` tree via `scripts/bundle.ts`.

Bismuth then:

1. Stages that tree as a Tauri resource and points `OA_CLAUDEBOT_BUNDLE` at it.
2. Resolves the installer entrypoint (`resolveEntrypoint`) with precedence: (1) an **already-installed** claude-bot on this machine (parsed from the launchd plist / systemd unit → its own `bin/ensure-installed.ts`); (2) the **bundled** copy `<bundle>/bin/ensure-installed.ts`; (3) the linked `file:` dev-dep.
3. Spawns that entrypoint with `--status` (read-only probe, behind `GET /daemon/install`) or no flag (adopt-only setup, behind `POST /daemon/setup`), parsing the single JSON line.

Because the entrypoint is **adopt-only**, it never clobbers, restarts, or repoints a live daemon. Full Bismuth-side detail is in [../daemon/overview.md](../daemon/overview.md) (the "Adopt-Only Setup" section + `resolveEntrypoint`) and [../daemon/storage.md](../daemon/storage.md); Bismuth's HTTP route docs are not duplicated here.

## See also

- [daemon.md](daemon.md) — launchd/systemd service + boot
- [storage.md](storage.md) — on-disk file shapes
- [communication.md](communication.md) — owner gating
- [../daemon/overview.md](../daemon/overview.md), [../daemon/storage.md](../daemon/storage.md) — Bismuth's adopt-only bridge + `OA_CLAUDEBOT_HOME`

Source: bin/ensure-installed.ts, lib/install.ts, lib/platform.ts, lib/device.ts, lib/owner.ts, lib/config.ts, scripts/bundle.ts, package.json
