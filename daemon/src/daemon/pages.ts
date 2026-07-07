// The daemon-inbox execution runtime: fires the ONE approved action for a daemon-authored page
// (core/src/daemonPages.ts writes the page + its dynamic sidecar, .daemon/pages/.state/<slug>.json)
// once the user presses an "approve" button. Structurally identical to processTriggers (cron.ts) —
// readdir the trigger dir, dotfilter, owner-gate, unlink-before-process — but a page fires a
// one-shot ISOLATED session (never the persistent vault thread, never resumed), and completion is
// written HERE, deterministically, once the session settles — the LLM's own output is never
// trusted as a status signal (core writes "working" before triggering; this module writes
// "done"/"failed" after, never anything else).
import { join } from "path"
import { readdir, readFile, writeFile, unlink, rename, mkdir } from "fs/promises"
import { sendMessage } from "./session"
import { parseFrontmatter } from "../lib/frontmatter"
import { isOwner } from "../lib/owner"
import type { VaultContext } from "../lib/config.ts"

/** A page's dynamic sidecar, as written by core/src/daemonPages.ts. Only the fields this
 *  runtime reads/writes are typed here — core's PageState is the richer, canonical shape. */
interface PageState {
  status: "pending" | "working" | "done" | "failed" | "dismissed"
  pressedAction?: string
  pressedAt?: string
  prompt?: string
  model?: string
  timeoutSecs?: number
  daemonNote?: string
  completedAt?: string | null
}

// Keyed by `${ctx.root}::${slug}` — mirrors cron.ts's jobKey so two vaults' pages never collide
// and an overlapping trigger poll never double-fires a page already mid-run.
const runningPages = new Set<string>()
const pageKey = (ctx: VaultContext, slug: string): string => `${ctx.root}::${slug}`

async function readPageState(ctx: VaultContext, slug: string): Promise<PageState | null> {
  try {
    return JSON.parse(await readFile(join(ctx.pageStateDir, `${slug}.json`), "utf-8")) as PageState
  } catch {
    return null
  }
}

/** Atomic temp-then-rename write — core may be reading this same sidecar (its own poll of
 *  GET /daemon/pages) while this runs, so a partial write must never be observable. */
async function writePageState(ctx: VaultContext, slug: string, state: PageState): Promise<void> {
  const file = join(ctx.pageStateDir, `${slug}.json`)
  await mkdir(ctx.pageStateDir, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf-8")
  await rename(tmp, file)
}

/** Trim a session's result down to a short sidecar note — the inbox UI shows this at a glance,
 *  not the full transcript. */
function summarize(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 500 ? trimmed.slice(0, 500) + "…" : trimmed
}

/**
 * Run any approved daemon-inbox action pending for one vault. Called immediately after
 * processTriggers in the same 5s trigger loop (see cron.ts's processAllTriggers) — no separate
 * interval.
 */
export async function processPageTriggers(ctx: VaultContext): Promise<void> {
  let files: string[]
  try {
    files = await readdir(ctx.pageTriggerDir)
  } catch {
    return
  }

  const triggers = files.filter((f) => !f.startsWith("."))
  if (triggers.length === 0) return

  // Not the owner device: idle. Consume the trigger files so they don't pile up, but don't
  // fire — same semantics as processTriggers (cron.ts:693).
  if (!(await isOwner())) {
    for (const slug of triggers) {
      try { await unlink(join(ctx.pageTriggerDir, slug)) } catch {}
    }
    return
  }

  for (const slug of triggers) {
    try { await unlink(join(ctx.pageTriggerDir, slug)) } catch {}

    const key = pageKey(ctx, slug)
    if (runningPages.has(key)) continue // already mid-run — trigger consumed, nothing more to do

    const state = await readPageState(ctx, slug)
    // Core only drops a trigger after writing status "working" with a resolved prompt — a
    // missing sidecar, a non-"working" status, or a missing prompt means there's nothing
    // approved to run (a stale/duplicate trigger, or the page was already resolved elsewhere).
    if (!state || state.status !== "working" || !state.prompt) continue

    let body: string
    try {
      const raw = await readFile(join(ctx.pagesDir, `${slug}.md`), "utf-8")
      // This runtime's frontmatter parser is single-line-only and can't handle the page's
      // nested `actions[]` — but core already resolved that into state.prompt, so the body
      // (the user's exact edited draft) is all this needs.
      body = parseFrontmatter(raw).body
    } catch {
      // Page deleted out from under the trigger — nothing left to act on.
      await writePageState(ctx, slug, {
        ...state,
        status: "failed",
        daemonNote: "Page was deleted before it could be processed.",
        completedAt: new Date().toISOString(),
      })
      continue
    }

    const finalPrompt = `${state.prompt}\n\n---\n${body}`
    runningPages.add(key)
    console.log(`[pages] Firing approved action for "${slug}" (${ctx.name})`)

    // Run in the background: an isolated one-shot session (never the persistent vault thread,
    // never resumed). Completion is written deterministically here in try/catch, not by the LLM.
    void (async () => {
      try {
        const response = await sendMessage(finalPrompt, ctx, {
          newSession: true,
          model: state.model,
          timeoutSecs: state.timeoutSecs,
        })
        await writePageState(ctx, slug, {
          ...state,
          status: "done",
          daemonNote: summarize(response.result),
          completedAt: new Date().toISOString(),
        })
      } catch (err) {
        await writePageState(ctx, slug, {
          ...state,
          status: "failed",
          daemonNote: String(err),
          completedAt: new Date().toISOString(),
        })
      } finally {
        runningPages.delete(key)
      }
    })()
  }
}
