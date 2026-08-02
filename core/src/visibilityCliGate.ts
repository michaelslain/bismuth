// core/src/visibilityCliGate.ts
// The visibility gate for the `bismuth` CLI itself — the same binary is BOTH the vault owner's own
// hand (where visibility deliberately does NOT apply — see docs/vault/visibility.md's threat model)
// and, when Bismuth spawns an agent, that agent's hand too (where it must). Two trust boundaries,
// two entry points into this file:
//
//  - `gateCliArgs` — the MCP path (mcp/src/cli.ts spawns the CLI as a subprocess of the
//    `bismuth_cli` MCP tool). Channel comes from `BISMUTH_MCP_CHANNEL`; unset/unrecognized
//    defaults to "daemon" (every MCP session is SOME agent, so the safe default is the stricter
//    channel).
//  - `gateCliInvocation` — the CLI's OWN single dispatch point (cli/src/index.ts), so an agent that
//    runs `bismuth` directly in a shell — no MCP layer at all — is gated too. Channel comes from
//    `BISMUTH_AGENT_CHANNEL`, and here "unset" means something different on purpose: it is the
//    OWNER's own hand (their interactive shell, a dev script, CI…), so it is allowed through with NO
//    gate at all. Every place Bismuth itself spawns an agent (core/src/chat.ts, the daemon session,
//    the codex/ACP chat drivers) stamps this var explicitly; an unstamped invocation is, by
//    construction, not one of those. Getting this backwards in either direction is the whole risk:
//    default it to "gate" and the owner is locked out of their own CLI; default it to "no gate" and
//    every agent is ungated.
//
// The hole this half closes: `bismuth read Private/secret.md` (or, worse, `bismuth api GET
// '/file?path=Private/secret.md'`) returns a hidden note's contents verbatim when run as a Bash
// subprocess — a calling convention `disallowedTools: ["mcp__bismuth__bismuth_cli"]` cannot touch,
// because that SDK setting only blocks the MCP *tool*, not the same binary invoked as a plain
// subprocess, and Bash is deliberately never disallowed (the daemon needs `bismuth checkpoint`).
//
// Design notes (unchanged from this file's original spike — restated because they explain choices
// a "simplify this" pass might otherwise undo):
//  - FAIL-SAFE by default. An unset/garbled channel resolves to "daemon", the STRICTER of the two
//    (it also excludes `chat-only`) — except `BISMUTH_AGENT_CHANNEL` specifically, where absent
//    means "owner", per the threat model above. An unreadable vault, a bad settings file, or any
//    thrown error REFUSES rather than allows: this gate exists precisely for the cases where
//    something is off.
//  - OVER-INCLUSIVE on purpose. It refuses when a restricted path appears ANYWHERE in the argv, as a
//    substring, rather than trying to know which positional each CLI command treats as a path. A
//    false refusal costs an agent one tool call and says exactly why; a false ALLOW leaks a note.
//  - Content-scanning commands are refused wholesale whenever anything is restricted, mirroring the
//    existing precedent for Claude: a per-file deny cannot stop an unscoped `search` from returning a
//    hidden file's matching LINES (docs/vault/visibility.md disables Grep/Glob outright for exactly
//    this reason).
//  - The target dir is resolved the SAME way the CLI's own commands do — `--dir` (checkpoint's
//    generic-repo flag), then `--vault` (`requireVault`), then `BISMUTH_VAULT` env — not env alone.
//    An agent that knows its own cwd (the daemon's Bash tool never gets `BISMUTH_VAULT` in its env;
//    only the MCP server's own env block sets it) will pass `--vault`/`--dir` explicitly, and a gate
//    that only checked env would be a no-op for exactly the invocation shape this file exists to
//    cover.
import { buildDenyPaths, findDeniedEntry, normalizeForCompare, type DenyEntry, type VisibilityChannel } from "./visibility";

