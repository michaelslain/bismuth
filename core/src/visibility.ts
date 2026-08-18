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
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseFrontmatter } from './frontmatter'
import { readFolderVisibilityResult } from './settings'
import { ownerTokenDenyPaths } from './ownerToken'

export type Visibility = 'all' | 'chat-only' | 'hidden'
/** A file's own explicit frontmatter value; `undefined` = absent = inherit. */
export type FileVisibility = Visibility | undefined
/** Which consumer is asking — the two enforcement channels named in the plan. */
export type VisibilityChannel = 'chat' | 'daemon'

function isVisibilityLiteral(v: unknown): v is Visibility {
    return v === 'all' || v === 'chat-only' || v === 'hidden'
}

/** Ancestor folder paths of `path`, deepest-first. `includeSelf` treats `path` itself
 *  as a folder — used to resolve a DIRECTORY's own effective visibility (its own
 *  `folderVisibility` entry counts before its parents'). For a FILE, pass `false` so
 *  only its containing folders (not the file path itself) are considered. */
function ancestorFolders(path: string, includeSelf: boolean): string[] {
    const segs = path.split('/').filter(Boolean)
    const dirSegs = includeSelf ? segs : segs.slice(0, -1)
    const out: string[] = []
    for (let i = dirSegs.length; i > 0; i--)
        out.push(dirSegs.slice(0, i).join('/'))
    return out
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
    if (isVisibilityLiteral(fileVisibility)) return fileVisibility
    for (const folder of ancestorFolders(path, false)) {
        const v = folderVisibility[folder]
        if (v) return v
    }
    return 'all'
}

/**
 * Resolve a FOLDER's own effective visibility (folders have no frontmatter, so there is
 * no "explicit value" tier beyond the folder's own `folderVisibility` entry): its own
 * entry wins, else its ancestors' (deepest wins), else "all". Pure — no I/O.
 */
export function resolveFolderVisibility(
    path: string,
    folderVisibility: Record<string, Visibility>,
): Visibility {
    for (const folder of ancestorFolders(path, true)) {
        const v = folderVisibility[folder]
        if (v) return v
    }
    return 'all'
}

/** Chat may read anything except explicitly hidden notes (chat-only files ARE visible
 *  to chat — that's the tier's whole point). */
export function isVisibleToChat(v: Visibility): boolean {
    return v !== 'hidden'
}

/** The daemon (and memory recall) may only read notes with NO restriction at all. */
export function isVisibleToDaemon(v: Visibility): boolean {
    return v === 'all'
}

function isVisibleToChannel(
    v: Visibility,
    channel: VisibilityChannel,
): boolean {
    return channel === 'chat' ? isVisibleToChat(v) : isVisibleToDaemon(v)
}

/**
 * Thrown when the walk cannot enumerate what this vault restricts. Distinct from an ordinary error
 * so callers can tell "the vault said nothing is hidden" from "the vault did not say". See
 * {@link DenyPlan}.
 */
export class VisibilityUndeterminedError extends Error {
    constructor(reason: string) {
        super(reason)
        this.name = 'VisibilityUndeterminedError'
    }
}

/**
 * Upper bound on directory entries the walk will consider. Symlinked directories are followed
 * (see listVisibilityFiles), and following links makes the reachable set a graph rather than a
 * tree: N sibling links into a directory holding N more can multiply out far past the file count.
 * Cycles are caught exactly (the descent chain below); this bounds the acyclic-but-huge shapes,
 * and a vault that hits it is UNDETERMINED, not empty.
 */
export const MAX_WALK_ENTRIES = 200_000

