import { expect } from 'bun:test'
import { makeSampleVault, makeVault } from '../../core/test/helpers'
import { isolateCliEnv, runCli, spawnCli, test } from './cliHarness'

isolateCliEnv()

// --- `relay list` (commands/relay.ts) — contract test against a FAKE server -------------------
// core/src/relay.ts's `snapshot()` had ZERO callers before this command. IMPORTANT, stated here
// too (not just in the source header): core/src/server.ts does not expose `GET /relay/snapshot`
// yet, so this command will fail with a normal 404 against a REAL running `bismuth serve`/app
// today. This test proves the CLI's own dispatch/URL/passthrough logic is correct against the
// intended contract — it is not a claim that the real server currently serves this route.

test("`relay list` GETs /relay/snapshot and passes the route's JSON straight through", async () => {
    const calls: { method: string; path: string }[] = []
    const snapshot = {
        sessions: [
            {
                sessionId: 's1',
                terminalId: 't1',
                cwd: '/vault',
                backend: 'claude',
                lastSeen: 1000,
            },
        ],
        subagents: [
            {
                agentId: 'a1',
                parentSessionId: 's1',
                agentType: 'general-purpose',
                startedAt: 900,
                done: false,
            },
        ],
    }
    const server = Bun.serve({
        port: 0,
        fetch: req => {
            const { pathname } = new URL(req.url)
            calls.push({ method: req.method, path: pathname })
            if (req.method === 'GET' && pathname === '/relay/snapshot')
                return Response.json(snapshot)
            return new Response('not found', { status: 404 })
        },
    })
    try {
        const proc = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'relay',
                'list',
                '--api',
                `http://localhost:${server.port}`,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        const [outText, , code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        expect(code).toBe(0)
        expect(calls).toEqual([{ method: 'GET', path: '/relay/snapshot' }])
        expect(JSON.parse(outText)).toEqual(snapshot)
    } finally {
        server.stop(true)
    }
})

test('`relay list` fails cleanly (no crash) when no server is running', async () => {
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'relay',
            'list',
            '--api',
            'http://localhost:59996',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [, code] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(code).toBe(1)
})

// --- `chat` group (commands/chat.ts) — owner-token attach (http.ts) + route contracts + the ----
// --- mandatory proof that a restricted agent channel still can't reach it -----------------------
// `chat` wraps three owner-gated server routes (GET /chat/sessions, GET /chat/session-messages,
// POST /chat/search) that were completely unreachable from any CLI invocation before this task:
// cli/src/http.ts's call() never sent X-Bismuth-Token, so every CLI request looked like a
// non-owner request no matter who ran it. Covered below: (1) http.ts's token attach/omit logic
// directly, (2) each chat subcommand's dispatch against a fake server, and (3) — the mandatory
// security assertion — that a RESTRICTED agent channel is refused before ever reaching the
// network, so the CLI's new owner identity stays confined to the owner's own hand.

test('http.ts call() attaches X-Bismuth-Token when the run registry has a token for the target port', async () => {
    const { call } = await import('../src/http')
    const { writeRunRecord } = await import('../../core/src/runRegistry')
    const seenTokens: (string | null)[] = []
    const server = Bun.serve({
        port: 0,
        fetch: req => {
            seenTokens.push(req.headers.get('x-bismuth-token'))
            return Response.json({ ok: true })
        },
    })
    try {
        writeRunRecord({
            port: server.port!,
            vault: '/v/chat-owner-token-test',
            pid: process.pid,
            token: 'TEST-OWNER-TOKEN-1',
        })
        await call(`http://localhost:${server.port}`, 'GET', '/whatever')
        expect(seenTokens).toEqual(['TEST-OWNER-TOKEN-1'])
    } finally {
        server.stop(true)
    }
})

test('http.ts call() sends NO token header when the run record is missing or tokenless — never crashes, never fabricates', async () => {
    const { call } = await import('../src/http')
    const { writeRunRecord } = await import('../../core/src/runRegistry')
    const seenTokens: (string | null)[] = []
    const server = Bun.serve({
        port: 0,
        fetch: req => {
            seenTokens.push(req.headers.get('x-bismuth-token'))
            return Response.json({ ok: true })
        },
    })
    try {
        // No run record at all for this port.
        await call(`http://localhost:${server.port}`, 'GET', '/whatever')
        // A record exists for this port but carries no token (an older core build, predating the
        // owner-token gate).
        writeRunRecord({
            port: server.port!,
            vault: '/v/chat-tokenless-test',
            pid: process.pid,
        })
        await call(`http://localhost:${server.port}`, 'GET', '/whatever')
        expect(seenTokens).toEqual([null, null])
    } finally {
        server.stop(true)
    }
})

test("`chat list [--scope]` GETs /chat/sessions and passes the route's JSON straight through", async () => {
    const calls: { method: string; path: string; search: string }[] = []
    const sessions = [
        {
            sessionId: 's1',
            summary: 'hello',
            lastModified: 1000,
            origin: 'user',
        },
    ]
    const server = Bun.serve({
        port: 0,
        fetch: req => {
            const u = new URL(req.url)
            calls.push({
                method: req.method,
                path: u.pathname,
                search: u.search,
            })
            if (req.method === 'GET' && u.pathname === '/chat/sessions')
                return Response.json({ sessions })
            return new Response('not found', { status: 404 })
        },
    })
    try {
        const proc = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'chat',
                'list',
                '--scope',
                'daemon',
                '--api',
                `http://localhost:${server.port}`,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        const [outText, , code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        expect(code).toBe(0)
        expect(calls).toEqual([
            { method: 'GET', path: '/chat/sessions', search: '?scope=daemon' },
        ])
        expect(JSON.parse(outText)).toEqual({ sessions })
    } finally {
        server.stop(true)
    }
})

test('`chat read <id> [--provider]` GETs /chat/session-messages and passes frames straight through', async () => {
    const frames = [{ type: 'assistant-text', text: 'hi' }]
    const seen: { path: string; id: string | null; provider: string | null }[] =
        []
    const server = Bun.serve({
        port: 0,
        fetch: req => {
            const u = new URL(req.url)
            seen.push({
                path: u.pathname,
                id: u.searchParams.get('id'),
                provider: u.searchParams.get('provider'),
            })
            if (req.method === 'GET' && u.pathname === '/chat/session-messages')
                return Response.json({ frames })
            return new Response('not found', { status: 404 })
        },
    })
    try {
        const proc = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'chat',
                'read',
                'sess-1',
                '--provider',
                'opencode',
                '--api',
                `http://localhost:${server.port}`,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        const [outText, , code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        expect(code).toBe(0)
        expect(seen).toEqual([
            {
                path: '/chat/session-messages',
                id: 'sess-1',
                provider: 'opencode',
            },
        ])
        expect(JSON.parse(outText)).toEqual({ frames })
    } finally {
        server.stop(true)
    }
})

test('`chat read` (missing id) fails before ever reaching the network', async () => {
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'chat',
            'read',
            '--api',
            'http://localhost:59995',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [err, code] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(code).toBe(1)
    expect(err).toContain('usage: bismuth chat read')
})

test('`chat search <query> [--scope]` POSTs /chat/search with {query, scope} and passes hits straight through', async () => {
    const calls: any[] = []
    const hits = [
        {
            sessionId: 's1',
            summary: 'hi',
            lastModified: 1000,
            origin: 'user',
            snippet: '…hello…',
        },
    ]
    const server = Bun.serve({
        port: 0,
        fetch: async req => {
            const u = new URL(req.url)
            if (req.method === 'POST' && u.pathname === '/chat/search') {
                calls.push(await req.json())
                return Response.json({ hits })
            }
            return new Response('not found', { status: 404 })
        },
    })
    try {
        const proc = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'chat',
                'search',
                'hello',
                '--scope',
                'all',
                '--api',
                `http://localhost:${server.port}`,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        const [outText, , code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        expect(code).toBe(0)
        expect(calls).toEqual([{ query: 'hello', scope: 'all' }])
        expect(JSON.parse(outText)).toEqual({ hits })
    } finally {
        server.stop(true)
    }
})

test('`chat list` fails cleanly (no crash) when no server is running', async () => {
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'chat',
            'list',
            '--api',
            'http://localhost:59994',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [, code] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(code).toBe(1)
})

// SECURITY (MANDATORY per this task's brief): a RESTRICTED agent channel must refuse `chat`
// before it ever reaches the network — otherwise the CLI's new owner-token identity would leak
// past chat transcripts to exactly the caller the owner-token gate exists to keep them from. The
// fake server below would happily serve a session containing a seeded secret string if the CLI
// ever called it; asserting on RAW STDOUT (not just exit code) proves the secret never reached
// the process's own output, and asserting zero server calls proves the gate fired BEFORE any
// network attempt — not that the server merely declined to answer.
test('SECURITY: a RESTRICTED agent channel refuses `chat list` before ever reaching the network — the seeded transcript never appears in stdout', async () => {
    const vault = makeVault({
        'Private/secret.md': '---\nvisibility: hidden\n---\nirrelevant body\n',
    })
    const calls: string[] = []
    const server = Bun.serve({
        port: 0,
        fetch: req => {
            calls.push(new URL(req.url).pathname)
            return Response.json({
                sessions: [
                    { sessionId: 's1', summary: 'SEEDED-TRANSCRIPT-SECRET-99' },
                ],
            })
        },
    })
    try {
        const proc = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'chat',
                'list',
                '--vault',
                vault,
                '--api',
                `http://localhost:${server.port}`,
            ],
            {
                stdout: 'pipe',
                stderr: 'pipe',
                env: { ...process.env, BISMUTH_AGENT_CHANNEL: 'daemon' },
            },
        )
        const [outText, err, code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        expect(code).toBe(1)
        expect(err).toContain('chat')
        expect(outText).not.toContain('SEEDED-TRANSCRIPT-SECRET-99')
        expect(calls).toHaveLength(0) // the gate refused before ever touching the network
    } finally {
        server.stop(true)
    }
})

// Same restricted vault, same command — the owner's own hand (BISMUTH_AGENT_CHANNEL unset) is
// NOT refused. Only the channel differs, proving the block above is about identity, not the vault.
test('the SAME restricted vault does NOT refuse `chat list` for the owner (BISMUTH_AGENT_CHANNEL unset)', async () => {
    const vault = makeVault({
        'Private/secret.md': '---\nvisibility: hidden\n---\nirrelevant body\n',
    })
    const server = Bun.serve({
        port: 0,
        fetch: () => Response.json({ sessions: [] }),
    })
    try {
        const proc = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'chat',
                'list',
                '--vault',
                vault,
                '--api',
                `http://localhost:${server.port}`,
            ],
            {
                stdout: 'pipe',
                stderr: 'pipe',
                env: { ...process.env, BISMUTH_AGENT_CHANNEL: undefined },
            },
        )
        const code = await proc.exited
        expect(code).toBe(0)
    } finally {
        server.stop(true)
    }
})

// --- `task archive` (commands/task.ts) — mirrors POST /tasks/archive, headlessly ----------------

test('`task archive <file>` removes only resolved (done/cancelled) tasks from that note; open/in-progress tasks + other files stay', async () => {
    const { readNote } = await import('../../core/src/files')
    const vault = makeVault({
        'Todo.md':
            '- [ ] open task\n- [x] done task\n- [-] cancelled task\n- [/] in progress\n',
        'Other.md': '- [x] should stay (different file)\n',
    })
    const result = await runCli(vault, 'task', 'archive', 'Todo.md')
    expect(result.code).toBe(0)
    expect(result.json).toEqual({ removed: 2, files: 1 })
    const after = await readNote(vault, 'Todo.md')
    expect(after).toContain('open task')
    expect(after).toContain('in progress')
    expect(after).not.toContain('done task')
    expect(after).not.toContain('cancelled task')
    expect(await readNote(vault, 'Other.md')).toContain('should stay') // untouched — no <file> given, but this call was scoped
})

test('`task archive` (no file) sweeps the whole vault and reports files touched', async () => {
    const { readNote } = await import('../../core/src/files')
    const vault = makeVault({
        'A.md': '- [x] done in A\n- [ ] open in A\n',
        'B.md': '- [-] cancelled in B\n',
        'C.md': '- [ ] nothing resolved here\n',
    })
    const result = await runCli(vault, 'task', 'archive')
    expect(result.code).toBe(0)
    expect(result.json).toEqual({ removed: 2, files: 2 })
    expect(await readNote(vault, 'A.md')).not.toContain('done in A')
    expect(await readNote(vault, 'A.md')).toContain('open in A')
    expect(await readNote(vault, 'B.md')).not.toContain('cancelled in B')
    expect(await readNote(vault, 'C.md')).toContain('nothing resolved here') // untouched — nothing resolved
})

test("`task archive <file>` with nothing to archive reports {removed:0, files:0} and doesn't touch the file", async () => {
    const { readNote } = await import('../../core/src/files')
    const vault = makeVault({ 'Clean.md': '- [ ] still open\n' })
    const before = await readNote(vault, 'Clean.md')
    const result = await runCli(vault, 'task', 'archive', 'Clean.md')
    expect(result.code).toBe(0)
    expect(result.json).toEqual({ removed: 0, files: 0 })
    expect(await readNote(vault, 'Clean.md')).toBe(before)
})

// --- `settings deny-list` (commands/settings.ts) — the visibility preflight, gated correctly ---
// MANDATORY per the task brief: a restricted (agent-channel) caller must get a COUNT, never a
// path list — otherwise the command becomes an enumeration oracle for exactly what it exists to
// protect. `settings` is Tier A ("always-safe") in core/src/visibilityCliGate.ts's command
// classification (by its `settings`-prefixed group, unchanged by this task), so the command
// always RUNS even under a restricted vault + agent channel — the count-only behavior below is
// what actually protects it, not the outer gate refusing the command wholesale.

test('`settings deny-list` — the OWNER (BISMUTH_AGENT_CHANNEL unset) gets the full path list', async () => {
    const vault = makeVault({
        'Private/secret.md': '---\nvisibility: hidden\n---\nsecret body\n',
        'Public.md': '# public\n',
    })
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'settings',
            'deny-list',
            '--vault',
            vault,
        ],
        {
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env, BISMUTH_AGENT_CHANNEL: undefined },
        },
    )
    const [outText, , code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(code).toBe(0)
    expect(JSON.parse(outText)).toEqual({
        channel: 'daemon',
        determined: true,
        count: 1,
        entries: ['Private/secret.md'],
    })
})

