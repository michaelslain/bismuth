// POST /update/apply: a plain apply stays open to every caller, `{ reset: true }` (which moves the
// clone's branch) is owner-only.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createServer } from '../src/server'
import { makeVault, tempDir } from './helpers'

const TOKEN = 'owner-token-for-update-apply-test'
const KEYS = [
    'BISMUTH_RUN_DIR',
    'BISMUTH_DAEMON_DIR',
    'BISMUTH_INSTALL_SRC',
    'BISMUTH_NO_BOOT_DOCTOR',
    'BISMUTH_OWNER_TOKEN',
    'HOME',
] as const
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {}
beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k]
    process.env.BISMUTH_RUN_DIR = tempDir('update-apply-run-')
    process.env.BISMUTH_DAEMON_DIR = tempDir('update-apply-machine-')
    delete process.env.BISMUTH_INSTALL_SRC
    process.env.BISMUTH_NO_BOOT_DOCTOR = '1'
    process.env.BISMUTH_OWNER_TOKEN = TOKEN
    process.env.HOME = tempDir('update-apply-home-')
})
afterEach(() => {
    for (const k of KEYS)
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
})

test('reset to upstream is owner-only; a plain apply is not gated', async () => {
    const server = createServer({ vault: makeVault({ 'a.md': '# a\n' }), port: 0 })
    const post = (body: unknown, headers: Record<string, string>) =>
        fetch(`http://localhost:${server.port}/update/apply`, {
            method: 'POST',
            body: JSON.stringify(body),
            headers,
        })
    try {
        expect((await post({ reset: true }, {})).status).toBe(403)
        expect(
            (await post({ reset: true }, { 'X-Bismuth-Channel': 'chat' })).status,
        ).toBe(403)
        // not a source build here, so both answer with the "unavailable" error phase
        const owner = await post({ reset: true }, { 'X-Bismuth-Token': TOKEN })
        expect(owner.status).toBe(200)
        expect((await owner.json()).phase).toBe('error')
        const plain = await post({}, {})
        expect(plain.status).toBe(200)
        expect((await plain.json()).message).toContain('self-update unavailable')
    } finally {
        server.stop(true)
    }
})

test('cancel with nothing running answers with the current phase', async () => {
    const server = createServer({ vault: makeVault({ 'a.md': '# a\n' }), port: 0 })
    try {
        const r = await fetch(`http://localhost:${server.port}/update/cancel`, {
            method: 'POST',
        })
        expect(r.status).toBe(200)
        const body = await r.json()
        expect(body.phase).not.toBe('cancelled')
        expect(body.cancelling).toBeUndefined()
    } finally {
        server.stop(true)
    }
})
