import { join, dirname, resolve, sep } from "node:path";
import { mkdirSync, renameSync, existsSync, writeFileSync, statSync, rmSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
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
  allowDot: (rel: string) => boolean = () => false,
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
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      // Hidden entries are skipped unless explicitly allowed. `allowDot` opts in
      // specific system roots (.settings / .daemon) so they show in the sidebar
      // while their internal dot-state (e.g. .daemon/crons/.last-fired.json) stays
      // hidden and the knowledge graph (listMarkdown, dot:false) is unaffected.
      if (d.name.startsWith(".") && !allowDot(rel)) continue;

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

// Per-note icon+visibility cache, keyed by absolute path → { mtime, icon, visibility }.
// listTree otherwise reads + frontmatter-parses every .md just to pull the optional
// `icon`/`visibility` fields; this skips that work for notes whose mtime is unchanged
// since the last listTree. Self-healing: a changed file restamps its entry, so no
// explicit invalidation is needed. Stale entries for deleted paths may linger but are
// never emitted (only paths present in the current walk are looked up). `icon`/
// `visibility` are null when the note has no such frontmatter (or an invalid value).
const iconCache = new Map<string, { mtime: number; icon: string | null; visibility: "all" | "chat-only" | "hidden" | null }>();

export async function listTree(
  root: string,
  opts?: { daemonEnabled?: boolean; daemonName?: string },
): Promise<TreeEntry[]> {
  // System folders shown in the sidebar but kept out of the knowledge graph:
  // .settings always; .daemon only when this vault's daemon is enabled.
  // `.settings` is a single hidden FILE (the vault config); `.daemon` is a folder shown only when
  // this vault's daemon is enabled.
  const allowDot = (rel: string): boolean =>
    rel === ".settings" || (!!opts?.daemonEnabled && rel === ".daemon");
  const inSystemFolder = (rel: string): boolean =>
    rel.startsWith(".daemon/");

  const entries = await walkDir(root, (d, rel) => {
    if (d.isDirectory()) {
      return true; // Include all directories
    }

    const name = d.name;

    // Skip generated sidecars
    if (name.endsWith(".draw.png") || name.endsWith(".draw.pdf")) {
      return false;
    }

    // The root settings file (hidden `.settings`, no extension) — always include it.
    if (rel === ".settings") return true;

    // System folders surface every file regardless of extension (cron/process
    // defs, memory notes, …) — the .draw marker still applies.
    if (inSystemFolder(rel)) {
      return name.endsWith(".draw") ? { data: "PenTool" } : true;
    }

    // Include supported file types; .draw files get special icon marker.
    // (A base is a `type: base` md file — no separate `.base` extension.)
    // Images AND PDFs open as an annotatable markup surface (a sidecar `<file>.draw`), so they
    // surface as openable rows too. (Their `.draw` sidecars match `.draw` above; export
    // sidecars `*.draw.png`/`*.draw.pdf` were already excluded near the top, so a plain `.pdf`
    // still surfaces while the drawing-export artifact stays hidden.)
    if (name.endsWith(".md") || name.endsWith(".draw") ||
        name.endsWith(".sheet") || name.endsWith(".yaml") || name.endsWith(".yml") ||
        /\.(png|jpe?g|gif|webp|svg|pdf)$/i.test(name)) {
      return name.endsWith(".draw") ? { data: "PenTool" } : true;
    }

    return false;
  }, allowDot);

  const daemonLabel = opts?.daemonName?.trim() || "daemon";

  // Pre-stat every .md entry with bounded concurrency BEFORE the build loop. The loop used a
  // synchronous statSync per note — on an icon-cache-hit pass (the overwhelming majority) it
  // had no await at all, so hundreds of back-to-back sync syscalls blocked Bun's event loop
  // for the whole walk (starving the PTY WS → "terminal laggy, then fine" on every tree
  // rebuild). Async stat batched 32-wide keeps the loop free; NaN keeps the old stat-failed
  // semantics (deleted mid-walk → fresh read attempt below).
  const mdEntries = entries.filter((e) => !e.isDir && e.name.endsWith(".md") && e.rel !== ".settings");
  const mtimes = new Map<string, number>();
  {
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= mdEntries.length) return;
        const abs = join(root, mdEntries[i].rel);
        try {
          mtimes.set(abs, (await stat(abs)).mtimeMs);
        } catch {
          mtimes.set(abs, NaN);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(32, mdEntries.length) }, worker));
  }

  const out: TreeEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDir && entry.rel === ".settings") {
      // The single hidden settings file (YAML, no extension) — a FILE, not a folder: shown with a
      // gear + lowercase "settings" label, opens in the editor.
      out.push({ path: entry.rel, kind: "file", label: "settings", icon: "Settings2" });
    } else if (entry.isDir) {
      if (entry.rel === ".daemon") {
        out.push({ path: entry.rel, kind: "dir", isSystemFolder: true, label: daemonLabel });
      } else {
        out.push({ path: entry.rel, kind: "dir" });
      }
    } else if (entry.name.endsWith(".md")) {
      const abs = join(root, entry.rel);
      // Reuse the cached icon/visibility when the file's mtime is unchanged; only
      // re-read + parse frontmatter for notes that actually changed since the last
      // listTree. mtimes were pre-statted concurrently above (NaN = stat failed →
      // fresh read attempt). `visibility` here is the file's OWN explicit frontmatter
      // value (pre-cascade) — GET /tree's overlay resolves it against folderVisibility.
      let icon: string | null;
      let visibility: "all" | "chat-only" | "hidden" | null;
      const mtime = mtimes.get(abs) ?? NaN;
      const cached = iconCache.get(abs);
      if (cached && cached.mtime === mtime && !Number.isNaN(mtime)) {
        icon = cached.icon;
        visibility = cached.visibility;
      } else {
        const { data } = parseFrontmatter(await readNote(root, entry.rel));
        icon = typeof data.icon === "string" ? data.icon : null;
        visibility = data.visibility === "all" || data.visibility === "chat-only" || data.visibility === "hidden"
          ? data.visibility
          : null;
        if (!Number.isNaN(mtime)) iconCache.set(abs, { mtime, icon, visibility });
      }
      const treeEntry: TreeEntry = { path: entry.rel, kind: "file" };
      if (icon !== null) treeEntry.icon = icon;
      if (visibility !== null) treeEntry.visibility = visibility;
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
  // walkDir's filter already excludes directories, so the first match is the file we want.
  const hit = (await walkDir(root, (d) => !d.isDirectory() && d.name === base))[0];
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

/**
 * Carry an entry's companion sidecars along a move: the hidden note-ink store
 * (`.ink/<path>.ink` for a file, the whole `.ink/<path>/` subtree for a directory) and the
 * co-located image/PDF markup sidecar (`<path>.draw`). Best-effort + existence-gated — entries
 * without sidecars pay a couple of existsSync calls and a failed carry never fails the primary
 * operation. Symmetry note: deleteEntry carries sidecars to the TRASH-path-derived locations,
 * so POST /restore (which is just moveEntry(trashPath, to)) carries them back automatically.
 */
// A daemon approval page (`.daemon/pages/<slug>.md`) keeps its execution state in a slug-keyed
// JSON sidecar (`.daemon/pages/.state/<slug>.json`). Kept in sync here so a rename/trash/restore
// through the tree or CLI never strands the state (see core/src/daemonPages.ts). Outside the
// pages dir (e.g. in the trash) the state rides co-located as `<path>.pagestate.json`, which the
// slug-derived form maps back to on restore.
const PAGE_MD_RE = /^\.daemon\/pages\/[^/.][^/]*\.md$/;
const pageStateFor = (p: string): string =>
  PAGE_MD_RE.test(p) ? `.daemon/pages/.state/${p.slice(p.lastIndexOf("/") + 1, -3)}.json` : `${p}.pagestate.json`;

function carrySidecars(root: string, from: string, to: string, wasDir: boolean): void {
  const isPageMove = !wasDir && (PAGE_MD_RE.test(from) || PAGE_MD_RE.test(to));
  const pairs: Array<[string, string]> = wasDir
    ? [[`.ink/${from}`, `.ink/${to}`]]
    : [
        [`.ink/${from}.ink`, `.ink/${to}.ink`],
        // A .draw's own sidecar would be `x.draw.draw` — never a thing; skip the probe.
        ...(from.endsWith(".draw") ? [] : ([[`${from}.draw`, `${to}.draw`]] as Array<[string, string]>)),
        ...(isPageMove ? ([[pageStateFor(from), pageStateFor(to)]] as Array<[string, string]>) : []),
        // A rename WITHIN pages/ carries a pending trigger to the new slug (the queued action
        // survives — a trigger left on the old slug would fire against a missing page).
        ...(!wasDir && PAGE_MD_RE.test(from) && PAGE_MD_RE.test(to)
          ? ([[
              `.daemon/pages/.triggers/${from.slice(from.lastIndexOf("/") + 1, -3)}`,
              `.daemon/pages/.triggers/${to.slice(to.lastIndexOf("/") + 1, -3)}`,
            ]] as Array<[string, string]>)
          : []),
      ];
  // A page LEAVING `.daemon/pages/` (trash or move-out) can't be triggered anymore — drop any
  // pending trigger for its slug so the daemon never fires an action for a page that's gone.
  if (!wasDir && PAGE_MD_RE.test(from) && !PAGE_MD_RE.test(to)) {
    try {
      rmSync(join(root, `.daemon/pages/.triggers/${from.slice(from.lastIndexOf("/") + 1, -3)}`), { force: true });
    } catch {
      /* best-effort */
    }
  }
  for (const [f, t] of pairs) {
    try {
      const fAbs = join(root, f);
      if (!existsSync(fAbs)) continue;
      const tAbs = join(root, t);
      // A sidecar already at the destination is by construction an ORPHAN: the caller just
      // proved the destination MAIN entry didn't exist (moveEntry throws EEXIST; deleteEntry
      // stamps a unique trash path), so nothing owns it. Evict it — skipping instead would
      // strand the source's REAL ink at a path nothing ever reads again while the moved note
      // silently inherits the stale orphan. rm (not a bare rename) because renaming onto a
      // non-empty directory throws ENOTEMPTY, which the catch below would swallow.
      if (existsSync(tAbs)) rmSync(tAbs, { recursive: true, force: true });
      mkdirSync(dirname(tAbs), { recursive: true });
      renameSync(fAbs, tAbs);
    } catch {
      /* best-effort — the note/file operation itself already succeeded */
    }
  }
}

export function deleteEntry(root: string, path: string): { trashPath: string } {
  const fromAbs = resolveInVault(root, path);
  if (!existsSync(fromAbs)) throw createError("ENOENT", `does not exist: ${path}`, 404);
  const base = path.split("/").pop()!;
  const trashPath = `.trash/${Date.now()}-${base}`;
  const trashAbs = join(root, trashPath);
  mkdirSync(dirname(trashAbs), { recursive: true });
  renameSync(fromAbs, trashAbs);
  // Sidecars ride into the trash under the SAME stamped name, so a later restore
  // (moveEntry(trashPath, to)) carries them back to the restored path automatically.
  carrySidecars(root, path, trashPath, statSync(trashAbs).isDirectory());
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

  const out: Array<{ name: string; path: string }> = entries.map((e) => ({
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
  // Note ink + image-markup sidecars follow their file (and restores carry them back — see
  // carrySidecars). A directory move re-roots its whole .ink subtree; co-located .draw
  // sidecars inside the directory moved with it already.
  carrySidecars(root, from, to, statSync(toAbs).isDirectory());
}
