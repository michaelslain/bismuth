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

export async function listTree(root: string): Promise<TreeEntry[]> {
  const out: TreeEntry[] = [];
  const walk = async (relDir: string) => {
    const absDir = relDir ? join(root, relDir) : root;
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      if (d.name.startsWith(".")) continue;
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      if (d.isDirectory()) {
        out.push({ path: rel, kind: "dir" });
        await walk(rel);
      } else if (d.name.endsWith(".md")) {
        const { data } = parseFrontmatter(await readNote(root, rel));
        const entry: TreeEntry = { path: rel, kind: "file" };
        if (typeof data.icon === "string") entry.icon = data.icon;
        out.push(entry);
      } else if (d.name.endsWith(".draw.png") || d.name.endsWith(".draw.pdf")) {
        // generated sidecars (eager render of a .draw) — not shown in the tree
        continue;
      } else if (d.name.endsWith(".draw")) {
        out.push({ path: rel, kind: "file", icon: "PenTool" });
      } else if (d.name.endsWith(".base")) {
        out.push({ path: rel, kind: "file" });
      } else if (d.name.endsWith(".sheet")) {
        // Spreadsheet documents (Univer JSON snapshots) are real vault files —
        // list them so they appear in the tree and open in a SheetView pane.
        out.push({ path: rel, kind: "file" });
      } else if (d.name.endsWith(".yaml") || d.name.endsWith(".yml")) {
        // Config files (settings.yaml) are real vault files — show them in the
        // tree so they're opened/edited like anything else, no special chrome.
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
  const out: Array<{ name: string; path: string }> = [];
  const walk = async (absDir: string, relDir: string) => {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      if (d.name.startsWith(".")) continue;
      const relPath = relDir ? `${relDir}/${d.name}` : d.name;
      if (d.isDirectory()) {
        await walk(join(absDir, d.name), relPath);
      } else if (d.name.endsWith(".md")) {
        const name = d.name.slice(0, -3);
        const path = folder ? `${folder}/${relPath}` : relPath;
        out.push({ name, path });
      }
    }
  };
  await walk(absFolder, "");
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export function moveEntry(root: string, from: string, to: string): void {
  if (to === from || to.startsWith(from + "/")) throw new Error("cannot move an entry into itself");
  const fromAbs = resolveInVault(root, from);
  const toAbs = resolveInVault(root, to);
  if (!existsSync(fromAbs)) throw new Error(`source does not exist: ${from}`);
  if (existsSync(toAbs)) throw new Error(`destination already exists: ${to}`);
  mkdirSync(dirname(toAbs), { recursive: true });
  renameSync(fromAbs, toAbs);
}
