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
