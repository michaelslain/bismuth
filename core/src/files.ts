import { join, dirname, resolve, sep } from "node:path";
import { mkdirSync, renameSync, existsSync, writeFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { parseFrontmatter } from "./frontmatter";
import { createError } from "./error";
import type { TreeEntry } from "./graph";

/** Resolve a vault-relative path to an absolute path, throwing if it escapes the vault root. */
function resolveInVault(root: string, rel: string): string {
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, rel);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    throw createError("EINVAL", `path escapes vault: ${rel}`);
  }
  return abs;
}

/** Recursively walk a directory tree, filtering entries based on a filter function.
 *
 * Filter function signature:
 * - Returns `true` to include the entry (data: undefined)
 * - Returns `false` to skip the entry
 * - Returns `{ data: ... }` to include the entry with attached data
 *
 * Directories are always recursed; filtering only applies to whether they're included in results.
 */
async function walkDir<T>(
  absRoot: string,
  filter: (entry: Dirent, rel: string) => boolean | { data: T },
): Promise<Array<{ name: string; rel: string; isDir: boolean; data?: T }>> {
  const out: Array<{ name: string; rel: string; isDir: boolean; data?: T }> = [];

  const walk = async (absDir: string, relDir: string) => {
    let entries: Dirent[];
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const d of entries) {
      if (d.name.startsWith(".")) continue;
      const rel = relDir ? `${relDir}/${d.name}` : d.name;

      if (d.isDirectory()) {
        const result = filter(d, rel);
        if (result === true || (typeof result === "object" && result.data !== undefined)) {
          out.push({
            name: d.name,
            rel,
            isDir: true,
            data: typeof result === "object" ? result.data : undefined,
          });
        }
        await walk(join(absDir, d.name), rel);
      } else {
        const result = filter(d, rel);
        if (result === true || (typeof result === "object" && result.data !== undefined)) {
          out.push({
            name: d.name,
            rel,
            isDir: false,
            data: typeof result === "object" ? result.data : undefined,
          });
        }
      }
    }
  };

  await walk(absRoot, "");
  return out;
}

export async function listMarkdown(root: string): Promise<string[]> {
  const glob = new Bun.Glob("**/*.md");
  const out: string[] = [];
  for await (const rel of glob.scan({ cwd: root, dot: false })) out.push(rel);
  return out;
}

/** List `.base` files under the vault (the Bases data feed's discovery step). */
export async function listBases(root: string): Promise<string[]> {
  const glob = new Bun.Glob("**/*.base");
  const out: string[] = [];
  for await (const p of glob.scan({ cwd: root, dot: false })) out.push(p);
  return out.sort();
}

// Per-note icon cache, keyed by absolute path → { mtime, icon }. listTree otherwise
// reads + frontmatter-parses every .md just to pull the optional `icon` field; this skips
// that work for notes whose mtime is unchanged since the last listTree. Self-healing: a
// changed file restamps its entry, so no explicit invalidation is needed. Stale entries
// for deleted paths may linger but are never emitted (only paths present in the current
// walk are looked up). `icon` is null when the note has no icon frontmatter.
const iconCache = new Map<string, { mtime: number; icon: string | null }>();

export async function listTree(root: string): Promise<TreeEntry[]> {
  const entries = await walkDir(root, (d) => {
    if (d.isDirectory()) {
      return true; // Include all directories
    }

    const name = d.name;

    // Skip generated sidecars
    if (name.endsWith(".draw.png") || name.endsWith(".draw.pdf")) {
      return false;
    }

    // Include supported file types; .draw files get special icon marker.
    // (A base is a `type: base` md file — no separate `.base` extension.)
    if (name.endsWith(".md") || name.endsWith(".draw") ||
        name.endsWith(".sheet") || name.endsWith(".yaml") || name.endsWith(".yml")) {
      return name.endsWith(".draw") ? { data: "PenTool" } : true;
    }

    return false;
  });

  const out: TreeEntry[] = [];

  for (const entry of entries) {
    if (entry.isDir) {
      out.push({ path: entry.rel, kind: "dir" });
    } else if (entry.name.endsWith(".md")) {
      const abs = join(root, entry.rel);
      // Reuse the cached icon when the file's mtime is unchanged; only re-read + parse
      // frontmatter for notes that actually changed since the last listTree.
      let icon: string | null;
      let mtime = NaN;
      try {
        mtime = statSync(abs).mtimeMs;
      } catch {
        // stat failed (e.g. deleted mid-walk); fall through to a fresh read attempt.
      }
      const cached = iconCache.get(abs);
      if (cached && cached.mtime === mtime && !Number.isNaN(mtime)) {
        icon = cached.icon;
      } else {
        const { data } = parseFrontmatter(await readNote(root, entry.rel));
        icon = typeof data.icon === "string" ? data.icon : null;
        if (!Number.isNaN(mtime)) iconCache.set(abs, { mtime, icon });
      }
      const treeEntry: TreeEntry = { path: entry.rel, kind: "file" };
      if (icon !== null) treeEntry.icon = icon;
      out.push(treeEntry);
    } else if (entry.data === "PenTool") {
      // .draw file with icon marker
      out.push({ path: entry.rel, kind: "file", icon: "PenTool" });
    } else {
      // .sheet, .yaml, .yml
      out.push({ path: entry.rel, kind: "file" });
    }
  }

  return out;
}

