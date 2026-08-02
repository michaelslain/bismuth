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
//
// The discovery walk (listVisibilityFiles + buildDenyPaths) is the whole enforcement surface —
// a file it misses is unprotected. Keep this file's walk logic byte-for-byte in step with
// core/src/visibility.ts's; see that file's comments for the reasoning behind each fix.
import { open, readdir, readFile, realpath, stat } from "node:fs/promises"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { parseFrontmatter } from "./frontmatter.ts"
import { ownerTokenDenyPaths } from "./bismuthPaths.ts"

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

/** Resolve a FOLDER's own effective visibility (folders have no frontmatter, so there is no
 *  "explicit value" tier beyond the folder's own `folderVisibility` entry): its own entry wins,
 *  else its ancestors' (deepest wins), else "all". Pure — no I/O. Mirrors
 *  core/src/visibility.ts's resolveFolderVisibility. */
export function resolveFolderVisibility(path: string, folderVisibility: Record<string, Visibility>): Visibility {
  for (const folder of ancestorFolders(path, true)) {
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

/**
 * Read the folderVisibility map from the vault's settings, trying the same shapes registry.ts's
 * readDaemonSettings does (first readable wins).
 *
 * NOT tolerant of a corrupt file, unlike every other `.settings` reader in this codebase. An
 * absent settings file and one whose YAML has a syntax error both used to yield `{}`, and `{}`
 * means "no folder is restricted" — so appending one stray character to a settings file whose
 * `folderVisibility:` block hid a folder silently un-hid every note in it, with no error anywhere.
 * A file that is PRESENT but unparseable throws {@link VisibilityUndeterminedError}; a file that is
 * simply not there is an answer, and yields `{}`.
 */
async function readFolderVisibility(root: string): Promise<Record<string, Visibility>> {
  for (const rel of [".settings", join(".settings", "settings.yaml"), "settings.yaml"]) {
    let raw: string
    try {
      raw = await readFile(join(root, rel), "utf-8")
    } catch {
      continue // absent, a directory, or unreadable in this shape → try the next
    }
    let doc: { folderVisibility?: unknown } | null
    try {
      doc = parseYaml(raw) as { folderVisibility?: unknown } | null
    } catch (e) {
      throw new VisibilityUndeterminedError(
        `${rel} is not valid YAML (${e instanceof Error ? e.message : String(e)})`,
      )
    }
    if (doc !== null) return normalizeFolderVisibility(doc.folderVisibility)
  }
  return {}
}

/**
 * Thrown when the walk cannot enumerate what this vault restricts — see {@link DenyPlan}. A
 * deliberate literal copy of core/src/visibility.ts's class of the same name.
 */
export class VisibilityUndeterminedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "VisibilityUndeterminedError"
  }
}

/** Upper bound on directory entries the walk will consider — symlinked directories are followed,
 *  so the reachable set is a graph, not a tree. Cycles are caught exactly (the descent chain
 *  below); this bounds acyclic-but-huge fan-out, and hitting it is UNDETERMINED, not empty. */
export const MAX_WALK_ENTRIES = 200_000

/** Walk bounds, overridable per call — mirrors core/src/visibility.ts's WalkLimits. `maxEntries`
 *  exists so the budget MECHANISM can be exercised at a small bound rather than by materializing
 *  200k reachable entries; production callers pass nothing. The default is pinned by its own
 *  assertion, separately from any test that sets it. */
export interface WalkLimits {
  maxEntries?: number
}

/** One walked file: its vault-relative path, and the absolute path with every symlinked DIRECTORY
 *  on the way to it resolved. */
