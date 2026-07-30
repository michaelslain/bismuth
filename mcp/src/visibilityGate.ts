// mcp/src/visibilityGate.ts
// The visibility gate for the `bismuth_cli` MCP tool.
//
// WHY THIS EXISTS, in one sentence: the same `bismuth` CLI is the vault OWNER's hand (where
// visibility deliberately does NOT apply — see docs/vault/visibility.md's threat model) and, through
// this MCP server, an AGENT's hand (where it must). The trust boundary is the MCP layer, not the CLI,
// so the gate lives here.
//
// The hole it closes: `bismuth read Private/secret.md` returns a hidden note's contents verbatim.
// Claude Code sessions were protected by `disallowedTools: ["mcp__bismuth__bismuth_cli"]`, which is
// a Claude-SDK-specific mechanism. Bismuth now registers this MCP server with up to ten other agent
// CLIs, none of which Bismuth can hand a `disallowedTools` list — so without this gate, every one of
// them could read every hidden note through `bismuth_cli`, and the visibility feature would be
// Claude-only in practice while appearing to be universal.
//
// Design notes:
//  - FAIL-SAFE by default. An unset channel resolves to "daemon", the STRICTER of the two (it also
//    excludes `chat-only`). An unreadable vault, a bad settings file, or any thrown error refuses
//    rather than allows: this gate exists precisely for the cases where something is off.
//  - OVER-INCLUSIVE on purpose. It refuses when a restricted path appears ANYWHERE in the argv, as a
//    substring, rather than trying to know which positional each of ~60 CLI commands treats as a
//    path. A false refusal costs an agent one tool call and says exactly why; a false ALLOW leaks a
//    note the user asked to hide.
//  - Content-scanning commands are refused wholesale whenever anything is restricted, mirroring the
//    existing precedent for Claude: a per-file deny cannot stop an unscoped `search` from returning a
//    hidden file's matching LINES (docs/vault/visibility.md disables Grep/Glob outright for exactly
//    this reason).
import { buildDenyPaths, type VisibilityChannel } from "../../core/src/visibility";

/** Which channel this MCP server is serving, from `BISMUTH_MCP_CHANNEL`.
 *
 *  Defaults to "daemon" — the stricter channel — when unset or unrecognized, so a spawner that
 *  forgets to declare itself gets the safe answer rather than the permissive one. Bismuth's own
 *  spawners set it explicitly (the daemon session, and each chat driver that injects an MCP server). */
export function mcpChannel(env: Record<string, string | undefined> = process.env): VisibilityChannel {
  return env.BISMUTH_MCP_CHANNEL === "chat" ? "chat" : "daemon";
}

/**
 * CLI commands that can surface a restricted file's CONTENT without ever naming its path, so no
 * argv check can catch them. Refused outright whenever the vault restricts anything at all.
 *
 * `search`/`replace` scan file bodies; `api` is an arbitrary HTTP passthrough to the core server
 * (`bismuth api GET /file?path=…` reads any note, and the path hides inside a query string);
 * `export` can render a whole tree. Matched on the FIRST argv token, and for two-word commands on
 * the first two, mirroring the CLI's own longest-match dispatch.
 */
const CONTENT_SCANNING_COMMANDS = new Set(["search", "replace", "api", "export", "grep"]);

/** Pure: is this argv a content-scanning command? */
export function isContentScanningCommand(args: string[]): boolean {
  const first = (args[0] ?? "").toLowerCase();
  return CONTENT_SCANNING_COMMANDS.has(first);
}

export interface GateDecision {
  /** True when the CLI may run. */
  allowed: boolean;
  /** Why not — returned to the model verbatim, so it stops rather than retrying variants. */
  reason?: string;
}

/**
 * Pure: decide whether `args` may run, given the restricted paths for this channel.
 *
 * `restricted` is the `{rel, abs}` list from `buildDenyPaths`. A match is a SUBSTRING test against
 * each argv token in both path forms, which also catches a path embedded in a query string or a
 * `--flag=value` pair. Case-insensitive, because macOS filesystems are case-insensitive by default
 * and `private/SECRET.md` opens the same file as `Private/secret.md`.
 */
export function decideCliGate(
  args: string[],
  restricted: { rel: string; abs: string }[],
): GateDecision {
  if (restricted.length === 0) return { allowed: true };

  if (isContentScanningCommand(args)) {
    return {
      allowed: false,
      reason:
        `Refused: \`bismuth ${args[0]}\` can return the contents of notes this vault marks off-limits ` +
        `to AI sessions, and it cannot be filtered per-file. ${restricted.length} note(s) are restricted. ` +
        `Ask the user to unhide them, or use a command that names a specific visible file.`,
    };
  }

  const haystack = args.map((a) => a.toLowerCase());
  for (const entry of restricted) {
    for (const form of [entry.rel, entry.abs]) {
      const needle = form.toLowerCase();
      if (!needle) continue;
      if (haystack.some((a) => a.includes(needle))) {
        return {
          allowed: false,
          reason:
            `Refused: "${entry.rel}" is marked off-limits to AI sessions by this vault's visibility ` +
            `settings. Do not try to reach it another way — tell the user it is hidden if they need to know.`,
        };
      }
    }
  }
  return { allowed: true };
}

/**
 * The effectful gate: resolve the vault's restricted set, then decide. Never throws — any failure
 * REFUSES, because a gate that opens when it malfunctions is not a gate.
 *
 * Returns `{allowed: true}` immediately when no vault is configured: with no vault there is nothing
 * to protect, and refusing every call would break the docs/help commands that need no vault at all.
 */
export async function gateCliArgs(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<GateDecision> {
  const vault = env.BISMUTH_VAULT;
  if (!vault) return { allowed: true };
  try {
    const restricted = await buildDenyPaths(vault, mcpChannel(env));
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
