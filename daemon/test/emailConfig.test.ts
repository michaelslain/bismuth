import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    emailStatus,
    initEmailConfig,
    parseEmailConfig,
    readEmailConfig,
} from '../src/lib/emailConfig'

let dir: string
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'email-config-'))
    process.env.BISMUTH_EMAIL_CONFIG = join(dir, 'sub', 'email.json')
})
afterEach(() => {
    delete process.env.BISMUTH_EMAIL_CONFIG
    rmSync(dir, { recursive: true, force: true })
})

test('top-level user and pass fill both servers; ports follow secure', () => {
    const r = parseEmailConfig({
        to: 'me@x.com',
        user: 'me@x.com',
        pass: 'pw',
        smtp: { host: 'smtp.x.com' },
        imap: { host: 'imap.x.com', secure: false },
        pollSeconds: 1,
    })
    if ('error' in r) throw new Error(r.error)
    expect(r.config.from).toBe('me@x.com')
    expect(r.config.smtp).toEqual({ host: 'smtp.x.com', port: 465, secure: true, user: 'me@x.com', pass: 'pw' })
    expect(r.config.imap.port).toBe(143)
    expect(r.config.pollSeconds).toBe(15)
})

test('a login that is not an address falls back to "to" as the sender', () => {
    const r = parseEmailConfig({ to: 'me@x.com', user: 'me', pass: 'pw', smtp: { host: 'h' }, imap: { host: 'h' } })
    if ('error' in r) throw new Error(r.error)
    expect(r.config.from).toBe('me@x.com')
})

test('each missing piece is named', () => {
    expect(parseEmailConfig([])).toEqual({ error: 'email.json is not a JSON object' })
    expect(parseEmailConfig({ to: 'x' })).toEqual({ error: '"to" is missing or not an address' })
    expect(parseEmailConfig({ to: 'a@b', smtp: {} })).toEqual({ error: 'smtp.host is missing' })
    expect(parseEmailConfig({ to: 'a@b', smtp: { host: 'h', user: 'u' } })).toEqual({
        error: 'smtp.pass is missing (or a top-level "pass")',
    })
})

test('init writes an owner-only template once and never overwrites', async () => {
    expect(await initEmailConfig()).toEqual({ path: process.env.BISMUTH_EMAIL_CONFIG!, created: true })
    expect(statSync(process.env.BISMUTH_EMAIL_CONFIG!).mode & 0o777).toBe(0o600)
    writeFileSync(process.env.BISMUTH_EMAIL_CONFIG!, '{"mine":1}')
    expect((await initEmailConfig()).created).toBe(false)
    expect(readFileSync(process.env.BISMUTH_EMAIL_CONFIG!, 'utf8')).toBe('{"mine":1}')
})

test('status never prints a password', async () => {
    await initEmailConfig()
    const s = await emailStatus()
    expect(s.ok).toBe(true)
    expect(JSON.stringify(s)).not.toContain('app password')
    expect((s.smtp as any).user).toBe('you@gmail.com')
})

test('a missing or broken file reads as an error, not a throw', async () => {
    expect('error' in (await readEmailConfig())).toBe(true)
    await initEmailConfig()
    writeFileSync(process.env.BISMUTH_EMAIL_CONFIG!, '{')
    const r = await readEmailConfig()
    expect('error' in r && r.error).toContain('not valid JSON')
})
