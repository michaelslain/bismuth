// The daemon-inbox execution runtime: fires the ONE approved action for a daemon-authored page
// (core/src/daemonPages.ts writes the page + its dynamic sidecar, .daemon/pages/.state/<slug>.json)
// once the user presses an "approve" button. Structurally identical to processTriggers (cron.ts) —
// listTriggers/consumeTrigger (dotfilter, owner-gate, unlink-before-process) — but a page fires a
// one-shot ISOLATED session (never the persistent vault thread, never resumed), and completion is
// written HERE, deterministically, once the session settles — the LLM's own output is never
// trusted as a status signal (core writes "working" before triggering; this module writes
// "done"/"failed" after, never anything else).
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { sendMessage, composeBackendRefusalNote } from './session'
import { parseFrontmatter } from '../lib/frontmatter'
import { isOwner } from '../lib/owner'
import { consumeTrigger, listTriggers } from '../lib/drainTriggers'
import type { VaultContext } from '../lib/config.ts'
import { atomicWriteJson } from '../lib/atomicJson.ts'
import {
    listDaemonPages,
    resolvePage,
    type ThreadEntry,
} from '../../../core/src/daemonPages.ts'
import { writeFileAtomicSync } from '../../../core/src/atomicWrite.ts'
import {
    buildReplyPrompt,
    exactAction,
    parseDecision,
    replaceBody,
    type ReplyDecision,
} from './pageReply'

/** A page's dynamic sidecar, as written by core/src/daemonPages.ts. Only the fields this
 *  runtime reads/writes are typed here — core's PageState is the richer, canonical shape. */
export interface PageState {
    status: 'pending' | 'working' | 'done' | 'failed' | 'dismissed'
    pressedAction?: string
    pressedAt?: string
    prompt?: string
    model?: string
    timeoutSecs?: number
    daemonNote?: string
    completedAt?: string | null
    reply?: { text: string; at: string; via: 'app' | 'email' }
    thread?: ThreadEntry[]
}

// Keyed by `${ctx.root}::${slug}` — mirrors cron.ts's jobKey so two vaults' pages never collide
// and an overlapping trigger poll never double-fires a page already mid-run.
const runningPages = new Set<string>()
const pageKey = (ctx: VaultContext, slug: string): string =>
    `${ctx.root}::${slug}`

async function readPageState(
    ctx: VaultContext,
    slug: string,
): Promise<PageState | null> {
    try {
        return JSON.parse(
            await readFile(join(ctx.pageStateDir, `${slug}.json`), 'utf-8'),
        ) as PageState
    } catch {
        return null
    }
}

/** Atomic temp-then-rename write — core may be reading this same sidecar (its own poll of
 *  GET /daemon/pages) while this runs, so a partial write must never be observable. */
async function writePageState(
    ctx: VaultContext,
    slug: string,
    state: PageState,
): Promise<void> {
    const file = join(ctx.pageStateDir, `${slug}.json`)
    await atomicWriteJson(file, state, { ensureDir: true })
}

/** Trim a session's result down to a short sidecar note — the inbox UI shows this at a glance,
 *  not the full transcript. */
function summarize(text: string): string {
    const trimmed = text.trim()
    return trimmed.length > 500 ? trimmed.slice(0, 500) + '…' : trimmed
}

/**
 * Run any approved daemon-inbox action pending for one vault. Called immediately after
 * processTriggers in the same 5s trigger loop (see cron.ts's processAllTriggers) — no separate
 * interval.
 */
