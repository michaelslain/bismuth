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
import { open, readdir, readFile, realpath } from "node:fs/promises"
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
 */
async function listVisibilityFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (absDir: string, relDir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of entries) {
      if (d.name === ".git" || d.name === ".settings") continue
      const rel = relDir ? `${relDir}/${d.name}` : d.name
      if (d.isDirectory()) {
        await walk(join(absDir, d.name), rel)
      } else {
        out.push(rel)
      }
    }
  }
  await walk(root, "")
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
  abs: string
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

/** One restricted note, in both path forms a Claude Code tool call may report it in. */
export interface DenyEntry {
  /** Vault-relative path (e.g. "private/secret.md"). */
  rel: string
  /** Canonical (symlink-resolved) absolute path. */
  abs: string
}

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
export async function buildDenyPaths(root: string): Promise<DenyEntry[]> {
  const folderVisibility = await readFolderVisibility(root)
  const rels = await listVisibilityFiles(root)
  // Canonicalize the root before joining: the SDK's own tools resolve symlinks in the paths they
  // report (e.g. on macOS a vault under a tmp dir is really under /private/var or /private/tmp),
  // so a deny path built from a non-canonical root would silently never match theirs.
  const canonicalRoot = await realpath(root).catch(() => root)
  const cascadeCache = new Map<string, Visibility>()

  const resolved = await mapWithConcurrency(rels, READ_CONCURRENCY, async (rel): Promise<ResolvedFile> => {
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
      dir,
      stem: preDotStem(base),
      visibility: isVisibilityLiteral(own) ? own : cascade,
      explicit,
    }
  })

  applyStemInheritance(resolved)

  return resolved.filter((f) => !isVisibleToDaemon(f.visibility)).map((f) => ({ rel: f.rel, abs: f.abs }))
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
