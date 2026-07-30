// core/test/visibility.test.ts
import { test, expect } from "bun:test";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import {
  resolveVisibility,
  resolveFolderVisibility,
  isVisibleToChat,
  isVisibleToDaemon,
  buildDenyPaths,
  buildManagedSettingsDeny,
  absDenyPaths,
  denyPathSet,
  type DenyEntry,
  isDeniedPath,
  sandboxFailIfUnavailable,
} from "../src/visibility";
import { setFolderVisibility, readFolderVisibility } from "../src/settings";
import { makeVault } from "./helpers";

// --- resolveVisibility (files) ---

test("resolveVisibility: absence with no folder rules inherits to 'all'", () => {
  expect(resolveVisibility("notes/a.md", undefined, {})).toBe("all");
});

test("resolveVisibility: absence inherits the nearest ancestor folder's setting", () => {
  const folders = { "notes/private": "hidden" as const };
  expect(resolveVisibility("notes/private/a.md", undefined, folders)).toBe("hidden");
});

test("resolveVisibility: nearest ancestor wins over a shallower one", () => {
  const folders = { notes: "hidden" as const, "notes/private": "chat-only" as const };
  expect(resolveVisibility("notes/private/a.md", undefined, folders)).toBe("chat-only");
  // A sibling file directly under the shallower folder still inherits the shallow rule.
  expect(resolveVisibility("notes/b.md", undefined, folders)).toBe("hidden");
});

test("resolveVisibility: explicit file value overrides an ancestor folder's rule", () => {
  const folders = { "notes/private": "hidden" as const };
  expect(resolveVisibility("notes/private/a.md", "all", folders)).toBe("all");
  expect(resolveVisibility("notes/private/a.md", "chat-only", folders)).toBe("chat-only");
});

test("resolveVisibility: explicit file value wins even with no folder rules at all", () => {
  expect(resolveVisibility("a.md", "hidden", {})).toBe("hidden");
});

test("resolveVisibility: a root-level file with no ancestors inherits 'all'", () => {
  expect(resolveVisibility("a.md", undefined, { notes: "hidden" })).toBe("all");
});

test("resolveVisibility: a file re-resolves instantly when its path moves in/out of a restricted folder", () => {
  const folders = { private: "hidden" as const };
  // Same file, before the move (outside the restricted folder):
  expect(resolveVisibility("a.md", undefined, folders)).toBe("all");
  // ...and after being moved into it (no stamping/migration — just a new path):
  expect(resolveVisibility("private/a.md", undefined, folders)).toBe("hidden");
  // ...and moved back out:
  expect(resolveVisibility("a.md", undefined, folders)).toBe("all");
});

// --- resolveFolderVisibility (dirs) ---

test("resolveFolderVisibility: a folder's own entry wins over its parent's", () => {
  const folders = { notes: "hidden" as const, "notes/private": "chat-only" as const };
  expect(resolveFolderVisibility("notes/private", folders)).toBe("chat-only");
});

test("resolveFolderVisibility: inherits from an ancestor when it has no entry of its own", () => {
  const folders = { notes: "hidden" as const };
  expect(resolveFolderVisibility("notes/private", folders)).toBe("hidden");
});

test("resolveFolderVisibility: 'all' when neither it nor any ancestor has a rule", () => {
  expect(resolveFolderVisibility("notes/private", {})).toBe("all");
});

// --- channel predicates ---

test("isVisibleToChat: true for 'all' and 'chat-only', false for 'hidden'", () => {
  expect(isVisibleToChat("all")).toBe(true);
  expect(isVisibleToChat("chat-only")).toBe(true);
  expect(isVisibleToChat("hidden")).toBe(false);
});

test("isVisibleToDaemon: true only for 'all'", () => {
  expect(isVisibleToDaemon("all")).toBe(true);
  expect(isVisibleToDaemon("chat-only")).toBe(false);
  expect(isVisibleToDaemon("hidden")).toBe(false);
});

