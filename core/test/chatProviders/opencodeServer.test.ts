// Tests for the one PURE function in core/src/chatProviders/opencodeServer.ts —
// opencodeServerEventSessionId, which routes each event off the shared server's global event stream
// to the right chat session. Everything else in that module is effectful (spawns `opencode serve`,
// opens a real HTTP+SSE connection) and untested directly here, matching the codebase's existing
// convention for this kind of driver (chatProviders/acp/driver.ts has no direct tests either — only
// its pure protocol.ts does; chatProviders/opencode.ts itself is likewise untested beyond its pure
// opencodeTranslate.ts). Fixtures below mirror shapes captured live against opencode 1.18.4.
import { describe, expect, test } from 'bun:test'
import {
    opencodeServerEventSessionId,
    stopAllOpencodeServers,
} from '../../src/chatProviders/opencode/opencodeServer'

const SID = 'ses_05009a939ffetx8dxiZyL3yO6d'

describe('opencodeServerEventSessionId', () => {
    test('message.part.delta carries sessionID directly on properties', () => {
        expect(
            opencodeServerEventSessionId({
                type: 'message.part.delta',
                properties: {
                    sessionID: SID,
                    messageID: 'm',
                    partID: 'p',
                    field: 'text',
                    delta: 'x',
                },
            }),
        ).toBe(SID)
    })

    test("message.part.updated falls back to the nested part's sessionID", () => {
        expect(
            opencodeServerEventSessionId({
                type: 'message.part.updated',
                properties: {
                    part: {
                        id: 'prt_1',
                        sessionID: SID,
                        messageID: 'm',
                        type: 'text',
                        text: '',
                    },
                },
            }),
        ).toBe(SID)
    })

    test("message.updated falls back to the nested info's sessionID", () => {
        expect(
            opencodeServerEventSessionId({
                type: 'message.updated',
                properties: {
                    info: { id: 'msg_1', sessionID: SID, role: 'assistant' },
                },
            }),
        ).toBe(SID)
    })

    test("session.created/.updated/.deleted use info.id (the SESSION's own id, not a sessionID field)", () => {
        expect(
            opencodeServerEventSessionId({
                type: 'session.created',
                properties: { info: { id: SID, title: 'x' } },
            }),
        ).toBe(SID)
        expect(
            opencodeServerEventSessionId({
                type: 'session.updated',
                properties: { info: { id: SID, title: 'x' } },
            }),
        ).toBe(SID)
        expect(
            opencodeServerEventSessionId({
                type: 'session.deleted',
                properties: { info: { id: SID, title: 'x' } },
            }),
        ).toBe(SID)
    })

    test("a session.* event's bare info.id is NOT used for other event kinds (that'd be a coincidence, not a session id)", () => {
        expect(
            opencodeServerEventSessionId({
                type: 'some.other.event',
                properties: { info: { id: SID } },
            }),
        ).toBeNull()
    })

    test('permission.asked (the LIVE shape, not the SDK-declared permission.updated) carries sessionID directly', () => {
        expect(
            opencodeServerEventSessionId({
                type: 'permission.asked',
                properties: {
                    id: 'per_1',
                    sessionID: SID,
                    permission: 'bash',
                    patterns: ['echo hi'],
                    metadata: {},
                    tool: { messageID: 'm', callID: 'c' },
                },
            }),
        ).toBe(SID)
    })

    test('no sessionID anywhere, or malformed input, yields null', () => {
        expect(
            opencodeServerEventSessionId({
                type: 'server.connected',
                properties: {},
            }),
        ).toBeNull()
        expect(
            opencodeServerEventSessionId({
                type: 'server.heartbeat',
                properties: {},
            }),
        ).toBeNull()
        expect(opencodeServerEventSessionId(null)).toBeNull()
        expect(opencodeServerEventSessionId('garbage')).toBeNull()
        expect(opencodeServerEventSessionId({})).toBeNull()
    })
})