/** Walk bounds, overridable per call. `maxEntries` exists so the budget MECHANISM can be exercised
 *  at a small bound instead of by materializing 200k reachable entries; production callers pass
 *  nothing and get {@link MAX_WALK_ENTRIES}. A test that sets the bound cannot also be the thing
 *  that pins it — the default is asserted independently. */
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
 * the user marked `hidden` was invisible to this walk and therefore unenforced on every channel,
 * even though the sidebar badged its FOLDER as hidden. Widening to every extension is what makes
 * the folder cascade (in buildDenyPaths) a hard floor instead of a suggestion.
 *
 * SYMLINKED DIRECTORIES are followed. `Dirent.isDirectory()` is false for a link that points at a
 * directory, so such an entry used to be pushed as a FILE; readOwnVisibility then hit EISDIR and
 * returned undefined, and the entire subtree behind the link — including files carrying an explicit
 * `visibility: hidden` — produced no deny entry at all while reading fine through the link's path.
 * Following them means the reachable set is a graph, so two bounds apply: the descent CHAIN of
 * canonical directory paths catches a link back to an ancestor exactly, and MAX_WALK_ENTRIES bounds
 * the rest. A link is followed once per distinct path it is reachable at, on purpose — each spelling
 * needs its own deny entry.
 *
 * FAILURE IS NOT EMPTINESS. A readdir that fails is a subtree we cannot see into, and this walk is
 * the whole enforcement surface: returning what we did manage to read would report a SHORTER
 * restricted list than the truth, which every consumer reads as "less is hidden". So it throws
 * {@link VisibilityUndeterminedError} instead. The one exception is a subtree that has ENOENT'd
 * out from under us mid-walk — it existed when its parent was listed and does not now, so there is
 * nothing behind it to miss. (ENOENT on the ROOT is not that case: the vault we were asked about is
 * not there, which is a question we cannot answer rather than an answer of "nothing".)
 */
async function listVisibilityFiles(
    root: string,
    canonicalRoot: string,
    maxEntries: number = MAX_WALK_ENTRIES,
): Promise<WalkedFile[]> {
    const out: WalkedFile[] = []
    let budget = maxEntries

    const walk = async (
        absDir: string,
        relDir: string,
        canonDir: string,
        chain: string[],
    ): Promise<void> => {
        let entries
        try {
            entries = await readdir(absDir, { withFileTypes: true })
        } catch (e) {
            // Vanished mid-walk: nothing behind it to miss. Anything else (EACCES, EIO, ELOOP…) is a
            // subtree that exists and is opaque to us — the honest answer is "we don't know".
            if (
                relDir !== '' &&
                (e as NodeJS.ErrnoException)?.code === 'ENOENT'
            )
                return
            throw new VisibilityUndeterminedError(
                `cannot list ${relDir === '' ? 'the vault root' : relDir}: ${e instanceof Error ? e.message : String(e)}`,
            )
        }
        for (const d of entries) {
            if (d.name === '.git' || d.name === '.settings') continue
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
                    // Unresolvable target: treat as an ordinary file rather than guess. It yields no
                    // frontmatter, and its rel path still inherits the folder cascade.
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

    await walk(root, '', canonicalRoot, [canonicalRoot])
    return out
}

const HEAD_BYTES = 512
const MAX_FRONTMATTER_BYTES = 64 * 1024
/** Just the opening fence — cheap enough to run against every file the walk finds. */
const FRONTMATTER_OPEN_RE = /^---\r?\n/
/** The FULL frontmatter block (opening fence through closing fence) — mirrors
 *  frontmatter.ts's own FRONTMATTER_REGEX shape exactly, used only to check whether a closing
 *  fence already lies within whatever slice we've read so far. */
const FRONTMATTER_CLOSED_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

function stripBOM(s: string): string {
    return s.length > 0 && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/** Read up to `maxBytes` from the START of a file — a partial read, never the whole file.
 *  `truncated` is true iff the file is longer than what was read, so the caller knows whether a
 *  bigger re-read could still reveal a closing fence this slice missed. */
async function readHeadBytes(
    absPath: string,
    maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
    const fh = await open(absPath, 'r')
    try {
        const buf = Buffer.alloc(maxBytes)
        const { bytesRead } = await fh.read(buf, 0, maxBytes, 0)
        return {
            text: buf.toString('utf-8', 0, bytesRead),
            truncated: bytesRead === maxBytes,
        }
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
            text = stripBOM(
                (await readHeadBytes(absPath, MAX_FRONTMATTER_BYTES)).text,
            )
        } catch {
            return undefined
        }
    }
    const { data } = parseFrontmatter(text)
    return isVisibilityLiteral(data.visibility) ? data.visibility : undefined
}

/** Memoized per-directory folder-cascade lookup: many files share a directory, and
 *  resolveFolderVisibility's ancestor walk would otherwise be redone once per file for nothing. */
function cascadeForDir(
    dir: string,
    folderVisibility: Record<string, Visibility>,
    cache: Map<string, Visibility>,
): Visibility {
    let v = cache.get(dir)
    if (v === undefined) {
        v = resolveFolderVisibility(dir, folderVisibility)
        cache.set(dir, v)
    }
    return v
}

function splitRelPath(rel: string): { dir: string; base: string } {
    const idx = rel.lastIndexOf('/')
    return idx === -1
        ? { dir: '', base: rel }
        : { dir: rel.slice(0, idx), base: rel.slice(idx + 1) }
}

/** The part of a basename before its FIRST dot — "sketch.draw.png" and "sketch.draw" both stem
 *  to "sketch", which is what lets applyStemInheritance catch export sidecars. A LEADING dot is
 *  treated as part of the name, not a separator (a dotfile like ".env" stems to itself, not to
 *  ""), so unrelated dotfiles in the same directory don't collide on an empty stem. */
function preDotStem(base: string): string {
    const start = base.startsWith('.') ? 1 : 0
    const idx = base.indexOf('.', start)
    return idx === -1 ? base : base.slice(0, idx)
}

const VISIBILITY_RANK: Record<Visibility, number> = {
    all: 0,
    'chat-only': 1,
    hidden: 2,
}

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
        let strictest: Visibility = 'all'
        for (const f of group)
            if (VISIBILITY_RANK[f.visibility] > VISIBILITY_RANK[strictest])
                strictest = f.visibility
        if (strictest === 'all') continue
        for (const f of group) {
            if (
                !f.explicit &&
                VISIBILITY_RANK[strictest] > VISIBILITY_RANK[f.visibility]
            )
                f.visibility = strictest
        }
    }
}

