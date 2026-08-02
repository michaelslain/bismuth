// daemon/src/lib/visibility.test.ts
// Mirrors core/test/visibility.test.ts for this workspace's PORTED copy (the daemon has no
// dependency on @bismuth/core — see visibility.ts's header comment) — same resolution semantics,
// same dual-form deny-list fix (see buildManagedSettingsDeny's doc comment for the empirical bug
// this closes: a model's Read tool call may report either a relative or an absolute file_path).
import { test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, appendFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { realpath } from "node:fs/promises"
import {
  resolveVisibility,
  isVisibleToDaemon,
  buildDenyPaths,
  resolveDenyPlan,
  MAX_WALK_ENTRIES,
  VisibilityUndeterminedError,
  buildManagedSettingsDeny,
  absDenyPaths,
  sandboxFailIfUnavailable,
  type DenyEntry,
} from "./visibility.ts"

/** An entry's {rel, abs} only — `aliases` is asserted separately. Every vault here is a macOS
 *  tmpdir, so `/var/…` vs `/private/var/…` gives all of them a root-spelling alias. */
function pair(e: DenyEntry): { rel: string; abs: string } {
  return { rel: e.rel, abs: e.abs }
}

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
  expect(denied.map(pair)).toEqual(
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
  expect(denied.map(pair)).toEqual([{ rel: ".daemon/memory/note.md", abs: join(root, ".daemon/memory/note.md") }])
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

// sandbox.failIfUnavailable (2026-07-30 measurement, docs/vault/visibility.md +
// visibility-acceptance.md): session.ts used to hardcode `false` here, so a session whose OS
// sandbox couldn't start ran anyway with only managedSettings standing guard — which does nothing
// to a raw Bash `cat`/`bismuth read`/`python3 -c`. Now derived from the deny list so a restricted
// vault fails closed while an unrestricted one keeps working on a machine where the sandbox can't
// start at all.
test("sandboxFailIfUnavailable: true when the vault restricts something", () => {
  expect(sandboxFailIfUnavailable(SAMPLE_ENTRIES)).toBe(true)
})

test("sandboxFailIfUnavailable: false when nothing is restricted", () => {
  expect(sandboxFailIfUnavailable([])).toBe(false)
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

// --- Undetermined + symlinked directories (ported alongside core/src/visibility.ts) ---

test("resolveDenyPlan: a vault that is not there is undetermined, NOT unrestricted", async () => {
  const missing = join(tmpdir(), `bismuth-daemon-absent-${Date.now()}`)
  const plan = await resolveDenyPlan(missing)
  expect(plan.determined).toBe(false)
  expect(plan).not.toMatchObject({ determined: true, entries: [] })
})

test("buildDenyPaths: a vault that is not there throws rather than returning an empty list", async () => {
  const missing = join(tmpdir(), `bismuth-daemon-absent-${Date.now()}`)
  expect(buildDenyPaths(missing)).rejects.toThrow(VisibilityUndeterminedError)
})

test("resolveDenyPlan: a corrupt .settings is undetermined, so the folder cascade cannot silently vanish", async () => {
  const vault = makeVault({
    "Private/secret.md": "---\nvisibility: hidden\n---\n# Secret\n",
    "real-hidden/inside.md": "# Inside\n",
    ".settings": "folderVisibility:\n  real-hidden: hidden\n",
  })
  const before = await resolveDenyPlan(vault)
  expect(before.determined).toBe(true)
  expect(before.determined && before.entries.map((e) => e.rel).sort())
    .toEqual(["Private/secret.md", "real-hidden/inside.md"])

  appendFileSync(join(vault, ".settings"), "\n  [not: valid yaml\n:::\n")

  const after = await resolveDenyPlan(vault)
  expect(after.determined).toBe(false)
})

test("resolveDenyPlan: an ABSENT .settings is determined — a vault that hides nothing is an answer", async () => {
  const vault = makeVault({ "public.md": "# Public\n" })
  expect(await resolveDenyPlan(vault)).toEqual({ determined: true, entries: [] })
})

test("buildDenyPaths: a symlinked directory is walked, so the subtree behind it is denied", async () => {
  const vault = makeVault({ "real-hidden/inside.md": "---\nvisibility: hidden\n---\n# Inside\n" })
  symlinkSync(join(vault, "real-hidden"), join(vault, "link-to-hidden"))
  const canonical = await realpath(vault)
  const entries = await buildDenyPaths(vault)
  expect(entries.map((e) => e.rel).sort()).toEqual(["link-to-hidden/inside.md", "real-hidden/inside.md"])
  // Both absolute spellings reach the sandbox deny list — a tool that resolved the link reports
  // the second, and a deny keyed only on the link path would never match it.
  const abs = absDenyPaths(entries)
  expect(abs).toContain(join(canonical, "link-to-hidden/inside.md"))
  expect(abs).toContain(join(canonical, "real-hidden/inside.md"))
  // ...and managedSettings covers every form too.
  expect(buildManagedSettingsDeny(entries)).toContain(`Read(${join(canonical, "real-hidden/inside.md")})`)
})

test("buildDenyPaths: a symlink cycle terminates instead of recursing forever", async () => {
  const vault = makeVault({ "a/secret.md": "---\nvisibility: hidden\n---\n# Secret\n" })
  symlinkSync(join(vault, "a"), join(vault, "a", "loop"))
  const entries = await buildDenyPaths(vault)
  expect(entries.map((e) => e.rel)).toContain("a/secret.md")
  expect(entries.every((e) => !e.rel.includes("loop/loop"))).toBe(true)
})

test("resolveDenyPlan: an unreadable SUBDIRECTORY is undetermined (it may hold restricted notes)", async () => {
  const vault = makeVault({ "public.md": "# Public\n", "locked/inside.md": "# Inside\n" })
  const locked = join(vault, "locked")
  chmodSync(locked, 0o000)
  try {
    const plan = await resolveDenyPlan(vault)
    expect(plan.determined).toBe(false)
  } finally {
    chmodSync(locked, 0o755)
  }
})

test("MAX_WALK_ENTRIES is 200_000", () => {
  // Pinned independently of the mechanism test below — a test that both chooses and asserts a
  // bound can never fail.
  expect(MAX_WALK_ENTRIES).toBe(200_000)
})

test("resolveDenyPlan: exceeding the walk's entry budget is undetermined, not a short list", async () => {
  const vault = makeVault({
    "a.md": "---\nvisibility: hidden\n---\n# A\n",
    "b.md": "# B\n",
    "c.md": "# C\n",
    "d.md": "# D\n",
  })
  // Four entries against a bound of 3: the walk stops early, so the restricted set it found is
  // necessarily incomplete and must not be reported as the answer.
  const plan = await resolveDenyPlan(vault, { maxEntries: 3 })
  expect(plan.determined).toBe(false)
  expect(plan.determined === false && plan.reason).toContain("3")
  expect(plan).not.toMatchObject({ determined: true })
  // The same vault under the real default is answerable, so the refusal is the BOUND talking and
  // not something else about this vault.
  const ok = await resolveDenyPlan(vault)
  expect(ok).toMatchObject({ determined: true })
  expect(ok.determined === true && ok.entries.map((e) => e.rel)).toEqual(["a.md"])
})

test("buildDenyPaths: the caller's own root spelling is an alias when it differs from the canonical one", async () => {
  const vault = makeVault({ "secret.md": "---\nvisibility: hidden\n---\n# Secret\n" })
  const canonical = await realpath(vault)
  if (canonical === vault) return
  const entries = await buildDenyPaths(vault)
  expect(entries).toHaveLength(1)
  expect(entries[0]!.aliases).toContain(join(vault, "secret.md"))
  expect(absDenyPaths(entries)).toContain(join(vault, "secret.md"))
})
