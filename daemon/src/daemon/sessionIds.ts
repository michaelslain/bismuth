// daemon/src/daemon/sessionIds.ts
// The DURABLE SET of session ids this vault's daemon minted — `<vault>/.daemon/session-ids`.
//
// Why this exists (and why the obvious file next to it is NOT it): `<vault>/.daemon/session-id`
// is a single-value MOVING POINTER. Every daemon caller mints a fresh conversation
// (`newSession: true` — cron.ts fireJob, pages.ts, index.ts), and saveSessionId OVERWRITES that
// pointer each time, so it only ever names the MOST RECENT daemon run. Asking "did the daemon
// mint this session?" against the pointer answers correctly for exactly one session and wrongly
// for every earlier one — which is why the chat page couldn't tell a cron's session apart from a
// chat the user started. This file is the append-only record that makes the question answerable
// for ALL of them, durably, in both directions (Bismuth reads it to EXCLUDE daemon sessions from
// the chat page; a future daemon-sessions surface reads the same file to INCLUDE them).
//
// SHARED INTEGRATION CONTRACT — core/src/daemon.ts readDaemonSessionIds() parses this exact
// format. Keep the two in sync (the daemon workspace deliberately does not import core; see
// lib/bismuthPaths.ts for the same deliberate-duplication pattern).
//
//   <vault>/.daemon/session-ids — newline-delimited session ids, OLDEST FIRST, deduped.
//   Blank lines are ignored. Absent file = no daemon sessions on record.
//
// Concurrency: the cron scheduler fans out across vaults inside ONE machine process, so writers
// interleave on the event loop rather than across OSprocesses — a per-vault async lock makes the
// read→compute→write sequence atomic. Steady-state writes are a bare O_APPEND of one short line
// (atomic under POSIX, and crash-safe in a way a full rewrite is not); only a prune rewrites the
// file, via temp-then-rename.
import { readFile, writeFile, appendFile, mkdir, rename } from "node:fs/promises"
import { join } from "node:path"
import type { VaultContext } from "../lib/config.ts"

/** Keep at most this many ids. A daemon mints roughly one session per cron fire (~50/day for the
 *  seeded dream + vault-review crons), so this holds ~40 days of provenance in ~74KB — far beyond
 *  the window any session store retains, while keeping the file cheap to read on every chat-page
 *  open. Oldest ids are dropped first: they name sessions long gone from the store, so forgetting
 *  them cannot resurrect a daemon chat into the picker. */
export const SESSION_IDS_CAP = 2000

/** `<vault>/.daemon/session-ids` — the durable set's path. */
export function sessionIdsFile(ctx: VaultContext): string {
  return join(ctx.daemonDir, "session-ids")
}

/** Parse the file format → ids, oldest first, deduped, blanks dropped. Pure + total. */
export function parseSessionIds(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of text.split("\n")) {
    const id = line.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Serialize ids back to the file format (trailing newline so a later O_APPEND lands on its own
 *  line). Pure. */
export function formatSessionIds(ids: readonly string[]): string {
  return ids.length ? `${ids.join("\n")}\n` : ""
}

/**
 * The durable-set writer, as a pure function: add `id` to `existing`, keeping the newest `cap`.
 * Returns `existing` UNCHANGED (same reference) when the id is already recorded or blank — the
 * caller uses that identity to skip the write entirely, so a repeated session_id in one stream
 * costs nothing. Pure + unit-tested; the IO wrapper below is the only impure part.
 */
export function appendSessionId(existing: readonly string[], id: string, cap: number = SESSION_IDS_CAP): readonly string[] {
  const sid = id.trim()
  if (!sid || existing.includes(sid)) return existing
  const next = [...existing, sid]
  return next.length > cap ? next.slice(next.length - cap) : next
}

// Per-vault async lock. One machine process multiplexes every vault's brain, so concurrent
// fireJob calls are interleaved event-loop turns, not parallel processes: chaining each vault's
// writes onto its own promise makes read→compute→write atomic without a lockfile.
const writeChains = new Map<string, Promise<unknown>>()

function withVaultLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(key) ?? Promise.resolve()
  // Run `fn` whether or not the previous write settled — one failed write must not wedge the chain.
  const run = prev.then(fn, fn)
  writeChains.set(key, run.catch(() => {}))
  return run
}

/** Read the pointer file's current value — the ONE pre-existing daemon session we can still
 *  identify when this vault has no durable set yet (see recordDaemonSessionId). */
async function readPointer(ctx: VaultContext): Promise<string | undefined> {
  try {
    return (await readFile(ctx.sessionFile, "utf-8")).trim() || undefined
  } catch {
    return undefined
  }
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`
  await writeFile(tmp, content, "utf-8")
  await rename(tmp, file)
}

/**
 * Record `id` as daemon-minted for this vault. Called from saveSessionId, so EVERY session the
 * daemon mints lands here — the property the chat-page filter depends on.
 *
 * BACKFILL (one-time, per vault): daemon sessions minted before this file existed have no record
 * here. On the first write for a vault we seed the set from the pointer file (read BEFORE
 * saveSessionId overwrites it), which names the most recent such session.
 *
 * That covers exactly ONE session, which is nowhere near the problem on a vault with real history —
 * the reporting machine had 888 of them. The bulk is recovered separately and independently, by
 * Bismuth core (core/src/chatDaemonLegacy.ts), which scans the store once and identifies daemon
 * sessions by the prompts the daemon itself composed, into a sibling `session-ids-legacy` file that
 * readDaemonSessionIds unions with this one. That is a different file on purpose: it has a
 * different writing PROCESS, so this module's in-process lock stays sufficient for this file. Do
 * not fold the two together without adding cross-process locking.
 *
 * Best-effort: a failure here must never break the daemon's actual work (the caller ignores it).
 */
export async function recordDaemonSessionId(ctx: VaultContext, id: string): Promise<void> {
  const sid = id.trim()
  if (!sid) return
  await withVaultLock(ctx.root, async () => {
    const file = sessionIdsFile(ctx)
    let existing: readonly string[]
    let fresh = false
    try {
      existing = parseSessionIds(await readFile(file, "utf-8"))
    } catch {
      // No durable set yet — first write for this vault. Seed the backfill (above).
      fresh = true
      const prior = await readPointer(ctx)
      existing = prior && prior !== sid ? [prior] : []
    }

    const next = appendSessionId(existing, sid)
    if (next === existing) return // already recorded — nothing to write

    await mkdir(ctx.daemonDir, { recursive: true })
    // Steady state: append one line. Only take the rewrite path when the file doesn't exist yet
    // (a bare append would drop the seeded pointer) or when appendSessionId pruned the head off.
    if (!fresh && next.length === existing.length + 1) {
      await appendFile(file, `${sid}\n`, "utf-8")
      return
    }
    await writeAtomic(file, formatSessionIds(next))
  })
}
