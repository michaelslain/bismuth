# Doctor

`bismuth doctor` answers one question: **is this machine (and this vault) in the state the current
build expects?** It finds leftovers from older builds, version skew between the app and what it
installed, and pending vault migrations, and `--fix` repairs them. Source: `core/src/doctor/`.

It is one engine with four surfaces, so they never disagree:

- the CLI: `bismuth doctor` (`cli/src/commands/doctor.ts`)
- the MCP tool `bismuth_doctor`, which runs that same CLI command
- two core routes, `GET /doctor` and `POST /doctor/fix` ([HTTP reference](../api/http-reference.md))
- the app's launch toast, and a boot pass that applies the safe repairs

## Running it

```bash
bismuth doctor                       # dry run: list findings, change nothing
bismuth doctor --fix                 # apply every repair (safe and destructive)
bismuth doctor --fix --safe-only     # apply safe repairs only
bismuth doctor --fix --only <id>[,<id>…]   # apply just these findings
bismuth doctor --section <id>[,<id>…]      # run only these sections
bismuth doctor --vault <path>        # also run the vault section on this vault
bismuth doctor --json                # the raw report
```

Sections: `install`, `legacy`, `daemon`, `runtime`, `backends`, and `vault`. The vault section runs
only when a vault is given (`--vault` or `BISMUTH_VAULT`); without one the output says
`vault checks skipped // pass --vault <path>`.

A healthy machine prints `bismuth doctor // all clear`. Otherwise a header
`bismuth doctor // <n> findings // <d> need consent` is followed by one line per finding:
`<mark> <id>  <title>`, and `  -> <what the repair does> [<risk>]` when it has one. Marks are `✗`
error, `!` warn, `·` info, `✓` ok. Findings whose repair is destructive come first. With `--fix`,
each repaired line ends ` // fixed` or ` // failed: <first warning>`. `--only` with an id that matches
no finding applies nothing and prints `unknown id: <id>`.

A section that throws never stops the others: it becomes one `<section>.check-failed` error finding.

## Safe versus destructive

Every repair carries a risk.

- **safe**: removes only what is provably Bismuth's own and dead (ownership is judged by path shape
  under a `.bismuth` directory, never by a substring match), or reruns an installer or migration that
  boot already runs.
- **destructive**: deletes a directory a person might still want, unloads a service, or rewrites
  notes in a way boot does not already.

A repair never throws. It returns warnings, and a second run finds nothing left to do.

## What boot does

In the bundled app (`BISMUTH_INSTALL_SRC` set), after the machine-wide install settles, core runs the
doctor with **safe repairs only** and logs `bismuth doctor: fixed <n>, <d> waiting for consent`, plus
the first warning of any repair that failed. Dev runs skip it, and `BISMUTH_NO_BOOT_DOCTOR=1` skips it
everywhere. Boot runs every section except `vault`, because boot already runs the vault's own migrations itself.

Destructive repairs wait for you. When any are pending, each window shows one toast at launch:
`doctor // 2 repairs need your ok: <title 1>, <title 2>` (with more than two, the end reads
`<title 1>, <title 2> +<n> more`). Its **fix** button applies exactly those findings and the toast
becomes `doctor // fixed <k> of <n>`. It disappears after 20 seconds, and there is no toast when
nothing is pending or `/doctor` is unavailable (the iPad/iOS backend answers 501). Running
`bismuth doctor --fix` in a shell is the same decision, made by hand.

## Agent mode

A process Bismuth stamped as an agent's hand (`BISMUTH_AGENT_CHANNEL` set to anything but owner), or
one spawned by the MCP server (`BISMUTH_MCP_CHANNEL` set), runs the doctor in **agent mode**.
The visibility gate classes `doctor` as always safe because it never prints a note body, so the
command itself holds the two limits:

- `--fix` is forced to **safe repairs only**, whatever flags were passed. Destructive repairs stay
  pending for the owner, and the CLI prints `agent mode // destructive repairs need the owner`.
- If the vault hides anything from that channel (see [visibility](../vault/visibility.md)), the
  `vault` section is dropped, because its finding ids carry note paths.

`GET /doctor` and `POST /doctor/fix` are owner-only: an agent channel gets `403`.

## Finding ids

Ids are `<section>.<slug>`. A problem that can hit many items (stale run records, legacy bases, leftover
temp files) is ONE finding per kind: its title carries the count, its detail lists the items (the first
10, then `+<n> more`), and one repair covers them all. Only the few-at-most kinds carry a
`:<qualifier>` (`install.cli-link-stale:<path>`, `install.mcp-other-stale:<id>`, `legacy.skill-link:<id>`).
Ids are unique within a report. The human report pads the id column to at most 32 characters.

