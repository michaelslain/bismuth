// The daemon inbox <-> email bridge. For every enabled vault with settings.daemon.email.enabled:
//  - OUT: a new due inbox page is mailed to the account owner, under a Message-ID only that mail
//    carries; for a page answered by email, the daemon's questions and the final outcome are
//    mailed back in the same thread.
//  - IN: recent INBOX mail FROM the owner, read or not, that answers a page's Message-ID is the owner's reply,
//    in their own words: it goes to core's replyToPage, the same path as the app's reply field,
//    and the daemon's page runtime (pageReply.ts) reads it. Fresh mail to the vault's `address`
//    becomes a new request page, which runs only once a reply or click approves it.
// Runs on the owner device only; nothing listens for connections.
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import {
    createDaemonPage,
    listDaemonPages,
    replyToPage,
    type DaemonPage,
} from '../../../core/src/daemonPages.ts'
import { atomicWriteJson } from '../lib/atomicJson.ts'
import type { VaultContext } from '../lib/config.ts'
import { readEmailConfig, type EmailConfig } from '../lib/emailConfig.ts'
import { isOwner } from '../lib/owner.ts'
import { loadEnabledVaults } from '../lib/registry.ts'
import { safeTick } from '../lib/safeTick.ts'
import {
    composePageEmail,
    composeResultEmail,
    newMessageId,
    pageSubject,
    requestPage,
    sameAddress,
    stripQuoted,
} from './emailFormat.ts'
import {
    createMailTransport,
    type EmailTransport,
    type InboundMail,
    type MailHeader,
    RECEIVE_WINDOW_DAYS,
} from './emailTransport.ts'

/** One mailed page. */
export interface MailedPage {
    messageId: string
    subject: string
    sentAt: string
    /** A reply arrived by email; the daemon's questions and the outcome are mailed back. */
    viaEmail?: boolean
    /** How many entries of the page's thread the owner has seen by email (their own replies
     *  and every question already mailed). */
    threadMailed?: number
    resultSentAt?: string
}

/** `<vault>/.daemon/pages/.email/state.json`. */
export interface BridgeState {
    /** When the bridge first ran for this vault; older pages are never mailed. */
    enabledAt: string
    pages: Record<string, MailedPage>
    /** Message-ID -> when it was handled: what the bridge already acted on. The mailbox's read
     *  flag cannot say, because mail sent to yourself arrives already read. */
    handled?: Record<string, string>
}

/** Retention passed to listDaemonPages: the schema's maximum, so the bridge's read never
 *  garbage-collects a page sooner than the user's own daemon.inboxRetentionDays would. */
const LIST_RETENTION_DAYS = 90

export async function readBridgeState(
    ctx: VaultContext,
    now: Date,
): Promise<BridgeState> {
    try {
        const raw = JSON.parse(await readFile(ctx.emailStateFile, 'utf-8'))
        if (raw && typeof raw.enabledAt === 'string' && raw.pages)
            return raw as BridgeState
    } catch {
        /* first run */
    }
    return { enabledAt: now.toISOString(), pages: {} }
}

async function saveState(ctx: VaultContext, state: BridgeState): Promise<void> {
    await atomicWriteJson(ctx.emailStateFile, state, { ensureDir: true })
}

function isDue(page: DaemonPage, now: Date): boolean {
    const at = Date.parse(page.deliverAt ?? page.createdAt)
    return Number.isNaN(at) || at <= now.getTime()
}

async function mailPage(
    ctx: VaultContext,
    cfg: EmailConfig,
    transport: EmailTransport,
    state: BridgeState,
    page: DaemonPage,
    now: Date,
    inReplyTo?: string,
): Promise<void> {
    const messageId = newMessageId(page.slug, cfg.from)
    const subject = pageSubject(ctx.name, page.title)
    await transport.send({
        subject,
        text: composePageEmail(page, basename(ctx.root)),
        messageId,
        inReplyTo,
        references: inReplyTo ? [inReplyTo] : undefined,
        page: page.slug,
    })
    state.pages[page.slug] = { messageId, subject, sentAt: now.toISOString() }
    await saveState(ctx, state)
}

async function mailInThread(
    cfg: EmailConfig,
    transport: EmailTransport,
    slug: string,
    rec: MailedPage,
    text: string,
): Promise<void> {
    await transport.send({
        subject: `Re: ${rec.subject}`,
        text,
        messageId: newMessageId(slug, cfg.from),
        inReplyTo: rec.messageId,
        references: [rec.messageId],
        page: slug,
    })
}

