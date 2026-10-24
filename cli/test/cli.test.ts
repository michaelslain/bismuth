import { expect } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeSampleVault, makeVault } from '../../core/test/helpers'
import { resolveCore } from '../src/http'
import { isolateCliEnv, mockUiControlServer, runCli, test } from './cliHarness'

isolateCliEnv()

test('`bismuth graph --vault <dir>` prints graph JSON with the vault nodes', async () => {
    const { vault } = await makeSampleVault()
    const proc = Bun.spawn(
        ['bun', 'run', 'cli/src/index.ts', 'graph', '--vault', vault],
        {
            stdout: 'pipe',
        },
    )
    const out = await new Response(proc.stdout).text()
    await proc.exited
    expect(proc.exitCode).toBe(0)
    const g = JSON.parse(out)
    expect(g.nodes.some((n: any) => n.id === 'internship')).toBe(true)
    expect(g.nodes.some((n: any) => n.id === 'essay')).toBe(true)
})

// --- visibility CLI gate (core/src/visibilityCliGate.ts), wired at the real dispatch point --------
// End-to-end through an ACTUAL spawned `bismuth` process (not just the gate function's own unit
// tests) — this is the exact invocation shape an agent's Bash tool uses.

test("BISMUTH_AGENT_CHANNEL unset (the owner's own hand) reads a hidden note straight through", async () => {
    const vault = makeVault({
        'Private/secret.md':
            '---\nvisibility: hidden\n---\nTHE-SECRET-STRING-42\n',
    })
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'read',
            'Private/secret.md',
            '--vault',
            vault,
        ],
        {
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env, BISMUTH_AGENT_CHANNEL: undefined },
        },
    )
    const [out, , code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(code).toBe(0)
    expect(out).toContain('THE-SECRET-STRING-42')
})

test('the SAME command with BISMUTH_AGENT_CHANNEL=daemon is refused before it ever reads the file', async () => {
    const vault = makeVault({
        'Private/secret.md':
            '---\nvisibility: hidden\n---\nTHE-SECRET-STRING-42\n',
    })
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'read',
            'Private/secret.md',
            '--vault',
            vault,
        ],
        {
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env, BISMUTH_AGENT_CHANNEL: 'daemon' },
        },
    )
    const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(code).toBe(1)
    expect(out).not.toContain('THE-SECRET-STRING-42')
    expect(err).toContain('Private/secret.md')
})

test('`checkpoint diff` drops hidden paths for an agent against a REAL git repo, via --dir', async () => {
    const vault = makeVault(
        {
            'Private/secret.md':
                '---\nvisibility: hidden\n---\nTHE-SECRET-STRING-42\n',
            'open.md': '# open\n',
        },
        'bismuth-checkpoint-vis-',
    )
    await Bun.spawn(['git', 'init', '-q'], { cwd: vault }).exited
    await Bun.spawn(
        ['git', '-c', 'user.email=t@t.com', '-c', 'user.name=t', 'add', '-A'],
        { cwd: vault },
    ).exited
    await Bun.spawn(
        [
            'git',
            '-c',
            'user.email=t@t.com',
            '-c',
            'user.name=t',
            'commit',
            '-q',
            '-m',
            'initial',
        ],
        { cwd: vault },
    ).exited

    const daemon = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'checkpoint',
            'diff',
            'vis-test',
            '--dir',
            vault,
        ],
        {
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env, BISMUTH_AGENT_CHANNEL: 'daemon' },
        },
    )
    const [daemonOut, , daemonCode] = await Promise.all([
        new Response(daemon.stdout).text(),
        new Response(daemon.stderr).text(),
        daemon.exited,
    ])
    expect(daemonCode).toBe(0)
    expect(daemonOut).not.toContain('THE-SECRET-STRING-42')
    const agentPaths = JSON.parse(daemonOut).files.map((f: any) => f.path)
    expect(agentPaths).toContain('open.md')
    expect(agentPaths).not.toContain('Private/secret.md')

    // The owner (channel unset) still gets the real diff.
    const owner = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'checkpoint',
            'diff',
            'vis-test',
            '--dir',
            vault,
        ],
        {
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env, BISMUTH_AGENT_CHANNEL: undefined },
        },
    )
    const [ownerOut, , ownerCode] = await Promise.all([
        new Response(owner.stdout).text(),
        new Response(owner.stderr).text(),
        owner.exited,
    ])
    expect(ownerCode).toBe(0)
    expect(
        JSON.parse(ownerOut).files.some(
            (f: any) => f.path === 'Private/secret.md',
        ),
    ).toBe(true)
}, 30_000)