// --- buildDenyPaths (I/O: walks a real vault + settings.yaml) ---
//
// `vault` (from makeVault) is a raw mkdtemp path, which on macOS can itself sit behind a
// symlink (/tmp, /var → /private/...). buildDenyPaths canonicalizes internally (the SDK's own
// tools report canonical paths — see chat.ts's comment on the same issue, found by the
// visibility-controls Step-0 spike), so `.abs` is compared against the REALPATH of the vault,
// not the raw one, or this test would flake exactly the way the live chat test first did.

async function realVault(vault: string): Promise<string> {
  return realpath(vault);
}

test("buildDenyPaths: empty vault with no visibility rules denies nothing", async () => {
  const vault = makeVault({ "a.md": "# A\n" });
  expect(await buildDenyPaths(vault, "chat")).toEqual([]);
  expect(await buildDenyPaths(vault, "daemon")).toEqual([]);
});

test("buildDenyPaths: 'hidden' file denies for both channels; 'chat-only' denies only the daemon", async () => {
  const vault = makeVault({
    "secret.md": "---\nvisibility: hidden\n---\n# Secret\n",
    "draft.md": "---\nvisibility: chat-only\n---\n# Draft\n",
    "public.md": "# Public\n",
  });
  const root = await realVault(vault);
  const chatDeny = await buildDenyPaths(vault, "chat");
  const daemonDeny = await buildDenyPaths(vault, "daemon");
  expect(chatDeny).toEqual([{ rel: "secret.md", abs: join(root, "secret.md") }]);
  expect([...daemonDeny].sort((a, b) => a.rel.localeCompare(b.rel))).toEqual(
    [{ rel: "draft.md", abs: join(root, "draft.md") }, { rel: "secret.md", abs: join(root, "secret.md") }].sort((a, b) =>
      a.rel.localeCompare(b.rel),
    ),
  );
});

test("buildDenyPaths: folder-level rule cascades to files with no explicit visibility", async () => {
  const vault = makeVault({
    "private/a.md": "# A\n",
    "private/b.md": "# B\n",
    "public.md": "# Public\n",
  });
  await setFolderVisibility(vault, "private", "hidden");
  const root = await realVault(vault);
  const denied = await buildDenyPaths(vault, "chat");
  expect([...denied].sort((a, b) => a.rel.localeCompare(b.rel))).toEqual(
    [{ rel: "private/a.md", abs: join(root, "private/a.md") }, { rel: "private/b.md", abs: join(root, "private/b.md") }].sort(
      (a, b) => a.rel.localeCompare(b.rel),
    ),
  );
});

test("buildDenyPaths: an explicit file override inside a hidden folder is honored (not denied)", async () => {
  const vault = makeVault({
    "private/a.md": "# A\n",
    "private/exposed.md": "---\nvisibility: all\n---\n# Exposed\n",
  });
  await setFolderVisibility(vault, "private", "hidden");
  const root = await realVault(vault);
  const denied = await buildDenyPaths(vault, "chat");
  expect(denied).toEqual([{ rel: "private/a.md", abs: join(root, "private/a.md") }]);
});

test("buildDenyPaths: includes .daemon memory notes (ordinary vault files under the same frontmatter path)", async () => {
  const vault = makeVault({
    ".daemon/memory/note.md": "---\nvisibility: hidden\n---\nSome memory\n",
  });
  const root = await realVault(vault);
  const denied = await buildDenyPaths(vault, "chat");
  expect(denied).toEqual([{ rel: ".daemon/memory/note.md", abs: join(root, ".daemon/memory/note.md") }]);
});

// --- buildManagedSettingsDeny / absDenyPaths / denyPathSet ---
//
// buildManagedSettingsDeny's dual-form output is the fix for a real bug caught live: Claude
// Code's Read tool does not consistently resolve a relative `file_path` against an absolute
// deny pattern — a model asked to read "secret.md in the current directory" may call Read with
// file_path: "secret.md" (bare relative) just as often as the resolved absolute path. A rule
// keyed on only one form silently failed to match the other (see core/test/chat.test.ts's live
// "visibility" test and the git history for the empirical repro).