export async function readNote(root: string, rel: string): Promise<string> {
  return await Bun.file(resolveInVault(root, rel)).text();
}

export async function writeNote(root: string, rel: string, contents: string): Promise<void> {
  const full = resolveInVault(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  await Bun.write(full, contents);
}

/** Resolve an EMBED target (`![[target]]`) to an absolute file path, FILENAME-FIRST —
 *  matching wikilink semantics (name, not path). An exact vault-relative path wins;
 *  otherwise the first file anywhere in the vault whose basename matches. Strips a
 *  trailing `#fragment` (e.g. PDF `#page=3`) and `|size` defensively. Returns null when
 *  nothing matches. Walks the tree on each miss — fine for normal vaults; the browser
 *  caches the served bytes by URL, so repeat views don't re-resolve. */
export async function resolveAsset(root: string, target: string): Promise<string | null> {
  const clean = target.split("#")[0].split("|")[0].trim();
  if (!clean) return null;
  // 1. exact vault-relative path (handles `attachments/foo.png` and a root-level file)
  try {
    const abs = resolveInVault(root, clean);
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
  } catch {
    // path escapes the vault — ignore and fall through to a basename search
  }
  // 2. filename-first: the first file in the vault whose basename equals the target's
  const base = clean.split("/").pop()!;
  const matches = await walkDir(root, (d) => !d.isDirectory() && d.name === base);
  const hit = matches.find((m) => !m.isDir);
  return hit ? join(root, hit.rel) : null;
}

/** Write raw bytes to a vault-relative path, creating parent dirs (the attachment
 *  folder is auto-created on first use). Path-traversal guarded via resolveInVault. */
export async function writeBinary(root: string, rel: string, bytes: ArrayBuffer | Uint8Array): Promise<void> {
  const full = resolveInVault(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  await Bun.write(full, bytes);
}

/** Pick a non-colliding vault-relative path for `rel` by appending " 1", " 2", … to the
 *  basename (before the extension) until the path is free. Returns the chosen rel path so
 *  the caller can insert the actual basename. Lets two pasted screenshots coexist. */
export function uniqueAssetPath(root: string, rel: string): string {
  const free = (r: string): boolean => {
    try {
      return !existsSync(resolveInVault(root, r));
    } catch {
      return false; // escapes the vault — never treat as free
    }
  };
  if (free(rel)) return rel;
  const slash = rel.lastIndexOf("/");
  const dir = slash === -1 ? "" : rel.slice(0, slash + 1);
  const name = slash === -1 ? rel : rel.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  // dot <= 0 → no extension, or a leading-dot name: treat the whole name as the stem.
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const ext = dot <= 0 ? "" : name.slice(dot);
  for (let i = 1; i < 10000; i++) {
    const cand = `${dir}${stem} ${i}${ext}`;
    if (free(cand)) return cand;
  }
  return `${dir}${stem} ${Date.now()}${ext}`; // pathological fallback
}

export function deleteEntry(root: string, path: string): { trashPath: string } {
  const fromAbs = resolveInVault(root, path);
  if (!existsSync(fromAbs)) throw createError("ENOENT", `does not exist: ${path}`, 404);
  const base = path.split("/").pop()!;
  const trashPath = `.trash/${Date.now()}-${base}`;
  const trashAbs = join(root, trashPath);
  mkdirSync(dirname(trashAbs), { recursive: true });
  renameSync(fromAbs, trashAbs);
  return { trashPath };
}

export function createEntry(root: string, path: string, kind: "file" | "dir"): void {
  const abs = resolveInVault(root, path);
  if (existsSync(abs)) throw createError("EEXIST", `already exists: ${path}`, 409);
  if (kind === "dir") {
    mkdirSync(abs, { recursive: true });
  } else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "");
  }
}

/** List template .md files (basename + vault-relative path) under a vault subfolder.
 *  Returns [] if the folder is missing. Recurses, skipping dotfiles. */
export async function listTemplates(
  root: string,
  folder: string,
): Promise<Array<{ name: string; path: string }>> {
  let absFolder: string;
  try {
    absFolder = resolveInVault(root, folder);
  } catch {
    return [];
  }

  const entries = await walkDir(absFolder, (d) => {
    // Filter to only include .md files (skip directories)
    if (d.isDirectory()) {
      return false; // Don't include dirs, but still recurse
    }
    return d.name.endsWith(".md");
  });

  const out: Array<{ name: string; path: string }> = entries
    .filter((e) => e.name.endsWith(".md"))
    .map((e) => ({
      name: e.name.slice(0, -3), // Remove .md extension
      path: folder ? `${folder}/${e.rel}` : e.rel,
    }));

  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export function moveEntry(root: string, from: string, to: string): void {
  if (to === from || to.startsWith(from + "/")) {
    throw createError("EINVAL", "cannot move an entry into itself");
  }
  const fromAbs = resolveInVault(root, from);
  const toAbs = resolveInVault(root, to);
  if (!existsSync(fromAbs)) throw createError("ENOENT", `source does not exist: ${from}`, 404);
  if (existsSync(toAbs)) throw createError("EEXIST", `destination already exists: ${to}`, 409);
  mkdirSync(dirname(toAbs), { recursive: true });
  renameSync(fromAbs, toAbs);
}