// --- `app` group: core discovery precedence + `page` group headless create ---------------------

test('resolveCore precedence: --api > BISMUTH_API > CLAUDE_RELAY_URL > run-registry > :4321', async () => {
    const { writeRunRecord } = await import('../../core/src/runRegistry')
    // Nothing set → default port.
    expect(resolveCore([])).toBe('http://localhost:4321')
    // Run-registry single match. readRunRecords filters dead pids (core/src/runRegistry.ts), so use
    // this test process's own — the one pid guaranteed alive for the test's duration.
    writeRunRecord({ port: 4399, vault: '/v/one', pid: process.pid })
    expect(resolveCore([])).toBe('http://localhost:4399')
    // CLAUDE_RELAY_URL beats the registry.
    process.env.CLAUDE_RELAY_URL = 'http://localhost:5000'
    expect(resolveCore([])).toBe('http://localhost:5000')
    // BISMUTH_API beats CLAUDE_RELAY_URL.
    process.env.BISMUTH_API = 'http://localhost:6000/'
    expect(resolveCore([])).toBe('http://localhost:6000') // trailing slash trimmed
    // --api beats everything.
    expect(resolveCore(['--api', 'http://localhost:7000'])).toBe(
        'http://localhost:7000',
    )
})

test('`bismuth app windows` fails cleanly (no crash) when no app is running', async () => {
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'app',
            'windows',
            '--api',
            'http://localhost:59999',
        ],
        {
            stdout: 'pipe',
            stderr: 'pipe',
        },
    )
    const [, code] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(code).toBe(1) // fail() exits non-zero, doesn't throw an uncaught error
})

// --- `app rename`/`app pin`/`app reorder`: dispatch + arg validation --------------------------
// A tiny in-test mock of POST /ui/command captures exactly what the CLI sent (action + args), so
// these tests prove the argument-building logic in cli/src/commands/app.ts — not just "it didn't
// crash" — without needing a real Bismuth window.

test('`bismuth app rename <tabId> <name>` dispatches rename-tab with {tabId, name}', async () => {
    const mock = mockUiControlServer({ ok: true })
    try {
        const proc = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'app',
                'rename',
                't1',
                'New Name',
                '--api',
                mock.url,
            ],
            {
                stdout: 'pipe',
                stderr: 'pipe',
            },
        )
        const code = await proc.exited
        expect(code).toBe(0)
        expect(mock.calls).toHaveLength(1)
        expect(mock.calls[0]).toMatchObject({
            action: 'rename-tab',
            args: { tabId: 't1', name: 'New Name' },
        })
    } finally {
        mock.stop()
    }
})

test('`bismuth app rename <tabId>` (missing name) fails before ever reaching the network', async () => {
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'app',
            'rename',
            't1',
            '--api',
            'http://localhost:59999',
        ],
        {
            stdout: 'pipe',
            stderr: 'pipe',
        },
    )
    const [err, code] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(code).toBe(1)
    expect(err).toContain('usage: bismuth app rename')
})