const SAMPLE_ENTRIES: DenyEntry[] = [
  { rel: "secret.md", abs: "/vault/secret.md" },
  { rel: "private/b.md", abs: "/vault/private/b.md" },
];

test("buildManagedSettingsDeny: emits Read/Edit/Grep/Glob rules for BOTH the relative and absolute form of every entry", () => {
  const deny = buildManagedSettingsDeny(SAMPLE_ENTRIES);
  for (const tool of ["Read", "Edit", "Grep", "Glob"]) {
    expect(deny).toContain(`${tool}(secret.md)`);
    expect(deny).toContain(`${tool}(/vault/secret.md)`);
    expect(deny).toContain(`${tool}(private/b.md)`);
    expect(deny).toContain(`${tool}(/vault/private/b.md)`);
  }
  expect(deny.length).toBe(SAMPLE_ENTRIES.length * 4 * 2);
});

test("buildManagedSettingsDeny: empty entries → empty deny list", () => {
  expect(buildManagedSettingsDeny([])).toEqual([]);
});

test("absDenyPaths: pulls just the absolute form, in order", () => {
  expect(absDenyPaths(SAMPLE_ENTRIES)).toEqual(["/vault/secret.md", "/vault/private/b.md"]);
});

test("denyPathSet: contains BOTH forms of every entry, for either-shape lookup", () => {
  const set = denyPathSet(SAMPLE_ENTRIES);
  expect(set.has("secret.md")).toBe(true);
  expect(set.has("/vault/secret.md")).toBe(true);
  expect(set.has("private/b.md")).toBe(true);
  expect(set.has("/vault/private/b.md")).toBe(true);
  expect(set.has("nope.md")).toBe(false);
  expect(set.size).toBe(4);
});

// sandbox.failIfUnavailable (2026-07-30 measurement, docs/vault/visibility.md +
// visibility-acceptance.md): a fixed `false` here let a session whose OS sandbox couldn't start
// run anyway with only managedSettings standing guard — which does nothing to a raw Bash `cat`/
// `bismuth read`/`python3 -c`. Both chat.ts and daemon/session.ts now compute this from the deny
// list instead of hardcoding it, so a restricted vault fails closed while an unrestricted one
// keeps working on a machine where the sandbox can't start at all.
test("sandboxFailIfUnavailable: true when the vault restricts something", () => {
  expect(sandboxFailIfUnavailable(SAMPLE_ENTRIES)).toBe(true);
  expect(sandboxFailIfUnavailable([SAMPLE_ENTRIES[0]])).toBe(true);
});

test("sandboxFailIfUnavailable: false when nothing is restricted — an unrestricted vault must not start failing chats just because sandboxing is unavailable on this machine", () => {
  expect(sandboxFailIfUnavailable([])).toBe(false);
});

// --- review-fix regressions: non-md files, trailing-slash keys, memory-note cascade ---

test("buildDenyPaths: a folder rule covers NON-markdown files too (badge vs deny must agree)", async () => {
  const vault = makeVault({
    "private/notes.md": "# Notes\n",
    "private/data.yaml": "key: value\n",
    "private/scan.png": "\x89PNG binary-ish",
    "public.md": "# Public\n",
  });
  await setFolderVisibility(vault, "private", "hidden");
  const root = await realVault(vault);
  const denied = (await buildDenyPaths(vault, "chat")).map((e) => e.rel).sort();
  // The .yaml and .png in the hidden folder are denied, not just the .md — matching the tree badge.
  expect(denied).toEqual(["private/data.yaml", "private/notes.md", "private/scan.png"]);
  // sanity: absolute forms are canonical
  expect((await buildDenyPaths(vault, "chat")).every((e) => e.abs.startsWith(root))).toBe(true);
});