/**
 * One restricted note — ONE entry per restricted file, so `entries.length` is a count of notes and
 * can be shown to a user as one.
 *
 * `abs` is the file's path under the canonical vault root. That is not always the only absolute
 * path it is readable at: a file under a symlinked DIRECTORY is equally readable at the path with
 * the link resolved, and which of the two a tool reports depends on whether it resolved the link.
 * The other spellings go in `aliases`, and every consumer that emits absolute paths (absDenyPaths,
 * buildManagedSettingsDeny, denyPathSet, the isDeniedPath index) emits all of them.
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
 * The result of a visibility walk, with its third state made explicit.
 *
 * `determined: false` is NOT "nothing is restricted". It is "this vault did not tell us what is
 * restricted" — an unreadable subtree, a `.settings` that does not parse, a root that isn't there.
 * The two used to be the same value (`[]`), which meant every fail-safe written against the walk
 * — `sandboxFailIfUnavailable`, `sandboxDenyRead`'s `.git` deny, the CLI gate's refusal,
 * `resolveVisibilityGate`'s "an unreadable vault refuses" — silently reported "unrestricted" for a
 * vault it had simply failed to read. A boundary that opens when it malfunctions is worse than one
 * that is absent, because it is trusted; the type is what keeps a consumer from spelling that bug
 * again.
 */
export type DenyPlan =
    | { determined: true; entries: DenyEntry[] }
    | { determined: false; reason: string }

/** Bounded-concurrency map: `Promise.all` over thousands of files would open that many file
 *  descriptors at once and risk EMFILE on a large vault; this caps how many `readOwnVisibility`
 *  calls are in flight together while still reading every file's head in parallel, not serially
 *  (serial whole-file reads were the old implementation's actual performance bug). */
async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let next = 0
    const workers = Array.from(
        { length: Math.min(limit, items.length) },
        async () => {
            for (let i = next++; i < items.length; i = next++) {
                results[i] = await fn(items[i]!)
            }
        },
    )
    await Promise.all(workers)
    return results
}