test('`settings deny-list` — a RESTRICTED (agent-channel) caller gets a COUNT ONLY, never a path — mandatory security assertion', async () => {
    const vault = makeVault({
        'Private/secret.md': '---\nvisibility: hidden\n---\nsecret body\n',
        'Public.md': '# public\n',
    })
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'settings',
            'deny-list',
            '--vault',
            vault,
        ],
        {
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env, BISMUTH_AGENT_CHANNEL: 'daemon' },
        },
    )
    const [outText, , code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(code).toBe(0) // NOT refused wholesale — Tier A runs; the internal count-only branch is the real protection
    expect(JSON.parse(outText)).toEqual({
        channel: 'daemon',
        determined: true,
        count: 1,
    }) // no `entries` key at all
    expect(outText).not.toContain('secret.md') // belt-and-suspenders: the path never appears anywhere in the raw output
    expect(outText).not.toContain('Private')
})

test('`settings deny-list --channel chat` vs the default `daemon` channel: a chat-only note is visible to chat but restricted for daemon', async () => {
    const vault = makeVault({
        'Draft.md': '---\nvisibility: chat-only\n---\nwork in progress\n',
    })
    const daemonView = await runCli(vault, 'settings', 'deny-list') // default channel = daemon (stricter)
    expect(daemonView.json).toMatchObject({ channel: 'daemon', count: 1 })
    const chatView = await runCli(
        vault,
        'settings',
        'deny-list',
        '--channel',
        'chat',
    )
    expect(chatView.json).toMatchObject({ channel: 'chat', count: 0 })
})

