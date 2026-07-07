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
} from "../src/visibility";
import { setFolderVisibility } from "../src/settings";
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