const READ_CONCURRENCY = 64

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
export async function resolveDenyPlan(
    root: string,
    channel: VisibilityChannel,
    opts: WalkLimits = {},
): Promise<DenyPlan> {
    try {
        return {
            determined: true,
            entries: await walkDenyEntries(root, channel, opts),
        }
    } catch (e) {
        if (e instanceof VisibilityUndeterminedError)
            return { determined: false, reason: e.message }
        throw e
    }
}

/**
 * {@link resolveDenyPlan}'s entries, or a thrown {@link VisibilityUndeterminedError}.
 *
 * For the callers whose response to "we cannot tell" is already to refuse and say so — the chat
 * drivers, the CLI gate, the HTTP route dispatch, the daemon's sendMessage. Anything that wants to
 * branch on the reason should call resolveDenyPlan instead. What no caller can do any more is
 * receive an empty list for a vault that was never read.
 */
export async function buildDenyPaths(
    root: string,
    channel: VisibilityChannel,
    opts: WalkLimits = {},
): Promise<DenyEntry[]> {
    return walkDenyEntries(root, channel, opts)
}

async function walkDenyEntries(
    root: string,
    channel: VisibilityChannel,
    opts: WalkLimits = {},
): Promise<DenyEntry[]> {
    const folders = await readFolderVisibilityResult(root)
    // A `.settings` that exists but does not parse is the single sharpest instance of the
    // determined/undetermined confusion: `folderVisibility: {Private: hidden}` and a syntax error two
    // lines below it both used to yield `{}`, so appending one stray character to the settings file
    // silently un-hid every folder-hidden note with no error and no change to the sidebar badge.
    if (!folders.ok) throw new VisibilityUndeterminedError(folders.reason)
    const folderVisibility = folders.map
    // Canonicalize the root before joining: the SDK's own tools resolve symlinks in the paths they
    // report (e.g. on macOS a vault under a tmp dir is really under /private/var or /private/tmp),
    // so a deny path built from a non-canonical root would silently never match theirs and the
    // "deny" would be a no-op. A root that cannot be resolved is undetermined for the same reason
    // the walk is: every absolute deny path we would emit could be one no tool ever reports.
    const canonicalRoot = await realpath(root).catch((e: unknown) => {
        throw new VisibilityUndeterminedError(
            `cannot resolve the vault root ${root}: ${e instanceof Error ? e.message : String(e)}`,
        )
    })
    const walked = await listVisibilityFiles(
        root,
        canonicalRoot,
        opts.maxEntries,
    )
    const cascadeCache = new Map<string, Visibility>()

    const resolved = await mapWithConcurrency(
        walked,
        READ_CONCURRENCY,
        async (file): Promise<ResolvedFile> => {
            const { rel, canonicalAbs } = file
            const { dir, base } = splitRelPath(rel)
            // Memory notes (.daemon/memory/**) are gated by their OWN frontmatter only, NEVER folder
            // cascade — this keeps the native-tool deny list in agreement with the `recall` MCP tool /
            // searchMemory, which filter memory notes by frontmatter visibility and know nothing of the
            // folder-visibility map (documented in docs/vault/visibility.md). Applying the cascade here
            // would deny reading a memory .md that recall would still surface — a badge/enforcement split.
            const memoryNote =
                rel === '.daemon/memory' || rel.startsWith('.daemon/memory/')
            const cascade = memoryNote
                ? 'all'
                : cascadeForDir(dir, folderVisibility, cascadeCache)
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
        },
    )

    applyStemInheritance(resolved)

    // The absolute spellings one restricted file is readable at, deduped, minus `abs` itself.
    //
    // Two produce an alias, and both are the same class of aliasing:
    //  - a symlinked DIRECTORY on the way to the file (canonicalAbs), and
    //  - the CALLER's own spelling of the vault root, when it differs from the canonical one. On
    //    macOS a vault opened as `/var/…` or `/tmp/…` canonicalizes to `/private/var/…` through a
    //    firmlink, and a tool reporting the path the session was actually started with would have
    //    matched nothing at all. Vaults under /Users are unaffected, which is why this hid so well.
    return (
        resolved
            .filter(f => !isVisibleToChannel(f.visibility, channel))
            // One ENTRY per file — `entries.length` stays a count of NOTES, which is what the refusal
            // messages report — with the other spellings in `aliases` (absent in an ordinary vault).
            // Both candidates collapse into `abs` for a vault with no symlink and a canonical root, so the
            // dedupe below is what makes this a no-op there; no separate "are they equal" branch is needed.
            .map(f => {
                const aliases = [
                    ...new Set([f.canonicalAbs, join(root, f.rel)]),
                ].filter(a => a !== f.abs)
                return aliases.length === 0
                    ? { rel: f.rel, abs: f.abs }
                    : { rel: f.rel, abs: f.abs, aliases }
            })
    )
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
    return entries.flatMap(e =>
        [e.rel, ...absForms(e)].flatMap(path =>
            (['Read', 'Edit', 'Grep', 'Glob'] as const).map(
                tool => `${tool}(${path})`,
            ),
        ),
    )
}

