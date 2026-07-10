// daemon/src/lib/visibility.ts
// Per-file/folder AI visibility — the daemon's own copy of core/src/visibility.ts. The daemon
// workspace has no dependency on @bismuth/core (it only depends on @bismuth/memory), so this is
// PORTED, not imported, per the visibility-controls plan; keep it in sync with the core version
// if the resolution semantics ever change. See docs/vault/visibility.md for the full threat model
// (restated briefly: this is an honesty boundary, not a security boundary, and it restricts the
// daemon's own tool calls only — never the vault owner).
//
// Storage: a file's frontmatter `visibility: "chat-only" | "hidden"` (absent = INHERIT, not
// "visible"); a folder's entry in the vault's `.settings` `folderVisibility: {folderPath:
// "chat-only"|"hidden"}` map. Settings are read with the same tolerant fallback chain
// registry.ts already uses (`.settings`, the interim `.settings/settings.yaml`, and the legacy
// root `settings.yaml` — first readable wins), since the daemon may see a vault before core has
// migrated it.
import { readdir, readFile, realpath } from "node:fs/promises"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { parseFrontmatter } from "./frontmatter.ts"

export type Visibility = "all" | "chat-only" | "hidden"
/** A file's own explicit frontmatter value; `undefined` = absent = inherit. */
export type FileVisibility = Visibility | undefined

function isVisibilityLiteral(v: unknown): v is Visibility {
  return v === "all" || v === "chat-only" || v === "hidden"
}

/** Ancestor folder paths of `path`, deepest-first. `includeSelf` treats `path` itself as a
 *  folder — used to resolve a DIRECTORY's own effective visibility. */
function ancestorFolders(path: string, includeSelf: boolean): string[] {
  const segs = path.split("/").filter(Boolean)
  const dirSegs = includeSelf ? segs : segs.slice(0, -1)
  const out: string[] = []
  for (let i = dirSegs.length; i > 0; i--) out.push(dirSegs.slice(0, i).join("/"))
  return out
}

/** Resolve a FILE's effective visibility: an explicit frontmatter value wins; else the nearest
 *  ancestor folder's `folderVisibility` entry (deepest wins); else "all". Pure — no I/O. */
export function resolveVisibility(
  path: string,
  fileVisibility: FileVisibility,
  folderVisibility: Record<string, Visibility>,
): Visibility {
  if (isVisibilityLiteral(fileVisibility)) return fileVisibility
  for (const folder of ancestorFolders(path, false)) {
    const v = folderVisibility[folder]
    if (v) return v
  }
  return "all"
}

/** The daemon (and memory recall) may only read notes with NO restriction at all — "chat-only"
 *  is visible to chat but NOT the daemon. */
export function isVisibleToDaemon(v: Visibility): boolean {
  return v === "all"
}

/** Strip a trailing slash and collapse repeated slashes so a folder key like "Private/" (routine
 *  from shell tab-completion / the CLI) matches the slash-free paths resolveVisibility compares
 *  against. Must mirror core/src/settings.ts's setFolderVisibility normalization — the daemon
 *  reads .settings independently, so without this a trailing-slash key silently never enforces. */
function normalizeFolderKey(k: string): string {
  return k.replace(/\/+$/, "").replace(/\/{2,}/g, "/")
}

function normalizeFolderVisibility(raw: unknown): Record<string, Visibility> {
  const out: Record<string, Visibility> = {}
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === "chat-only" || v === "hidden") out[normalizeFolderKey(k)] = v
    }
  }
  return out
}

/** Read the folderVisibility map from the vault's settings. Never throws — an unreadable,
 *  missing, or corrupt file reads as {}. Mirrors registry.ts's readDaemonSettings fallback. */
async function readFolderVisibility(root: string): Promise<Record<string, Visibility>> {
  for (const rel of [".settings", join(".settings", "settings.yaml"), "settings.yaml"]) {
    try {
      const doc = parseYaml(await readFile(join(root, rel), "utf-8")) as { folderVisibility?: unknown } | null
      if (doc !== null) return normalizeFolderVisibility(doc.folderVisibility)
    } catch {
      // unreadable/missing/dir → try the next shape
    }
  }
  return {}
}