| id | what it means | what the repair does (risk) |
|---|---|---|
| `<section>.check-failed` | A section threw while checking (for example, unreadable folder). | none |
| `backends.<backendId>` | An agent CLI is installed but its probe failed. | none |
| `backends.claude` | `claude` is not on PATH. | none |
| `install.not-installed` | Bismuth's machine-wide CLI and MCP are not installed (a dev checkout, usually). | none |
| `install.version-skew` | The installed CLI/MCP tools differ from the ones bundled with this app. | reruns the installer (safe) |
| `install.cli-link-missing` | The `bismuth` command is not linked onto PATH. | relinks it (safe) |
| `install.cli-link-stale:<path>` | A `bismuth` link on PATH points at a Bismuth that no longer exists. | unlinks it, then relinks (safe) |
| `install.mcp-claude-missing` | Claude has no `bismuth` MCP registration. | registers it (safe) |
| `install.mcp-claude-stale` | Claude's `bismuth` MCP registration points at a stale binary. | re-registers it (safe) |
| `install.mcp-other-stale:<registrarId>` | Another agent CLI's `bismuth` MCP entry (one you opted into) is stale. | re-registers that entry (safe) |
| `legacy.skill-link:<id>` | An old Bismuth skill symlink remains in `~/.claude/skills`. | unlinks it (safe) |
| `legacy.skills-dir` | `~/.bismuth/skills` remains from a build that shipped skills. | removes the directory (safe) |
| `legacy.claude-bot-service` | The retired claude-bot service is still registered with launchd/systemd. | unloads and removes it (destructive) |
| `legacy.claude-bot-clone` | A clone of the old claude-bot repo sits in `~/.bismuth/claude-bot`. | removes the directory (destructive) |
| `legacy.claude-bot-home` | `~/.claude-bot` still exists (info once its contents were migrated, warn if not). | removes it, only when the migrated copy is found in the destination vault's `.daemon/memory` (destructive) |
| `legacy.claude-bot-marker-old-home` | A claude-bot migration marker records an old home directory. | none |
| `legacy.obsidian-bundle-dirs` | App-support folders from an old `com.michael.obsidian*` bundle id remain. | removes each (destructive) |
| `legacy.sandboxes` | Old sandbox folders remain. | none |
| `daemon.unit-missing-binary` | The daemon service points at a binary that is gone. | removes the service (destructive) |
| `daemon.unit-old-home` | The daemon service was written under an old home directory. | re-registers the service (safe) |
| `daemon.binary-skew` | The installed daemon binary differs from the one bundled with this app. | reinstalls it from the bundle (safe) |
| `daemon.temp-binary` | Half-copied daemon binaries were left in `~/.bismuth/bin`. | unlinks them all (safe) |
| `daemon.atomic-tmp` | Leftover atomic-write temp files sit in the daemon directory. | unlinks them all (safe) |
| `daemon.log-size` | Daemon logs have grown past 10 MB. | keeps the last 1 MiB of each (safe) |
| `runtime.stale-run-record` | Run records name owner processes that are no longer alive; the detail lists their vaults. | unlinks them all (safe) |
| `runtime.trusted-commands-orphans` | The status-bar trust store has entries for vaults that no longer exist. | rewrites it without them (safe) |
| `runtime.gcal-orphan-keys` | The Google Calendar sync manifest has keys from an old home. | none (needs a migration, not a delete) |
| `runtime.app-config-vault-missing` | The app's saved vault folder no longer exists. | none |
| `runtime.agent-shim` | Leftover agent PATH-shim directories remain. | removes them all (safe) |
| `vault.settings-location` | The vault's settings are still in the old `settings.yaml` location. | migrates them to `.settings` (safe) |
| `vault.settings-retired-keys` | `.settings` carries keys the schema has retired. | reconciles the file (safe) |
| `vault.task-syntax` | Notes still use the old emoji task syntax. | converts them to bracketed fields (safe) |
| `vault.base-views-list` | Bases use the legacy one-entry `views:` list. | rewrites each flat (destructive) |
| `vault.base-views-multi` | Bases have a `views:` list with two or more entries, which cannot be flattened. | none |
| `vault.ink-dir` | A leftover `<vault>/.ink` directory remains. | removes it, only when every file is empty (destructive) |
| `vault.daemon-md` | A leftover `daemon.md` file remains. | none |
| `vault.visibility-profiles` | Old sandbox visibility profiles sit in `.daemon/tmp`. | unlinks those older than 7 days (safe) |
| `vault.backup-exclude` | The backup repo's `.git/info/exclude` lists stale lines. | prunes them (safe) |

Related: [install](install.md), [self-update](self-update.md), [status messages](status-messages.md).