test("buildDenyPaths: a .draw.png / .draw.pdf export sidecar of a hidden drawing IS denied (regression: it used to be explicitly excluded as an 'export artifact')", async () => {
  const vault = makeVault({
    "private/sketch.draw.png": "binary",
    "private/real.md": "# Real\n",
  });
  await setFolderVisibility(vault, "private", "hidden");
  const denied = (await buildDenyPaths(vault, "chat")).map((e) => e.rel).sort();
  expect(denied).toEqual(["private/real.md", "private/sketch.draw.png"]);
});

test("setFolderVisibility + resolveVisibility: a trailing-slash folder key still enforces", async () => {
  const vault = makeVault({ "Private/secret.md": "# S\n" });
  const persisted = await setFolderVisibility(vault, "Private/", "hidden"); // trailing slash (CLI/tab-complete)
  expect(persisted).toBe(true);
  const map = await readFolderVisibility(vault);
  expect(resolveVisibility("Private/secret.md", undefined, map)).toBe("hidden");
  // and the deny list actually restricts it
  expect((await buildDenyPaths(vault, "chat")).map((e) => e.rel)).toContain("Private/secret.md");
});

test("buildDenyPaths: a memory note under .daemon/memory is gated by its OWN frontmatter, never folder cascade", async () => {
  const vault = makeVault({
    ".daemon/memory/fact.md": "# a plain memory note\n",
    ".daemon/memory/hushed.md": "---\nvisibility: hidden\n---\n# secret memory\n",
  });
  // A folder rule on .daemon/memory must NOT cascade (recall doesn't know the folder map — see F).
  await setFolderVisibility(vault, ".daemon/memory", "hidden");
  const denied = (await buildDenyPaths(vault, "daemon")).map((e) => e.rel).sort();
  // Only the note with explicit frontmatter is denied; the cascade is ignored under .daemon/memory.
  expect(denied).toEqual([".daemon/memory/hushed.md"]);
});

// --- isDeniedPath: the matcher every gate that inspects a MODEL-supplied path must use ----------
// A raw `denyPathSet(...).has(p)` is an exact byte comparison. Red-teaming the shipped chat.ts check
// found that a differently-cased path walks straight through it on macOS, where the filesystem is
// case-insensitive so both spellings open the same file.

const ENTRIES = [{ rel: "Private/secret.md", abs: "/v/Private/secret.md" }];

test("isDeniedPath matches the exact relative and absolute forms", () => {
  expect(isDeniedPath(ENTRIES, "Private/secret.md")).toBe(true);
  expect(isDeniedPath(ENTRIES, "/v/Private/secret.md")).toBe(true);
});

test("isDeniedPath matches a DIFFERENTLY-CASED path — the verified bypass", () => {
  expect(isDeniedPath(ENTRIES, "private/SECRET.md")).toBe(true);
  expect(isDeniedPath(ENTRIES, "/V/PRIVATE/Secret.MD")).toBe(true);
});

test("isDeniedPath tolerates the shapes a model actually emits", () => {
  expect(isDeniedPath(ENTRIES, "./Private/secret.md")).toBe(true);
  expect(isDeniedPath(ENTRIES, "Private//secret.md")).toBe(true);
});

test("isDeniedPath matches a path UNDER a restricted directory entry", () => {
  const dirs = [{ rel: "Private", abs: "/v/Private" }];
  expect(isDeniedPath(dirs, "Private/deep/nested.md")).toBe(true);
  expect(isDeniedPath(dirs, "/v/Private/deep/nested.md")).toBe(true);
});

test("isDeniedPath does not match an unrelated path, or a mere prefix collision", () => {
  expect(isDeniedPath(ENTRIES, "Public/secret.md")).toBe(false);
  expect(isDeniedPath(ENTRIES, "open.md")).toBe(false);
  // "Private2" must NOT match a "Private" entry — the subpath check needs the separator.
  expect(isDeniedPath([{ rel: "Private", abs: "/v/Private" }], "Private2/x.md")).toBe(false);
});

test("isDeniedPath is safe on empty input", () => {
  expect(isDeniedPath([], "anything.md")).toBe(false);
  expect(isDeniedPath(ENTRIES, "")).toBe(false);
});