test('`bismuth app pin <tabId>` dispatches pin-tab with pinned:true; `--off` sends pinned:false', async () => {
    const mock = mockUiControlServer({ ok: true })
    try {
        const on = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'app',
                'pin',
                't1',
                '--api',
                mock.url,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        expect(await on.exited).toBe(0)
        const off = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'app',
                'pin',
                't1',
                '--off',
                '--api',
                mock.url,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        expect(await off.exited).toBe(0)
        expect(mock.calls).toHaveLength(2)
        expect(mock.calls[0]).toMatchObject({
            action: 'pin-tab',
            args: { tabId: 't1', pinned: true },
        })
        expect(mock.calls[1]).toMatchObject({
            action: 'pin-tab',
            args: { tabId: 't1', pinned: false },
        })
    } finally {
        mock.stop()
    }
})

test('`bismuth app reorder <tabId> <index>` dispatches reorder-tab with a numeric index', async () => {
    const mock = mockUiControlServer({ ok: true })
    try {
        const proc = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'app',
                'reorder',
                't1',
                '2',
                '--api',
                mock.url,
            ],
            {
                stdout: 'pipe',
                stderr: 'pipe',
            },
        )
        const code = await proc.exited
        expect(code).toBe(0)
        expect(mock.calls).toHaveLength(1)
        expect(mock.calls[0]).toMatchObject({
            action: 'reorder-tab',
            args: { tabId: 't1', index: 2 },
        })
    } finally {
        mock.stop()
    }
})

test('`bismuth app reorder <tabId> <index>` rejects a non-integer index before ever reaching the network', async () => {
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'app',
            'reorder',
            't1',
            'notanumber',
            '--api',
            'http://localhost:59999',
        ],
        {
            stdout: 'pipe',
            stderr: 'pipe',
        },
    )
    const [err, code] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(code).toBe(1)
    expect(err).toContain('invalid index')
})

// --- `card review` must honour settings.srs (not the hardcoded SM-2 defaults) ------------------

test('`card review` honours settings.srs instead of the hardcoded defaults', async () => {
    const { readNote } = await import('../../core/src/files')
    const { parseBaseFile } = await import('../../core/src/bases/parse')
    const { applyReviewToRow } = await import('../../core/src/srs/reviewRow')
    const { DEFAULT_SRS } = await import('../../core/src/srs/scheduler')
    const { today } = await import('../src/args')

    const deckPath = 'Deck.md'
    const vault = makeVault({
        '.settings': 'srs:\n  easyGraduatingInterval: 9\n',
        [deckPath]:
            '---\ntype: base\nview: flashcards\n---\n\n| front | back | due | ease | interval |\n| --- | --- | --- | --- | --- |\n| a | b |  |  |  |\n',
    })

    // Capture the pre-review row so the expectation is computed from the SAME input the CLI sees.
    const before = parseBaseFile(await readNote(vault, deckPath), {
        name: 'Deck',
        path: deckPath,
    })
    const expected = applyReviewToRow(
        before.rows[0].note,
        'easy',
        today(),
        { ...DEFAULT_SRS, easyGraduatingInterval: 9 },
        undefined,
    )

    const result = await runCli(
        vault,
        'card',
        'review',
        '--file',
        deckPath,
        '--index',
        '0',
        '--response',
        'easy',
    )
    expect(result.code).toBe(0)

    const after = parseBaseFile(await readNote(vault, deckPath), {
        name: 'Deck',
        path: deckPath,
    })
    expect(after.rows[0].note.interval).toBe(expected.interval)
    // Sanity: the configured value actually diverges from what the hardcoded default would produce.
    expect(expected.interval).not.toBe(DEFAULT_SRS.easyGraduatingInterval)
})

