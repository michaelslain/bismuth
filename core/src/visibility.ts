// core/src/visibility.ts
// Per-file/folder AI visibility: an HONESTY boundary (not a security boundary) that
// keeps the daemon + in-app chat's own tool calls from reading a marked note. See
// docs/vault/visibility.md for the full threat model — restated briefly: this never
// restricts the vault owner (editor/FileTree/graph/CLI) or their own interactive
// terminal Claude sessions, only the app's own daemon + chat sessions.
//
// Storage: a file's frontmatter `visibility: "chat-only" | "hidden"` (absent = INHERIT,
// not "visible" — this is what makes folder inheritance work); a folder's entry in the
// `.settings` `folderVisibility: {folderPath: "chat-only"|"hidden"}` map (folders have
// no frontmatter of their own).
//
// Isolated and pure (the resolvers) so they're fully unit-testable, mirroring
// daemonViz.nodeVisualState. `buildDenyPaths` is the one I/O entry point, walking the
// vault + settings to produce a deny-list; it is NOT cached — visibility is resolved
// fresh from the file's CURRENT path every time, so a note moved into or out of a
// restricted folder re-resolves instantly with no migration step.
import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";
import { readNote } from "./files";
import { readFolderVisibility } from "./settings";

export type Visibility = "all" | "chat-only" | "hidden";
/** A file's own explicit frontmatter value; `undefined` = absent = inherit. */
export type FileVisibility = Visibility | undefined;
/** Which consumer is asking — the two enforcement channels named in the plan. */
export type VisibilityChannel = "chat" | "daemon";

function isVisibilityLiteral(v: unknown): v is Visibility {
  return v === "all" || v === "chat-only" || v === "hidden";
}

/** Ancestor folder paths of `path`, deepest-first. `includeSelf` treats `path` itself
 *  as a folder — used to resolve a DIRECTORY's own effective visibility (its own
 *  `folderVisibility` entry counts before its parents'). For a FILE, pass `false` so
 *  only its containing folders (not the file path itself) are considered. */
function ancestorFolders(path: string, includeSelf: boolean): string[] {
  const segs = path.split("/").filter(Boolean);
  const dirSegs = includeSelf ? segs : segs.slice(0, -1);
  const out: string[] = [];
  for (let i = dirSegs.length; i > 0; i--) out.push(dirSegs.slice(0, i).join("/"));
  return out;
}

/**
 * Resolve a FILE's effective visibility: an explicit frontmatter value wins; else the
 * nearest ancestor folder's `folderVisibility` entry (deepest wins); else "all". Pure —
 * no I/O, so a stray `visibility: "all"` inside an otherwise-hidden folder is honored
 * as an explicit per-file override (see docs/vault/visibility.md for the tradeoff vs.
 * a "folder is a hard floor" policy).
 */
export function resolveVisibility(
  path: string,
  fileVisibility: FileVisibility,
  folderVisibility: Record<string, Visibility>,
): Visibility {
  if (isVisibilityLiteral(fileVisibility)) return fileVisibility;
  for (const folder of ancestorFolders(path, false)) {
    const v = folderVisibility[folder];
    if (v) return v;
  }
  return "all";
}

/**
 * Resolve a FOLDER's own effective visibility (folders have no frontmatter, so there is
 * no "explicit value" tier beyond the folder's own `folderVisibility` entry): its own
 * entry wins, else its ancestors' (deepest wins), else "all". Pure — no I/O.
 */
export function resolveFolderVisibility(path: string, folderVisibility: Record<string, Visibility>): Visibility {
  for (const folder of ancestorFolders(path, true)) {
    const v = folderVisibility[folder];
    if (v) return v;
  }
  return "all";
}

/** Chat may read anything except explicitly hidden notes (chat-only files ARE visible
 *  to chat — that's the tier's whole point). */
export function isVisibleToChat(v: Visibility): boolean {
  return v !== "hidden";
}

/** The daemon (and memory recall) may only read notes with NO restriction at all. */
export function isVisibleToDaemon(v: Visibility): boolean {
  return v === "all";
}

function isVisibleToChannel(v: Visibility, channel: VisibilityChannel): boolean {
  return channel === "chat" ? isVisibleToChat(v) : isVisibleToDaemon(v);
}

// The vault files that show in the sidebar (mirrors listTree's filter) — the deny list must
// cover the SAME set the /tree badge marks, or a hidden folder of .yaml/.pdf/.sheet is badged
// off-limits while staying fully readable (badge-vs-enforcement disagreement).
const VISIBLE_MEDIA_RE = /\.(png|jpe?g|gif|webp|svg|pdf)$/i;
function isTreeSurfacedFile(name: string): boolean {
  if (name.endsWith(".draw.png") || name.endsWith(".draw.pdf")) return false; // export sidecars
  return (
    name.endsWith(".md") || name.endsWith(".draw") || name.endsWith(".sheet") ||
    name.endsWith(".yaml") || name.endsWith(".yml") || VISIBLE_MEDIA_RE.test(name)
  );
}

