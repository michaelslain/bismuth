import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { bismuthHome } from './bismuthPaths'

// The mail account the inbox <-> email bridge (daemon/src/daemon/emailBridge.ts) sends and reads
// through. Machine-level and OUTSIDE every vault on purpose: it holds a password, and a vault is
// synced, backed up and read by agents. Each vault opts in with settings.daemon.email.enabled.

/** One mail server. `user`/`pass` fall back to the file's top-level pair. */
export interface MailServer {
    host: string
    port: number
    secure: boolean
    user: string
    pass: string
}

export interface EmailConfig {
    /** The account owner's address: pages are mailed here, and only mail FROM it is acted on. */
    to: string
    /** The sender address on outgoing mail; defaults to the SMTP user when that is an address,
     *  else to `to`. */
    from: string
    smtp: MailServer
    imap: MailServer
    /** Seconds between IMAP checks for replies. */
    pollSeconds: number
}

export const DEFAULT_POLL_SECONDS = 60
export const MIN_POLL_SECONDS = 15

/** `~/.bismuth/email.json`, or `BISMUTH_EMAIL_CONFIG` (tests point it at a temp file). */
export function emailConfigPath(): string {
    return process.env.BISMUTH_EMAIL_CONFIG || bismuthHome('email.json')
}

/** What `bismuth daemon email init` writes: a Gmail-shaped file to fill in. */
export const EMAIL_CONFIG_TEMPLATE = {
    to: 'you@gmail.com',
    user: 'you@gmail.com',
    pass: 'an app password, not your account password',
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    pollSeconds: DEFAULT_POLL_SECONDS,
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

function parseServer(
    raw: unknown,
    name: 'smtp' | 'imap',
    user: string,
    pass: string,
): MailServer | string {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<
        string,
        unknown
    >
    const host = str(r.host)
    if (!host) return `${name}.host is missing`
    const secure = r.secure === undefined ? true : r.secure === true
    const defaultPort =
        name === 'smtp' ? (secure ? 465 : 587) : secure ? 993 : 143
    const port = typeof r.port === 'number' ? r.port : defaultPort
    const u = str(r.user) || user
    const p = typeof r.pass === 'string' && r.pass ? r.pass : pass
    if (!u) return `${name}.user is missing (or a top-level "user")`
    if (!p) return `${name}.pass is missing (or a top-level "pass")`
    return { host, port, secure, user: u, pass: p }
}

/** Validate a parsed email.json. Returns the first problem as a sentence naming the key. */
export function parseEmailConfig(
    raw: unknown,
): { config: EmailConfig } | { error: string } {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return { error: 'email.json is not a JSON object' }
    const r = raw as Record<string, unknown>
    const to = str(r.to)
    if (!to.includes('@')) return { error: '"to" is missing or not an address' }
    const user = str(r.user)
    const pass = typeof r.pass === 'string' ? r.pass : ''
    const smtp = parseServer(r.smtp, 'smtp', user, pass)
    if (typeof smtp === 'string') return { error: smtp }
    const imap = parseServer(r.imap, 'imap', user, pass)
    if (typeof imap === 'string') return { error: imap }
    const poll =
        typeof r.pollSeconds === 'number' ? r.pollSeconds : DEFAULT_POLL_SECONDS
    return {
        config: {
            to,
            // A login that is not an address (some hosts use a plain username) cannot be a sender.
            from: str(r.from) || (smtp.user.includes('@') ? smtp.user : to),
            smtp,
            imap,
            pollSeconds: Math.max(MIN_POLL_SECONDS, poll),
        },
    }
}

/** Read and validate the machine's email.json. Never throws. */
export async function readEmailConfig(): Promise<
    { config: EmailConfig } | { error: string }
> {
    const path = emailConfigPath()
    let text: string
    try {
        text = await readFile(path, 'utf-8')
    } catch {
        return { error: `no mail account: ${path} does not exist` }
    }
    try {
        return parseEmailConfig(JSON.parse(text))
    } catch (e) {
        return {
            error: `${path} is not valid JSON (${e instanceof Error ? e.message : String(e)})`,
        }
    }
}

/** `bismuth daemon email init`: write the template, owner-only (0600), never over a real file. */
export async function initEmailConfig(): Promise<{ path: string; created: boolean }> {
    const path = emailConfigPath()
    try {
        await writeFile(path, JSON.stringify(EMAIL_CONFIG_TEMPLATE, null, 4) + '\n', {
            flag: 'wx',
            mode: 0o600,
        })
        return { path, created: true }
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') return { path, created: false }
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
            await mkdir(dirname(path), { recursive: true })
            return initEmailConfig()
        }
        throw e
    }
}

/** `bismuth daemon email status`: the account as the bridge sees it, passwords left out. */
export async function emailStatus(): Promise<Record<string, unknown>> {
    const path = emailConfigPath()
    const read = await readEmailConfig()
    if ('error' in read) return { path, ok: false, error: read.error }
    const { config: c } = read
    const server = (s: MailServer) => ({ host: s.host, port: s.port, secure: s.secure, user: s.user })
    return {
        path,
        ok: true,
        to: c.to,
        from: c.from,
        smtp: server(c.smtp),
        imap: server(c.imap),
        pollSeconds: c.pollSeconds,
    }
}
