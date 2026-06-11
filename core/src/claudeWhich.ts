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
// /usr/bin:/bin:/usr/sbin:/sbin from launchd, missing homebrew/bun/local/nvm bins.
export function claudeLookupPath(env: Record<string, string | undefined> = process.env): string {
  return [
    env.PATH,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".bun", "bin"),
    join(homedir(), ".local", "bin"),
    ...nvmBinPaths(env),
  ]
    .filter(Boolean)
    .join(":");
}

// Resolve the real `claude` binary against the augmented PATH, or null when not found.
export function whichClaude(): string | null {
  return Bun.which("claude", { PATH: claudeLookupPath() });
}
