import { test as bunTest, expect, describe, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeVault } from '../../core/test/helpers'
import { manifestKey } from '../../core/src/gcal/manifest'
import {
    TOKENS,
    makeLeakVault,
    runCli,
    expectNamesHiddenFrom,
    type RunOpts,
} from './visibilityLeak'

// calendar / gcal / relay are `filtered` for agents: the enumeration commands drop hidden notes
// at the source, and an explicit hidden <basePath> is refused by the argv scan. Each test spawns
// the real CLI the way an agent reaches it.
const SPAWN_TIMEOUT_MS = 30_000
const test = (name: string, fn: Parameters<typeof bunTest>[1]) =>
    bunTest(name, fn, SPAWN_TIMEOUT_MS)

const CASES: { name: string; opts: RunOpts }[] = [
    { name: 'owner', opts: { channel: 'owner' } },
    { name: 'chat', opts: { channel: 'chat' } },
    { name: 'daemon via cli', opts: { channel: 'daemon', via: 'cli' } },
    { name: 'daemon via mcp', opts: { channel: 'daemon', via: 'mcp' } },
]

describe('calendar bases', () => {
    for (const { name, opts } of CASES)
        test(`${name}: hidden calendar bases are absent`, async () => {
            makeLeakVault()
            const { code, stdout, stderr } = await runCli(['calendar', 'bases'], opts)
            expect(code, stderr).toBe(0)
            // The visible base is listed (its path), so a filter that drops everything fails.
            expect(stdout).toContain('Cal.md')
            expectNamesHiddenFrom(stdout, opts.channel)
            // The listing prints no event text; a restricted event title must never appear either.
            if (opts.channel !== 'owner')
                expect(stdout).not.toContain(TOKENS.secret)
            else expect(stdout).toContain('Cal Secret')
        })
})

describe('calendar <basePath> subcommands', () => {
    test('calendar list on a hidden base is refused for daemon (cli and mcp)', async () => {
        makeLeakVault()
        for (const via of ['cli', 'mcp'] as const) {
            const r = await runCli(['calendar', 'list', 'Private/Cal Secret.md'], {
                channel: 'daemon',
                via,
            })
            expect(r.code, `via ${via}`).not.toBe(0)
            expect(r.stdout).not.toContain(TOKENS.secret)
            expect(r.stderr).not.toContain(TOKENS.secret)
        }
    })

    test('calendar list on a hidden base: owner sees the event, chat is refused', async () => {
        makeLeakVault()
        const owner = await runCli(['calendar', 'list', 'Private/Cal Secret.md'], {
            channel: 'owner',
        })
        expect(owner.code, owner.stderr).toBe(0)
        expect(owner.stdout).toContain(TOKENS.secret)
        // `Private/Cal Secret.md` is `visibility: hidden`: hidden from chat too.
        const chat = await runCli(['calendar', 'list', 'Private/Cal Secret.md'], {
            channel: 'chat',
        })
        expect(chat.code).not.toBe(0)
        expect(chat.stdout).not.toContain(TOKENS.secret)
    })

    test('calendar list on the visible base works for every channel', async () => {
        makeLeakVault()
        for (const { opts } of CASES) {
            const r = await runCli(['calendar', 'list', 'Cal.md'], opts)
            expect(r.code, r.stderr).toBe(0)
            expect(r.stdout).toContain(TOKENS.open)
        }
    })

    test('a write to a hidden base is refused for daemon', async () => {
        makeLeakVault()
        const r = await runCli(
            ['calendar', 'add', 'Private/Cal Secret.md', '--date', '2026-10-07', '--title', 'x'],
            { channel: 'daemon' },
        )
        expect(r.code).not.toBe(0)
    })
})

/** Rewrite both calendar bases so Google sync is on: `gcal targets` only lists those. */
function enableGcalSync(vault: string) {
    const body = (token: string, id: string, title: string) =>
        `---\n${title}type: base\nview: calendar\ngoogleCalendarSync: true\n---\n\n` +
        `- id: ${id}\n  title: Event ${token}\n  date: 2026-10-05\n`
    writeFileSync(join(vault, 'Cal.md'), body(TOKENS.open, 'ev-open', ''))
    writeFileSync(
        join(vault, 'Private/Cal Secret.md'),
        body(TOKENS.secret, 'ev-secret', 'visibility: hidden\n'),
    )
}