/** Which channel this MCP server is serving, from `BISMUTH_MCP_CHANNEL`.
 *
 *  Defaults to "daemon" — the stricter channel — when unset or unrecognized, so a spawner that
 *  forgets to declare itself gets the safe answer rather than the permissive one. Bismuth's own
 *  spawners set it explicitly (the daemon session, and each chat driver that injects an MCP server). */
export function mcpChannel(env: Record<string, string | undefined> = process.env): VisibilityChannel {
  return env.BISMUTH_MCP_CHANNEL === "chat" ? "chat" : "daemon";
}

/**
 * Who is invoking the CLI directly, from `BISMUTH_AGENT_CHANNEL`.
 *
 * ABSENT is not a default to the stricter channel — this is the one gate signal in this codebase
 * where "unset" must mean the OWNER'S OWN HAND, never an agent: the same `bismuth` binary is the
 * vault owner's interactive tool (their shell, dev scripts, CI, a plain terminal Claude Code
 * session), where visibility must not apply at all. Every place Bismuth itself SPAWNS an agent
 * stamps this var explicitly before that agent can reach a shell; an unstamped invocation is,
 * by construction, the owner's.
 *
 * A garbled non-empty value (typo, a future channel this build doesn't know) is NOT treated as
 * "absent" — it falls through to the stricter "daemon" channel rather than "owner", so a corrupted
 * signal fails safe instead of silently degrading to no gate at all.
 */
export function cliAgentChannel(env: Record<string, string | undefined> = process.env): VisibilityChannel | "owner" {
  const raw = env.BISMUTH_AGENT_CHANNEL;
  // EMPTY counts as absent, not as a garbled agent value. `export BISMUTH_AGENT_CHANNEL=` and shells
  // that propagate empty vars are ordinary in a human's environment, and Bismuth itself never writes
  // an empty value — it always stamps "chat" or "daemon" explicitly. So an empty value can only have
  // come from the OWNER's own shell, and treating it as an agent locked them out of their own CLI
  // (found by the acceptance run). Nothing is lost by being lenient here: this signal is an honesty
  // boundary, and an agent that could set the var to "" could equally `unset` it — the layer that
  // actually ENFORCES against a determined process is the OS sandbox wrapper, not this env var.
  if (raw === undefined || raw.trim() === "") return "owner";
  return raw === "chat" ? "chat" : "daemon";
}

/**
 * Command classification, as an ALLOWLIST with a refuse-by-default tail.
 *
 * This started as a denylist of "content-scanning commands" and that was the wrong shape. A
 * red-team pass found the misses immediately: `rows`, `card all|due|note`, `task list`,
 * `calendar`, `graph`, `tree`, and most sharply **`checkpoint diff`** — a git diff, i.e. the full
 * plaintext of every changed hidden note, on a command the daemon's PATH shim exists to make
 * reachable. A denylist is only ever as good as the author's imagination, and it silently fails
 * open for every command added to the CLI afterwards.
 *
 * So: three tiers, and anything unclassified REFUSES. Re-checked against the CLI's full `--help`
 * enumeration (every command group under cli/src/commands/) rather than the partial list this
 * gate started from — see the per-command reasoning below.
 */

/**
 * Tier A — cannot surface vault note content at all, so allowed even in a restricted vault.
 * Machine/app/daemon plumbing and settings writes. Keep this list boring and short: every addition
 * is a promise that the command can never echo a note's body.
 *
 * `page` is here deliberately: daemon inbox pages (core/src/daemonPages.ts, `<vault>/.daemon/pages`)
 * are the daemon/MCP's OWN authored notifications, not vault note content — `page list`'s body/title
 * fields are whatever the daemon wrote when it created the page, never a vault note pulled in by
 * reference.
 *
 * `serve` is deliberately NOT here (it was in an earlier revision of this list): `bismuth serve`
 * spins up ANOTHER unauthenticated copy of the core HTTP API (`GET /file`, `POST /search`, `POST
 * /rows`, …, none of which check visibility on their own — see docs/vault/visibility.md), which an
 * agent could then `curl` from the very same shell — a strictly worse ambient-oracle bypass than
 * anything a `bismuth` subcommand returns directly. Nothing in chat.ts/session.ts ever shells out to
 * `bismuth serve` (grepped), so refusing it under a restricted vault does not brick any real flow.
 */
