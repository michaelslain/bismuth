import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    createDaemonPage,
    listDaemonPages,
    readPageState,
} from '../../core/src/daemonPages.ts'
import { vaultPaths, type VaultContext } from '../src/lib/config'
import type { EmailConfig } from '../src/lib/emailConfig'
import { runEmailBridge, readBridgeState } from '../src/daemon/emailBridge'
import type {
    EmailTransport,
    InboundMail,
    MailHeader,
    OutboundMail,
} from '../src/daemon/emailTransport'

const cfg: EmailConfig = {
    to: 'me@example.com',
    from: 'me@example.com',
    smtp: { host: 'h', port: 1, secure: true, user: 'u', pass: 'p' },
    imap: { host: 'h', port: 1, secure: true, user: 'u', pass: 'p' },
    pollSeconds: 60,
}

/** An in-memory mailbox: `sent` collects outgoing mail, `inbox` is what the IMAP search returns,
 *  read or not, like the real transport; `seen` records what was flagged read. */
class FakeTransport implements EmailTransport {
    sent: OutboundMail[] = []
    inbox: InboundMail[] = []
    seen = new Set<number>()
    async send(mail: OutboundMail) {
        this.sent.push(mail)
    }
    async receive(
        select: (h: MailHeader) => boolean,
        handle: (m: InboundMail) => Promise<void>,
    ) {
        for (const m of this.inbox) {
            if (!select(m)) continue
            await handle(m)
            this.seen.add(m.uid)
        }
    }
}

let uid = 1
function mail(over: Partial<InboundMail>): InboundMail {
    return {
        uid: uid++,
        messageId: `<user.${uid}@example.com>`,
        from: 'me@example.com',
        to: ['me@example.com'],
        subject: 'Re: x',
        date: new Date(),
        inReplyTo: '',
        references: [],
        fromBridge: false,
        text: '',
        ...over,
    }
}

let root: string
let ctx: VaultContext
const T0 = new Date('2026-10-13T12:00:00Z')
const later = (s: number) => new Date(T0.getTime() + s * 1000)

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'email-bridge-'))
    ctx = vaultPaths(root, 'Ada')
    ctx.email = { enabled: true, address: 'me+bismuth@example.com' }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const draftPage = (slug = 'reply-drafts') =>
    createDaemonPage(root, {
        slug,
        title: 'Reply drafts ready',
        body: 'Reply to Jane: Q3 budget looks fine.',
        source: 'cron:answer-emails',
        actions: [
            { id: 'send', label: 'Send replies', kind: 'primary', prompt: 'Send each reply.' },
            { id: 'discard', label: 'Discard', kind: 'danger' },
        ],
    })

describe('outbound', () => {
    test('a vault with email off is never touched', async () => {
        ctx.email.enabled = false
        const t = new FakeTransport()
        await runEmailBridge([ctx], cfg, t, T0)
        expect(t.sent).toEqual([])
        expect(existsSync(ctx.emailStateFile)).toBe(false)
    })

    test('pages that predate the bridge are not mailed', async () => {
        draftPage()
        const t = new FakeTransport()
        await runEmailBridge([ctx], cfg, t, later(60))
        expect(t.sent).toEqual([])
    })

    test('a new due page is mailed once, under the bridge header', async () => {
        const t = new FakeTransport()
        await runEmailBridge([ctx], cfg, t, T0) // first run stamps enabledAt
        // createdAt is the real clock; move enabledAt behind it
        const state = await readBridgeState(ctx, T0)
        state.enabledAt = new Date(0).toISOString()
        writeFileSync(ctx.emailStateFile, JSON.stringify(state))
        draftPage()
        await runEmailBridge([ctx], cfg, t, new Date())
        await runEmailBridge([ctx], cfg, t, new Date())
        expect(t.sent).toHaveLength(1)
        expect(t.sent[0]?.subject).toBe('Ada: Reply drafts ready')
        expect(t.sent[0]?.page).toBe('reply-drafts')
        expect(t.sent[0]?.text).toContain('send replies // discard')
    })

    test('a page held by deliverAt waits for it', async () => {
        writeState(new Date(0))
        createDaemonPage(root, { slug: 'later', title: 'L', deliverAt: '2999-01-01T00:00:00Z' })
        const t = new FakeTransport()
        await runEmailBridge([ctx], cfg, t, new Date())
        expect(t.sent).toEqual([])
    })
})

