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
//
// The discovery walk is the whole enforcement surface — every consumer (Claude's
// managedSettings/sandbox, the CLI/MCP gate, isDeniedPath's live checks) only ever restricts
// what THIS walk found, so a file it misses is unprotected everywhere. See listVisibilityFiles
// and buildDenyPaths' doc comments for the extension/frontmatter/stem-inheritance fixes.
import { open, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";
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

/**
 * Walk EVERY regular file under `root` — any extension, any directory, INCLUDING
 * dot-directories (a note stashed in `.stash/` or similar is still a note; excluding
 * dot-directories was a verified leak). Skips only two names: `.git` (handled as its own
 * subtree deny by sandboxDenyRead — not walked as vault content) and `.settings` (Bismuth's own
 * config, file or interim-directory shape, never vault content).
 *
 * The OLD version of this walk surfaced only an extension allowlist (`.md`/`.draw`/`.sheet`/
 * `.yaml`/`.yml` + a few image/pdf types) — so a `.txt`/`.json`/`.csv` file living in a folder
 * the user marked `hidden` was invisible to this walk and therefore unenforced on every channel,
 * even though the sidebar badged its FOLDER as hidden. Widening to every extension is what makes
 * the folder cascade (in buildDenyPaths) a hard floor instead of a suggestion.
 */
async function listVisibilityFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (absDir: string, relDir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      if (d.name === ".git" || d.name === ".settings") continue;
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      if (d.isDirectory()) {
        await walk(join(absDir, d.name), rel);
      } else {
        out.push(rel);
      }
    }
  };
  await walk(root, "");
  return out;
}

const HEAD_BYTES = 512;
const MAX_FRONTMATTER_BYTES = 64 * 1024;
/** Just the opening fence — cheap enough to run against every file the walk finds. */
const FRONTMATTER_OPEN_RE = /^---\r?\n/;
/** The FULL frontmatter block (opening fence through closing fence) — mirrors
 *  frontmatter.ts's own FRONTMATTER_REGEX shape exactly, used only to check whether a closing
 *  fence already lies within whatever slice we've read so far. */
const FRONTMATTER_CLOSED_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