export async function processPageTriggers(ctx: VaultContext): Promise<void> {
    const triggers = await listTriggers(ctx.pageTriggerDir, isOwner)

    for (const slug of triggers) {
        await consumeTrigger(ctx.pageTriggerDir, slug)

        const key = pageKey(ctx, slug)
        if (runningPages.has(key)) continue // already mid-run — trigger consumed, nothing more to do

        const state = await readPageState(ctx, slug)
        // A plain-language reply (core's replyToPage): read it, then press or ask back.
        if (state?.status === 'working' && state.reply && !state.prompt) {
            runningPages.add(key)
            void readReply(ctx, slug, state).finally(() => runningPages.delete(key))
            continue
        }
        // Core only drops a trigger after writing status "working" with a resolved prompt — a
        // missing sidecar, a non-"working" status, or a missing prompt means there's nothing
        // approved to run (a stale/duplicate trigger, or the page was already resolved elsewhere).
        if (!state || state.status !== 'working' || !state.prompt) continue

        let body: string
        try {
            const raw = await readFile(
                join(ctx.pagesDir, `${slug}.md`),
                'utf-8',
            )
            // This runtime's frontmatter parser is single-line-only and can't handle the page's
            // nested `actions[]` — but core already resolved that into state.prompt, so the body
            // (the user's exact edited draft) is all this needs.
            body = parseFrontmatter(raw).body
        } catch {
            // Page deleted out from under the trigger — nothing left to act on.
            await writePageState(ctx, slug, {
                ...state,
                status: 'failed',
                daemonNote: 'Page was deleted before it could be processed.',
                completedAt: new Date().toISOString(),
            })
            continue
        }

        const finalPrompt = `${state.prompt}\n\n---\n${body}`
        runningPages.add(key)
        console.log(
            `[pages] Firing approved action for "${slug}" (${ctx.name})`,
        )

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
                    status: 'done',
                    // composeBackendRefusalNote: when settings.daemon.backend was silently downgraded to
                    // Claude for this run (vault has hidden notes), say so — otherwise the user reads a
                    // normal "Done" note with no idea it ran on a different backend than requested.
                    daemonNote: composeBackendRefusalNote(
                        summarize(response.result),
                        response.backendRefusal,
                    ),
                    completedAt: new Date().toISOString(),
                })
            } catch (err) {
                await writePageState(ctx, slug, {
                    ...state,
                    status: 'failed',
                    daemonNote: String(err),
                    completedAt: new Date().toISOString(),
                })
            } finally {
                runningPages.delete(key)
            }
        })()
    }
}

/** Retention passed to listDaemonPages: the schema's maximum, so this read never deletes a page
 *  sooner than the user's own daemon.inboxRetentionDays would. */
const LIST_RETENTION_DAYS = 90

/** Ask the model to classify a reply; returns its raw text. Injected so tests run without it. */
export type ReplyClassifier = (prompt: string, ctx: VaultContext) => Promise<string>

const classifyWithDaemon: ReplyClassifier = async (prompt, ctx) =>
    (await sendMessage(prompt, ctx, { newSession: true, model: 'sonnet', timeoutSecs: 120 }))
        .result

/**
 * Turn a reply into a press or a question (pageReply.ts decides; this writes). The page goes back
 * to `pending` first, keeping its thread, because resolvePage refuses a `working` page; a press
 * then drops the action's trigger, which the next poll runs like any click.
 */
export async function readReply(
    ctx: VaultContext,
    slug: string,
    state: PageState,
    classify: ReplyClassifier = classifyWithDaemon,
): Promise<void> {
    const reply = state.reply!
    const thread = state.thread ?? []
    const page = listDaemonPages(ctx.root, LIST_RETENTION_DAYS).find(
        p => p.slug === slug,
    )
    if (!page) {
        await writePageState(ctx, slug, {
            ...state,
            reply: undefined,
            status: 'failed',
            daemonNote: 'Page was deleted before its reply could be read.',
            completedAt: new Date().toISOString(),
        })
        return
    }

    let decision: ReplyDecision
    const exact = exactAction(page.actions, reply.text)
    if (exact) decision = { kind: 'press', actionId: exact.id, draft: null }
    else {
        try {
            decision = parseDecision(
                await classify(buildReplyPrompt({ ...page, thread }, reply.text), ctx),
                page.actions,
            )
        } catch (err) {
            decision = {
                kind: 'ask',
                question: `I couldn't read your reply (${String(err).slice(0, 120)}). Reply again or press a button.`,
            }
        }
    }

    if (decision.kind === 'ask') {
        await writePageState(ctx, slug, {
            status: 'pending',
            thread: [
                ...thread,
                { from: 'daemon', text: decision.question, at: new Date().toISOString() },
            ],
        })
        console.log(`[pages] "${slug}": asked about the reply (${ctx.name})`)
        return
    }

    if (decision.draft !== null) {
        const file = join(ctx.root, page.path)
        writeFileAtomicSync(
            file,
            replaceBody(await readFile(file, 'utf-8'), decision.draft),
        )
    }
    await writePageState(ctx, slug, { status: 'pending', thread })
    resolvePage(ctx.root, page.path, decision.actionId)
    console.log(
        `[pages] "${slug}": reply read as ${decision.actionId}${decision.draft !== null ? ' with a new draft' : ''} (${ctx.name})`,
    )
}
