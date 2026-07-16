// The DURABLE SET of daemon-minted session ids — the provenance record that lets Bismuth's chat
// page list only the user's own chats (core/src/chat.ts) without deleting or hiding anything the
// daemon needs.
//
// The mechanism this replaces was refuted for a fatally wrong signal: it compared a session id
// against `<vault>/.daemon/session-id`, a MOVING POINTER overwritten on every new session, so it
// recognized only the daemon's most recent run. The tests below pin the property that failure
// demands — EVERY id the daemon ever minted stays recognizable, not just the latest.
import { test, expect, describe } from "bun:test"
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  appendSessionId,
  parseSessionIds,
  formatSessionIds,
  recordDaemonSessionId,
  sessionIdsFile,
  SESSION_IDS_CAP,
} from "../src/daemon/sessionIds.ts"
import { vaultPaths } from "../src/lib/config.ts"

async function makeVault(): Promise<ReturnType<typeof vaultPaths>> {
  const root = await mkdtemp(join(tmpdir(), "bismuth-sessionids-"))
  const ctx = vaultPaths(root, "Atlas")
  await mkdir(ctx.daemonDir, { recursive: true })
  return ctx
}

/** The recorded set, straight off disk. */
async function readSet(ctx: ReturnType<typeof vaultPaths>): Promise<string[]> {
  return parseSessionIds(await readFile(sessionIdsFile(ctx), "utf-8"))
}

describe("appendSessionId (the durable-set writer, pure)", () => {
  test("appends a new id, oldest first", () => {
    expect(appendSessionId(["a", "b"], "c")).toEqual(["a", "b", "c"])
  })

  test("an id already recorded returns the SAME array reference — the caller's skip-the-write signal", () => {
    const existing = ["a", "b"]
    expect(appendSessionId(existing, "b")).toBe(existing)
  })

  test("blank/whitespace ids are ignored (never recorded)", () => {
    const existing = ["a"]
    expect(appendSessionId(existing, "")).toBe(existing)
    expect(appendSessionId(existing, "   ")).toBe(existing)
  })

  test("ids are trimmed before recording, so a stray newline can't fork one id into two", () => {
    expect(appendSessionId([], " a\n")).toEqual(["a"])
    expect(appendSessionId(["a"], " a ")).toEqual(["a"])
  })

  test("at the cap, the OLDEST id is dropped — the newest `cap` survive", () => {
    expect(appendSessionId(["a", "b", "c"], "d", 3)).toEqual(["b", "c", "d"])
  })

  test("an over-cap set is pruned back to exactly `cap` (newest kept)", () => {
    expect(appendSessionId(["a", "b", "c", "d", "e"], "f", 3)).toEqual(["d", "e", "f"])
  })

  test("under the cap nothing is dropped", () => {
    const ids = Array.from({ length: SESSION_IDS_CAP - 1 }, (_, i) => `id-${i}`)
    expect(appendSessionId(ids, "new").length).toBe(SESSION_IDS_CAP)
  })
})

describe("parseSessionIds / formatSessionIds (the on-disk contract)", () => {
  test("round-trips ids in order", () => {
    const ids = ["a", "b", "c"]
    expect(parseSessionIds(formatSessionIds(ids))).toEqual(ids)
  })

  test("format ends with a newline so a later O_APPEND lands on its own line", () => {
    expect(formatSessionIds(["a"])).toBe("a\n")
    expect(formatSessionIds([])).toBe("")
  })

  test("blank lines, trailing newlines, and duplicates are tolerated", () => {
    expect(parseSessionIds("a\n\n b \na\n\n")).toEqual(["a", "b"])
  })

  test("an empty file is an empty set (not a set containing '')", () => {
    expect(parseSessionIds("")).toEqual([])
    expect(parseSessionIds("\n\n")).toEqual([])
  })
})