/** Walk every tree-surfaced file under `root`, INCLUDING `.daemon/**` (memory notes + inbox
 *  pages are ordinary vault files), skipping other dot-directories (`.git`, …) and the
 *  extensionless `.settings` file. Returns `{ rel, isMd }` — only `.md` files carry frontmatter,
 *  so the caller frontmatter-parses those and folder-cascades the rest. */
async function listVisibilityFiles(root: string): Promise<{ rel: string; isMd: boolean }[]> {
  const out: { rel: string; isMd: boolean }[] = [];
  const walk = async (absDir: string, relDir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      if (d.name.startsWith(".") && d.name !== ".daemon") continue;
      if (d.isDirectory()) {
        await walk(join(absDir, d.name), rel);
      } else if (isTreeSurfacedFile(d.name)) {
        out.push({ rel, isMd: d.name.endsWith(".md") });
      }
    }
  };
  await walk(root, "");
  return out;
}

/** One restricted note, in both path forms a Claude Code tool call may report it in. */
export interface DenyEntry {
  /** Vault-relative path (e.g. "private/secret.md"). */
  rel: string;
  /** Canonical (symlink-resolved) absolute path. */
  abs: string;
}

/**
 * Resolve every note's effective visibility and return the RESTRICTED subset for `channel` —
 * per-file entries, not folder globs, so an explicit file-level override inside a restricted
 * folder is honored by simply not appearing here. Recomputed fresh on every call (no cache):
 * callers (chat.ts, the daemon's sendMessage) are expected to call this per session/message so a
 * visibility edit or a file move takes effect on the very next turn.
 */
export async function buildDenyPaths(root: string, channel: VisibilityChannel): Promise<DenyEntry[]> {
  const folderVisibility = await readFolderVisibility(root);
  const files = await listVisibilityFiles(root);
  // Canonicalize the root before joining: the SDK's own tools resolve symlinks in the paths they
  // report (e.g. on macOS a vault under a tmp dir is really under /private/var or /private/tmp),
  // so a deny path built from a non-canonical root would silently never match theirs and the
  // "deny" would be a no-op. Falls back to the given root if it can't be resolved (shouldn't
  // happen for a real vault, but never let a resolution failure crash the deny-list build).
  const canonicalRoot = await realpath(root).catch(() => root);
  const out: DenyEntry[] = [];
  for (const { rel, isMd } of files) {
    let fileVisibility: FileVisibility;
    if (isMd) {
      try {
        const { data } = parseFrontmatter(await readNote(root, rel));
        fileVisibility = isVisibilityLiteral(data.visibility) ? data.visibility : undefined;
      } catch {
        continue; // unreadable — nothing to deny
      }
    } else {
      fileVisibility = undefined; // non-md files carry no frontmatter → folder cascade only
    }
    // Memory notes (.daemon/memory/**) are gated by their OWN frontmatter only, NEVER folder
    // cascade — this keeps the native-tool deny list in agreement with the `recall` MCP tool /
    // searchMemory, which filter memory notes by frontmatter visibility and know nothing of the
    // folder-visibility map (documented in docs/vault/visibility.md). Applying the cascade here
    // would deny reading a memory .md that recall would still surface — a badge/enforcement split.
    const memoryNote = rel === ".daemon/memory" || rel.startsWith(".daemon/memory/");
    const resolved = resolveVisibility(rel, fileVisibility, memoryNote ? {} : folderVisibility);
    if (!isVisibleToChannel(resolved, channel)) out.push({ rel, abs: join(canonicalRoot, rel) });
  }
  return out;
}

/**
 * Build the full `managedSettings.permissions.deny` rule list from buildDenyPaths' output — BOTH
 * the relative AND absolute form of every denied path, for each of Read/Edit/Grep/Glob. Both
 * forms are load-bearing: empirically (see the visibility-controls spike), Claude Code's Read
 * tool does NOT consistently resolve a relative `file_path` against an absolute deny pattern — a
 * model asked to read "secret.md in the current directory" may call Read with `file_path:
 * "secret.md"` (bare relative) just as often as the fully-resolved absolute path, and a deny rule
 * keyed on only one form silently fails to match the other.
 */
export function buildManagedSettingsDeny(entries: DenyEntry[]): string[] {
  return entries.flatMap(({ rel, abs }) =>
    (["Read", "Edit", "Grep", "Glob"] as const).flatMap((tool) => [`${tool}(${rel})`, `${tool}(${abs})`]),
  );
}

/** The absolute paths only — what `sandbox.filesystem.denyRead` requires. */
export function absDenyPaths(entries: DenyEntry[]): string[] {
  return entries.map((e) => e.abs);
}

/** Both path forms of every entry, for an O(1) same-process membership check (e.g. a
 *  canUseTool's `toolInput.file_path`, which may itself be relative OR absolute). */
export function denyPathSet(entries: DenyEntry[]): Set<string> {
  const s = new Set<string>();
  for (const e of entries) {
    s.add(e.rel);
    s.add(e.abs);
  }
  return s;
}