function writeState(enabledAt: Date) {
    mkdirSync(join(ctx.emailStateFile, '..'), { recursive: true })
    writeFileSync(ctx.emailStateFile, JSON.stringify({ enabledAt: enabledAt.toISOString(), pages: {} }))
}

async function mailedPage(t: FakeTransport) {
    writeState(new Date(0))
    draftPage()
    await runEmailBridge([ctx], cfg, t, new Date())
    return t.sent[0]!
}

/** What the daemon's page runtime does to a reply: pageReply.ts's outcomes, written directly. */
function daemonAnswers(next: Record<string, unknown>) {
    const file = join(ctx.pageStateDir, 'reply-drafts.json')
    mkdirSync(ctx.pageStateDir, { recursive: true })
    const s = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
    delete s.reply
    writeFileSync(file, JSON.stringify({ ...s, ...next }))
}

describe('replies', () => {
    test('a reply in plain words goes to the page as a reply, quote cut', async () => {
        const t = new FakeTransport()
        const out = await mailedPage(t)
        t.inbox.push(
            mail({
                inReplyTo: out.messageId,
                text: `yes send it, but tell her Q3 is fine\n\nOn Tue, Oct 13, 2026 at 2:10 PM Ada <me@example.com>\nwrote:\n> old`,
            }),
        )
        await runEmailBridge([ctx], cfg, t, new Date())
        const state = readPageState(root, 'reply-drafts') as any
        expect(state.status).toBe('working')
        expect(state.reply).toEqual(expect.objectContaining({ text: 'yes send it, but tell her Q3 is fine', via: 'email' }))
        expect(existsSync(join(ctx.pageTriggerDir, 'reply-drafts'))).toBe(true)
        expect(t.sent).toHaveLength(1) // nothing mailed until the daemon has read it
        expect(t.seen.size).toBe(1)
    })

    test("the daemon's question comes back in the thread, once, and the answer to it is read", async () => {
        const t = new FakeTransport()
        const out = await mailedPage(t)
        t.inbox.push(mail({ inReplyTo: out.messageId, text: 'hmm' }))
        await runEmailBridge([ctx], cfg, t, new Date())
        const thread = (readPageState(root, 'reply-drafts') as any).thread
        daemonAnswers({ status: 'pending', thread: [...thread, { from: 'daemon', text: 'Send it as is?', at: 'x' }] })
        await runEmailBridge([ctx], cfg, t, new Date())
        await runEmailBridge([ctx], cfg, t, new Date())
        expect(t.sent).toHaveLength(2)
        expect(t.sent[1]?.text).toBe('Send it as is?\n')
        expect(t.sent[1]?.inReplyTo).toBe(out.messageId)
        // replying to the question (References carries the page's id) is read as the next reply
        t.inbox.push(mail({ inReplyTo: t.sent[1]!.messageId, references: [out.messageId, t.sent[1]!.messageId], text: 'yes' }))
        await runEmailBridge([ctx], cfg, t, new Date())
        expect((readPageState(root, 'reply-drafts') as any).reply.text).toBe('yes')
    })

    test('the outcome of an emailed reply is mailed back in the thread, once', async () => {
        const t = new FakeTransport()
        const out = await mailedPage(t)
        t.inbox.push(mail({ inReplyTo: out.messageId, text: 'send' }))
        await runEmailBridge([ctx], cfg, t, new Date())
        daemonAnswers({ status: 'done', daemonNote: 'Sent 1 reply.' })
        await runEmailBridge([ctx], cfg, t, new Date())
        await runEmailBridge([ctx], cfg, t, new Date())
        expect(t.sent).toHaveLength(2)
        expect(t.sent[1]?.subject).toBe('Re: Ada: Reply drafts ready')
        expect(t.sent[1]?.text).toBe('Done.\n\nSent 1 reply.\n')
    })

    test('a dismissal is mailed back', async () => {
        const t = new FakeTransport()
        const out = await mailedPage(t)
        t.inbox.push(mail({ references: ['<other@x>', out.messageId], text: 'no thanks' }))
        await runEmailBridge([ctx], cfg, t, new Date())
        daemonAnswers({ status: 'dismissed' })
        await runEmailBridge([ctx], cfg, t, new Date())
        expect(t.sent[1]?.text).toBe('Dismissed.\n')
    })

    test('a page answered in the app sends nothing back by email', async () => {
        const t = new FakeTransport()
        await mailedPage(t)
        daemonAnswers({ status: 'done', daemonNote: 'x' })
        await runEmailBridge([ctx], cfg, t, new Date())
        expect(t.sent).toHaveLength(1)
    })

    test('mail from anyone but the owner is left unread', async () => {
        const t = new FakeTransport()
        const out = await mailedPage(t)
        t.inbox.push(mail({ from: 'mallory@evil.test', inReplyTo: out.messageId, text: 'send' }))
        await runEmailBridge([ctx], cfg, t, new Date())
        expect(readPageState(root, 'reply-drafts')).toBeNull()
        expect(t.seen.size).toBe(0)
    })

    test("the bridge's own mail is never read back as a reply", async () => {
        const t = new FakeTransport()
        const out = await mailedPage(t)
        t.inbox.push(mail({ fromBridge: true, inReplyTo: out.messageId, text: 'send' }))
        await runEmailBridge([ctx], cfg, t, new Date())
        expect(readPageState(root, 'reply-drafts')).toBeNull()
    })

    test('a reply that arrived already read is still handled, and only once', async () => {
        const t = new FakeTransport()
        const out = await mailedPage(t)
        const reply = mail({ inReplyTo: out.messageId, text: 'send' })
        t.inbox.push(reply)
        t.seen.add(reply.uid) // Gmail marks mail sent to yourself read
        await runEmailBridge([ctx], cfg, t, new Date())
        expect((readPageState(root, 'reply-drafts') as any).reply.text).toBe('send')
        await runEmailBridge([ctx], cfg, t, new Date())
        expect(t.sent).toHaveLength(1) // no "still working" bounce from reading it twice
    })

    test('a second reply while the first is still being read says so', async () => {
        const t = new FakeTransport()
        const out = await mailedPage(t)
        t.inbox.push(mail({ inReplyTo: out.messageId, text: 'send' }))
        t.inbox.push(mail({ inReplyTo: out.messageId, text: 'actually wait' }))
        await runEmailBridge([ctx], cfg, t, new Date())
        expect(t.sent[1]?.text).toBe('Still working on your last answer; this reply was not used.\n')
    })
})