describe('gcal targets', () => {
    for (const { name, opts } of CASES)
        test(`${name}: hidden sync targets are absent`, async () => {
            const { vault } = makeLeakVault()
            enableGcalSync(vault)
            const { code, stdout, stderr } = await runCli(['gcal', 'targets'], opts)
            expect(code, stderr).toBe(0)
            expect(stdout).toContain('Cal.md')
            expectNamesHiddenFrom(stdout, opts.channel)
            if (opts.channel === 'owner') expect(stdout).toContain('Cal Secret')
        })
})

describe('gcal health', () => {
    const saved = process.env.BISMUTH_GCAL_DIR
    afterEach(() => {
        if (saved === undefined) delete process.env.BISMUTH_GCAL_DIR
        else process.env.BISMUTH_GCAL_DIR = saved
    })

    /** A manifest with a namespaced entry for each base, in an isolated gcal dir. */
    function seedManifest(vault: string) {
        const dir = mkdtempSync(join(tmpdir(), 'gcal-health-'))
        mkdirSync(dir, { recursive: true })
        const entry = { calendarId: 'primary', links: {} }
        writeFileSync(
            join(dir, 'sync.json'),
            JSON.stringify({
                bases: {
                    [manifestKey(vault, 'Cal.md')]: entry,
                    [manifestKey(vault, 'Private/Cal Secret.md')]: entry,
                },
            }),
        )
        process.env.BISMUTH_GCAL_DIR = dir
    }

    for (const { name, opts } of CASES)
        test(`${name}: the per-base listing omits hidden bases`, async () => {
            const { vault } = makeLeakVault()
            seedManifest(vault)
            const { code, stdout, stderr } = await runCli(['gcal', 'health'], opts)
            expect(code, stderr).toBe(0)
            expect(stdout).toContain('Cal.md')
            expectNamesHiddenFrom(stdout, opts.channel)
            if (opts.channel === 'owner') expect(stdout).toContain('Cal Secret')
        })

    test('gcal health on a hidden base is refused for daemon', async () => {
        const { vault } = makeLeakVault()
        seedManifest(vault)
        const r = await runCli(['gcal', 'health', 'Private/Cal Secret.md'], {
            channel: 'daemon',
        })
        expect(r.code).not.toBe(0)
        expect(r.stdout).not.toContain('Cal Secret')
    })
})

describe('gcal sync', () => {
    test('a hidden <basePath> is refused for daemon before any request is made', async () => {
        makeLeakVault()
        // Port 0 stub: if the gate failed, the CLI would POST here and the call count would show it.
        let hits = 0
        const server = Bun.serve({
            port: 0,
            fetch: () => {
                hits++
                return Response.json({ pulled: 0 })
            },
        })
        try {
            const r = await runCli(
                ['gcal', 'sync', 'Private/Cal Secret.md', '--api', `http://localhost:${server.port}`],
                { channel: 'daemon' },
            )
            expect(r.code).not.toBe(0)
            expect(hits).toBe(0)
        } finally {
            server.stop(true)
        }
    })
})

/** `runCli` appends the fixture vault when args lack `--vault`; this spawns with NONE (no flag,
 *  no BISMUTH_VAULT), the shape the gate's "no vault resolves" hole needs. */