test('`settings deny-list --channel bogus` is rejected before touching the vault', async () => {
    const vault = makeVault({
        'Private/secret.md': '---\nvisibility: hidden\n---\nx\n',
    })
    const result = await runCli(
        vault,
        'settings',
        'deny-list',
        '--channel',
        'bogus',
    )
    expect(result.code).toBe(1)
    expect(result.err).toContain('usage: settings deny-list')
})

// --- `card decks` / `card all` / `card due` / `card note` (commands/card.ts) — real reads --------
// `card review` (the settings.srs wiring) is already covered above. collectDecks/collectCards/
// dueCards/noteCards (core/src/srs/cards.ts) take no config the CLI could drop — compared their
// exported signatures against every call site in card.ts and each is a plain passthrough.

test('`card all`/`card decks`/`card due --deck`/`card note` read real flashcards parsed from tagged notes, skipping untagged ones', async () => {
    const vault = makeVault({
        'Deck.md': '---\ntags: [flashcards/Geo]\n---\n\nQ1::A1\n\nQ2::A2\n',
        'Other.md': '---\ntags: [flashcards]\n---\n\nQ3::A3\n',
        'NotACard.md': '# just a note, no flashcards tag\n',
    })

    const all = await runCli(vault, 'card', 'all')
    expect(all.code).toBe(0)
    expect(all.json).toHaveLength(3) // NotACard.md contributes nothing
    expect(all.json.map((c: any) => c.deck).sort()).toEqual(['', 'Geo', 'Geo'])

    const decks = await runCli(vault, 'card', 'decks')
    expect(decks.code).toBe(0)
    expect(decks.json).toEqual([
        { name: '', total: 1, due: 1 },
        { name: 'Geo', total: 2, due: 2 },
    ])

    const due = await runCli(vault, 'card', 'due', '--deck', 'Geo')
    expect(due.code).toBe(0)
    expect(due.json.map((c: any) => c.question)).toEqual(['Q1', 'Q2']) // filtered to the Geo deck only

    const note = await runCli(vault, 'card', 'note', 'Deck.md')
    expect(note.code).toBe(0)
    expect(note.json.map((c: any) => c.question)).toEqual(['Q1', 'Q2'])
})

