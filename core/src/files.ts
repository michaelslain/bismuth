import { join, dirname, resolve, sep } from "node:path";
import { mkdirSync, renameSync, existsSync, writeFileSync } from "node:fs";
import { readdir, Dirent } from "node:fs/promises";
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

export async function listTree(root: string): Promise<TreeEntry[]> {
  const entries = await walkDir(root, (d, rel) => {
    if (d.isDirectory()) {
      return true; // Include all directories
    }

    const name = d.name;

    // Skip generated sidecars
    if (name.endsWith(".draw.png") || name.endsWith(".draw.pdf")) {
      return false;
    }

    // Include supported file types; .draw files get special icon marker
    if (name.endsWith(".md") || name.endsWith(".draw") || name.endsWith(".base") ||
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
      const { data } = parseFrontmatter(await readNote(root, entry.rel));
      const treeEntry: TreeEntry = { path: entry.rel, kind: "file" };
      if (typeof data.icon === "string") treeEntry.icon = data.icon;
      out.push(treeEntry);
    } else if (entry.data === "PenTool") {
      // .draw file with icon marker
      out.push({ path: entry.rel, kind: "file", icon: "PenTool" });
    } else {
      // .base, .sheet, .yaml, .yml
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

  const entries = await walkDir(absFolder, (d, rel) => {
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