/** Mail every new due page, and the outcome of every emailed press that has settled. */
export async function sendOutbound(
    ctx: VaultContext,
    cfg: EmailConfig,
    transport: EmailTransport,
    state: BridgeState,
    now: Date,
): Promise<void> {
    const pages = listDaemonPages(ctx.root, LIST_RETENTION_DAYS)
    const enabledAt = Date.parse(state.enabledAt)
    for (const page of pages) {
        const rec = state.pages[page.slug]
        if (!rec) {
            if (page.status !== 'pending' || !isDue(page, now)) continue
            const created = Date.parse(page.createdAt)
            if (!Number.isNaN(created) && created < enabledAt) continue
            await mailPage(ctx, cfg, transport, state, page, now)
            continue
        }
        if (!rec.viaEmail) continue
        const unseen = (page.thread ?? []).slice(rec.threadMailed ?? 0)
        for (const entry of unseen) {
            if (entry.from === 'daemon')
                await mailInThread(cfg, transport, page.slug, rec, `${entry.text}\n`)
            rec.threadMailed = (rec.threadMailed ?? 0) + 1
            await saveState(ctx, state)
        }
        if (
            !rec.resultSentAt &&
            (page.status === 'done' ||
                page.status === 'failed' ||
                page.status === 'dismissed')
        ) {
            await mailInThread(
                cfg,
                transport,
                page.slug,
                rec,
                composeResultEmail(page.status, page.daemonNote),
            )
            rec.resultSentAt = now.toISOString()
            await saveState(ctx, state)
        }
    }
    // Forget pages that are gone (archived or garbage-collected).
    const live = new Set(pages.map(p => p.slug))
    let pruned = false
    for (const slug of Object.keys(state.pages))
        if (!live.has(slug)) {
            delete state.pages[slug]
            pruned = true
        }
    if (pruned) await saveState(ctx, state)
}

/** The key a message is remembered by once handled. */
const mailKey = (h: MailHeader) => h.messageId || `uid:${h.uid}`

const wasHandled = (
    h: MailHeader,
    vaults: Array<{ state: BridgeState }>,
): boolean => vaults.some(v => v.state.handled?.[mailKey(h)] !== undefined)

/** Drop handled ids older than the receive window plus a day: the search no longer returns them. */
function pruneHandled(state: BridgeState, now: Date): void {
    if (!state.handled) return
    const cutoff = now.getTime() - (RECEIVE_WINDOW_DAYS + 1) * 86_400_000
    for (const [id, at] of Object.entries(state.handled))
        if (Date.parse(at) < cutoff) delete state.handled[id]
}

/** Which mailed page (in which vault) a header answers, by In-Reply-To then References. */
function findThread(
    h: MailHeader,
    vaults: Array<{ ctx: VaultContext; state: BridgeState }>,
): { ctx: VaultContext; state: BridgeState; slug: string } | null {
    const wanted = [h.inReplyTo, ...h.references].filter(Boolean)
    for (const id of wanted)
        for (const v of vaults)
            for (const [slug, rec] of Object.entries(v.state.pages))
                if (rec.messageId === id) return { ...v, slug }
    return null
}

async function handleReply(
    ctx: VaultContext,
    cfg: EmailConfig,
    transport: EmailTransport,
    state: BridgeState,
    slug: string,
    mail: InboundMail,
): Promise<void> {
    const rec = state.pages[slug]
    if (!rec) return
    const page = listDaemonPages(ctx.root, LIST_RETENTION_DAYS).find(
        p => p.slug === slug,
    )
    if (!page) {
        await mailInThread(cfg, transport, slug, rec, 'That page is gone; it was archived or cleaned up.\n')
        return
    }
    const text = stripQuoted(mail.text)
    if (!text) return
    const result = replyToPage(ctx.root, page.path, text, 'email')
    if (result.alreadyResolved) {
        await mailInThread(
            cfg,
            transport,
            slug,
            rec,
            result.status === 'working'
                ? 'Still working on your last answer; this reply was not used.\n'
                : `This page is already ${result.status}; nothing changed.\n`,
        )
        return
    }
    rec.viaEmail = true
    // Everything up to and including this reply is the owner's own knowledge.
    rec.threadMailed = (page.thread ?? []).length + 1
    delete rec.resultSentAt
    await saveState(ctx, state)
    console.log(`[email] "${slug}" got a reply by email (${ctx.name})`)
}