test('`card review` (legacy inline note card) honours settings.srs instead of the hardcoded defaults', async () => {
    const { noteCards } = await import('../../core/src/srs/cards')
    const { schedule, DEFAULT_SRS } =
        await import('../../core/src/srs/scheduler')
    const { today } = await import('../src/args')

    const notePath = 'Card.md'
    const vault = makeVault({
        '.settings': 'srs:\n  easyGraduatingInterval: 9\n',
        [notePath]: 'Q1::A1\n',
    })
    const cardId = `${notePath}::0::0`

    // Independent expectation: the scheduler itself, given the explicit configured value. Only
    // `interval` is asserted below (not `due`) — `due` is derived from "today", and bun's test
    // runner forces its own process clock to UTC while the spawned CLI subprocess uses the real
    // system timezone, so comparing ISO due-dates across that boundary is flaky near midnight UTC.
    const expected = schedule(null, 'easy', today(), {
        ...DEFAULT_SRS,
        easyGraduatingInterval: 9,
    })
    // Sanity: the configured value actually diverges from what the hardcoded default would produce.
    expect(expected.interval).not.toBe(DEFAULT_SRS.easyGraduatingInterval)

    const result = await runCli(vault, 'card', 'review', cardId, 'easy')
    expect(result.code).toBe(0)

    const reviewed = (await noteCards(vault, notePath)).find(
        c => c.id === cardId,
    )
    expect(reviewed?.interval).toBe(expected.interval)
})

test('`bismuth page create` + `page list` author and read back a page headlessly', async () => {
    const { vault } = await makeSampleVault()
    const create = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'page',
            'create',
            'cli-page',
            '--title',
            'From CLI',
            '--body',
            'hello',
            '--vault',
            vault,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [createOut, , createCode] = await Promise.all([
        new Response(create.stdout).text(),
        new Response(create.stderr).text(),
        create.exited,
    ])
    expect(createCode).toBe(0)
    expect(JSON.parse(createOut)).toMatchObject({
        path: '.daemon/pages/cli-page.md',
        slug: 'cli-page',
    })

    const list = Bun.spawn(
        ['bun', 'run', 'cli/src/index.ts', 'page', 'list', '--vault', vault],
        { stdout: 'pipe' },
    )
    const listOut = await new Response(list.stdout).text()
    await list.exited
    const pages = JSON.parse(listOut)
    expect(
        pages.some((p: any) => p.slug === 'cli-page' && p.title === 'From CLI'),
    ).toBe(true)
})

// --- `replace` scoping + snapshot (cli/src/commands/search.ts) --------------------------------

test('`replace --scope <path>` only rewrites the named note', async () => {
    const { readNote } = await import('../../core/src/files')
    const vault = makeVault({
        'A.md': 'target here\n',
        'B.md': 'target here\n',
    })

    const result = await runCli(
        vault,
        'replace',
        'target',
        'changed',
        '--scope',
        'A.md',
    )
    expect(result.code).toBe(0)

    expect(await readNote(vault, 'A.md')).toContain('changed')
    expect(await readNote(vault, 'B.md')).toContain('target')
})

test('a vault-wide replace leaves a git snapshot to undo from', async () => {
    const vault = makeVault({ 'A.md': 'target here\n' })

    const result = await runCli(vault, 'replace', 'target', 'changed')
    expect(result.code).toBe(0)

    const log = await Bun.spawn(['git', '-C', vault, 'log', '--oneline'], {
        stdout: 'pipe',
    })
    const logOut = await new Response(log.stdout).text()
    await log.exited
    expect(logOut.trim()).not.toBe('')
})