/** The absolute paths only — what `sandbox.filesystem.denyRead` requires. Every spelling of every
 *  entry (see {@link DenyEntry.aliases}), not one per file. */
export function absDenyPaths(entries: DenyEntry[]): string[] {
    return entries.flatMap(absForms)
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
export function sandboxDenyRead(
    entries: DenyEntry[],
    vaultRoot: string,
): string[] {
    if (entries.length === 0) return []
    return [...absDenyPaths(entries), join(vaultRoot, '.git')]
}

/**
 * THE deny-read list every agent spawn uses: {@link sandboxDenyRead} plus the owner-token run
 * record (`ownerToken.ts`'s {@link ownerTokenDenyPath}).
 *
 * The token is the one file whose contents defeat every other layer at once. It grants an HTTP
 * caller the `"owner"` channel — no visibility filter at all — and it lives OUTSIDE the vault
 * (`~/.bismuth/run/<vault>.json`), so nothing derived from the vault walk can reach it. Its mode is
 * 0600, which stops another user and not the agent: a chat/daemon session runs as the same uid that
 * wrote it. An agent that reads that file and replays it in `X-Bismuth-Token` gets back exactly the
 * notes the rest of this module exists to withhold.
 *
 * Single composition point on purpose. Every spawn that carries a read-deny list — chat.ts's
 * `buildChatSandboxOption`, the daemon's `buildQueryOptions`, the Seatbelt wrapper for non-Claude
 * backends — resolves it here, so the token cannot be covered on one path and missed on another.
 * (The daemon workspace cannot import `@bismuth/core`; its ported copy of this module holds the
 * mirror, pinned to this one by a parity test in `core/test/ownerToken.test.ts`.)
 *
 * Gated on `entries.length > 0`, like everything else here. That gate is not a weakening: an
 * unrestricted vault is spawned with NO sandbox at all (both `buildChatSandboxOption` and
 * `buildQueryOptions` omit the option entirely), so there is no profile a token deny could ride in
 * on, and nothing for it to protect — the vault hides nothing, and the HTTP surface serves that
 * same nothing unfiltered to a tokenless caller already.
 */
export function buildSandboxDenyPaths(
    entries: DenyEntry[],
    vaultRoot: string,
): string[] {
    const base = sandboxDenyRead(entries, vaultRoot)
    if (base.length === 0) return []
    return [...base, ...ownerTokenDenyPaths(vaultRoot)]
}

/**
 * Pure: `sandbox.failIfUnavailable` for a spawn — whether a sandbox that can't start should hard-
 * fail the session rather than silently degrade to running unsandboxed. Measured (2026-07-30, see
 * docs/vault/visibility.md + docs/vault/visibility-acceptance.md's second run): both `chat.ts` and
 * `daemon/session.ts` used to pass a FIXED `false` here, so a session whose OS sandbox couldn't
 * start ran anyway — leaving only `managedSettings.permissions.deny`, which restricts the Read/
 * Edit/Grep/Glob tool CALLING CONVENTION and does nothing at all to a raw Bash subprocess
 * (`bismuth read`, `cat`, `python3 -c`). A live probe confirmed the OS sandbox is what actually
 * stops those — `managedSettings` never touches Bash's argv.
 *
 * Conditional, never a fixed `true`: an UNRESTRICTED vault (nothing in `entries`) must keep
 * working exactly as today on a machine where the sandbox can't start at all — failing every chat
 * there would be a regression worse than the leak this closes. A restricted vault, on the other
 * hand, would rather refuse to open the session than open it silently unprotected.
 */
export function sandboxFailIfUnavailable(entries: DenyEntry[]): boolean {
    return entries.length > 0
}

/** Both path forms of every entry, for an O(1) same-process membership check (e.g. a
 *  canUseTool's `toolInput.file_path`, which may itself be relative OR absolute).
 *
 *  Prefer {@link isDeniedPath} for checking a path a MODEL supplied — a raw `Set.has()` is an exact
 *  byte comparison, and a tool call's path is not guaranteed to be byte-identical to ours. */
export function denyPathSet(entries: DenyEntry[]): Set<string> {
    const s = new Set<string>()
    for (const e of entries) {
        s.add(e.rel)
        for (const abs of absForms(e)) s.add(abs)
    }
    return s
}

/**
 * Reduce a path to a comparison key: resolve `.` and `..` segments, collapse repeated and trailing
 * slashes, normalize to Unicode NFC, and case-fold.
 *
 * Two paths that open the same file must produce the same key, and a filesystem offers several ways
 * to spell one file. Three are handled here, all three verified against a real vault to open the
 * hidden note under both spellings while the deny check answered differently:
 *
 *  - SEGMENTS. `Private/./secret.md` and `Private/../Private/secret.md` name the same file as
 *    `Private/secret.md`. `resolveInVault` (core/src/files.ts) resolves them before its containment
 *    check, so the read succeeds; a comparison that only stripped a LEADING `./` did not, so every
 *    deny check answered false for a file it was holding open.
 *  - UNICODE FORM. macOS stores `café.md` decomposed (NFD) when created through some tools and
 *    composed (NFC) through others, and APFS opens the file under either. The two are different
 *    strings.
 *  - CASE. macOS filesystems are case-insensitive by default, so `Private/SECRET.md` opens the same
 *    file as `Private/secret.md`.
 *
 * CASE and UNICODE FORM are pure widenings, and both carry the same cost: a false POSITIVE on a
 * filesystem that would in fact distinguish the two spellings — a case-sensitive volume holding two
 * notes differing only in case, or an NFC and an NFD file of the same name side by side, one hidden
 * and one not. Those vaults are vanishingly rare against leaks that are trivial to trigger, so the
 * trade goes this way; it is a trade, and it is written down rather than left to be rediscovered.
 *
 * SEGMENT RESOLUTION IS NOT A WIDENING, and calling it one would be wrong in a way that matters.
 * It re-points the comparison at a different question: not "does this string contain a restricted
 * path?" but "does this path RESOLVE to one?" — the same question `resolveInVault` (core/src/files.ts)
 * answers before it opens anything, by the same lexical `path.resolve` rules. That makes it deny
 * more in most cases and LESS in a few, and the few are the point:
 *
 *   `Private/secret.md/../other.md` resolves to `Private/other.md`
 *   `Private/secret.md/../../other.md` resolves to `other.md` — a VISIBLE note
 *
 * Both used to be denied, purely because the restricted path survived in them as a verbatim
 * substring; neither can reach the hidden file, because `..` is resolved lexically and never
 * traverses into `secret.md` at all. Denying them was the bug. Pinned by test, in both directions,
 * against what the filesystem actually returns rather than against this paragraph.
 *
 * A leading `..` that cannot be resolved (the path reaches above its own base) is KEPT, so the key
 * stays distinct from the same path without it. isDeniedPath resolves those against the vault root
 * separately.
 *
 * What this does NOT do, and no string comparison can: it does not follow symlinks, hard links, or
 * `/private` vs `/var`-style firmlink aliases at compare time. Those are handled where they can be —
 * the walk resolves symlinked directories and emits every reachable spelling as its own entry. This
 * remains an honesty boundary, not a security boundary: it closes the spellings a model reaches for,
 * not the ones a process determined to get at the file could construct.
 */
export function normalizeForCompare(p: string): string {
    const rooted = p.startsWith('/')
    const segs: string[] = []
    for (const seg of p.split('/')) {
        if (seg === '' || seg === '.') continue
        if (seg === '..') {
            const last = segs[segs.length - 1]
            if (last !== undefined && last !== '..') segs.pop()
            else if (!rooted) segs.push('..') // no base to climb above — keep it and stay distinct
            // rooted: ".." above "/" is "/" itself, so drop it
            continue
        }
        segs.push(seg)
    }
    return ((rooted ? '/' : '') + segs.join('/')).toLowerCase().normalize('NFC')
}

/** Precomputed comparison keys for one entry list, cached per array identity. Callers pass the same
 *  `DenyEntry[]` for every candidate (a session's entries, a request's memoized walk), and
 *  filterGraph checks one list against every node in the graph — normalizing the entries once per
 *  list instead of once per candidate is what keeps that from being quadratic in string work. */
interface DenyIndex {
    /** Normalized `rel` and `abs` of every entry, paired with the entry itself. */
    keys: Array<{ key: string; entry: DenyEntry }>
    /** Normalized absolute vault root, when derivable — see findDeniedEntry. */
    root: string | null
}
const denyIndexCache = new WeakMap<DenyEntry[], DenyIndex>()

function denyIndex(entries: DenyEntry[]): DenyIndex {
    const hit = denyIndexCache.get(entries)
    if (hit) return hit
    const keys: DenyIndex['keys'] = []
    let root: string | null = null
    for (const e of entries) {
        for (const form of [e.rel, ...absForms(e)]) {
            const key = normalizeForCompare(form)
            if (key) keys.push({ key, entry: e })
        }
        // Recover the vault root: `abs` is always `<canonicalRoot>/<rel>` (aliases are the spellings
        // that aren't), so stripping the rel path off it leaves the root.
        if (root === null) {
            const a = normalizeForCompare(e.abs)
            const r = normalizeForCompare(e.rel)
            if (a && r && a.endsWith(`/${r}`))
                root = a.slice(0, a.length - r.length - 1)
        }
    }
    const index = { keys, root }
    denyIndexCache.set(entries, index)
    return index
}

/**
 * The restricted entry `candidate` names, or undefined. `candidate` is a path as some MODEL
 * reported it — relative or absolute, any case, any Unicode form, with `.`/`..` segments in it.
 *
 * Also matches a path that lies UNDER a restricted entry, so a directory-shaped deny covers the
 * files inside it rather than only an exact hit on the directory itself.
 *
 * A relative candidate is checked twice: as written (against the entries' relative forms) and
 * resolved against the vault root (against their absolute forms). The second is what catches
 * `../<vaultname>/Private/secret.md` — a relative path that climbs out of the vault and back in,
 * which `resolveInVault` resolves and opens.
 */
export function findDeniedEntry(
    entries: DenyEntry[],
    candidate: string,
): DenyEntry | undefined {
    if (entries.length === 0) return undefined
    const { keys, root } = denyIndex(entries)
    const forms: string[] = []
    const c = normalizeForCompare(candidate)
    if (c) forms.push(c)
    if (root !== null && !candidate.startsWith('/')) {
        const resolved = normalizeForCompare(`${root}/${candidate}`)
        if (resolved && resolved !== c) forms.push(resolved)
    }
    if (forms.length === 0) return undefined
    for (const { key, entry } of keys) {
        for (const form of forms) {
            if (form === key || form.startsWith(`${key}/`)) return entry
        }
    }
    return undefined
}

/** Is `candidate` one of the restricted entries? See {@link findDeniedEntry} — use this for every
 *  gate that inspects a tool call's path. */
export function isDeniedPath(entries: DenyEntry[], candidate: string): boolean {
    return findDeniedEntry(entries, candidate) !== undefined
}