async function handleRequest(
    ctx: VaultContext,
    cfg: EmailConfig,
    transport: EmailTransport,
    state: BridgeState,
    mail: InboundMail,
    now: Date,
): Promise<void> {
    const input = requestPage(mail.subject, mail.text, now)
    createDaemonPage(ctx.root, input)
    const page = listDaemonPages(ctx.root, LIST_RETENTION_DAYS).find(
        p => p.slug === input.slug,
    )
    if (page)
        await mailPage(ctx, cfg, transport, state, page, now, mail.messageId || undefined)
    console.log(`[email] request "${input.slug}" filed from email (${ctx.name})`)
}

/** Read the owner's new replies and requests across every bridged vault. */
export async function receiveInbound(
    cfg: EmailConfig,
    transport: EmailTransport,
    vaults: Array<{ ctx: VaultContext; state: BridgeState }>,
    now: Date,
): Promise<void> {
    // A request must postdate the bridge, or turning it on would file the last days' mail.
    const requestVault = (h: MailHeader) =>
        vaults.find(
            v =>
                v.ctx.email.address &&
                h.to.some(t => sameAddress(t, v.ctx.email.address)) &&
                h.date !== null &&
                h.date.getTime() >= Date.parse(v.state.enabledAt),
        )
    await transport.receive(
        h =>
            !h.fromBridge &&
            sameAddress(h.from, cfg.to) &&
            !wasHandled(h, vaults) &&
            (findThread(h, vaults) !== null || requestVault(h) !== undefined),
        async mail => {
            const thread = findThread(mail, vaults)
            const v = thread ?? requestVault(mail)
            if (!v) return
            // Recorded first: a reply that fails halfway is not acted on twice.
            v.state.handled = { ...v.state.handled, [mailKey(mail)]: now.toISOString() }
            await saveState(v.ctx, v.state)
            if (thread)
                return handleReply(thread.ctx, cfg, transport, thread.state, thread.slug, mail)
            await handleRequest(v.ctx, cfg, transport, v.state, mail, now)
        },
    )
}

/** One bridge pass over the given vaults: replies first, so a press is mailed back promptly. */
export async function runEmailBridge(
    vaults: VaultContext[],
    cfg: EmailConfig,
    transport: EmailTransport,
    now: Date = new Date(),
): Promise<void> {
    const bridged = vaults.filter(v => v.email.enabled)
    if (!bridged.length) return
    const withState = await Promise.all(
        bridged.map(async ctx => ({ ctx, state: await readBridgeState(ctx, now) })),
    )
    // Persist a first run's enabledAt before anything else, so pages older than it stay unmailed.
    for (const v of withState) {
        pruneHandled(v.state, now)
        await saveState(v.ctx, v.state)
    }
    await receiveInbound(cfg, transport, withState, now)
    for (const v of withState) await sendOutbound(v.ctx, cfg, transport, v.state, now)
}

// ── Scheduling ──────────────────────────────────────────────────────────────────────────────

const TICK_MS = 15_000
let interval: ReturnType<typeof setInterval> | null = null
let inFlight = false
let lastRunMs = 0
let lastError = ''

/** Log a config or connection problem once, not every poll. */
function reportOnce(msg: string): void {
    if (msg === lastError) return
    lastError = msg
    console.warn(`[email] ${msg}`)
}

async function tick(): Promise<void> {
    if (inFlight) return
    if (!(await isOwner())) return
    const vaults = (await loadEnabledVaults()).filter(v => v.email.enabled)
    if (!vaults.length) return
    const read = await readEmailConfig()
    if ('error' in read) return reportOnce(read.error)
    if (Date.now() - lastRunMs < read.config.pollSeconds * 1000) return
    inFlight = true
    lastRunMs = Date.now()
    try {
        await runEmailBridge(vaults, read.config, createMailTransport(read.config))
        lastError = ''
    } catch (e) {
        reportOnce(`mail check failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
        inFlight = false
    }
}

export function startEmailBridge(): void {
    if (interval !== null) return
    interval = setInterval(() => void safeTick('email', tick), TICK_MS)
}

export function stopEmailBridge(): void {
    if (interval !== null) {
        clearInterval(interval)
        interval = null
    }
}
