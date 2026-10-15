// Pure halves of the inbox <-> email bridge (emailBridge.ts): what a page looks like as an email,
// how the owner's typed reply is cut out of a mail, and how mail is told apart. No IO, no clock
// reads beyond what the caller passes in, so every rule here is unit-tested directly.
import { randomBytes } from 'node:crypto'

/** Header stamped on every mail the bridge sends, so a mailbox that receives its own mail (the
 *  owner mailing themselves) never reads the bridge's output back as a reply. */
export const BRIDGE_HEADER = 'X-Bismuth-Page'

/** A page action as the bridge needs it — a structural subset of core's PageAction. */
export interface MailAction {
    id: string
    label: string
    prompt?: string
}

export interface MailPage {
    slug: string
    title: string
    body: string
    source?: string
    actions: MailAction[]
}

/** `<bismuth.<slug>.<random>@<domain>>`. The random part is what makes a reply trustworthy: only
 *  someone who received the page's email can quote its Message-ID back. */
export function newMessageId(slug: string, from: string): string {
    const domain = from.split('@')[1] || 'bismuth.local'
    const safe = slug.replace(/[^A-Za-z0-9_-]/g, '-')
    return `<bismuth.${safe}.${randomBytes(9).toString('hex')}@${domain}>`
}

/** Lowercased bare address out of `Name <a@b>` or `a@b`. */
export function bareAddress(addr: string): string {
    const m = /<([^>]+)>/.exec(addr)
    return (m?.[1] ?? addr).trim().toLowerCase()
}

export function sameAddress(a: string, b: string): boolean {
    return bareAddress(a) === bareAddress(b)
}

export function pageSubject(daemonName: string, title: string): string {
    return `${daemonName}: ${title}`
}

/** A page as a plain-text email: the draft, then what answering it does. */
export function composePageEmail(page: MailPage, vaultName: string): string {
    const lines = [page.body.trim() || '(no draft)', '', '-- ']
    if (page.actions.length) {
        lines.push(
            `Reply in your own words: approve it, ask for changes to the draft, or say no. The page's buttons: ${page.actions.map(a => a.label.toLowerCase()).join(' // ')}.`,
        )
    } else lines.push('This page has no buttons; open it in Bismuth to see it.')
    lines.push(
        `From ${vaultName}${page.source ? ` // ${page.source.replace(/^cron:/, '')}` : ''}`,
    )
    return lines.join('\n') + '\n'
}

/** The follow-up mailed in the page's thread once an emailed press settles. */
export function composeResultEmail(
    status: 'done' | 'failed' | 'dismissed',
    note: string | undefined,
): string {
    const head =
        status === 'done'
            ? 'Done.'
            : status === 'failed'
              ? 'Failed. Reply again to retry.'
              : 'Dismissed.'
    return note?.trim() ? `${head}\n\n${note.trim()}\n` : `${head}\n`
}

/** Lines that start the quoted original or a signature in common mail clients. */
const CUT_LINE = [
    /^>/,
    /^On .*wrote:\s*$/,
    /^On .*<[^<>\s]+@[^<>\s]+>\s*$/, // Gmail wraps: "On <date> <name> <addr>", "wrote:" next line
    /^-----\s*Original Message\s*-----/i,
    /^_{8,}\s*$/,
    /^From:\s.+/,
    /^--\s*$/,
    /^Sent from my /,
]

/** The text the person typed: everything above the quoted original and the signature. */
export function stripQuoted(text: string): string {
    const out: string[] = []
    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
        if (CUT_LINE.some(re => re.test(line.trim()))) break
        out.push(line)
    }
    return out.join('\n').trim()
}

/** The page a fresh email to the vault's address becomes: a request the daemon runs only once a
 *  reply or click approves it, so a forged sender alone never makes it act. */
export function requestPage(
    subject: string,
    text: string,
    now: Date,
): {
    slug: string
    title: string
    body: string
    source: string
    actions: Array<MailAction & { kind: 'primary' | 'default'; model?: string; timeout?: number }>
} {
    const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15) // 20261013T141016
    return {
        slug: `email-${stamp.toLowerCase()}-${randomBytes(2).toString('hex')}`,
        title: subject.trim() || 'Email request',
        body: stripQuoted(text) || '(empty email)',
        source: 'email',
        actions: [
            {
                id: 'run',
                label: 'Run',
                kind: 'primary',
                model: 'sonnet',
                timeout: 900,
                prompt: 'The user emailed you this request. Carry it out, then reply with a short summary of what you did.',
            },
            { id: 'dismiss', label: 'Dismiss', kind: 'default' },
        ],
    }
}