const ALWAYS_SAFE_COMMANDS = new Set([
  "backends", "install", "uninstall", "app", "daemon", "agent-graph",
  "folder-icon", "folder-visibility", "settings", "backup", "page",
]);

/** Tier B — takes an explicit path, and returns only that path's content. Allowed subject to the
 *  argv path check below, which is what makes them safe. */
const PATH_SCOPED_COMMANDS = new Set([
  "read", "write", "move", "delete", "restore", "mkdir", "prop", "render",
]);

/**
 * Compound-command overrides, checked before the group's first-token tier. Needed only where a
 * group's OWN subcommands disagree with each other on content risk — widening the whole group's
 * tier would be wrong in one direction or the other:
 *
 *  - `checkpoint diff` is a `git diff` — i.e. the full plaintext of every changed hidden note — so
 *    it stays in the refuse-by-default tail (bare `checkpoint`, or any subcommand this build
 *    doesn't recognize, is NOT in this map and so REFUSES, which is what we want).
 *  - `checkpoint advance`/`checkpoint ref` touch only a git-ref pointer (a SHA, or nothing) and
 *    print no note content — the daemon's own crons legitimately call these (Feature #51
 *    change-scoping), and refusing them would brick that in any restricted vault.
 */
const COMPOUND_OVERRIDES: Record<string, CommandTier> = {
  "checkpoint advance": "always-safe",
  "checkpoint ref": "always-safe",
};

/**
 * Tier C is everything else, INCLUDING commands this build has never heard of — refused whenever
 * the vault restricts anything. That covers the verified leaks (`checkpoint diff`, `search`, `api`,
 * `export`, `serve`, `rows`, `row`, `base`, `card`, `task`, `calendar`, `graph`, `tree`, `templates`,
 * `daily`, `replace`) and, more importantly, whatever the CLI grows next.
 *
 * `note` is deliberately here rather than in Tier B even though it takes a path: `note new x.md
 * --template Secret` pulls a TEMPLATE's body into the new note, and the template is named by name,
 * not by path, so the argv check cannot see it. An agent that needs to create a file can `write`.
 * `daily` carries the identical risk (a configured daily-note template), so it stays here too.
 *
 * `tree`/`graph` are deliberately here too, even though neither prints note BODY text: both list
 * every note's PATH/NAME, and a restricted note's filename can itself be the sensitive part (e.g.
 * "Divorce proceedings notes.md") — the same reasoning that already kept `graph` refused, applied
 * consistently rather than carved out for `tree`.
 *
 * `api` is the sharpest case of all: it is a passthrough to ANY server route, including the exact
 * `GET /file?path=…` ambient-oracle read this whole feature exists to close. It was never in
 * Tier A/B and must never be.
 */
export type CommandTier = "always-safe" | "path-scoped" | "refuse-when-restricted";

/** Pure: which tier this argv falls into. Checks a two-word compound override first (needed only
 *  for groups whose own subcommands disagree — see COMPOUND_OVERRIDES), then the group's first
 *  token, mirroring the CLI's own longest-match dispatch closely enough for classification purposes. */
export function commandTier(args: string[]): CommandTier {
  const first = (args[0] ?? "").toLowerCase();
  // No command at all (or a bare flag) is help output — harmless.
  if (!first || first.startsWith("-")) return "always-safe";
  if (args.length >= 2) {
    const compound = `${first} ${(args[1] ?? "").toLowerCase()}`;
    const override = COMPOUND_OVERRIDES[compound];
    if (override) return override;
  }
  if (ALWAYS_SAFE_COMMANDS.has(first)) return "always-safe";
  if (PATH_SCOPED_COMMANDS.has(first)) return "path-scoped";
  return "refuse-when-restricted";
}