test('opencode 2 events carry the session in data.sessionID', () => {
    expect(
        opencodeServerEventSessionId({
            id: 'evt_1',
            type: 'session.text.delta',
            data: {
                sessionID: 'ses_v2',
                assistantMessageID: 'msg_1',
                ordinal: 0,
                delta: 'hi',
            },
        }),
    ).toBe('ses_v2')
    expect(
        opencodeServerEventSessionId({
            id: 'evt_0',
            type: 'server.connected',
            data: {},
        }),
    ).toBeNull()
})

// ---- profile slots, against a fake `opencode serve` (test/support/fakeOpencodeServe.ts) ----------
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    ensureOpencodeServer,
    OPENCODE_STREAM_CLOSED,
    registerOpencodeServerListener,
} from '../../src/chatProviders/opencode/opencodeServer'

const fakeDir = mkdtempSync(join(tmpdir(), 'fake-opencode-'))
const fakeBin = join(fakeDir, 'opencode')
writeFileSync(
    fakeBin,
    `#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dir, '../support/fakeOpencodeServe.ts')}" "$@"\n`,
)
chmodSync(fakeBin, 0o755)

const cfg = (n: string) => ({ env: { OPENCODE_CONFIG_CONTENT: n } })
const whoami = async (url: string) =>
    (await (await fetch(url + '/whoami')).json()) as {
        config: string | null
        pid: number
    }

describe('profile slots', () => {
    test('two profiles hold two live servers with different configs', async () => {
        const a = await ensureOpencodeServer(fakeBin, cfg('A'), 'default')
        const b = await ensureOpencodeServer(fakeBin, cfg('B'), 'compact')
        expect(a && b).toBeTruthy()
        expect(a!.url).not.toBe(b!.url)
        expect((await whoami(a!.url)).config).toBe('A')
        expect((await whoami(b!.url)).config).toBe('B')
    })

    test('a config change on one profile leaves the other running', async () => {
        const b0 = await ensureOpencodeServer(fakeBin, undefined, 'compact')
        const a1 = await ensureOpencodeServer(fakeBin, cfg('A2'), 'default')
        expect((await whoami(a1!.url)).config).toBe('A2')
        const b1 = await ensureOpencodeServer(fakeBin, undefined, 'compact')
        expect(b1!.url).toBe(b0!.url)
        expect((await whoami(b1!.url)).config).toBe('B')
    })

    test('a turn on compact does not delay replacing default', async () => {
        const unregister = registerOpencodeServerListener(
            'ses_c',
            () => {},
            'compact',
        )
        try {
            const a = await Promise.race([
                ensureOpencodeServer(fakeBin, cfg('A3'), 'default'),
                new Promise<'late'>(r => setTimeout(() => r('late'), 5000)),
            ])
            expect(a).not.toBe('late')
            expect((await whoami((a as { url: string }).url)).config).toBe('A3')
        } finally {
            unregister()
        }
    })

    test('a stream close on one slot reaches only its listeners', async () => {
        const got: Record<string, unknown[]> = { d: [], c: [] }
        const un1 = registerOpencodeServerListener(
            'ses_d',
            ev => got.d.push(ev),
            'default',
        )
        const un2 = registerOpencodeServerListener(
            'ses_c2',
            ev => got.c.push(ev),
            'compact',
        )
        try {
            const b = await ensureOpencodeServer(fakeBin, undefined, 'compact')
            await fetch(b!.url + '/end-stream')
            const until = Date.now() + 3000
            while (!got.c.length && Date.now() < until)
                await new Promise(r => setTimeout(r, 25))
            expect(got.c).toEqual([{ type: OPENCODE_STREAM_CLOSED }])
            expect(got.d).toEqual([])
        } finally {
            un1()
            un2()
        }
    })
})

describe('stopAllOpencodeServers', () => {
    test('with no server started it is a no-op, and safe to call twice', () => {
        expect(() => {
            stopAllOpencodeServers()
            stopAllOpencodeServers()
        }).not.toThrow()
    })
})