async function runCliNoVault(
    args: string[],
    opts: RunOpts,
): Promise<{ code: number; stdout: string; stderr: string }> {
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.BISMUTH_AGENT_CHANNEL
    delete env.BISMUTH_MCP_CHANNEL
    delete env.BISMUTH_VAULT
    env.BROWSER = 'none'
    if ((opts.via ?? 'cli') === 'mcp') env.BISMUTH_MCP_CHANNEL = opts.channel
    else env.BISMUTH_AGENT_CHANNEL = opts.channel
    const proc = Bun.spawn(
        ['bun', 'run', join(import.meta.dir, '..', 'src', 'index.ts'), ...args],
        { env, stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { code, stdout, stderr }
}

describe('gcal sync vault requirement', () => {
    for (const via of ['cli', 'mcp'] as const) {
        test(`an agent with no vault is refused before any request: daemon via ${via}`, async () => {
            const { vault } = makeLeakVault()
            let hits = 0
            const server = Bun.serve({
                port: 0,
                fetch: () => {
                    hits++
                    return Response.json({ pulled: 0 })
                },
            })
            try {
                const api = `http://localhost:${server.port}`
                const noVault = await runCliNoVault(
                    ['gcal', 'sync', 'Private/Cal Secret.md', '--api', api],
                    { channel: 'daemon', via },
                )
                expect(noVault.code).not.toBe(0)
                expect(noVault.stderr).toContain('no vault')
                const withVault = await runCli(
                    ['gcal', 'sync', 'Private/Cal Secret.md', '--api', api, '--vault', vault],
                    { channel: 'daemon', via },
                )
                expect(withVault.code).not.toBe(0)
                expect(hits).toBe(0)
            } finally {
                server.stop(true)
            }
        })
    }
})

describe('relay list', () => {
    /** A stub core whose snapshot carries a free-text `lastMessage` quoting restricted tokens. */
    function stubRelay() {
        const server = Bun.serve({
            port: 0,
            fetch: req => {
                if (new URL(req.url).pathname !== '/relay/snapshot')
                    return new Response('nf', { status: 404 })
                return Response.json({
                    sessions: [
                        {
                            sessionId: 's1',
                            terminalId: 't1',
                            cwd: `/work/${TOKENS.open}`,
                            backend: 'claude',
                            lastSeen: 1,
                        },
                    ],
                    subagents: [
                        {
                            agentId: 'a1',
                            parentSessionId: 's1',
                            agentType: 'general',
                            startedAt: 1,
                            done: true,
                            doneAt: 2,
                            lastMessage: `${TOKENS.secret} ${TOKENS.chatty} ${TOKENS.folder}`,
                        },
                    ],
                })
            },
        })
        return { server, api: `http://localhost:${server.port}` }
    }

    for (const { name, opts } of CASES)
        test(`${name}: lastMessage is redacted for agents, kept for the owner`, async () => {
            makeLeakVault()
            const { server, api } = stubRelay()
            try {
                const { code, stdout, stderr } = await runCli(
                    ['relay', 'list', '--api', api],
                    opts,
                )
                expect(code, stderr).toBe(0)
                // Bookkeeping survives for everyone: a filter that drops everything fails.
                expect(stdout).toContain(TOKENS.open)
                expect(stdout).toContain('a1')
                if (opts.channel === 'owner') {
                    for (const t of [TOKENS.secret, TOKENS.chatty, TOKENS.folder])
                        expect(stdout).toContain(t)
                } else {
                    expect(stdout).not.toContain('lastMessage')
                    for (const t of [TOKENS.secret, TOKENS.chatty, TOKENS.folder])
                        expect(stdout).not.toContain(t)
                }
            } finally {
                server.stop(true)
            }
        })
})

describe('fail closed', () => {
    test('an unparseable .settings makes an agent calendar bases exit non-zero with no output', async () => {
        const vault = makeVault({
            '.settings': 'folderVisibility: [unclosed\n  : :\n',
            'Cal.md':
                `---\ntype: base\nview: calendar\n---\n\n- id: e\n  title: ${TOKENS.open}\n  date: 2026-10-05\n`,
        })
        const r = await runCli(['calendar', 'bases', '--vault', vault], {
            channel: 'daemon',
        })
        expect(r.code).not.toBe(0)
        expect(r.stdout).toBe('')
    })

    test('the same vault still serves the owner', async () => {
        const vault = makeVault({
            '.settings': 'folderVisibility: [unclosed\n  : :\n',
            'Cal.md':
                `---\ntype: base\nview: calendar\n---\n\n- id: e\n  title: ${TOKENS.open}\n  date: 2026-10-05\n`,
        })
        const r = await runCli(['calendar', 'bases', '--vault', vault], {
            channel: 'owner',
        })
        expect(r.code, r.stderr).toBe(0)
        expect(r.stdout).toContain('Cal.md')
    })
})