// The tree-surfaced file set (mirrors core listTree) — the deny list must cover the SAME files
// the badge marks, or a hidden folder of .yaml/.pdf/.sheet stays fully readable by the daemon.
const VISIBLE_MEDIA_RE = /\.(png|jpe?g|gif|webp|svg|pdf)$/i
function isTreeSurfacedFile(name: string): boolean {
  if (name.endsWith(".draw.png") || name.endsWith(".draw.pdf")) return false
  return (
    name.endsWith(".md") || name.endsWith(".draw") || name.endsWith(".sheet") ||
    name.endsWith(".yaml") || name.endsWith(".yml") || VISIBLE_MEDIA_RE.test(name)
  )
}

/** Walk every tree-surfaced file under `root`, INCLUDING `.daemon/**`, skipping other
 *  dot-directories (`.git`, …) and `.settings`. `{ rel, isMd }` — only `.md` carries frontmatter. */
async function listVisibilityFiles(root: string): Promise<{ rel: string; isMd: boolean }[]> {
  const out: { rel: string; isMd: boolean }[] = []
  const walk = async (absDir: string, relDir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of entries) {
      const rel = relDir ? `${relDir}/${d.name}` : d.name
      if (d.name.startsWith(".") && d.name !== ".daemon") continue
      if (d.isDirectory()) {
        await walk(join(absDir, d.name), rel)
      } else if (isTreeSurfacedFile(d.name)) {
        out.push({ rel, isMd: d.name.endsWith(".md") })
      }
    }
  }
  await walk(root, "")
  return out
}

/** One restricted note, in both path forms a Claude Code tool call may report it in. */
export interface DenyEntry {
  /** Vault-relative path (e.g. "private/secret.md"). */
  rel: string
  /** Canonical (symlink-resolved) absolute path. */
  abs: string
}

/**
 * Resolve every note's effective visibility and return the daemon-restricted subset (any
 * visibility other than "all" — i.e. "chat-only" OR "hidden") — per-file entries, not folder
 * globs, so an explicit file-level override inside a restricted folder is honored by simply not
 * appearing here. Recomputed fresh on every call (no cache): sendMessage calls this per message
 * so a visibility edit or a file move takes effect on the very next turn.
 */
export async function buildDenyPaths(root: string): Promise<DenyEntry[]> {
  const folderVisibility = await readFolderVisibility(root)
  const files = await listVisibilityFiles(root)
  // Canonicalize the root before joining: the SDK's own tools resolve symlinks in the paths they
  // report (e.g. on macOS a vault under a tmp dir is really under /private/var or /private/tmp),
  // so a deny path built from a non-canonical root would silently never match theirs.
  const canonicalRoot = await realpath(root).catch(() => root)
  const out: DenyEntry[] = []
  for (const { rel, isMd } of files) {
    let fileVisibility: FileVisibility
    if (isMd) {
      try {
        const { frontmatter } = parseFrontmatter(await readFile(join(root, rel), "utf-8"))
        fileVisibility = isVisibilityLiteral(frontmatter.visibility) ? (frontmatter.visibility as Visibility) : undefined
      } catch {
        continue // unreadable — nothing to deny
      }
    } else {
      fileVisibility = undefined // non-md files carry no frontmatter → folder cascade only
    }
    // Memory notes (.daemon/memory/**): frontmatter-only, never folder cascade — keeps the deny
    // list in agreement with recall/searchMemory (which don't know the folder map). See the core
    // copy + docs/vault/visibility.md.
    const memoryNote = rel === ".daemon/memory" || rel.startsWith(".daemon/memory/")
    const resolved = resolveVisibility(rel, fileVisibility, memoryNote ? {} : folderVisibility)
    if (!isVisibleToDaemon(resolved)) out.push({ rel, abs: join(canonicalRoot, rel) })
  }
  return out
}

/**
 * Build the full `managedSettings.permissions.deny` rule list from buildDenyPaths' output — BOTH
 * the relative AND absolute form of every denied path, for each of Read/Edit/Grep/Glob. Both
 * forms are load-bearing: empirically (see the visibility-controls spike + core/src/visibility.ts's
 * matching comment), Claude Code's Read tool does NOT consistently resolve a relative `file_path`
 * against an absolute deny pattern — a rule keyed on only one form silently fails to match the other.
 */
export function buildManagedSettingsDeny(entries: DenyEntry[]): string[] {
  return entries.flatMap(({ rel, abs }) =>
    (["Read", "Edit", "Grep", "Glob"] as const).flatMap((tool) => [`${tool}(${rel})`, `${tool}(${abs})`]),
  )
}

/** The absolute paths only — what `sandbox.filesystem.denyRead` requires. */
export function absDenyPaths(entries: DenyEntry[]): string[] {
  return entries.map((e) => e.abs)
}