interface WalkedFile {
  rel: string
  canonicalAbs: string
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
 * the user marked `hidden` was invisible to this walk and therefore unenforced, even though the
 * sidebar badged its FOLDER as hidden. Widening to every extension is what makes the folder
 * cascade (in buildDenyPaths) a hard floor instead of a suggestion.
 *
 * SYMLINKED DIRECTORIES are followed. `Dirent.isDirectory()` is false for a link that points at a
 * directory, so such an entry used to be pushed as a FILE; readOwnVisibility then hit EISDIR and
 * returned undefined, leaving the whole subtree behind the link — explicit `visibility: hidden`
 * files included — with no deny entry while reading fine through the link's path.
 *
 * FAILURE IS NOT EMPTINESS. A readdir that fails is a subtree we cannot see into, and this walk is
 * the whole enforcement surface: returning only what we did read reports a SHORTER restricted list
 * than the truth, which every consumer reads as "less is hidden". It throws instead. The one
 * exception is a subtree that ENOENT'd out from under us mid-walk — it existed when its parent was
 * listed and does not now, so there is nothing behind it to miss. (ENOENT on the ROOT is not that
 * case: the vault we were asked about is not there.)
 */
async function listVisibilityFiles(
  root: string,
  canonicalRoot: string,
  maxEntries: number = MAX_WALK_ENTRIES,
): Promise<WalkedFile[]> {
  const out: WalkedFile[] = []
  let budget = maxEntries

  const walk = async (absDir: string, relDir: string, canonDir: string, chain: string[]): Promise<void> => {
    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch (e) {
      if (relDir !== "" && (e as NodeJS.ErrnoException)?.code === "ENOENT") return
      throw new VisibilityUndeterminedError(
        `cannot list ${relDir === "" ? "the vault root" : relDir}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    for (const d of entries) {
      if (d.name === ".git" || d.name === ".settings") continue
      if (--budget < 0) {
        throw new VisibilityUndeterminedError(
          `vault has more than ${maxEntries} reachable entries (symlink fan-out?) — the walk stopped early`,
        )
      }
      const rel = relDir ? `${relDir}/${d.name}` : d.name
      const abs = join(absDir, d.name)
      if (d.isDirectory()) {
        const next = join(canonDir, d.name)
        await walk(abs, rel, next, [...chain, next])
        continue
      }
      if (d.isSymbolicLink()) {
        // stat() follows the link; lstat/Dirent cannot tell us what it points AT.
        const target = await stat(abs).catch(() => null)
        if (target?.isDirectory()) {
          const real = await realpath(abs).catch(() => null)
          if (real === null) {
            out.push({ rel, canonicalAbs: join(canonDir, d.name) })
            continue
          }
          if (chain.includes(real)) continue // link back onto our own descent — a cycle
          await walk(abs, rel, real, [...chain, real])
          continue
        }
        // A link to a FILE (or a broken link): one entry, same as a regular file.
      }
      out.push({ rel, canonicalAbs: join(canonDir, d.name) })
    }
  }

  await walk(root, "", canonicalRoot, [canonicalRoot])
  return out
}

const HEAD_BYTES = 512
const MAX_FRONTMATTER_BYTES = 64 * 1024
/** Just the opening fence — cheap enough to run against every file the walk finds. */
const FRONTMATTER_OPEN_RE = /^---\r?\n/
/** The FULL frontmatter block (opening fence through closing fence) — used only to check
 *  whether a closing fence already lies within whatever slice we've read so far. */
const FRONTMATTER_CLOSED_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

function stripBOM(s: string): string {
  return s.length > 0 && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/** Read up to `maxBytes` from the START of a file — a partial read, never the whole file.
 *  `truncated` is true iff the file is longer than what was read, so the caller knows whether a
 *  bigger re-read could still reveal a closing fence this slice missed. */
async function readHeadBytes(absPath: string, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const fh = await open(absPath, "r")
  try {
    const buf = Buffer.alloc(maxBytes)
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0)
    return { text: buf.toString("utf-8", 0, bytesRead), truncated: bytesRead === maxBytes }
  } finally {
    await fh.close()
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
  let head: { text: string; truncated: boolean }
  try {
    head = await readHeadBytes(absPath, HEAD_BYTES)
  } catch {
    return undefined
  }
  let text = stripBOM(head.text)
  if (!FRONTMATTER_OPEN_RE.test(text)) return undefined // not frontmatter-shaped — no more I/O
  if (head.truncated && !FRONTMATTER_CLOSED_RE.test(text)) {
    try {
      text = stripBOM((await readHeadBytes(absPath, MAX_FRONTMATTER_BYTES)).text)
    } catch {
      return undefined
    }
  }
  const { frontmatter } = parseFrontmatter(text)
  return isVisibilityLiteral(frontmatter.visibility) ? (frontmatter.visibility as Visibility) : undefined
}

/** Memoized per-directory folder-cascade lookup: many files share a directory, and
 *  resolveFolderVisibility's ancestor walk would otherwise be redone once per file for nothing. */
function cascadeForDir(dir: string, folderVisibility: Record<string, Visibility>, cache: Map<string, Visibility>): Visibility {
  let v = cache.get(dir)
  if (v === undefined) {
    v = resolveFolderVisibility(dir, folderVisibility)
    cache.set(dir, v)
  }
  return v
}

function splitRelPath(rel: string): { dir: string; base: string } {
  const idx = rel.lastIndexOf("/")
  return idx === -1 ? { dir: "", base: rel } : { dir: rel.slice(0, idx), base: rel.slice(idx + 1) }
}

/** The part of a basename before its FIRST dot — "sketch.draw.png" and "sketch.draw" both stem
 *  to "sketch", which is what lets applyStemInheritance catch export sidecars. A LEADING dot is
 *  treated as part of the name, not a separator (a dotfile like ".env" stems to itself, not to
 *  ""), so unrelated dotfiles in the same directory don't collide on an empty stem. */
function preDotStem(base: string): string {
  const start = base.startsWith(".") ? 1 : 0
  const idx = base.indexOf(".", start)
  return idx === -1 ? base : base.slice(0, idx)
}

const VISIBILITY_RANK: Record<Visibility, number> = { all: 0, "chat-only": 1, hidden: 2 }

interface ResolvedFile {
  rel: string
  /** `rel` joined onto the canonical vault root — the spelling that follows the walked path. */
  abs: string
  /** The same file with symlinked directories on the way to it resolved; equals `abs` unless the
   *  walk crossed a link. */
  canonicalAbs: string
  dir: string
  stem: string
  visibility: Visibility
  /** True iff `visibility` came from this file's OWN frontmatter. Stem inheritance never
   *  overrides an explicit value, in either direction (see applyStemInheritance). */
  explicit: boolean
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
  const groups = new Map<string, ResolvedFile[]>()
  for (const f of files) {
    // JSON-encode the (dir, stem) pair rather than joining with a plain separator: a real
    // vault's folder/file names commonly contain spaces or other punctuation, so a naive join
    // could collide two distinct pairs into one group ("a" + "b c" vs "a b" + "c").
    const key = JSON.stringify([f.dir, f.stem])
    const g = groups.get(key)
    if (g) g.push(f)
    else groups.set(key, [f])
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    let strictest: Visibility = "all"
    for (const f of group) if (VISIBILITY_RANK[f.visibility] > VISIBILITY_RANK[strictest]) strictest = f.visibility
    if (strictest === "all") continue
    for (const f of group) {
      if (!f.explicit && VISIBILITY_RANK[strictest] > VISIBILITY_RANK[f.visibility]) f.visibility = strictest
    }
  }
}

/**
 * One restricted note — ONE entry per restricted file, so `entries.length` is a count of notes.
 *
 * `abs` is the file's path under the canonical vault root. That is not always the only absolute
 * path it is readable at: a file under a symlinked DIRECTORY is equally readable at the path with
 * the link resolved, and which of the two a tool reports depends on whether it resolved the link.
 * The other spellings go in `aliases`, and every consumer that emits absolute paths emits all of
 * them. Mirrors core/src/visibility.ts's DenyEntry.
 */
export interface DenyEntry {
  /** Vault-relative path (e.g. "private/secret.md"). */
  rel: string
  /** This file's path under the canonical vault root — always `<canonicalRoot>/<rel>`. */
  abs: string
  /** Further absolute paths the same file is readable at; absent when there are none. */
  aliases?: string[]
}

/** Every absolute spelling of one entry. */
function absForms(e: DenyEntry): string[] {
  return e.aliases === undefined ? [e.abs] : [e.abs, ...e.aliases]
}

/**
 * The result of a visibility walk, with its third state made explicit. A deliberate literal copy of
 * core/src/visibility.ts's DenyPlan — see that file for the full reasoning.
 *
 * `determined: false` is NOT "nothing is restricted". It is "this vault did not tell us what is
 * restricted". The two used to be the same value (`[]`), which meant `sandboxFailIfUnavailable`,
 * `sandboxDenyRead`'s `.git` deny and `resolveDaemonBackend`'s refusal all reported "unrestricted"
 * for a vault the daemon had simply failed to read.
 */
export type DenyPlan =
  | { determined: true; entries: DenyEntry[] }
  | { determined: false; reason: string }

/** Bounded-concurrency map: `Promise.all` over thousands of files would open that many file
 *  descriptors at once and risk EMFILE on a large vault; this caps how many `readOwnVisibility`
 *  calls are in flight together while still reading every file's head in parallel, not serially
 *  (serial whole-file reads were the old implementation's actual performance bug). */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i]!)
    }
  })
  await Promise.all(workers)
  return results
}

const READ_CONCURRENCY = 64

/**
 * Resolve every note's effective visibility and return the daemon-restricted subset (any
 * visibility other than "all" — i.e. "chat-only" OR "hidden") — per-file entries, not folder
 * globs, so an explicit file-level override inside a restricted folder is honored by simply not
 * appearing here. Recomputed fresh on every call (no cache): sendMessage calls this per message
 * so a visibility edit or a file move takes effect on the very next turn.
 *
 * Resolution order per file: (1) the folder cascade is resolved first, with ZERO I/O
 * (cascadeForDir, memoized per directory) — this alone covers any extension inside a restricted
 * folder; (2) the file's own frontmatter, if any (readOwnVisibility — checked on every file, not
 * just `.md`), overrides the cascade when present; (3) a stem-inheritance pass
 * (applyStemInheritance) then covers export sidecars and same-stem siblings that have neither a
 * restricting folder nor frontmatter of their own. See each helper's doc comment for why.
 */
export async function resolveDenyPlan(root: string, opts: WalkLimits = {}): Promise<DenyPlan> {
  try {
    return { determined: true, entries: await walkDenyEntries(root, opts) }
  } catch (e) {
    if (e instanceof VisibilityUndeterminedError) return { determined: false, reason: e.message }
    throw e
  }
}

/**
 * {@link resolveDenyPlan}'s entries, or a thrown {@link VisibilityUndeterminedError}. `sendMessage`
 * calls this at the top of every message, where a throw refuses the message — which is the correct
 * answer for a vault whose restrictions cannot be read. What no caller can receive any more is an
 * empty list for a vault that was never read.
 */
export async function buildDenyPaths(root: string, opts: WalkLimits = {}): Promise<DenyEntry[]> {
  return walkDenyEntries(root, opts)
}

async function walkDenyEntries(root: string, opts: WalkLimits = {}): Promise<DenyEntry[]> {
  const folderVisibility = await readFolderVisibility(root)
  // Canonicalize the root before joining: the SDK's own tools resolve symlinks in the paths they
  // report (e.g. on macOS a vault under a tmp dir is really under /private/var or /private/tmp),
  // so a deny path built from a non-canonical root would silently never match theirs. A root that
  // cannot be resolved is undetermined for that same reason.
  const canonicalRoot = await realpath(root).catch((e: unknown) => {
    throw new VisibilityUndeterminedError(
      `cannot resolve the vault root ${root}: ${e instanceof Error ? e.message : String(e)}`,
    )
  })
  const walked = await listVisibilityFiles(root, canonicalRoot, opts.maxEntries)
  const cascadeCache = new Map<string, Visibility>()

  const resolved = await mapWithConcurrency(walked, READ_CONCURRENCY, async (file): Promise<ResolvedFile> => {
    const { rel, canonicalAbs } = file
    const { dir, base } = splitRelPath(rel)
    // Memory notes (.daemon/memory/**): frontmatter-only, never folder cascade — keeps the deny
    // list in agreement with recall/searchMemory (which don't know the folder map). See the core
    // copy + docs/vault/visibility.md.
    const memoryNote = rel === ".daemon/memory" || rel.startsWith(".daemon/memory/")
    const cascade = memoryNote ? "all" : cascadeForDir(dir, folderVisibility, cascadeCache)
    const own = await readOwnVisibility(join(root, rel))
    const explicit = isVisibilityLiteral(own)
    return {
      rel,
      abs: join(canonicalRoot, rel),
      canonicalAbs,
      dir,
      stem: preDotStem(base),
      visibility: isVisibilityLiteral(own) ? own : cascade,
      explicit,
    }
  })

  applyStemInheritance(resolved)

  // The absolute spellings one restricted file is readable at, deduped, minus `abs` itself: a
  // symlinked DIRECTORY on the way to it, and the CALLER's own spelling of the vault root when it
  // differs from the canonical one (macOS firmlinks: `/var/…` canonicalizes to `/private/var/…`).
  // Mirrors core/src/visibility.ts.
  return resolved
    .filter((f) => !isVisibleToDaemon(f.visibility))
    // One ENTRY per file, so `entries.length` stays a count of NOTES; other spellings in `aliases`.
    // Both candidates collapse into `abs` for a vault with no symlink and a canonical root, so the
    // dedupe is what makes this a no-op there; no separate equality branch is needed.
    .map((f) => {
      const aliases = [...new Set([f.canonicalAbs, join(root, f.rel)])].filter((a) => a !== f.abs)
      return aliases.length === 0 ? { rel: f.rel, abs: f.abs } : { rel: f.rel, abs: f.abs, aliases }
    })
}

/**
 * Build the full `managedSettings.permissions.deny` rule list from buildDenyPaths' output — BOTH
 * the relative AND absolute form of every denied path, for each of Read/Edit/Grep/Glob. Both
 * forms are load-bearing: empirically (see the visibility-controls spike + core/src/visibility.ts's
 * matching comment), Claude Code's Read tool does NOT consistently resolve a relative `file_path`
 * against an absolute deny pattern — a rule keyed on only one form silently fails to match the other.
 */
export function buildManagedSettingsDeny(entries: DenyEntry[]): string[] {
  return entries.flatMap((e) =>
    [e.rel, ...absForms(e)].flatMap((path) =>
      (["Read", "Edit", "Grep", "Glob"] as const).map((tool) => `${tool}(${path})`),
    ),
  )
}

/** The absolute paths only — what `sandbox.filesystem.denyRead` requires. Every spelling of every
 *  entry (see {@link DenyEntry.aliases}), not one per file. */
export function absDenyPaths(entries: DenyEntry[]): string[] {
  return entries.flatMap(absForms)
}

/**
 * Sandbox deny-read list: every restricted file, PLUS the vault's `.git`. A deliberate literal copy
 * of core/src/visibility.ts's sandboxDenyRead (this whole module is a ported copy so the daemon
 * compiles standalone — same arrangement as claudeWhich.ts / bismuthPaths.ts).
 *
 * `.git` matters because core/src/backup.ts git-snapshots the vault: a note hidden today was likely
 * committed in plaintext yesterday, and `git show HEAD:Private/secret.md` reads it back without ever
 * touching the working-tree path the deny list covers. Verified by red-teaming. We restrict the
 * AGENT's view rather than rewriting the owner's backups.
 */
export function sandboxDenyRead(entries: DenyEntry[], vaultRoot: string): string[] {
  if (entries.length === 0) return []
  return [...absDenyPaths(entries), join(vaultRoot, ".git")]
}

/**
 * THE deny-read list this workspace's session spawns use: {@link sandboxDenyRead} plus the
 * owner-token run record. A deliberate literal copy of core/src/visibility.ts's
 * `buildSandboxDenyPaths` — see that function's doc comment for the full reasoning.
 *
 * In short: the token grants an HTTP caller the `"owner"` channel, unfiltered, and it lives OUTSIDE
 * the vault, so nothing derived from the vault walk reaches it. Its 0600 mode stops another user and
 * not this session, which runs as the same uid that wrote it. A daemon session that reads that file
 * and replays it in `X-Bismuth-Token` gets back exactly the notes this list exists to withhold.
 *
 * Gated on `entries.length > 0` like everything else here: an unrestricted vault is spawned with no
 * sandbox option at all, so there is no profile a token deny could ride in on.
 */
export function buildSandboxDenyPaths(entries: DenyEntry[], vaultRoot: string): string[] {
  const base = sandboxDenyRead(entries, vaultRoot)
  if (base.length === 0) return []
  return [...base, ...ownerTokenDenyPaths(vaultRoot)]
}

/**
 * Pure: `sandbox.failIfUnavailable` for this vault's daemon session. A deliberate literal copy of
 * core/src/visibility.ts's `sandboxFailIfUnavailable` (see that file's doc comment for the full
 * measurement this is based on — 2026-07-30, docs/vault/visibility.md + visibility-acceptance.md).
 *
 * `session.ts` used to pass a fixed `false` here, so a sandbox that couldn't start let the daemon's
 * session run anyway with only `managedSettings.permissions.deny` standing guard — which restricts
 * the Read/Edit/Grep/Glob tool CALLING CONVENTION and does nothing to a raw Bash subprocess
 * (`bismuth read`, `cat`, `python3 -c`). Conditional on `entries`, never a fixed `true`: a vault
 * that hides nothing must keep running on a machine where the sandbox can't start at all.
 */
export function sandboxFailIfUnavailable(entries: DenyEntry[]): boolean {
  return entries.length > 0
}