export interface GateDecision {
  /** True when the CLI may run. */
  allowed: boolean;
  /** Why not — returned to the model verbatim, so it stops rather than retrying variants. */
  reason?: string;
}

/**
 * Reduce an argv token, and each deny path it is scanned against, to the same comparison form —
 * visibility.ts's `normalizeForCompare`, applied to the WHOLE token rather than to a path.
 *
 * All three spelling axes have to be folded here, not two. An earlier version of this function
 * folded only case and Unicode form, on the reasoning that a whole argv token is not a path and so
 * its `.`/`..` segments could not be resolved in place — with the segment axis left to the
 * per-token `findDeniedEntry` pass above. That reasoning is right for a token that IS a path and
 * wrong for one that merely CONTAINS one, and the gap was real:
 * `render --out exports/Private/./secret.md.html` returned `allowed: true`, because
 * `findDeniedEntry` cannot resolve a token whose path is a substring, and an unnormalized substring
 * scan cannot see through the `/./`. (`//` slipped the same way. The `..` spelling happened to be
 * caught, since `Private/../Private/secret.md` still contains `Private/secret.md` verbatim — which
 * is luck, not coverage.)
 *
 * Normalizing the whole token is safe because both sides of the scan get the identical treatment: a
 * path embedded in a longer string keeps its segment boundaries, so `exports/Private/./secret.md`
 * folds to `exports/private/secret.md` and still contains the folded needle. It is deliberately
 * over-inclusive in the same direction as the rest of this gate — a false refusal costs one tool
 * call, a false allow leaks a note.
 */
function foldForScan(s: string): string {
  return normalizeForCompare(s);
}

/** The path-shaped pieces of one argv token: the token itself, and — for `--flag=value` and
 *  `path=value` query fragments — whatever follows the first `=`. Each is handed to
 *  findDeniedEntry, which resolves `.`/`..` and both other spelling axes properly. */
function pathCandidates(arg: string): string[] {
  const eq = arg.indexOf("=");
  if (eq === -1 || eq === arg.length - 1) return [arg];
  return [arg, arg.slice(eq + 1)];
}

/**
 * Pure: decide whether `args` may run, given the restricted paths for this channel.
 *
 * `restricted` is the `{rel, abs}` list from `buildDenyPaths`. Two passes, because neither alone is
 * enough:
 *
 *  1. Each argv token (and the value half of a `--flag=value` / `path=value` pair) goes through
 *     `findDeniedEntry`, which resolves `.`/`..` segments, Unicode form and case the same way every
 *     other gate does. `bismuth read Private/../Private/secret.md` opens the file, so it must
 *     refuse.
 *  2. A SUBSTRING test against each token in both path forms, which catches a path embedded
 *     somewhere a whole-token check cannot see it — a longer query string, a quoted shell fragment,
 *     an export path derived from the note. Both sides go through `foldForScan`, which folds all
 *     three spelling axes and not just the two a substring test looks like it can honor; see that
 *     function for the `/./`-inside-a-longer-token hole that costs.
 */
export function decideCliGate(
  args: string[],
  restricted: DenyEntry[],
): GateDecision {
  if (restricted.length === 0) return { allowed: true };

  const tier = commandTier(args);
  if (tier === "always-safe") return { allowed: true };
  if (tier === "refuse-when-restricted") {
    return {
      allowed: false,
      reason:
        `Refused: \`bismuth ${args[0]}\` can return the contents of notes this vault marks off-limits ` +
        `to AI sessions, and it cannot be filtered per-file. ${restricted.length} note(s) are restricted. ` +
        `Ask the user to unhide them, or read a specific visible file by path.`,
    };
  }

  const refusal = (entry: DenyEntry): GateDecision => ({
    allowed: false,
    reason:
      `Refused: "${entry.rel}" is marked off-limits to AI sessions by this vault's visibility ` +
      `settings. Do not try to reach it another way — tell the user it is hidden if they need to know.`,
  });

  for (const arg of args) {
    for (const candidate of pathCandidates(arg)) {
      const hit = findDeniedEntry(restricted, candidate);
      if (hit) return refusal(hit);
    }
  }

  const haystack = args.map(foldForScan);
  for (const entry of restricted) {
    for (const form of [entry.rel, entry.abs]) {
      const needle = foldForScan(form);
      if (!needle) continue;
      if (haystack.some((a) => a.includes(needle))) return refusal(entry);
    }
  }
  return { allowed: true };
}

