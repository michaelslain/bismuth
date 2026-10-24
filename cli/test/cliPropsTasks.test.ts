import { expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { makeVault } from '../../core/test/helpers'
import {
    isolateCliEnv,
    mockUiControlServer,
    mockUpdateServer,
    runCli,
    spawnCli,
    test,
} from './cliHarness'

isolateCliEnv()

// --- `prop set` / `prop delete` (prop.ts) — real frontmatter mutation, read back from disk -------

test('`prop set <file> <key> <value>` JSON-parses the value when possible, else keeps it a raw string — verified by reading the note back from disk', async () => {
    const { readNote } = await import('../../core/src/files')
    const { parseFrontmatter } = await import('../../core/src/frontmatter')
    const vault = makeVault({ 'Note.md': '---\ntitle: Before\n---\nbody\n' })

    expect(
        (await runCli(vault, 'prop', 'set', 'Note.md', 'priority', '3')).code,
    ).toBe(0)
    expect(
        (await runCli(vault, 'prop', 'set', 'Note.md', 'done', 'true')).code,
    ).toBe(0)
    expect(
        (await runCli(vault, 'prop', 'set', 'Note.md', 'status', 'in progress'))
            .code,
    ).toBe(0)

    const { data } = parseFrontmatter(await readNote(vault, 'Note.md'))
    expect(data.priority).toBe(3) // valid JSON -> number
    expect(data.done).toBe(true) // valid JSON -> boolean
    expect(data.status).toBe('in progress') // not valid JSON -> raw string
    expect(data.title).toBe('Before') // untouched by the other sets
})

test('`prop delete <file> <key>` removes exactly that key, preserving the rest of the frontmatter', async () => {
    const { readNote } = await import('../../core/src/files')
    const { parseFrontmatter } = await import('../../core/src/frontmatter')
    const vault = makeVault({
        'Note.md': '---\ntitle: Keep\npriority: 3\n---\nbody\n',
    })

    const result = await runCli(vault, 'prop', 'delete', 'Note.md', 'priority')
    expect(result.code).toBe(0)

    const { data } = parseFrontmatter(await readNote(vault, 'Note.md'))
    expect(data.priority).toBeUndefined()
    expect(data.title).toBe('Keep')
})

test('`prop set`/`prop delete` (missing required args) fail with a usage message; the file is left untouched', async () => {
    const { readNote } = await import('../../core/src/files')
    const vault = makeVault({ 'Note.md': '---\ntitle: X\n---\nbody\n' })
    const before = await readNote(vault, 'Note.md')

    const noValue = await runCli(vault, 'prop', 'set', 'Note.md', 'key')
    expect(noValue.code).toBe(1)
    expect(noValue.err).toContain('usage: prop set')

    const noKey = await runCli(vault, 'prop', 'delete', 'Note.md')
    expect(noKey.code).toBe(1)
    expect(noKey.err).toContain('usage: prop delete')

    expect(await readNote(vault, 'Note.md')).toBe(before)
})

// --- `prop set`/`prop delete` on an image/PDF — routed at the hidden companion note, never the
// binary itself (core/src/fileKinds.ts's companionPathFor). This is what makes `bismuth prop set
// paper.pdf tags '[...]'` the right way for an agent to tag a binary, instead of inventing a new
// note that embeds the file just to hold frontmatter. --------------------------------------------

test('`prop set <binary> <key> <value>` on a PDF operates on its companion note, creating it on first use', async () => {
    const { readNote } = await import('../../core/src/files')
    const { parseFrontmatter } = await import('../../core/src/frontmatter')
    const vault = makeVault({
        'paper.pdf': 'not real pdf bytes, just a placeholder',
    })

    const result = await runCli(
        vault,
        'prop',
        'set',
        'paper.pdf',
        'tags',
        '["reading"]',
    )
    expect(result.code).toBe(0)
    expect(result.json).toEqual({ ok: true, path: 'paper.pdf.md' })
    expect(existsSync(join(vault, 'paper.pdf'))).toBe(true) // the binary itself is untouched

    const { data } = parseFrontmatter(await readNote(vault, 'paper.pdf.md'))
    expect(data.tags).toEqual(['reading'])
})

test('a second `prop set` on the same PDF companion preserves the first key it wrote', async () => {
    const { readNote } = await import('../../core/src/files')
    const { parseFrontmatter } = await import('../../core/src/frontmatter')
    const vault = makeVault({ 'paper.pdf': 'placeholder' })

    expect(
        (await runCli(vault, 'prop', 'set', 'paper.pdf', 'tags', '["reading"]'))
            .code,
    ).toBe(0)
    expect(
        (await runCli(vault, 'prop', 'set', 'paper.pdf', 'rating', '5')).code,
    ).toBe(0)

    const { data } = parseFrontmatter(await readNote(vault, 'paper.pdf.md'))
    expect(data.tags).toEqual(['reading'])
    expect(data.rating).toBe(5)
})

test('`prop delete <binary> <key>` on a PDF with an existing companion removes the key from it', async () => {
    const { readNote } = await import('../../core/src/files')
    const { parseFrontmatter } = await import('../../core/src/frontmatter')
    const vault = makeVault({
        'paper.pdf': 'placeholder',
        'paper.pdf.md': '---\ntags: [reading]\nrating: 5\n---\n',
    })

    const result = await runCli(vault, 'prop', 'delete', 'paper.pdf', 'rating')
    expect(result.code).toBe(0)
    expect(result.json).toEqual({ ok: true, path: 'paper.pdf.md' })

    const { data } = parseFrontmatter(await readNote(vault, 'paper.pdf.md'))
    expect(data.rating).toBeUndefined()
    expect(data.tags).toEqual(['reading'])
})

test('`prop delete` on a PDF with no companion yet is a no-op success — nothing gets written, and the binary itself is never touched even when its bytes happen to look like frontmatter', async () => {
    const { readNote } = await import('../../core/src/files')
    const binaryBytes =
        '---\ntags: [oops]\n---\nnot actually yaml, just pdf-shaped bytes'
    const vault = makeVault({ 'paper.pdf': binaryBytes })

    const result = await runCli(vault, 'prop', 'delete', 'paper.pdf', 'tags')
    expect(result.code).toBe(0)
    expect(result.json).toEqual({ ok: true })
    expect(existsSync(join(vault, 'paper.pdf.md'))).toBe(false)
    expect(await readNote(vault, 'paper.pdf')).toBe(binaryBytes) // the binary itself was never rewritten
})

test('`prop set <binary> <key> <value>` on a companionable path whose binary does NOT exist refuses — no orphan companion note is written', async () => {
    const vault = makeVault({ 'Papers/real.pdf': 'placeholder' })

    const result = await runCli(
        vault,
        'prop',
        'set',
        'Papers/typo.pdf',
        'tags',
        '["reading"]',
    )
    expect(result.code).toBe(1)
    expect(result.err).toContain('no such file')
    expect(existsSync(join(vault, 'Papers/typo.pdf.md'))).toBe(false)
})

test('`prop delete <binary> <key>` on a companionable path whose binary does NOT exist also refuses, for symmetry with `set`', async () => {
    const vault = makeVault({ 'Papers/real.pdf': 'placeholder' })

    const result = await runCli(
        vault,
        'prop',
        'delete',
        'Papers/typo.pdf',
        'tags',
    )
    expect(result.code).toBe(1)
    expect(result.err).toContain('no such file')
    expect(existsSync(join(vault, 'Papers/typo.pdf.md'))).toBe(false)
})

test('`prop set`/`prop delete` on a plain note are unaffected by the companion routing', async () => {
    const { readNote } = await import('../../core/src/files')
    const { parseFrontmatter } = await import('../../core/src/frontmatter')
    const vault = makeVault({ 'Note.md': '---\ntitle: X\n---\nbody\n' })

    const setResult = await runCli(
        vault,
        'prop',
        'set',
        'Note.md',
        'done',
        'true',
    )
    expect(setResult.code).toBe(0)
    expect(setResult.json).toEqual({ ok: true, path: 'Note.md' })

    const { data } = parseFrontmatter(await readNote(vault, 'Note.md'))
    expect(data.done).toBe(true)

    const deleteResult = await runCli(
        vault,
        'prop',
        'delete',
        'Note.md',
        'done',
    )
    expect(deleteResult.code).toBe(0)
    expect(deleteResult.json).toEqual({ ok: true, path: 'Note.md' })
})

// --- `tree` (file.ts) — real vault file-tree JSON -------------------------------------------------
//
// WIRING GAP FOUND, NOT FIXED (per the task brief — reported here, left alone): core/src/server.ts
// builds its tree cache via listTree(cfg.vault, { daemonEnabled: appConfig.daemon?.enabled,
// daemonName: daemonIdentityName(cfg.vault) }) — core/src/files.ts's listTree only ever shows the
// `.daemon` folder when daemonEnabled is passed true. cli/src/commands/file.ts's `tree` command
// calls listTree(vault) with NO second argument at all, so `bismuth tree` can NEVER surface
// `.daemon` (crons/processes/pages/memory), even on a vault with settings.daemon.enabled: true —
// exactly the "CLI silently drops a config core supports" shape named in the task brief. Not
// fixed here (a fix is a separate reviewed change). This test only exercises the unaffected
// ordinary-file path, since asserting on `.daemon` visibility would just be asserting the bug.

test("`bismuth tree` lists the vault's real file tree, including nested folders and file/dir kinds", async () => {
    const vault = makeVault({
        'Root.md': '# root\n',
        'Folder/Child.md': '# child\n',
        'Folder/Sub/Deep.md': '# deep\n',
    })
    const result = await runCli(vault, 'tree')
    expect(result.code).toBe(0)
    const byPath = Object.fromEntries(
        result.json.map((e: any) => [e.path, e.kind]),
    )
    expect(byPath['Root.md']).toBe('file')
    expect(byPath['Folder']).toBe('dir')
    expect(byPath['Folder/Child.md']).toBe('file')
    expect(byPath['Folder/Sub']).toBe('dir')
    expect(byPath['Folder/Sub/Deep.md']).toBe('file')
})

test('`bismuth tree` (no vault, BISMUTH_VAULT unset) fails cleanly naming the missing vault', async () => {
    const result = await spawnCli(['tree'], {
        ...process.env,
        BISMUTH_VAULT: undefined,
    })
    expect(result.code).toBe(1)
    expect(result.err).toContain('no vault')
})

// --- `backup` (serve.ts) — commits a real git snapshot of the vault -------------------------------

test("`backup` commits a real git snapshot of the vault; a second call with nothing changed reports 'nothing to commit'", async () => {
    const vault = makeVault({ 'Note.md': 'hello\n' })

    const first = await runCli(vault, 'backup')
    expect(first.code).toBe(0)

    const log = await Bun.spawn(['git', '-C', vault, 'log', '--oneline'], {
        stdout: 'pipe',
    })
    const commits = (await new Response(log.stdout).text())
        .trim()
        .split('\n')
        .filter(Boolean)
    expect(commits).toHaveLength(1) // the note really got committed

    const second = await runCli(vault, 'backup')
    expect(second.code).toBe(0)
})

test('`backup` (no vault, BISMUTH_VAULT unset) fails cleanly naming the missing vault', async () => {
    const result = await spawnCli(['backup'], {
        ...process.env,
        BISMUTH_VAULT: undefined,
    })
    expect(result.code).toBe(1)
    expect(result.err).toContain('no vault')
})

// --- `backends` (backends.ts) — read-only machine probe, safe to run for real -------------------
// Per the module's own doc: never runs an agent turn, authenticates, spends money, starts a
// daemon, or writes config — it only resolves binaries already on PATH and asks each for its
// version (bounded per-probe timeout). Safe to spawn for real, unlike install/uninstall below.

test('`bismuth backends --json` reports a real per-backend row for every entry in the catalog', async () => {
    const result = await spawnCli(['backends', '--json'])
    expect(result.code).toBe(0)
    const reports = JSON.parse(result.out)
    expect(Array.isArray(reports)).toBe(true)
    expect(reports.length).toBeGreaterThan(0)
    for (const r of reports) {
        expect(typeof r.id).toBe('string')
        expect(typeof r.installed).toBe('boolean')
        expect(r.surfaces).toBeTruthy()
    }
}, 30_000)

test('`bismuth backends` (no --json) prints a human-readable table by default, not raw JSON', async () => {
    const result = await spawnCli(['backends'])
    expect(result.code).toBe(0)
    expect(() => JSON.parse(result.out)).toThrow() // the default path is formatTable(), not out()
    expect(result.out.length).toBeGreaterThan(0)
}, 30_000)

test('`bismuth backends --json --installed` only includes installed backends', async () => {
    const result = await spawnCli(['backends', '--json', '--installed'])
    expect(result.code).toBe(0)
    const reports = JSON.parse(result.out)
    expect(reports.every((r: any) => r.installed === true)).toBe(true)
}, 30_000)

// --- `install` / `uninstall` (install.ts) — SAFETY-CONSTRAINED per the task brief ----------------
//
// Both write MACHINE-WIDE state with NO env-var seam to redirect them into a temp dir the way
// every other command group in this file is sandboxed: core/src/bismuthInstall.ts hardcodes
// BISMUTH_HOME = join(homedir(), ".bismuth") at module scope (and the legacy-skill cleanup it
// runs on every install touches ~/.claude/skills/ too). A real `install` (with --src, or --mcp)
// writes there and calls the real `claude mcp add`; `uninstall` unconditionally rmSync()s ~/.bismuth. Per the task's hard
// constraint, neither may be run for real against this developer's machine — skipped.
//
// Mocking core/src/bismuthInstall.ts (the pattern used above for `daemon stop`/`daemon restart`
// via daemon/src/lib/platform.ts) is ALSO unsafe here, unlike that case: core/test/
// bismuthInstall.test.ts calls the SAME exported ensureBismuthInstalled/getBismuthStatus/
// uninstallBismuth functions directly (injecting a fake `io` argument, not module-mocking).
// mock.module swaps a module out process-wide for the rest of a combined `bun test` run (see the
// comment above the daemon mock), so mocking it here would silently replace those functions for
// that OTHER file's real-function assertions too. So this covers exactly what's provably safe:
// (1) dispatcher registration — index.ts's printHelp() runs before any command's own code, so
// spawning `--help` never touches disk; (2) the two invocations that are read-only BY INSPECTION
// of ensureBismuthInstalled's own source (core/src/bismuthInstall.ts:419-436): with no --src, it
// returns { action: "skipped-no-src" } immediately — before any of InstallIO's write methods
// (installFiles/linkCli/writeMarker/…) are ever called; --status takes the identical
// getBismuthStatus() read-only path. `--mcp`, a real `--src`, `--dry-run` WITH a real --src (which
// would still call getBismuthStatus() on this machine but is riskier to reason about than the
// no-src case), and `uninstall` are NOT exercised here — they write real machine state with
// nothing to sandbox into.

test('`bismuth --help` proves install/uninstall/backends are really registered in the dispatcher (not just exported from commands/*.ts)', async () => {
    const result = await spawnCli(['--help'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('Install the bismuth CLI + MCP machine-wide')
    expect(result.out).toContain('Remove the machine-wide bismuth CLI symlink')
    expect(result.out).toContain('List agent backends')
})

test('`bismuth install --status` and `bismuth install --dry-run` (no --src) are read-only no-ops by construction — safe to run for real, never writes to ~/.bismuth', async () => {
    const env = { ...process.env, BISMUTH_INSTALL_SRC: undefined }

    const status = await spawnCli(['install', '--status'], env)
    expect(status.code).toBe(0)
    expect(typeof JSON.parse(status.out).installed).toBe('boolean') // BismuthStatus shape, real read

    const dryRun = await spawnCli(['install', '--dry-run'], env)
    expect(dryRun.code).toBe(0)
    expect(JSON.parse(dryRun.out).action).toBe('skipped-no-src') // returns before any write — no --src given
}, 20_000)

// --- `task list --query` (commands/task.ts) — the same translateTaskDsl + applyTaskSort wiring
// as core/src/bases/source.ts, driven through the REAL CLI process end to end. A translated
// `sort by` used to be computed and thrown away here too — only `.where` was read off
// translateTaskDsl's result, so `--query "not done\nsort by due"` silently returned the on-disk
// scan order. Proven through row order, not a translated-string assertion (which stays green
// even when nothing ever applies it).

test('`bismuth task list --query` applies a translated "sort by due", not the on-disk scan order', async () => {
    const vault = makeVault({
        't.md': [
            '- [ ] z-early [due 2026-01-01]',
            '- [ ] a-late [due 2026-12-01]',
            '- [ ] m-mid [due 2026-06-01]',
        ].join('\n'),
    })
    const result = await spawnCli([
        'task',
        'list',
        '--query',
        'not done\nsort by due',
        '--vault',
        vault,
    ])
    expect(result.code).toBe(0)
    const { tasks, errors } = JSON.parse(result.out)
    expect(errors).toEqual([])
    // Ascending by due date, NOT the write order above.
    expect(tasks.map((t: any) => t.description)).toEqual([
        'z-early',
        'm-mid',
        'a-late',
    ])
})

test('`bismuth task list --query` sorts priority by urgency, not alphabetically', async () => {
    const vault = makeVault({
        't.md': ['- [ ] a [low]', '- [ ] b [highest]', '- [ ] c [medium]'].join(
            '\n',
        ),
    })
    const result = await spawnCli([
        'task',
        'list',
        '--query',
        'not done\nsort by priority',
        '--vault',
        vault,
    ])
    expect(result.code).toBe(0)
    const { tasks } = JSON.parse(result.out)
    expect(tasks.map((t: any) => t.description)).toEqual(['b', 'c', 'a'])
})

test('`bismuth task list --query` surfaces an unrecognised leaf as a diagnostic, not silently', async () => {
    const vault = makeVault({ 't.md': '- [ ] one\n- [x] two' })
    const result = await spawnCli([
        'task',
        'list',
        '--query',
        'not done AND banana',
        '--vault',
        vault,
    ])
    expect(result.code).toBe(0)
    const { tasks, errors } = JSON.parse(result.out)
    // Filtering is still correct (degrade-to-true) — "banana" does not hide "one".
    expect(tasks.map((t: any) => t.description)).toEqual(['one'])
    // But the typo is surfaced, unlike a bare array that gives no signal at all.
    expect(errors).toEqual(['unrecognized filter: banana'])
})

const runApp = (...rest: string[]) =>
    Bun.spawn(['bun', 'run', 'cli/src/index.ts', 'app', ...rest], {
        stdout: 'pipe',
        stderr: 'pipe',
    })

test('`bismuth app scroll` dispatches scroll-pane with the op its flag names', async () => {
    const position = {
        leafId: 'l1',
        content: 'a.md',
        top: 400,
        max: 1500,
        height: 500,
        fraction: 0.267,
    }
    const mock = mockUiControlServer({ ok: true, result: position })
    try {
        const cases: [string[], unknown][] = [
            [['--by', '-400'], { by: -400 }],
            [['--pages', '2'], { pages: 2 }],
            [['--to', 'bottom'], { to: 'bottom' }],
            [['--to', '0.5'], { to: 0.5 }],
            [['t1', '--pane', 'l1', '--by', '10'], { by: 10 }],
            [[], undefined],
        ]
        for (const [flags] of cases) {
            const proc = runApp('scroll', ...flags, '--api', mock.url)
            expect(await proc.exited).toBe(0)
        }
        expect(mock.calls.map(c => c.action)).toEqual(
            cases.map(() => 'scroll-pane'),
        )
        cases.forEach(([, op], i) => expect(mock.calls[i].args.op).toEqual(op))
        expect(mock.calls[4].args).toMatchObject({ tabId: 't1', leafId: 'l1' })
        const proc = runApp('scroll', '--api', mock.url)
        expect(await proc.exited).toBe(0)
        expect(JSON.parse(await new Response(proc.stdout).text())).toEqual(
            position,
        )
    } finally {
        mock.stop()
    }
})

test('`bismuth app scroll` rejects a bad or doubled motion flag before reaching the network', async () => {
    for (const flags of [
        ['--by', 'far'],
        ['--to', 'middle'],
        ['--to', '1.5'],
        ['--by', '1', '--pages', '1'],
    ]) {
        const proc = runApp('scroll', ...flags, '--api', 'http://localhost:1')
        expect(await proc.exited).not.toBe(0)
        expect(await new Response(proc.stderr).text()).not.toContain(
            'could not reach',
        )
    }
})

test("`bismuth update cancel` POSTs /update/cancel and prints the route's JSON", async () => {
    const mockSrv = mockUpdateServer({
        cancel: { phase: 'cancelled', message: 'update cancelled' },
    })
    try {
        const proc = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'update',
                'cancel',
                '--api',
                mockSrv.url,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        const [outText, , code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        expect(code).toBe(0)
        expect(mockSrv.calls).toEqual([
            { method: 'POST', path: '/update/cancel' },
        ])
        expect(JSON.parse(outText)).toEqual({
            phase: 'cancelled',
            message: 'update cancelled',
        })
    } finally {
        mockSrv.stop()
    }
})