test('`card note` (missing path) fails with a usage message', async () => {
    const vault = makeVault({})
    const result = await runCli(vault, 'card', 'note')
    expect(result.code).toBe(1)
    expect(result.err).toContain('usage: card note <path>')
})

// --- `checkpoint advance` / `checkpoint ref` (checkpoint.ts) — real git refs, throwaway repos ----
// `checkpoint diff` (+ the visibility gate over it) is already covered above; these are the other
// two commands in the group. Every repo here is a fresh tmpdir from makeVault(), never this repo —
// per the task's hard constraint, `checkpoint` must never touch this repo's own git refs.

test('`checkpoint ref` reports sha:null before any checkpoint (auto-inits the repo, like `checkpoint diff` does); `checkpoint advance` commits pending changes and moves the ref — verified via a FRESH `checkpoint ref` read and the git log', async () => {
    const repo = makeVault(
        { 'note.md': 'hello\n' },
        'bismuth-checkpoint-advance-',
    )

    const before = await spawnCli([
        'checkpoint',
        'ref',
        'cron-x',
        '--dir',
        repo,
    ])
    expect(before.code).toBe(0)
    expect(JSON.parse(before.out)).toEqual({ ref: 'cron-x', sha: null })

    const advance = await spawnCli([
        'checkpoint',
        'advance',
        'cron-x',
        '--dir',
        repo,
    ])
    expect(advance.code).toBe(0)
    const advanceJson = JSON.parse(advance.out)
    expect(advanceJson.ref).toBe('cron-x')
    expect(advanceJson.head).toBeTruthy()

    const after = await spawnCli(['checkpoint', 'ref', 'cron-x', '--dir', repo])
    expect(after.code).toBe(0)
    expect(JSON.parse(after.out).sha).toBe(advanceJson.head) // the ref really moved, verified via a FRESH read

    const log = await Bun.spawn(['git', '-C', repo, 'log', '--oneline'], {
        stdout: 'pipe',
    })
    const commits = (await new Response(log.stdout).text())
        .trim()
        .split('\n')
        .filter(Boolean)
    expect(commits).toHaveLength(1) // note.md really got committed by advance's default commit-before-op behavior
}, 20_000)