// --- discovery-walk fixes: extension allowlist, dot-directories, frontmatter on any extension,
// export-sidecar stem inheritance, 512-byte head escalation. Each of these fails against the OLD
// implementation (isTreeSurfacedFile's extension allowlist + isMd-gated frontmatter reads).

test("buildDenyPaths: EVERY extension inside a hidden folder is denied, not just the recognized note types (T-D1)", async () => {
  const vault = makeVault({
    "priv/note.md": "# Note\n",
    "priv/notes.txt": "some plain text, no frontmatter\n",
    "priv/data.json": '{"k":"v"}\n',
    "priv/sketch.draw": "drawing json blob\n",
    "priv/sketch.draw.png": "binary\n",
    "public.md": "# Public\n",
  });
  await setFolderVisibility(vault, "priv", "hidden");
  const denied = (await buildDenyPaths(vault, "chat")).map((e) => e.rel).sort();
  expect(denied).toEqual([
    "priv/data.json",
    "priv/note.md",
    "priv/notes.txt",
    "priv/sketch.draw",
    "priv/sketch.draw.png",
  ]);
});

test("buildDenyPaths: an explicit visibility: all override inside the same hidden folder still exempts that one file", async () => {
  const vault = makeVault({
    "priv/note.md": "# Note\n",
    "priv/notes.txt": "plain text\n",
    "priv/exposed.md": "---\nvisibility: all\n---\n# Exposed\n",
  });
  await setFolderVisibility(vault, "priv", "hidden");
  const denied = (await buildDenyPaths(vault, "chat")).map((e) => e.rel).sort();
  expect(denied).toEqual(["priv/note.md", "priv/notes.txt"]);
});

test("buildDenyPaths: a note stashed in a DOT-DIRECTORY is still walked and denied (dot-dirs are no longer skipped wholesale)", async () => {
  const vault = makeVault({
    ".stash/inside.md": "---\nvisibility: hidden\n---\n# Stashed\n",
    "public.md": "# Public\n",
  });
  const denied = (await buildDenyPaths(vault, "chat")).map((e) => e.rel).sort();
  expect(denied).toEqual([".stash/inside.md"]);
});

test("buildDenyPaths: .git and .settings are still excluded from the walk (not treated as vault content)", async () => {
  const vault = makeVault({
    ".git/HEAD": "ref: refs/heads/main\n",
    ".settings": "folderVisibility: {}\n",
    "public.md": "# Public\n",
  });
  const denied = (await buildDenyPaths(vault, "chat")).map((e) => e.rel).sort();
  expect(denied).toEqual([]);
});

test("buildDenyPaths: a hidden note's frontmatter is honored on a NON-.md extension too (copy/rename/hard-link carry the same bytes)", async () => {
  const secretBody = "---\nvisibility: hidden\n---\n# Secret\nTOKEN-9001\n";
  const vault = makeVault({
    "secret.md": secretBody,
    // Same frontmatter bytes, untracked extensions, no folder rule involved at all — the OLD
    // isMd-gated read never opened these, so they leaked regardless of extension widening.
    "secret-copy.txt": secretBody,
    "secret.json": secretBody,
  });
  const denied = (await buildDenyPaths(vault, "chat")).map((e) => e.rel).sort();
  expect(denied).toEqual(["secret-copy.txt", "secret.json", "secret.md"]);
});

test("buildDenyPaths: a hard-linked copy of a hidden note is denied too (same inode, different name/extension)", async () => {
  const vault = makeVault({ "secret.md": "---\nvisibility: hidden\n---\n# Secret\n" });
  const { linkSync } = await import("node:fs");
  linkSync(join(vault, "secret.md"), join(vault, "secret-hard.txt"));
  const denied = (await buildDenyPaths(vault, "chat")).map((e) => e.rel).sort();
  expect(denied).toEqual(["secret-hard.txt", "secret.md"]);
});

