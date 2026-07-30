// daemon/src/lib/visibility.test.ts
// Mirrors core/test/visibility.test.ts for this workspace's PORTED copy (the daemon has no
// dependency on @bismuth/core — see visibility.ts's header comment) — same resolution semantics,
// same dual-form deny-list fix (see buildManagedSettingsDeny's doc comment for the empirical bug
// this closes: a model's Read tool call may report either a relative or an absolute file_path).
import { test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { realpath } from "node:fs/promises"
import {
  resolveVisibility,
  isVisibleToDaemon,
  buildDenyPaths,
  buildManagedSettingsDeny,
  absDenyPaths,
  type DenyEntry,
} from "./visibility.ts"

function makeVault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-daemon-vis-"))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}

/** Write a `.settings` file with a single folderVisibility entry — the daemon reads
 *  folderVisibility from `.settings` (or its interim shapes) independently of core. */
function setFolderVisibility(vault: string, folder: string, value: "chat-only" | "hidden"): void {
  writeFileSync(join(vault, ".settings"), `folderVisibility:\n  ${JSON.stringify(folder)}: ${value}\n`)
}

// --- resolveVisibility ---

test("resolveVisibility: absence with no folder rules inherits to 'all'", () => {
  expect(resolveVisibility("notes/a.md", undefined, {})).toBe("all")
})

test("resolveVisibility: nearest ancestor wins over a shallower one", () => {
  const folders = { notes: "hidden" as const, "notes/private": "chat-only" as const }
  expect(resolveVisibility("notes/private/a.md", undefined, folders)).toBe("chat-only")
  expect(resolveVisibility("notes/b.md", undefined, folders)).toBe("hidden")
})

test("resolveVisibility: explicit file value overrides an ancestor folder's rule", () => {
  const folders = { "notes/private": "hidden" as const }
  expect(resolveVisibility("notes/private/a.md", "all", folders)).toBe("all")
})

// --- isVisibleToDaemon ---

test("isVisibleToDaemon: true only for 'all'", () => {
  expect(isVisibleToDaemon("all")).toBe(true)
  expect(isVisibleToDaemon("chat-only")).toBe(false)
  expect(isVisibleToDaemon("hidden")).toBe(false)
})

// --- buildDenyPaths (I/O) ---

test("buildDenyPaths: empty vault denies nothing", async () => {
  const vault = makeVault({ "a.md": "# A\n" })
  expect(await buildDenyPaths(vault)).toEqual([])
})

test("buildDenyPaths: 'hidden' AND 'chat-only' are both daemon-restricted (only 'all' is not)", async () => {
  const vault = makeVault({
    "secret.md": "---\nvisibility: hidden\n---\n# Secret\n",
    "draft.md": "---\nvisibility: chat-only\n---\n# Draft\n",
    "public.md": "# Public\n",
  })
  const root = await realpath(vault)
  const denied = (await buildDenyPaths(vault)).sort((a, b) => a.rel.localeCompare(b.rel))
  expect(denied).toEqual(
    [
      { rel: "draft.md", abs: join(root, "draft.md") },
      { rel: "secret.md", abs: join(root, "secret.md") },
    ].sort((a, b) => a.rel.localeCompare(b.rel)),
  )
})

test("buildDenyPaths: includes .daemon memory notes", async () => {
  const vault = makeVault({ ".daemon/memory/note.md": "---\nvisibility: hidden\n---\nSome memory\n" })
  const root = await realpath(vault)
  const denied = await buildDenyPaths(vault)
  expect(denied).toEqual([{ rel: ".daemon/memory/note.md", abs: join(root, ".daemon/memory/note.md") }])
})

// --- buildManagedSettingsDeny / absDenyPaths ---

const SAMPLE_ENTRIES: DenyEntry[] = [{ rel: "secret.md", abs: "/vault/secret.md" }]

test("buildManagedSettingsDeny: emits Read/Edit/Grep/Glob rules for BOTH path forms", () => {
  const deny = buildManagedSettingsDeny(SAMPLE_ENTRIES)
  for (const tool of ["Read", "Edit", "Grep", "Glob"]) {
    expect(deny).toContain(`${tool}(secret.md)`)
    expect(deny).toContain(`${tool}(/vault/secret.md)`)
  }
  expect(deny.length).toBe(8)
})

test("absDenyPaths: pulls just the absolute form", () => {
  expect(absDenyPaths(SAMPLE_ENTRIES)).toEqual(["/vault/secret.md"])
})

// --- discovery-walk fixes: same bugs, same fixes as core/test/visibility.test.ts (this file is
// a literal port and must stay in step — see visibility.ts's header comment).

test("buildDenyPaths: EVERY extension inside a hidden folder is denied, not just recognized note types", async () => {
  const vault = makeVault({
    "priv/note.md": "# Note\n",
    "priv/notes.txt": "plain text, no frontmatter\n",
    "priv/data.json": '{"k":"v"}\n',
    "priv/sketch.draw": "drawing json blob\n",
    "priv/sketch.draw.png": "binary\n",
    "public.md": "# Public\n",
  })
  setFolderVisibility(vault, "priv", "hidden")
  const denied = (await buildDenyPaths(vault)).map((e) => e.rel).sort()
  expect(denied).toEqual(["priv/data.json", "priv/note.md", "priv/notes.txt", "priv/sketch.draw", "priv/sketch.draw.png"])
})

test("buildDenyPaths: an explicit visibility: all override inside the same hidden folder still exempts that file", async () => {
  const vault = makeVault({
    "priv/note.md": "# Note\n",
    "priv/exposed.md": "---\nvisibility: all\n---\n# Exposed\n",
  })
  setFolderVisibility(vault, "priv", "hidden")
  const denied = (await buildDenyPaths(vault)).map((e) => e.rel).sort()
  expect(denied).toEqual(["priv/note.md"])
})

test("buildDenyPaths: a note stashed in a dot-directory is still walked and denied", async () => {
  const vault = makeVault({
    ".stash/inside.md": "---\nvisibility: hidden\n---\n# Stashed\n",
    "public.md": "# Public\n",
  })
  const denied = (await buildDenyPaths(vault)).map((e) => e.rel).sort()
  expect(denied).toEqual([".stash/inside.md"])
})

test("buildDenyPaths: .git and .settings are excluded from the walk", async () => {
  const vault = makeVault({
    ".git/HEAD": "ref: refs/heads/main\n",
    "public.md": "# Public\n",
  })
  setFolderVisibility(vault, "nonexistent", "hidden")
  const denied = (await buildDenyPaths(vault)).map((e) => e.rel).sort()
  expect(denied).toEqual([])
})

test("buildDenyPaths: a hidden note's frontmatter is honored on a non-.md extension too (copy/rename carries the same bytes)", async () => {
  const secretBody = "---\nvisibility: hidden\n---\n# Secret\nTOKEN-9001\n"
  const vault = makeVault({
    "secret.md": secretBody,
    "secret-copy.txt": secretBody,
  })
  const denied = (await buildDenyPaths(vault)).map((e) => e.rel).sort()
  expect(denied).toEqual(["secret-copy.txt", "secret.md"])
})

test("buildDenyPaths: frontmatter whose closing fence lies past the 512-byte head is still parsed", async () => {
  const filler = "notes: |\n" + Array.from({ length: 40 }, (_, i) => `  line ${i} filler filler filler filler`).join("\n") + "\n"
  const body = `---\n${filler}visibility: hidden\n---\n# Big frontmatter\n`
  expect(body.indexOf("---", 4)).toBeGreaterThan(512)
  const vault = makeVault({ "big.md": body })
  const denied = (await buildDenyPaths(vault)).map((e) => e.rel)
  expect(denied).toEqual(["big.md"])
})

test("stem inheritance: a hidden drawing's export sidecars inherit its restriction with no folder rule involved", async () => {
  const vault = makeVault({
    "diagram.md": "---\nvisibility: hidden\n---\n# Diagram\n",
    "diagram.draw": "drawing json blob\n",
    "diagram.draw.png": "binary\n",
    "other.png": "unrelated sibling, different stem\n",
  })
  const denied = (await buildDenyPaths(vault)).map((e) => e.rel).sort()
  expect(denied).toEqual(["diagram.draw", "diagram.draw.png", "diagram.md"])
})

test("stem inheritance: an explicit visibility: all file still wins for itself even beside a hidden same-stem sibling", async () => {
  const vault = makeVault({
    "note.draw": "drawing json blob\n",
    "note.hidden-marker.md": "---\nvisibility: hidden\n---\n# Marker\n",
    "note.md": "---\nvisibility: all\n---\n# Note\n",
  })
  const denied = (await buildDenyPaths(vault)).map((e) => e.rel).sort()
  expect(denied).toEqual(["note.draw", "note.hidden-marker.md"])
  expect(denied).not.toContain("note.md")
})

test("verification scenario: a.md/b.txt/c.json/sketch.draw+.png in a hidden folder are ALL denied, and an explicit override survives", async () => {
  const vault = makeVault({
    "hidden-folder/a.md": "# A\n",
    "hidden-folder/b.txt": "plain text\n",
    "hidden-folder/c.json": '{"a":1}\n',
    "hidden-folder/sketch.draw": "drawing blob\n",
    "hidden-folder/sketch.draw.png": "binary\n",
    "hidden-folder/exempt.md": "---\nvisibility: all\n---\n# Exempt\n",
  })
  setFolderVisibility(vault, "hidden-folder", "hidden")
  const denied = (await buildDenyPaths(vault)).map((e) => e.rel).sort()
  expect(denied).toEqual([
    "hidden-folder/a.md",
    "hidden-folder/b.txt",
    "hidden-folder/c.json",
    "hidden-folder/sketch.draw",
    "hidden-folder/sketch.draw.png",
  ])
  expect(denied).not.toContain("hidden-folder/exempt.md")
})