function stripBOM(s: string): string {
  return s.length > 0 && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Read up to `maxBytes` from the START of a file — a partial read, never the whole file.
 *  `truncated` is true iff the file is longer than what was read, so the caller knows whether a
 *  bigger re-read could still reveal a closing fence this slice missed. */
async function readHeadBytes(absPath: string, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const fh = await open(absPath, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return { text: buf.toString("utf-8", 0, bytesRead), truncated: bytesRead === maxBytes };
  } finally {
    await fh.close();
  }
}

/**
 * A file's OWN explicit `visibility:` value, read as cheaply as possible: a 512-byte head
 * covers essentially every real note's frontmatter block; only when that head is BOTH truncated
 * (there is more file beyond it) AND doesn't already contain a closing fence do we re-read up to
 * 64 KiB. Never throws — an unreadable or non-frontmatter-shaped file costs one small read and
 * returns undefined ("no explicit value", the folder cascade decides), so a transient read error
 * can only make a file MORE restricted, never less.
 *
 * Checked on EVERY file the walk finds, regardless of extension — NOT gated on `.md`. The old
 * "only `.md` carries frontmatter" assumption was itself a deny-list hole: a hidden note copied,
 * renamed, or hard-linked to an untracked extension carries the exact same frontmatter BYTES,
 * and a walk that only opens `.md` files never sees them. The cost is bounded regardless: a file
 * that doesn't start with `---` is rejected after one 512-byte read no matter how large it is.
 */
async function readOwnVisibility(absPath: string): Promise<FileVisibility> {
  let head: { text: string; truncated: boolean };
  try {
    head = await readHeadBytes(absPath, HEAD_BYTES);
  } catch {
    return undefined;
  }
  let text = stripBOM(head.text);
  if (!FRONTMATTER_OPEN_RE.test(text)) return undefined; // not frontmatter-shaped — no more I/O
  if (head.truncated && !FRONTMATTER_CLOSED_RE.test(text)) {
    try {
      text = stripBOM((await readHeadBytes(absPath, MAX_FRONTMATTER_BYTES)).text);
    } catch {
      return undefined;
    }
  }
  const { data } = parseFrontmatter(text);
  return isVisibilityLiteral(data.visibility) ? data.visibility : undefined;
}

/** Memoized per-directory folder-cascade lookup: many files share a directory, and
 *  resolveFolderVisibility's ancestor walk would otherwise be redone once per file for nothing. */
function cascadeForDir(dir: string, folderVisibility: Record<string, Visibility>, cache: Map<string, Visibility>): Visibility {
  let v = cache.get(dir);
  if (v === undefined) {
    v = resolveFolderVisibility(dir, folderVisibility);
    cache.set(dir, v);
  }
  return v;
}

function splitRelPath(rel: string): { dir: string; base: string } {
  const idx = rel.lastIndexOf("/");
  return idx === -1 ? { dir: "", base: rel } : { dir: rel.slice(0, idx), base: rel.slice(idx + 1) };
}

/** The part of a basename before its FIRST dot — "sketch.draw.png" and "sketch.draw" both stem
 *  to "sketch", which is what lets applyStemInheritance catch export sidecars. A LEADING dot is
 *  treated as part of the name, not a separator (a dotfile like ".env" stems to itself, not to
 *  ""), so unrelated dotfiles in the same directory don't collide on an empty stem. */
function preDotStem(base: string): string {
  const start = base.startsWith(".") ? 1 : 0;
  const idx = base.indexOf(".", start);
  return idx === -1 ? base : base.slice(0, idx);
}

const VISIBILITY_RANK: Record<Visibility, number> = { all: 0, "chat-only": 1, hidden: 2 };

interface ResolvedFile {
  rel: string;
  abs: string;
  dir: string;
  stem: string;
  visibility: Visibility;
  /** True iff `visibility` came from this file's OWN frontmatter. Stem inheritance never
   *  overrides an explicit value, in either direction (see applyStemInheritance). */
  explicit: boolean;
}

/**
 * Stem inheritance: a file with NO explicit visibility of its own, whose pre-first-dot stem
 * matches a restricted sibling's stem IN THE SAME DIRECTORY, inherits the STRICTEST such
 * sibling's resolved visibility.
 *
 * This is deliberately over-inclusive: an unrelated `note.png` sitting beside a hidden `note.md`
 * becomes restricted too. That's the safe direction, and it's the only one available, because a
 * non-markdown file has no frontmatter of its own with which to opt back out (documented in
 * docs/vault/visibility.md). It's what closes the export-sidecar gap: `sketch.draw.png` /
 * `sketch.draw.pdf` share the stem "sketch" with `sketch.draw`, so a restricted drawing's
 * rendered exports are restricted too, rather than reachable under a name the deny list used to
 * explicitly skip as an "export artifact".
 *
 * An EXPLICIT visibility (frontmatter, checked on every file — see readOwnVisibility) always
 * wins over whatever a file's stem-mates would otherwise contribute, in both directions: a
 * `visibility: all` note stays visible even beside a hidden stem-mate, and a `visibility: hidden`
 * note stays hidden even beside an all-visible one. Only non-explicit members are upgraded.
 */
function applyStemInheritance(files: ResolvedFile[]): void {
  const groups = new Map<string, ResolvedFile[]>();
  for (const f of files) {
    // JSON-encode the (dir, stem) pair rather than joining with a plain separator: a real
    // vault's folder/file names commonly contain spaces or other punctuation, so a naive join
    // could collide two distinct pairs into one group ("a" + "b c" vs "a b" + "c").
    const key = JSON.stringify([f.dir, f.stem]);
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    let strictest: Visibility = "all";
    for (const f of group) if (VISIBILITY_RANK[f.visibility] > VISIBILITY_RANK[strictest]) strictest = f.visibility;
    if (strictest === "all") continue;
    for (const f of group) {
      if (!f.explicit && VISIBILITY_RANK[strictest] > VISIBILITY_RANK[f.visibility]) f.visibility = strictest;
    }
  }
}

/** One restricted note, in both path forms a Claude Code tool call may report it in. */
export interface DenyEntry {
  /** Vault-relative path (e.g. "private/secret.md"). */
  rel: string;
  /** Canonical (symlink-resolved) absolute path. */
  abs: string;
}

/** Bounded-concurrency map: `Promise.all` over thousands of files would open that many file
 *  descriptors at once and risk EMFILE on a large vault; this caps how many `readOwnVisibility`
 *  calls are in flight together while still reading every file's head in parallel, not serially
 *  (serial whole-file reads were the old implementation's actual performance bug). */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

const READ_CONCURRENCY = 64;

/**
 * Resolve every file's effective visibility and return the RESTRICTED subset for `channel` —
 * per-file entries, not folder globs, so an explicit file-level override inside a restricted
 * folder is honored by simply not appearing here. Recomputed fresh on every call (no cache):
 * callers (chat.ts, the daemon's sendMessage) are expected to call this per session/message so a
 * visibility edit or a file move takes effect on the very next turn.
 *
 * Resolution order per file: (1) the folder cascade is resolved first, with ZERO I/O
 * (cascadeForDir, memoized per directory) — this alone covers any extension inside a restricted
 * folder; (2) the file's own frontmatter, if any (readOwnVisibility — checked on every file, not
 * just `.md`), overrides the cascade when present; (3) a stem-inheritance pass
 * (applyStemInheritance) then covers export sidecars and same-stem siblings that have neither a
 * restricting folder nor frontmatter of their own. See each helper's doc comment for why.
 */
export async function buildDenyPaths(root: string, channel: VisibilityChannel): Promise<DenyEntry[]> {
  const folderVisibility = await readFolderVisibility(root);
  const rels = await listVisibilityFiles(root);
  // Canonicalize the root before joining: the SDK's own tools resolve symlinks in the paths they
  // report (e.g. on macOS a vault under a tmp dir is really under /private/var or /private/tmp),
  // so a deny path built from a non-canonical root would silently never match theirs and the
  // "deny" would be a no-op. Falls back to the given root if it can't be resolved (shouldn't
  // happen for a real vault, but never let a resolution failure crash the deny-list build).
  const canonicalRoot = await realpath(root).catch(() => root);
  const cascadeCache = new Map<string, Visibility>();

  const resolved = await mapWithConcurrency(rels, READ_CONCURRENCY, async (rel): Promise<ResolvedFile> => {
    const { dir, base } = splitRelPath(rel);
    // Memory notes (.daemon/memory/**) are gated by their OWN frontmatter only, NEVER folder
    // cascade — this keeps the native-tool deny list in agreement with the `recall` MCP tool /
    // searchMemory, which filter memory notes by frontmatter visibility and know nothing of the
    // folder-visibility map (documented in docs/vault/visibility.md). Applying the cascade here
    // would deny reading a memory .md that recall would still surface — a badge/enforcement split.
    const memoryNote = rel === ".daemon/memory" || rel.startsWith(".daemon/memory/");
    const cascade = memoryNote ? "all" : cascadeForDir(dir, folderVisibility, cascadeCache);
    const own = await readOwnVisibility(join(root, rel));
    const explicit = isVisibilityLiteral(own);
    return {
      rel,
      abs: join(canonicalRoot, rel),
      dir,
      stem: preDotStem(base),
      visibility: isVisibilityLiteral(own) ? own : cascade,
      explicit,
    };
  });

  applyStemInheritance(resolved);

  return resolved.filter((f) => !isVisibleToChannel(f.visibility, channel)).map((f) => ({ rel: f.rel, abs: f.abs }));
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

/**
 * The sandbox deny-read list: every restricted file, PLUS the vault's `.git` directory.
 *
 * `.git` is load-bearing and easy to miss. `core/src/backup.ts` git-snapshots the vault, so a note
 * hidden today was very likely committed in plaintext yesterday — and `git show HEAD:Private/secret.md`
 * or `git log -p` reads it straight back out with no reference to the working-tree path the deny list
 * covers. Red-teaming confirmed the read succeeds without this, and that adding
 * `(deny file-read* (subpath "<vault>/.git"))` blocks `git show`/`git log -p` while an ordinary
 * `cat public.md` keeps working.
 *
 * Deliberately NOT solved by rewriting history: the owner's backups are theirs, and scrubbing them
 * would destroy the very thing they exist for. We restrict the AGENT's view instead.
 *
 * Only applied when something is actually restricted, so an unrestricted vault's agent keeps full
 * git access (the daemon's own crons legitimately run `bismuth checkpoint diff`).
 */
export function sandboxDenyRead(entries: DenyEntry[], vaultRoot: string): string[] {
  if (entries.length === 0) return [];
  return [...absDenyPaths(entries), join(vaultRoot, ".git")];
}

/** Both path forms of every entry, for an O(1) same-process membership check (e.g. a
 *  canUseTool's `toolInput.file_path`, which may itself be relative OR absolute).
 *
 *  Prefer {@link isDeniedPath} for checking a path a MODEL supplied — a raw `Set.has()` is an exact
 *  byte comparison, and a tool call's path is not guaranteed to be byte-identical to ours. */
export function denyPathSet(entries: DenyEntry[]): Set<string> {
  const s = new Set<string>();
  for (const e of entries) {
    s.add(e.rel);
    s.add(e.abs);
  }
  return s;
}

/**
 * Normalize a path for comparison: strip a leading `./`, collapse repeated slashes, drop a trailing
 * slash, and CASE-FOLD.
 *
 * Case-folding is the load-bearing part. macOS filesystems are case-insensitive by default, so
 * `Private/SECRET.md` opens exactly the same file as `Private/secret.md` while comparing unequal as
 * a string — a deny keyed on an exact match lets the second spelling straight through. Found by
 * red-teaming the shipped `denyPathSet(...).has(p)` check, not by reading it.
 *
 * The cost is a false positive on a genuinely case-sensitive volume holding two notes whose paths
 * differ only in case, where one is hidden and one is not. That is a vanishingly rare vault against
 * a leak that is trivial to trigger, so it is the right trade — but it is a trade, so it is written
 * down here rather than left for someone to rediscover.
 */
function normalizeForCompare(p: string): string {
  return p
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
}

/**
 * Is `candidate` (a path as some MODEL reported it — relative or absolute, any case) one of the
 * restricted entries? Use this for every gate that inspects a tool call's path.
 *
 * Also matches a path that lies UNDER a restricted entry, so a directory-shaped deny covers the
 * files inside it rather than only an exact hit on the directory itself.
 */
export function isDeniedPath(entries: DenyEntry[], candidate: string): boolean {
  const c = normalizeForCompare(candidate);
  if (!c) return false;
  for (const e of entries) {
    for (const form of [e.rel, e.abs]) {
      const f = normalizeForCompare(form);
      if (!f) continue;
      if (c === f || c.startsWith(`${f}/`)) return true;
    }
  }
  return false;
}