test('a snapshot failure warns on stderr but the replace still proceeds', async () => {
    const { mkdirSync, writeFileSync, chmodSync } = await import('node:fs')
    const { readNote } = await import('../../core/src/files')
    const vault = makeVault({ 'A.md': 'target here\n' })

    // First replace git-inits the vault and commits the pre-replace state, then rewrites A.md —
    // leaving an uncommitted change behind for the NEXT snapshot attempt to actually have to commit.
    const first = await runCli(vault, 'replace', 'target', 'changed1')
    expect(first.code).toBe(0)

    // Install a pre-commit hook that always fails, the way the reviewer reproduced the silent bug.
    const hookDir = join(vault, '.git', 'hooks')
    mkdirSync(hookDir, { recursive: true })
    const hookPath = join(hookDir, 'pre-commit')
    writeFileSync(hookPath, '#!/bin/sh\nexit 1\n')
    chmodSync(hookPath, 0o755)

    const before = await Bun.spawn(['git', '-C', vault, 'log', '--oneline'], {
        stdout: 'pipe',
    })
    const commitsBefore = (await new Response(before.stdout).text())
        .trim()
        .split('\n').length

    const result = await runCli(vault, 'replace', 'changed1', 'changed2')
    expect(result.code).toBe(0) // best-effort: the replace still proceeds
    expect(result.err).toContain('warning: snapshot failed')
    expect(await readNote(vault, 'A.md')).toContain('changed2') // the replace itself wasn't blocked

    const after = await Bun.spawn(['git', '-C', vault, 'log', '--oneline'], {
        stdout: 'pipe',
    })
    const commitsAfter = (await new Response(after.stdout).text())
        .trim()
        .split('\n').length
    expect(commitsAfter).toBe(commitsBefore) // the failed snapshot really didn't commit anything
})

// --- `daily --id <n>` selects a configured daily-note type by index (note.ts) -----------------

test('`daily --id <n>` selects a configured daily-note type by index; out-of-range fails naming the count', async () => {
    const vault = makeVault({
        '.settings':
            'dailyNotes:\n' +
            '  - id: journal\n    label: Journal\n    icon: BookOpen\n    folder: Journal\n    fileName: "{{date}} journal"\n    template: ""\n' +
            '  - id: work\n    label: Work\n    icon: Briefcase\n    folder: Work\n    fileName: "{{date}} work"\n    template: ""\n',
    })

    // --id 1 picks the SECOND configured type (Work/), not the first (Journal/). A date-derived
    // filename can't be asserted exactly (bun test forces UTC, the spawned CLI uses local time —
    // see the module docstring on the daily-note filename/timezone caveat), so assert on the
    // stable part: which folder the path landed under.
    const second = await runCli(vault, 'daily', '--id', '1')
    expect(second.code).toBe(0)
    expect(second.json.path.startsWith('Work/')).toBe(true)

    // Out of range fails, naming how many types the vault configures.
    const outOfRange = await runCli(vault, 'daily', '--id', '5')
    expect(outOfRange.code).toBe(1)
    expect(outOfRange.err).toContain('2')
})

test('`daily --id <n>` against a vault with `dailyNotes: []` (explicit empty): --id 0 falls back to the built-in default, --id 1 fails naming 0 configured types', async () => {
    const vault = makeVault({ '.settings': 'dailyNotes: []\n' })

    const zero = await runCli(vault, 'daily', '--id', '0')
    expect(zero.code).toBe(0)
    // The built-in default is { folder: "", fileName: "{{date}}" } → a root-level "<date>.md", no
    // folder prefix. Exact date not asserted (bun test forces UTC; the spawned CLI uses local
    // time — see the earlier daily-note test's note on that mismatch).
    expect(zero.json.path).toMatch(/^\d{4}-\d{2}-\d{2}\.md$/)

    const outOfRange = await runCli(vault, 'daily', '--id', '1')
    expect(outOfRange.code).toBe(1)
    expect(outOfRange.err).toContain('0 daily-note type')
})

// --- `task toggle --status <char>` sets an explicit status instead of the binary toggle -------

test('`task toggle --status <char>` sets an explicit status char; without it, the binary toggle is unchanged', async () => {
    const vault = makeVault({ 'Todo.md': '- [ ] buy milk\n' })
    const { readNote } = await import('../../core/src/files')

    const result = await runCli(
        vault,
        'task',
        'toggle',
        'Todo.md',
        '1',
        '--status',
        '/',
    )
    expect(result.code).toBe(0)
    expect(await readNote(vault, 'Todo.md')).toContain('- [/] buy milk')
})

