import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";

// nvm installs node — and globally-installed CLIs like `claude` (`npm i -g
// @anthropic-ai/claude-code`) — under $NVM_DIR/versions/node/<version>/bin, a dir a
// Homebrew/launchd PATH never sees. Return those bin dirs so `claude` resolves when
// installed via nvm. The default-alias version is preferred; the rest follow (newest
// first) as a fallback. Best-effort + defensive: any fs hiccup yields [].
export function nvmBinPaths(env: Record<string, string | undefined> = process.env): string[] {
  const nvmDir = env.NVM_DIR || join(homedir(), ".nvm");
  const versionsDir = join(nvmDir, "versions", "node");
  let versions: string[];
  try {
    versions = readdirSync(versionsDir);
  } catch {
    return [];
  }
  // Newest first, numeric-aware so v20 sorts above v8 (lexicographic would invert that).
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  // Prefer the user's default-alias version when it maps to an installed dir. The alias
  // file stores the version without the `v` prefix the dir carries (e.g. "18.16.0" →
  // "v18.16.0"); implicit aliases like "node"/"stable" don't match a dir and fall through
  // to the newest-first ordering below.
  let preferred: string | undefined;
  try {
    const alias = readFileSync(join(nvmDir, "alias", "default"), "utf8").trim();
    preferred = versions.find((v) => v === alias || v === `v${alias}`);
  } catch {}

  const ordered = preferred ? [preferred, ...versions.filter((v) => v !== preferred)] : versions;
  return ordered.map((v) => join(versionsDir, v, "bin")).filter(existsSync);
}

// PATH augmented with common install dirs so `claude` resolves even from a minimal
// GUI-app PATH — a Finder-launched bundle's sidecar inherits only
// /usr/bin:/bin:/usr/sbin:/sbin from launchd (verified against a real launchd GUI-domain
// job: `launchctl bootstrap gui/<uid>` with a plist that dumps `env` — it gets exactly
// USER/LOGNAME/HOME/SHELL/TMPDIR/SSH_AUTH_SOCK/XPC_* plus that minimal PATH, nothing from
// homebrew/bun/local/nvm). The base POSIX dirs are appended UNCONDITIONALLY (not just
// relied on via `env.PATH`) — BUG #8 (4th bounce): reproduced a case where `env.PATH` was
// completely empty/undefined, which used to produce a PATH with ONLY the augmentation
// dirs and no `/usr/bin` at all; `claude` shells out to `/usr/bin/security` (see
// claudeSpawnEnv below) via a bare command name in at least one internal path, and
// without `/usr/bin` on PATH that lookup fails, surfacing as "Not logged in" even though
// $USER/$HOME were both correct. Cheap insurance: duplicates in PATH are harmless.
export function claudeLookupPath(env: Record<string, string | undefined> = process.env): string {
  return [
    env.PATH,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".bun", "bin"),
    join(homedir(), ".local", "bin"),
    ...nvmBinPaths(env),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ]
    .filter(Boolean)
    .join(":");
}

// Resolve the real `claude` binary against the augmented PATH, or null when not found.
export function whichClaude(): string | null {
  return Bun.which("claude", { PATH: claudeLookupPath() });
}

// Real OS username, independent of $USER/$LOGNAME. node:os's `userInfo().username` looks robust
// (docs promise a getpwuid-style native lookup) but Bun's implementation of it ACTUALLY falls back
// to the literal string "unknown" once both env vars are absent (verified: Node's own userInfo()
// resolves the real name with zero env vars; Bun's does not) — so it can't be trusted here, of all
// places. `id -un` is a tiny, always-present macOS/Linux binary that reads the real account for the
// running UID regardless of environment (verified under a fully-stripped env). Spawned via its
// absolute path, so it needs no PATH either. Best-effort: any failure yields null (caller leaves
// USER/LOGNAME unset rather than poisoning them with a fake value).
function realUsername(): string | null {
  try {
    const r = Bun.spawnSync(["/usr/bin/id", "-un"]);
    if (r.exitCode !== 0) return null;
    const name = r.stdout.toString().trim();
    return name || null;
  } catch {
    return null;
  }
}

// BUG #8 (4th bounce) ROOT CAUSE: the spawned CHILD PROCESS needs a WORKING env to actually
// authenticate, not just a resolvable binary path. `claude` reads its Keychain-stored OAuth
// credentials via `security find-generic-password -a "$USER" -s "Claude Code-credentials" -w`
// (macOS) — reproduced directly, twice over:
//   1. With `$USER`/`$LOGNAME` unset, the lookup account resolves to "" and MISSES the item
//      (stored under the real username) — every call reports "Not logged in · Please run /login".
//   2. With `$USER` correct but `$PATH` lacking `/usr/bin` (see the empty-`env.PATH` case fixed in
//      claudeLookupPath above), the bare `security` shellout itself can't be found — SAME symptom.
// Both surface as a completely normal-looking `result` message (`is_error: true`, not a spawn
// crash) even though the user genuinely IS logged in — see consumeModelStream's `is_error` check
// in searchPrompt.ts for why that used to be silently swallowed into an empty `[]`. (A real
// launchd GUI-domain job — verified via `launchctl bootstrap gui/<uid>` — DOES get $USER/$LOGNAME/
// $HOME/a minimal $PATH; this is defense-in-depth for whatever narrower environment a given host
// process actually ends up with, not a claim that launchd itself omits them.) The Agent SDK's
// `env` option REPLACES the child's environment when set (never merged with `process.env`), so
// passing `env` at all means the caller owns building a COMPLETE one — this is that builder,
// reused by every `query()` call that spawns the user's own `claude` (currently searchPrompt.ts;
// chat.ts should adopt it too).
export function claudeSpawnEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env, PATH: claudeLookupPath(env), HOME: env.HOME || homedir() };
  if (!out.USER || !out.LOGNAME) {
    const username = realUsername();
    if (username) {
      out.USER = out.USER || username;
      out.LOGNAME = out.LOGNAME || username;
    }
  }
  return out;
}
