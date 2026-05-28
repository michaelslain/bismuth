import { join, dirname, resolve, sep } from "node:path";
import { mkdirSync, renameSync, existsSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { parseFrontmatter } from "./frontmatter";
import type { TreeEntry } from "./graph";

/** Resolve a vault-relative path to an absolute path, throwing if it escapes the vault root. */
function resolveInVault(root: string, rel: string): string {
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, rel);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    throw new Error(`path escapes vault: ${rel}`);
  }
  return abs;
}

export async function listMarkdown(root: string): Promise<string[]> {
  const glob = new Bun.Glob("**/*.md");
  const out: string[] = [];
  for await (const rel of glob.scan({ cwd: root, dot: false })) out.push(rel);
  return out;
}

/**
 * Walk the vault, returning files AND directories for the sidebar tree.
 * - Skips dot-entries (`.trash`, `.obsidian`, …) so trash and config stay hidden.
 * - `.md` files are included (their `icon` frontmatter is read for the sidebar) and `.base` files too.
 * - Empty directories are included so newly-created folders persist across polls.
 */
export async function listTree(root: string): Promise<TreeEntry[]> {
  const out: TreeEntry[] = [];
  const walk = async (relDir: string) => {
    const absDir = relDir ? join(root, relDir) : root;
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return; // dir may have been removed mid-walk
    }
    for (const d of entries) {
      if (d.name.startsWith(".")) continue;
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      if (d.isDirectory()) {
        out.push({ path: rel, kind: "dir" });
        await walk(rel);
      } else if (d.name.endsWith(".md")) {
        const { data } = parseFrontmatter(await readNote(root, rel));
        out.push(
          typeof data.icon === "string"
            ? { path: rel, icon: data.icon, kind: "file" }
            : { path: rel, kind: "file" },
        );
      } else if (d.name.endsWith(".base")) {
        // `.base` files surface in the sidebar like notes (no frontmatter/icon read).
        out.push({ path: rel, kind: "file" });
      }
    }
  };
  await walk("");
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

/**
 * "Delete" an entry by moving it into the hidden `.trash/` dir (excluded from listTree).
 * Returns the trash-relative path so the caller can restore it via moveEntry.
 */
export function deleteEntry(root: string, path: string): { trashPath: string } {
  const fromAbs = resolveInVault(root, path);
  if (!existsSync(fromAbs)) throw new Error(`does not exist: ${path}`);
  const base = path.split("/").pop()!;
  const trashPath = `.trash/${Date.now()}-${base}`;
  const trashAbs = join(root, trashPath);
  mkdirSync(dirname(trashAbs), { recursive: true });
  renameSync(fromAbs, trashAbs);
  return { trashPath };
}

/** Create a new empty markdown file or a new directory. */
export function createEntry(root: string, path: string, kind: "file" | "dir"): void {
  const abs = resolveInVault(root, path);
  if (existsSync(abs)) throw new Error(`already exists: ${path}`);
  if (kind === "dir") {
    mkdirSync(abs, { recursive: true });
  } else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "");
  }
}

/** Move or rename a vault entry (file or folder). Used for both rename and drag-drop. */
export function moveEntry(root: string, from: string, to: string): void {
  if (to === from || to.startsWith(from + "/")) {
    throw new Error("cannot move an entry into itself");
  }
  const fromAbs = resolveInVault(root, from);
  const toAbs = resolveInVault(root, to);
  if (!existsSync(fromAbs)) throw new Error(`source does not exist: ${from}`);
  if (existsSync(toAbs)) throw new Error(`destination already exists: ${to}`);
  mkdirSync(dirname(toAbs), { recursive: true });
  renameSync(fromAbs, toAbs);
}