test('`checkpoint advance --no-commit` moves the ref to the CURRENT head without committing pending changes', async () => {
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const repo = makeVault(
        { 'note.md': 'hello\n' },
        'bismuth-checkpoint-nocommit-',
    )

    // Establish a first real commit via a normal advance, then dirty the tree again.
    const first = await spawnCli(['checkpoint', 'advance', 'x', '--dir', repo])
    expect(first.code).toBe(0)
    const firstHead = JSON.parse(first.out).head as string
    writeFileSync(join(repo, 'note.md'), 'dirty, uncommitted\n')

    const result = await spawnCli([
        'checkpoint',
        'advance',
        'x',
        '--dir',
        repo,
        '--no-commit',
    ])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.out).head).toBe(firstHead) // HEAD never moved — nothing was committed

    const status = await Bun.spawn(
        ['git', '-C', repo, 'status', '--porcelain'],
        { stdout: 'pipe' },
    )
    expect((await new Response(status.stdout).text()).trim()).not.toBe('') // the dirty change is still uncommitted
})

test('`checkpoint advance`/`checkpoint ref` (no ref) fail with a usage message naming the command; (no --dir/--vault, BISMUTH_VAULT unset) fails naming the missing dir', async () => {
    const repo = makeVault({}, 'bismuth-checkpoint-argval-')

    const noRefAdvance = await spawnCli([
        'checkpoint',
        'advance',
        '--dir',
        repo,
    ])
    expect(noRefAdvance.code).toBe(1)
    expect(noRefAdvance.err).toContain('usage: checkpoint advance')

    const noRefRef = await spawnCli(['checkpoint', 'ref', '--dir', repo])
    expect(noRefRef.code).toBe(1)
    expect(noRefRef.err).toContain('usage: checkpoint ref')

    const noDir = await spawnCli(['checkpoint', 'advance', 'some-ref'], {
        ...process.env,
        BISMUTH_VAULT: undefined,
    })
    expect(noDir.code).toBe(1)
    expect(noDir.err).toContain('no dir')
})