describe("recordDaemonSessionId (durability — the refuted mechanism's actual failure)", () => {
  test("EVERY minted id stays recorded, not just the most recent one", async () => {
    const ctx = await makeVault()
    for (const id of ["s1", "s2", "s3"]) await recordDaemonSessionId(ctx, id)
    // The pointer file would have kept only s3; the set keeps all three.
    expect(await readSet(ctx)).toEqual(["s1", "s2", "s3"])
  })

  test("re-recording the same id is a no-op (a stream can repeat its session_id)", async () => {
    const ctx = await makeVault()
    await recordDaemonSessionId(ctx, "s1")
    await recordDaemonSessionId(ctx, "s1")
    expect(await readSet(ctx)).toEqual(["s1"])
  })

  test("blank ids are never recorded", async () => {
    const ctx = await makeVault()
    await recordDaemonSessionId(ctx, "  ")
    await recordDaemonSessionId(ctx, "s1")
    expect(await readSet(ctx)).toEqual(["s1"])
  })

  test("concurrent records (the cron fan-out) all land — no lost update", async () => {
    const ctx = await makeVault()
    const ids = Array.from({ length: 25 }, (_, i) => `concurrent-${i}`)
    // Fire them all without awaiting in between: the per-vault lock must serialize the
    // read→compute→write of each, or interleaved reads would clobber each other's appends.
    await Promise.all(ids.map((id) => recordDaemonSessionId(ctx, id)))
    expect((await readSet(ctx)).sort()).toEqual([...ids].sort())
  })

  test("creates .daemon/ when absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "bismuth-sessionids-bare-"))
    const ctx = vaultPaths(root, "Atlas") // no mkdir — the dir does not exist yet
    await recordDaemonSessionId(ctx, "s1")
    expect(await readSet(ctx)).toEqual(["s1"])
  })

  test("pruning past the cap keeps the file valid and drops only the oldest", async () => {
    const ctx = await makeVault()
    // Seed a full-to-the-cap file directly, then record one more.
    const seeded = Array.from({ length: SESSION_IDS_CAP }, (_, i) => `old-${i}`)
    await writeFile(sessionIdsFile(ctx), formatSessionIds(seeded), "utf-8")
    await recordDaemonSessionId(ctx, "newest")

    const set = await readSet(ctx)
    expect(set.length).toBe(SESSION_IDS_CAP)
    expect(set[set.length - 1]).toBe("newest")
    expect(set).not.toContain("old-0") // oldest dropped
    expect(set).toContain("old-1")
  })
})

describe("recordDaemonSessionId backfill (pre-existing daemon sessions)", () => {
  test("first write seeds the set from the session-id POINTER — the one recoverable old session", async () => {
    const ctx = await makeVault()
    // A vault upgraded from before the set existed: the pointer names the daemon's last session.
    await writeFile(ctx.sessionFile, "pre-existing-daemon-session", "utf-8")

    await recordDaemonSessionId(ctx, "brand-new-session")

    // Both: the one we could still identify, and the new one. Order = oldest first.
    expect(await readSet(ctx)).toEqual(["pre-existing-daemon-session", "brand-new-session"])
  })

  test("the seeded pointer is NOT duplicated when it equals the id being recorded", async () => {
    const ctx = await makeVault()
    await writeFile(ctx.sessionFile, "same-session", "utf-8")
    await recordDaemonSessionId(ctx, "same-session")
    expect(await readSet(ctx)).toEqual(["same-session"])
  })

  test("no pointer file (a daemon that never ran) → the set is just the new id", async () => {
    const ctx = await makeVault()
    await recordDaemonSessionId(ctx, "s1")
    expect(await readSet(ctx)).toEqual(["s1"])
  })

  test("backfill runs ONCE — a later record must not re-seed a stale pointer back in", async () => {
    const ctx = await makeVault()
    await writeFile(ctx.sessionFile, "pointer-a", "utf-8")
    await recordDaemonSessionId(ctx, "s1")
    // Simulate the pointer moving on (saveSessionId overwrites it after every session).
    await writeFile(ctx.sessionFile, "pointer-b", "utf-8")
    await recordDaemonSessionId(ctx, "s2")

    // pointer-b was already recorded as s1/s2's own id path; it must not be seeded as a phantom.
    expect(await readSet(ctx)).toEqual(["pointer-a", "s1", "s2"])
  })
})
