# Daemon tools (daemon-gated, per-vault)

When the [daemon](../daemon/overview.md) is enabled for the active vault, the Bismuth MCP server exposes **ten more tools** — the daemon control surface: crons, background processes, the daemon inbox (pages), and daemon status / device ownership. They live in `mcp/src/daemon.ts`.

## Gating (same signal as the memory tools)

The gate is `daemonEnabled()` — which is just `memoryDir() != null`, i.e. `process.env.BISMUTH_MEMORY_DIR` is set. `core/src/terminal.ts` injects `BISMUTH_MEMORY_DIR` (pointing at `<vault>/.daemon/memory`) into a Bismuth tab's PTY **only** when `settings.daemon.enabled` is on for that vault, and the daemon's own session sets it explicitly; the MCP child inherits it. So `ListTools` returns `daemonEnabled() ? [...always-on, ...memoryTools, ...daemonTools] : always-on` — outside a daemon-enabled session a machine-wide Claude session never even sees these tools, so they don't tax its context. (This is the same precedent as the memory tools, not the always-on five — see [overview.md](overview.md).)

## Why first-class tools here (vs. app control's "zero new tools")

App control deliberately adds no MCP schemas because it's always-on machine-wide. The daemon tools are different: they're **daemon-gated**, so they cost context only in a session that actually has a daemon — and surfacing them as named tools makes the daemon's own session discover its control surface (run a cron, pause a process, author an inbox page) without having to know the exact `bismuth …` incantation. Under the hood they still **bridge the existing `bismuth` CLI** (`daemon` + `page` groups via `mcp/src/cli.ts`'s `runCli`) rather than reimplementing daemon logic — one code path per operation, and no `@bismuth/core` dependency added to this workspace.

## The tools

Vault-scoped tools inject `--vault <root>`; the root is derived from `BISMUTH_MEMORY_DIR` (stripping the `/.daemon/memory` suffix), falling back to `BISMUTH_VAULT`.

| Tool | Args | Bridges to | Does |
|---|---|---|---|
| `daemon_status` | — | `daemon status` | Daemon liveness, this device id, current owner |
| `daemon_devices` | — | `daemon devices` | All heartbeating devices (owner/this flagged) |
| `daemon_owner` | `device?` | `daemon owner [device]` | Read the owner, or claim `device` as owner |
| `daemon_list` | — | `daemon graph` | This vault's crons + processes with enabled/running/schedule/last-result |
| `cron_run` | `name` | `daemon cron run <name>` | Run a cron NOW, out of schedule (e.g. `dream` to consolidate memory now) |
| `cron_toggle` | `name`, `enabled?` | `daemon cron toggle <name> [--off]` | Enable (default) or, with `enabled:false`, pause a cron |
| `process_toggle` | `name`, `enabled?` | `daemon process toggle <name> [--off]` | Enable/disable a background process (nudges the running daemon to start/stop it) |
| `page_list` | — | `page list` | The daemon inbox (each page merged with its dynamic status) |
| `page_create` | `slug`, `title?`, `body?`, `actions?`, `source?`, `deliver_at?` | `page create <slug> …` | Author a validated inbox page + action buttons (an action with `prompt` = approve, without = dismiss) |
| `page_resolve` | `path`, `action` | `page resolve <path> <action>` | Press a page action (approve → daemon runs its prompt; dismiss → resolved here) |

`page_create`'s `actions` is an array of `{id, label, kind?, prompt?, model?, timeout?}`; the tool JSON-stringifies it into the CLI's `--actions '<json>'` so the caller never hand-writes the nested `actions[]` YAML that `resolvePage` depends on.

## Known gaps (no clean CLI path yet — follow-ups)

`dream_config`/`dream_status` (dream config now lives in the `dream` cron's frontmatter — edit the file); `cron_create`/`cron_delete`/`cron_stop`; `process_start`/`process_stop` (runtime start/stop, distinct from enable/disable); `message_bot` (superseded by the visual Claude chat / daemon session — no headless send); `restart`/`stop`/`uninstall` (daemon lifecycle — `bismuth daemon update`/`setup` cover re-register; a full stop/uninstall CLI isn't wired). Each of these wants a `bismuth` CLI command first, then a thin tool here — rather than a fragile direct reimplementation in the MCP.

## Source

`mcp/src/daemon.ts` (the tool defs + the pure `daemonCliArgs` name→argv mapper + `daemonVaultRoot` derivation), `mcp/src/server.ts` (gating + dispatch), `mcp/src/cli.ts` (`runCli`/`formatCliResult`), `cli/src/commands/daemon.ts`, `cli/src/commands/page.ts`, `core/src/daemon.ts`, `core/src/daemonGraph.ts`, `core/src/daemonPages.ts`. Tests: `mcp/test/daemon.test.ts`.