/** Value of a `--name <value>` argv flag, mirroring cli/src/args.ts's `flag()` (duplicated rather
 *  than imported: core must not depend on the cli workspace). */
function argFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
}

/** Resolve the dir a CLI invocation targets exactly the way the CLI's own commands do:
 *  `--dir` wins (checkpoint.ts's `repoDir` — checkpoint is generic over any tracked repo, not just
 *  the vault: the `dream` cron points it at `<vault>/.daemon/memory`), then `--vault`
 *  (`requireVault`, every other file-based command), then `BISMUTH_VAULT`. Checking env alone (this
 *  gate's original shape) is a no-op for the daemon's own Bash tool calls, which never get
 *  `BISMUTH_VAULT` in their env — only the MCP server's own env block sets it — so an agent passing
 *  `--vault`/`--dir <cwd>` explicitly (the normal, expected shape) would otherwise sail through
 *  ungated. A `--dir` target that isn't the vault root (the memory repo case) still works: every
 *  file's OWN frontmatter `visibility:` is read regardless of which root buildDenyPaths walked from,
 *  and a Tier-C command refuses on ANY restricted file, not a specific one. */
function resolveGateVault(args: string[], env: Record<string, string | undefined>): string | undefined {
  return argFlag(args, "dir") ?? argFlag(args, "vault") ?? env.BISMUTH_VAULT;
}

/** Shared resolve-then-decide core for both entry points below. Never throws — any failure REFUSES,
 *  because a gate that opens when it malfunctions is not a gate. Returns `{allowed: true}`
 *  immediately when no vault is configured: with no vault there is nothing to protect, and refusing
 *  every call would break the docs/help commands that need no vault at all. */
async function resolveAndDecide(
  args: string[],
  env: Record<string, string | undefined>,
  channel: VisibilityChannel,
): Promise<GateDecision> {
  const vault = resolveGateVault(args, env);
  if (!vault) return { allowed: true };
  try {
    const restricted = await buildDenyPaths(vault, channel);
    return decideCliGate(args, restricted);
  } catch (e) {
    return {
      allowed: false,
      reason:
        `Refused: could not resolve this vault's visibility settings, so the ` +
        `bismuth CLI is unavailable to this session (${e instanceof Error ? e.message : String(e)}).`,
    };
  }
}

/**
 * The MCP-path gate: resolve the vault's restricted set for `BISMUTH_MCP_CHANNEL`, then decide.
 * Used by mcp/src/cli.ts, at the chokepoint every `bismuth_cli`/`remember`/`recall`/`forget` call
 * spawns the CLI through.
 */
export async function gateCliArgs(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<GateDecision> {
  return resolveAndDecide(args, env, mcpChannel(env));
}

/**
 * The CLI's OWN gate — hooked at cli/src/index.ts's single dispatch point, so it runs before every
 * command regardless of how the CLI was invoked (Bash subprocess, a script, anything). Channel
 * comes from `BISMUTH_AGENT_CHANNEL`, whose absence means the OWNER's own hand (see
 * {@link cliAgentChannel}) — the one place in this file where "unset" allows through with NO gate
 * at all, rather than defaulting to the stricter channel.
 */
export async function gateCliInvocation(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<GateDecision> {
  const channel = cliAgentChannel(env);
  if (channel === "owner") return { allowed: true };
  return resolveAndDecide(args, env, channel);
}
