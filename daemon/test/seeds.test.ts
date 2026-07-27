// Versioned seed refresh (daemon/src/daemon/seeds.ts): reconcileSeeds must upgrade an EXISTING
// vault's default cron in place when it's still byte-identical to a known prior stock version
// (so "dream"/"vault-review" ship their incremental-scoping upgrade to already-set-up vaults, not
// just brand-new ones), while never touching a file the user has since customized even slightly.
import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { reconcileSeeds, seedsFor } from "../src/daemon/seeds.ts"
import { vaultPaths, type VaultContext } from "../src/lib/config.ts"
import { DEFAULT_CRONS } from "../src/daemon/defaultCrons.ts"
import { OLD_DREAM_CONTENT, OLD_VAULT_REVIEW_CONTENT } from "./fixtures/oldSeedContent.ts"

const CURRENT_DREAM = DEFAULT_CRONS.find((c) => c.name === "dream")!.content
const CURRENT_VAULT_REVIEW = DEFAULT_CRONS.find((c) => c.name === "vault-review")!.content

let root: string
let ctx: VaultContext

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bismuth-seeds-"))
  ctx = vaultPaths(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

test("a fresh vault (nothing on disk) gets every seed written, including the two default crons", async () => {
  const result = await reconcileSeeds(ctx)
  expect(result.refreshed).toEqual([])
  expect(result.customized).toEqual([])
  expect(result.written.sort()).toEqual(
    seedsFor(ctx).map((s) => s.path).sort(),
  )
  expect(readFileSync(join(ctx.cronsDir, "dream.md"), "utf-8")).toBe(CURRENT_DREAM)
  expect(readFileSync(join(ctx.cronsDir, "vault-review.md"), "utf-8")).toBe(CURRENT_VAULT_REVIEW)
})

test("an existing vault whose dream.md still matches the known PRIOR (pre-incremental) stock version is upgraded in place", async () => {
  mkdirSync(ctx.cronsDir, { recursive: true })
  writeFileSync(join(ctx.cronsDir, "dream.md"), OLD_DREAM_CONTENT, "utf-8")

  const result = await reconcileSeeds(ctx)
  expect(result.refreshed).toContain(join(ctx.cronsDir, "dream.md"))
  expect(result.customized).toEqual([])
  expect(readFileSync(join(ctx.cronsDir, "dream.md"), "utf-8")).toBe(CURRENT_DREAM)
})

test("an existing vault whose vault-review.md still matches the known prior stock version is upgraded in place", async () => {
  mkdirSync(ctx.cronsDir, { recursive: true })
  writeFileSync(join(ctx.cronsDir, "vault-review.md"), OLD_VAULT_REVIEW_CONTENT, "utf-8")

  const result = await reconcileSeeds(ctx)
  expect(result.refreshed).toContain(join(ctx.cronsDir, "vault-review.md"))
  expect(readFileSync(join(ctx.cronsDir, "vault-review.md"), "utf-8")).toBe(CURRENT_VAULT_REVIEW)
})

test("a user-customized dream.md (matches neither the prior nor the current stock version) is left completely untouched", async () => {
  mkdirSync(ctx.cronsDir, { recursive: true })
  // Edit a phrase that's actually inside the seeded BODY (not just a surrounding JS comment) so
  // the fixture is genuinely byte-different from both the prior and current stock versions.
  expect(OLD_DREAM_CONTENT).toContain("Consolidate this vault's memory graph");
  const customized = OLD_DREAM_CONTENT.replace(
    "Consolidate this vault's memory graph",
    "MY CUSTOM: consolidate this vault's memory graph",
  );
  expect(customized).not.toBe(OLD_DREAM_CONTENT); // sanity: the replace actually took effect
  writeFileSync(join(ctx.cronsDir, "dream.md"), customized, "utf-8")

  const result = await reconcileSeeds(ctx)
  expect(result.refreshed).toEqual([])
  expect(result.customized).toContain(join(ctx.cronsDir, "dream.md"))
  expect(readFileSync(join(ctx.cronsDir, "dream.md"), "utf-8")).toBe(customized) // byte-identical, untouched
})

test("a dream.md the user wrote from scratch (unrelated content) is also left untouched, not treated as customized-from-nothing", async () => {
  mkdirSync(ctx.cronsDir, { recursive: true })
  const scratch = "---\nname: dream\nschedule: 0 3 * * *\n---\n\nMy own thing.\n"
  writeFileSync(join(ctx.cronsDir, "dream.md"), scratch, "utf-8")

  const result = await reconcileSeeds(ctx)
  expect(result.customized).toContain(join(ctx.cronsDir, "dream.md"))
  expect(readFileSync(join(ctx.cronsDir, "dream.md"), "utf-8")).toBe(scratch)
})

test("a dream.md already on the CURRENT (incremental) version is a no-op — not written, refreshed, or flagged customized", async () => {
  // Fully seed the vault first (writes everything, including a fresh dream.md at CURRENT_DREAM),
  // then reconcile again — a clean second pass touches nothing.
  await reconcileSeeds(ctx)
  expect(readFileSync(join(ctx.cronsDir, "dream.md"), "utf-8")).toBe(CURRENT_DREAM)

  const result = await reconcileSeeds(ctx)
  expect(result.written).toEqual([])
  expect(result.refreshed).toEqual([])
  expect(result.customized).toEqual([])
  expect(readFileSync(join(ctx.cronsDir, "dream.md"), "utf-8")).toBe(CURRENT_DREAM)
})

test("non-versioned seeds (identity.md, PAGES.md) are never refreshed or flagged even when their content is stale/different", async () => {
  mkdirSync(ctx.daemonDir, { recursive: true })
  writeFileSync(ctx.identityFile, "---\nname: daemon\n---\n\nSome old identity text.\n", "utf-8")

  const result = await reconcileSeeds(ctx)
  expect(result.refreshed).toEqual([]);
  expect(result.customized.some((p) => p === ctx.identityFile)).toBe(false);
  expect(readFileSync(ctx.identityFile, "utf-8")).toBe("---\nname: daemon\n---\n\nSome old identity text.\n");
})

test("running reconcileSeeds twice in a row is idempotent (second pass is a no-op)", async () => {
  mkdirSync(ctx.cronsDir, { recursive: true })
  writeFileSync(join(ctx.cronsDir, "dream.md"), OLD_DREAM_CONTENT, "utf-8")

  const first = await reconcileSeeds(ctx)
  expect(first.refreshed).toContain(join(ctx.cronsDir, "dream.md"))

  const second = await reconcileSeeds(ctx)
  expect(second.written).toEqual([])
  expect(second.refreshed).toEqual([])
  expect(second.customized).toEqual([])
})

test("a missing crons dir (never seeded before) still yields written for both default crons with the CURRENT incremental content", async () => {
  const result = await reconcileSeeds(ctx)
  expect(existsSync(join(ctx.cronsDir, "dream.md"))).toBe(true)
  expect(existsSync(join(ctx.cronsDir, "vault-review.md"))).toBe(true)
  const dreamBody = readFileSync(join(ctx.cronsDir, "dream.md"), "utf-8")
  expect(dreamBody).toContain("incremental: true")
  expect(dreamBody).toContain("{{changedSinceLastRun}}")
  expect(result.written.length).toBeGreaterThan(0)
})
