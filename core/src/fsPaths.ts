// core/src/fsPaths.ts
// Filesystem path completion: given the partial path a user is typing in a
// `scope:"fs"` setting (e.g. daemon.home), list matching directory entries so the
// editor can autocomplete them. The vault-path completion (settingsComplete.ts) is
// vault-rooted; this is its filesystem-rooted counterpart, for settings that name a
// path OUTSIDE the vault (absolute or `~`-relative).
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type FsEntry = { path: string; kind: "file" | "dir" };

/**
 * Complete a filesystem path the user is typing (e.g. "~/.cl" → "~/.claude-bot").
 * Splits the typed value into a parent directory + a partial basename, lists the
 * parent, and returns matching children whose display path preserves the user's
 * "~" / leading-"/" form (so accepting a row drops a usable path back in). Tolerant:
 * a missing / unreadable / non-directory parent yields [] rather than throwing.
 *
 * `only` narrows to dirs or files. `home` overrides the home dir (for tests).
 */
export async function listFsPaths(
  value: string,
  only?: "dir" | "file",
  home: string = homedir(),
): Promise<FsEntry[]> {
  const lastSlash = value.lastIndexOf("/");
  // With a slash, split into "<dir>/" + basename. With no slash yet, interpret the
  // text as a name under home and suggest absolute "~/<name>" rows (a bare relative
  // name would be useless for an out-of-vault path).
  const dirDisplay = lastSlash >= 0 ? value.slice(0, lastSlash + 1) : "~/";
  const partial = lastSlash >= 0 ? value.slice(lastSlash + 1) : value;

  const realDir = resolveDisplayDir(dirDisplay, home);
  if (!realDir) return [];

  let names: string[];
  try {
    names = await readdir(realDir);
  } catch {
    return []; // missing dir, not a dir, or no permission
  }

  const p = partial.toLowerCase();
  const out: FsEntry[] = [];
  for (const name of names) {
    if (!name.toLowerCase().startsWith(p)) continue;
    let kind: "file" | "dir";
    try {
      kind = (await stat(join(realDir, name))).isDirectory() ? "dir" : "file";
    } catch {
      continue; // dangling symlink etc.
    }
    if (only && kind !== only) continue;
    out.push({ path: dirDisplay + name, kind });
  }
  // Dirs first (so drilling down is easy), then case-insensitive alpha.
  out.sort((a, b) =>
    a.kind !== b.kind
      ? a.kind === "dir" ? -1 : 1
      : a.path.toLowerCase().localeCompare(b.path.toLowerCase()),
  );
  return out;
}

/** Map a typed display dir ("~/", "/etc/") to a real fs dir, or null if unsupported
 *  (a relative path — there's no working dir to resolve it against here). */
function resolveDisplayDir(dirDisplay: string, home: string): string | null {
  if (dirDisplay === "~" || dirDisplay === "~/") return home;
  if (dirDisplay.startsWith("~/")) return join(home, dirDisplay.slice(2));
  if (dirDisplay.startsWith("/")) return dirDisplay;
  return null;
}
