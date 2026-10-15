// The wire half of the inbox <-> email bridge: SMTP out through nodemailer, IMAP in through
// imapflow. emailBridge.ts only sees the EmailTransport interface, so its tests run on a fake and
// this file stays the one place that knows about sockets.
import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { EmailConfig } from '../lib/emailConfig'
import { BRIDGE_HEADER } from './emailFormat'

export interface OutboundMail {
    subject: string
    text: string
    messageId: string
    /** The Message-ID this answers; threads the mail under the page's email. */
    inReplyTo?: string
    references?: string[]
    /** Value of the bridge header; the page slug. */
    page: string
}

/** What the bridge decides on before downloading a message. */
export interface MailHeader {
    uid: number
    messageId: string
    from: string
    to: string[]
    subject: string
    /** The Date header; null when missing or unparsable. */
    date: Date | null
    inReplyTo: string
    references: string[]
    /** Carries the bridge header: the bridge's own outgoing mail. */
    fromBridge: boolean
}

export interface InboundMail extends MailHeader {
    text: string
}

export interface EmailTransport {
    send(mail: OutboundMail): Promise<void>
    /** Look at INBOX mail from the last few days, read or not: mail you send to yourself often
     *  arrives already read. Download and `handle` the ones `select` picks, marking each seen once
     *  `handle` resolves; the bridge's state, not the flag, records what was handled. Mail not
     *  selected is left untouched. */
    receive(
        select: (h: MailHeader) => boolean,
        handle: (m: InboundMail) => Promise<void>,
    ): Promise<void>
}

/** How far back a message still counts as a fresh reply. */
export const RECEIVE_WINDOW_DAYS = 3

const ids = (v: unknown): string[] =>
    String(v ?? '')
        .split(/\s+/)
        .map(s => s.trim())
        .filter(s => s.startsWith('<'))

/** Pull one header's value out of a raw header block (imapflow returns them unparsed). */
function headerValue(block: string, name: string): string {
    const unfolded = block.replace(/\r?\n[ \t]+/g, ' ')
    const re = new RegExp(`^${name}:\\s*(.*)$`, 'im')
    return re.exec(unfolded)?.[1]?.trim() ?? ''
}

export function createMailTransport(cfg: EmailConfig): EmailTransport {
    const smtp = nodemailer.createTransport({
        host: cfg.smtp.host,
        port: cfg.smtp.port,
        secure: cfg.smtp.secure,
        auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
    })

    const imapClient = () =>
        new ImapFlow({
            host: cfg.imap.host,
            port: cfg.imap.port,
            secure: cfg.imap.secure,
            auth: { user: cfg.imap.user, pass: cfg.imap.pass },
            logger: false,
        })

    return {
        async send(mail) {
            await smtp.sendMail({
                from: cfg.from,
                to: cfg.to,
                subject: mail.subject,
                text: mail.text,
                messageId: mail.messageId,
                inReplyTo: mail.inReplyTo,
                references: mail.references,
                headers: { [BRIDGE_HEADER]: mail.page },
            })
        },

        async receive(select, handle) {
            const client = imapClient()
            await client.connect()
            try {
                const lock = await client.getMailboxLock('INBOX')
                try {
                    const since = new Date(
                        Date.now() - RECEIVE_WINDOW_DAYS * 86_400_000,
                    )
                    const uids =
                        (await client.search(
                            { since },
                            { uid: true },
                        )) || []
                    if (!uids.length) return
                    const picked: MailHeader[] = []
                    for await (const msg of client.fetch(
                        uids,
                        {
                            envelope: true,
                            headers: [
                                'references',
                                'in-reply-to',
                                BRIDGE_HEADER.toLowerCase(),
                            ],
                        },
                        { uid: true },
                    )) {
                        const env = msg.envelope
                        const block = msg.headers?.toString('utf-8') ?? ''
                        const h: MailHeader = {
                            uid: msg.uid,
                            messageId: env?.messageId ?? '',
                            from: env?.from?.[0]?.address ?? '',
                            to: [...(env?.to ?? []), ...(env?.cc ?? [])]
                                .map(a => a.address ?? '')
                                .filter(Boolean),
                            subject: env?.subject ?? '',
                            date: env?.date ? new Date(env.date) : null,
                            inReplyTo:
                                env?.inReplyTo ??
                                headerValue(block, 'in-reply-to'),
                            references: ids(headerValue(block, 'references')),
                            fromBridge: !!headerValue(block, BRIDGE_HEADER),
                        }
                        if (select(h)) picked.push(h)
                    }
                    for (const h of picked) {
                        const one = await client.fetchOne(
                            String(h.uid),
                            { source: true },
                            { uid: true },
                        )
                        if (!one || !one.source) continue
                        const parsed = await simpleParser(one.source)
                        await handle({ ...h, text: parsed.text ?? '' })
                        await client.messageFlagsAdd(String(h.uid), ['\\Seen'], {
                            uid: true,
                        })
                    }
                } finally {
                    lock.release()
                }
            } finally {
                await client.logout().catch(() => {})
            }
        },
    }
}

/** Log in to both servers without sending or reading anything (`bismuth daemon email test`). */
export async function verifyMailAccount(cfg: EmailConfig): Promise<void> {
    await nodemailer
        .createTransport({
            host: cfg.smtp.host,
            port: cfg.smtp.port,
            secure: cfg.smtp.secure,
            auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
        })
        .verify()
    const client = new ImapFlow({
        host: cfg.imap.host,
        port: cfg.imap.port,
        secure: cfg.imap.secure,
        auth: { user: cfg.imap.user, pass: cfg.imap.pass },
        logger: false,
    })
    await client.connect()
    await client.logout().catch(() => {})
}