test("buildDenyPaths: frontmatter whose closing fence lies PAST the 512-byte head is still parsed (head-read escalates to a bigger read)", async () => {
  // Pad the frontmatter well past 512 bytes with an inert filler key before the real value, so
  // the closing `---` cannot possibly be within the first read.
  const filler = "notes: |\n" + Array.from({ length: 40 }, (_, i) => `  line ${i} filler filler filler filler`).join("\n") + "\n";
  const body = `---\n${filler}visibility: hidden\n---\n# Big frontmatter\n`;
  expect(body.indexOf("---", 4)).toBeGreaterThan(512); // sanity: the fixture actually exercises escalation
  const vault = makeVault({ "big.md": body });
  const denied = (await buildDenyPaths(vault, "chat")).map((e) => e.rel);
  expect(denied).toEqual(["big.md"]);
});

test("buildDenyPaths: frontmatter whose closing fence lies past even the 64 KiB escalation ceiling is NOT parsed (fails toward the cascade, never toward a crash)", async () => {
  const filler = "notes: |\n" + "x".repeat(70 * 1024) + "\n";
  const body = `---\n${filler}visibility: hidden\n---\n# Huge frontmatter\n`;
  const vault = makeVault({ "huge.md": body });
  // No folder rule and no successfully-parsed override → falls back to "all" (cascade default),
  // not to a thrown error and not to a false "hidden".
  const denied = (await buildDenyPaths(vault, "chat")).map((e) => e.rel);
  expect(denied).toEqual([]);
});

test("stem inheritance (T-D2): a hidden drawing's export sidecars inherit its restriction even with NO folder rule involved", async () => {
  const vault = makeVault({
    "diagram.md": "---\nvisibility: hidden\n---\n# Diagram\n",
    "diagram.draw": "drawing json blob\n",
    "diagram.draw.png": "binary\n",
    "diagram.draw.pdf": "binary\n",
    "other.png": "unrelated sibling, different stem\n",
  });
  const denied = (await buildDenyPaths(vault, "chat")).map((e) => e.rel).sort();
  expect(denied).toEqual(["diagram.draw", "diagram.draw.pdf", "diagram.draw.png", "diagram.md"]);
});

test("stem inheritance (T-D2b): an explicit visibility: all file still wins for itself even beside a hidden same-stem sibling", async () => {
  const vault = makeVault({
    "note.draw": "drawing json blob\n",
    // Folder-cascade-free: note.draw becomes restricted only via a THIRD stem-mate that's
    // explicitly hidden, so note.md's own "all" override must still win for itself.
    "note.hidden-marker.md": "---\nvisibility: hidden\n---\n# Marker\n",
    "note.md": "---\nvisibility: all\n---\n# Note\n",
  });
  const denied = (await buildDenyPaths(vault, "chat")).map((e) => e.rel).sort();
  // "note.hidden-marker.md" stems to "note" (pre-first-dot), same as "note.draw" and "note.md".
  expect(denied).toEqual(["note.draw", "note.hidden-marker.md"]);
  expect(denied).not.toContain("note.md");
});

test("verification scenario from the task: a.md/b.txt/c.json/sketch.draw+.png in a hidden folder are ALL denied, and an explicit override survives", async () => {
  const vault = makeVault({
    "hidden-folder/a.md": "# A\n",
    "hidden-folder/b.txt": "plain text\n",
    "hidden-folder/c.json": '{"a":1}\n',
    "hidden-folder/sketch.draw": "drawing blob\n",
    "hidden-folder/sketch.draw.png": "binary\n",
    "hidden-folder/exempt.md": "---\nvisibility: all\n---\n# Exempt\n",
  });
  await setFolderVisibility(vault, "hidden-folder", "hidden");
  const denied = (await buildDenyPaths(vault, "chat")).map((e) => e.rel).sort();
  expect(denied).toEqual([
    "hidden-folder/a.md",
    "hidden-folder/b.txt",
    "hidden-folder/c.json",
    "hidden-folder/sketch.draw",
    "hidden-folder/sketch.draw.png",
  ]);
  expect(denied).not.toContain("hidden-folder/exempt.md");
});