// --- `page resolve` / `page mark-failed` (page.ts) — dispatch + real sidecar effect --------------
// `page create`/`page list` are already covered above. These fill the mutating paths: a
// pure-dismiss action, an approve action (checked via the trigger file the daemon's
// processPageTriggers polls), an unknown action, and the mark-failed escape hatch — including that
// it never clobbers an already-settled page (per daemonPages.ts's own compare-and-swap doc).

test('`page resolve <path> <actionId>` on a pure-dismiss action (no prompt) settles the page to dismissed and writes NO trigger file', async () => {
    const { vault } = await makeSampleVault()
    const create = await runCli(
        vault,
        'page',
        'create',
        'dismiss-me',
        '--actions',
        JSON.stringify([{ id: 'ok', label: 'OK' }]),
    )
    expect(create.code).toBe(0)
    const path = create.json.path as string

    const resolve = await runCli(vault, 'page', 'resolve', path, 'ok')
    expect(resolve.code).toBe(0)
    expect(resolve.json).toEqual({
        status: 'dismissed',
        alreadyResolved: false,
    })

    const list = await runCli(vault, 'page', 'list')
    expect(list.json.find((p: any) => p.slug === 'dismiss-me').status).toBe(
        'dismissed',
    )

    const { existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    expect(
        existsSync(join(vault, '.daemon', 'pages', '.triggers', 'dismiss-me')),
    ).toBe(false)
})

test("`page resolve <path> <actionId>` on an approve action (has a prompt) sets status:working and drops a trigger file for the daemon's processPageTriggers to poll", async () => {
    const { vault } = await makeSampleVault()
    const create = await runCli(
        vault,
        'page',
        'create',
        'approve-me',
        '--actions',
        JSON.stringify([{ id: 'go', label: 'Go', prompt: 'do the thing' }]),
    )
    const path = create.json.path as string

    const resolve = await runCli(vault, 'page', 'resolve', path, 'go')
    expect(resolve.code).toBe(0)
    expect(resolve.json).toEqual({ status: 'working', alreadyResolved: false })

    const list = await runCli(vault, 'page', 'list')
    expect(list.json.find((p: any) => p.slug === 'approve-me').status).toBe(
        'working',
    )

    const { existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    expect(
        existsSync(join(vault, '.daemon', 'pages', '.triggers', 'approve-me')),
    ).toBe(true)
})

test("`page resolve <path> <bogus-action>` fails naming the action; the page's state is left untouched", async () => {
    const { vault } = await makeSampleVault()
    const create = await runCli(
        vault,
        'page',
        'create',
        'unknown-action',
        '--actions',
        JSON.stringify([{ id: 'ok', label: 'OK' }]),
    )
    const path = create.json.path as string

    const result = await runCli(
        vault,
        'page',
        'resolve',
        path,
        'does-not-exist',
    )
    expect(result.code).toBe(1)
    expect(result.err).toContain('does-not-exist')

    const list = await runCli(vault, 'page', 'list')
    expect(list.json.find((p: any) => p.slug === 'unknown-action').status).toBe(
        'pending',
    ) // untouched
})

test('`page resolve`/`page mark-failed` (missing positionals) fail with a usage message', async () => {
    const { vault } = await makeSampleVault()
    const noPath = await runCli(vault, 'page', 'resolve')
    expect(noPath.code).toBe(1)
    expect(noPath.err).toContain('usage: bismuth page resolve')

    const noAction = await runCli(
        vault,
        'page',
        'resolve',
        '.daemon/pages/x.md',
    )
    expect(noAction.code).toBe(1)
    expect(noAction.err).toContain('usage: bismuth page resolve')

    const noMarkFailedPath = await runCli(vault, 'page', 'mark-failed')
    expect(noMarkFailedPath.code).toBe(1)
    expect(noMarkFailedPath.err).toContain('usage: bismuth page mark-failed')
})

test("`page mark-failed <path>` forces a stuck 'working' page to failed (verified via `page list`), but never re-marks an already-settled (dismissed) page", async () => {
    const { vault } = await makeSampleVault()
    const stuck = await runCli(
        vault,
        'page',
        'create',
        'stuck',
        '--actions',
        JSON.stringify([{ id: 'go', label: 'Go', prompt: 'do it' }]),
    )
    const stuckPath = stuck.json.path as string
    expect(
        (await runCli(vault, 'page', 'resolve', stuckPath, 'go')).json.status,
    ).toBe('working')

    const markFailed = await runCli(vault, 'page', 'mark-failed', stuckPath)
    expect(markFailed.code).toBe(0)
    expect(markFailed.json).toEqual({ ok: true })

    const list1 = await runCli(vault, 'page', 'list')
    expect(list1.json.find((p: any) => p.slug === 'stuck').status).toBe(
        'failed',
    )

    // Compare-and-swap: an already-dismissed page must never be relabeled "failed" by a late click.
    const dismissed = await runCli(
        vault,
        'page',
        'create',
        'already-dismissed',
        '--actions',
        JSON.stringify([{ id: 'ok', label: 'OK' }]),
    )
    const dismissedPath = dismissed.json.path as string
    await runCli(vault, 'page', 'resolve', dismissedPath, 'ok') // -> dismissed
    const markFailed2 = await runCli(
        vault,
        'page',
        'mark-failed',
        dismissedPath,
    )
    expect(markFailed2.code).toBe(0)
    const list2 = await runCli(vault, 'page', 'list')
    expect(
        list2.json.find((p: any) => p.slug === 'already-dismissed').status,
    ).toBe('dismissed') // NOT overwritten
})