describe('requests', () => {
    test('fresh mail to the vault address files a request page and mails it back', async () => {
        writeState(new Date(0))
        const t = new FakeTransport()
        t.inbox.push(
            mail({
                messageId: '<orig@example.com>',
                to: ['me+bismuth@example.com'],
                subject: 'Summarise this week',
                text: 'what did I write about climbing?',
            }),
        )
        await runEmailBridge([ctx], cfg, t, new Date())
        const pages = listDaemonPages(root, 90)
        expect(pages).toHaveLength(1)
        expect(pages[0]?.source).toBe('email')
        expect(pages[0]?.status).toBe('pending')
        expect(pages[0]?.body.trim()).toBe('what did I write about climbing?')
        expect(t.sent).toHaveLength(1)
        expect(t.sent[0]?.inReplyTo).toBe('<orig@example.com>')
        expect(t.sent[0]?.text).toContain('run // dismiss')
        // and a reply to it goes to the page
        t.inbox.push(mail({ inReplyTo: t.sent[0]!.messageId, text: 'go ahead' }))
        await runEmailBridge([ctx], cfg, t, new Date())
        expect(readPageState(root, pages[0]!.slug)?.status).toBe('working')
    })

    test('mail sent before the bridge was turned on is not filed', async () => {
        writeState(new Date())
        const t = new FakeTransport()
        t.inbox.push(mail({ to: ['me+bismuth@example.com'], date: new Date(Date.now() - 86_400_000), text: 'old' }))
        await runEmailBridge([ctx], cfg, t, new Date())
        expect(listDaemonPages(root, 90)).toEqual([])
    })

    test('with no address set, fresh mail is ignored', async () => {
        ctx.email.address = ''
        const t = new FakeTransport()
        t.inbox.push(mail({ to: ['me+bismuth@example.com'], text: 'hi' }))
        await runEmailBridge([ctx], cfg, t, new Date())
        expect(listDaemonPages(root, 90)).toEqual([])
        expect(t.seen.size).toBe(0)
    })
})