test('`task toggle --status <multi-char>` is rejected', async () => {
    const vault = makeVault({ 'Todo.md': '- [ ] buy milk\n' })
    const result = await runCli(
        vault,
        'task',
        'toggle',
        'Todo.md',
        '1',
        '--status',
        'ab',
    )
    expect(result.code).toBe(1)
    expect(result.err).toContain('--status')
})

test('`task toggle --status <newline>` is rejected — a control char would silently corrupt the file', async () => {
    const vault = makeVault({ 'Todo.md': '- [ ] buy milk\n' })
    const { readNote } = await import('../../core/src/files')
    const before = await readNote(vault, 'Todo.md')

    const result = await runCli(
        vault,
        'task',
        'toggle',
        'Todo.md',
        '1',
        '--status',
        '\n',
    )
    expect(result.code).toBe(1)
    expect(result.err).toContain('--status')
    expect(await readNote(vault, 'Todo.md')).toBe(before) // the file must be untouched, not half-written
})

test("`task toggle --status <tab>` still round-trips (tab isn't destructive — TASK_LINE's `.` matches it)", async () => {
    const vault = makeVault({ 'Todo.md': '- [ ] buy milk\n' })
    const { readNote } = await import('../../core/src/files')

    const result = await runCli(
        vault,
        'task',
        'toggle',
        'Todo.md',
        '1',
        '--status',
        '\t',
    )
    expect(result.code).toBe(0)
    expect(await readNote(vault, 'Todo.md')).toContain('- [\t] buy milk')
})

// --- `render --theme` / `export --theme` (draw.ts / export.ts) --------------------------------

test('`render --theme light` produces bytes that differ from the default dark theme', async () => {
    const { readFileSync, writeFileSync } = await import('node:fs')
    const { emptyDoc } = await import('../../core/src/drawing/model')
    const dir = mkdtempSync(join(tmpdir(), 'bismuth-draw-render-'))
    const drawPath = join(dir, 'Sketch.draw')
    writeFileSync(drawPath, JSON.stringify(emptyDoc()))
    const darkOut = join(dir, 'dark.png')
    const lightOut = join(dir, 'light.png')

    const dark = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'render',
            drawPath,
            '--out',
            darkOut,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    expect(await dark.exited).toBe(0)
    const light = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'render',
            drawPath,
            '--out',
            lightOut,
            '--theme',
            'light',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    expect(await light.exited).toBe(0)

    expect(
        Buffer.compare(readFileSync(darkOut), readFileSync(lightOut)),
    ).not.toBe(0)
})

test('`render --theme purple` is rejected', async () => {
    const { writeFileSync } = await import('node:fs')
    const { emptyDoc } = await import('../../core/src/drawing/model')
    const dir = mkdtempSync(join(tmpdir(), 'bismuth-draw-render-bad-'))
    const drawPath = join(dir, 'Sketch.draw')
    writeFileSync(drawPath, JSON.stringify(emptyDoc()))

    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'render',
            drawPath,
            '--theme',
            'purple',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(code).toBe(1)
    expect(err).toContain('--theme')
})

test('`export <file.draw> --theme light` produces bytes that differ from the default dark theme', async () => {
    const { readFileSync, writeFileSync } = await import('node:fs')
    const { emptyDoc } = await import('../../core/src/drawing/model')
    const dir = mkdtempSync(join(tmpdir(), 'bismuth-draw-export-'))
    const drawPath = join(dir, 'Sketch.draw')
    writeFileSync(drawPath, JSON.stringify(emptyDoc()))
    const darkOut = join(dir, 'dark.png')
    const lightOut = join(dir, 'light.png')

    const dark = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'export',
            drawPath,
            '--out',
            darkOut,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    expect(await dark.exited).toBe(0)
    const light = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'export',
            drawPath,
            '--out',
            lightOut,
            '--theme',
            'light',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    expect(await light.exited).toBe(0)

    expect(
        Buffer.compare(readFileSync(darkOut), readFileSync(lightOut)),
    ).not.toBe(0)
})

