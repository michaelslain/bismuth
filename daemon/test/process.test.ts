// enableProcess/disableProcess's "is it already in the target state?" checks must agree with
// parseProcessFrontmatter's own default, which treats a definition with NO `enabled:` key as
// ENABLED (`frontmatter.enabled !== "false"`). enableProcess used to ask `=== "true"`, so a file
// that omitted the key looked disabled to it and a no-op enable rewrote the file on disk —
// contradicting the function's documented "Idempotent: succeeds even if already enabled".
// These tests pin the agreement, in both directions, by asserting on the file's mtime+bytes.
import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { enableProcess, disableProcess } from "../src/daemon/process.ts"
import type { VaultContext } from "../src/lib/config.ts"

let processesDir: string
let ctx: VaultContext

beforeEach(() => {
  processesDir = mkdtempSync(join(tmpdir(), "bismuth-process-fixture-"))
  ctx = { processesDir, root: processesDir } as unknown as VaultContext
})

afterEach(() => {
  rmSync(processesDir, { recursive: true, force: true })
})

function procFile(name: string, fm: string, body = "a process"): string {
  const p = join(processesDir, `${name}.md`)
  writeFileSync(p, `---\n${fm}\n---\n\n${body}\n`)
  return p
}

test("enabling a process whose file OMITS `enabled:` does not rewrite the file (it is already enabled)", async () => {
  // No `enabled:` key at all — parseProcessFrontmatter reads this as enabled:true.
  const p = procFile("implicit", "command: sleep")
  const before = readFileSync(p, "utf-8")

  const res = await enableProcess("implicit", ctx)
  expect(res.ok).toBe(true)

  // The file is untouched — byte-for-byte. Before the fix this gained an `enabled: "true"` line.
  expect(readFileSync(p, "utf-8")).toBe(before)
  expect(before).not.toContain("enabled")
})

test("enabling a process that is explicitly disabled DOES flip it on disk", async () => {
  const p = procFile("off", "command: sleep\nenabled: false")

  const res = await enableProcess("off", ctx)
  expect(res.ok).toBe(true)

  const after = readFileSync(p, "utf-8")
  expect(after).toContain("enabled: true")
  expect(after).not.toContain("enabled: false")
})

test("disabling a process whose file OMITS `enabled:` DOES write it (it was implicitly enabled)", async () => {
  // The mirror case: disableProcess's `=== "false"` check is already correct, so an implicitly
  // enabled process must still be flipped off. This guards the fix from being over-applied.
  const p = procFile("implicit-off", "command: sleep")

  const res = await disableProcess("implicit-off", ctx)
  expect(res.ok).toBe(true)
  expect(readFileSync(p, "utf-8")).toContain("enabled: false")
})

test("enableProcess is idempotent: a second call still leaves the file untouched", async () => {
  const p = procFile("twice", "command: sleep\nenabled: true")
  await enableProcess("twice", ctx)
  const afterFirst = readFileSync(p, "utf-8")
  const mtimeFirst = statSync(p).mtimeMs

  await enableProcess("twice", ctx)
  expect(readFileSync(p, "utf-8")).toBe(afterFirst)
  expect(statSync(p).mtimeMs).toBe(mtimeFirst)
})

test("enableProcess reports a missing definition instead of throwing", async () => {
  const res = await enableProcess("nope", ctx)
  expect(res.ok).toBe(false)
  expect(res.error).toContain("nope")
})