// --- headless `export` honours the vault's own editor.lineHeight (task 4) ---------------------
// bismuth export has no DOM, so it used to always render prose at DEFAULT_PROSE_LEADING
// (exportTheme.ts) no matter what the vault's own editor.lineHeight said — meaning an export of
// the SAME note from two vaults with different line-height settings came out byte-identical on
// leading. Assert the emitted stylesheet's line-height differs between a tight (1.2) and loose
// (1.5) vault.

function lineHeightPxFromHtml(html: string): number {
    // "p { … line-height: <N>px; …" — the prose leading rule (htmlTemplate.ts). `p` and `li` are
    // separate rules (not a combined `p, li` selector), so match `p`'s alone.
    const m = /(?:^|[\s}])p\s*\{[^}]*line-height:\s*([\d.]+)px/.exec(html)
    if (!m)
        throw new Error(
            'could not find "p { … line-height: …px" in exported html',
        )
    return parseFloat(m[1])
}

async function exportNoteHtml(lineHeight: number): Promise<string> {
    const vault = makeVault({
        '.settings': `editor:\n  lineHeight: ${lineHeight}\n`,
        'Note.md': '# Title\n\nSome prose paragraph.\n',
    })
    const dir = mkdtempSync(join(tmpdir(), 'bismuth-export-leading-'))
    const outPath = join(dir, 'Note.html')
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'export',
            'Note.md',
            '--vault',
            vault,
            '--format',
            'html',
            '--out',
            outPath,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const err = await new Response(proc.stderr).text()
    expect(await proc.exited).toBe(0)
    if (err) throw new Error(err)
    const { readFileSync: rf } = await import('node:fs')
    return rf(outPath, 'utf8')
}

test("`export --format html` renders prose line-height from the vault's own editor.lineHeight, not a fixed default", async () => {
    const tight = await exportNoteHtml(1.2)
    const loose = await exportNoteHtml(1.5)
    const tightPx = lineHeightPxFromHtml(tight)
    const loosePx = lineHeightPxFromHtml(loose)
    // 16px prose x (18 * lineHeight) / (editorFontSize 13.5 * proseScale 0.97), rounded to the
    // nearest px (htmlTemplate.ts's `rule`) — see cli/src/commands/export.ts's
    // buildPaletteOverride for the same arithmetic run headlessly. proseScale is exportTheme.ts's
    // exported PROSE_SCALE (0.97, Libron's measured x-height ratio) — IBM Plex Serif's was 1.00,
    // Lora's 1.04, CMU Serif's 1.28.
    expect(tightPx).toBe(26) // 16 * (18*1.2)/(13.5*0.97) = 26.39 -> 26
    expect(loosePx).toBe(33) // 16 * (18*1.5)/(13.5*0.97) = 32.99 -> 33
    expect(tightPx).not.toBe(loosePx)
})

// --- `note new` applies the vault's configured default template (note.ts) ---------------------

test("`note new` applies the vault's configured default template when --template is omitted", async () => {
    const vault = makeVault({
        '.settings':
            'templates:\n  folder: Templates\n  newNote: Templates/Default.md\n',
        'Templates/Default.md': '# {{title}}\n\nDefault body.\n',
    })
    const { readNote } = await import('../../core/src/files')

    const result = await runCli(vault, 'note', 'new', 'Quick.md')
    expect(result.code).toBe(0)
    expect(await readNote(vault, 'Quick.md')).toBe('# Quick\n\nDefault body.\n')
})

test("`note new --no-template` skips the vault's configured default template", async () => {
    const vault = makeVault({
        '.settings':
            'templates:\n  folder: Templates\n  newNote: Templates/Default.md\n',
        'Templates/Default.md': '# {{title}}\n\nDefault body.\n',
    })
    const { readNote } = await import('../../core/src/files')

    const result = await runCli(
        vault,
        'note',
        'new',
        'Quick.md',
        '--no-template',
    )
    expect(result.code).toBe(0)
    expect(await readNote(vault, 'Quick.md')).toBe('')
})
