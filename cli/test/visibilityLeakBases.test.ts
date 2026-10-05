import { test as bunTest, expect, describe } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { listMarkdown } from '../../core/src/files'
import { buildDenyPaths, isDeniedPath } from '../../core/src/visibility'
import { makeVault } from '../../core/test/helpers'
import {
    TOKENS,
    makeLeakVault,
    runCli,
    expectVisibleFor,
    expectNamesHiddenFrom,
    type RunOpts,
} from './visibilityLeak'

// Leak tests for the bases group (rows, base render/validate/migrate-queries). Every case spawns the
// real CLI; the daemon case runs through BOTH entry paths (BISMUTH_AGENT_CHANNEL and the MCP-only
// BISMUTH_MCP_CHANNEL).
const SPAWN_TIMEOUT_MS = 30_000
const test = (name: string, fn: Parameters<typeof bunTest>[1]) =>
    bunTest(name, fn, SPAWN_TIMEOUT_MS)

const CASES: Array<[string, RunOpts]> = [
    ['owner', { channel: 'owner' }],
    ['chat', { channel: 'chat' }],
    ['daemon via cli', { channel: 'daemon', via: 'cli' }],
    ['daemon via mcp', { channel: 'daemon', via: 'mcp' }],
]

/** Add files to the fixture vault after the fact. */
function addFiles(vault: string, files: Record<string, string>): void {
    for (const [rel, text] of Object.entries(files)) {
        mkdirSync(dirname(join(vault, rel)), { recursive: true })
        writeFileSync(join(vault, rel), text)
    }
}

const LEGACY_QUERY = (token: string) =>
    `# Legacy ${token}\n\n\`\`\`query\ntasks: not done\n\`\`\`\n`

/** Row count of a `base render` payload (groups of rows). */
function renderedRowCount(stdout: string): number {
    const parsed = JSON.parse(stdout) as { groups: Array<{ rows: unknown[] }> }
    return parsed.groups.reduce((n, g) => n + g.rows.length, 0)
}

describe('rows', () => {
    for (const [label, opts] of CASES) {
        test(`rows (source: notes) hides restricted notes: ${label}`, async () => {
            makeLeakVault()
            const r = await runCli(['rows'], opts)
            expect(r.code).toBe(0)
            expect(r.stdout).toContain('open.md')
            expectNamesHiddenFrom(r.stdout, opts.channel)
            if (opts.channel === 'owner') {
                expect(r.stdout).toContain('Private/secret.md')
                expect(r.stdout).toContain('chatty.md')
                expect(r.stdout).toContain('Vault Hidden/inner.md')
            }
        })

        test(`rows --tasks hides restricted tasks: ${label}`, async () => {
            makeLeakVault()
            const r = await runCli(['rows', '--tasks', ''], opts)
            expect(r.code).toBe(0)
            expectVisibleFor(r.stdout, opts.channel)
        })
    }

    for (const via of ['cli', 'mcp'] as const) {
        test(`rows --of a hidden base answers byte-identically to a missing one: daemon via ${via}`, async () => {
            makeLeakVault()
            const opts: RunOpts = { channel: 'daemon', via }
            const hidden = await runCli(['rows', '--of', '[[Cal Secret]]'], opts)
            const missing = await runCli(
                ['rows', '--of', '[[Cal Secret Nope]]'],
                opts,
            )
            expect(hidden.code).toBe(missing.code)
            expect(hidden.stdout).toBe(missing.stdout)
            expect(hidden.stderr).toBe(missing.stderr)
            expect(hidden.stdout + hidden.stderr).not.toContain('refused')
            expect(hidden.stdout + hidden.stderr).not.toContain(TOKENS.secret)
        })
    }

    test('rows --of a hidden base still works for the owner', async () => {
        makeLeakVault()
        const r = await runCli(['rows', '--of', '[[Cal Secret]]'], {
            channel: 'owner',
        })
        expect(r.code).toBe(0)
    })
})

describe('base render', () => {
    for (const [label, opts] of CASES) {
        test(`base render "All Notes.md" counts only visible notes: ${label}`, async () => {
            const { vault } = makeLeakVault()
            const r = await runCli(['base', 'render', 'All Notes.md'], opts)
            expect(r.code).toBe(0)
            expect(r.stdout).toContain('open.md')
            expectNamesHiddenFrom(r.stdout, opts.channel)

            // The row count equals the number of notes this channel can see.
            const all = await listMarkdown(vault)
            const deny =
                opts.channel === 'owner'
                    ? []
                    : await buildDenyPaths(vault, opts.channel)
            const visible = all.filter(p => !isDeniedPath(deny, p))
            expect(renderedRowCount(r.stdout)).toBe(visible.length)
            if (opts.channel === 'owner')
                expect(visible.length).toBe(all.length)
            else expect(visible.length).toBeLessThan(all.length)
        })
    }

    test('a stat base over all notes counts only visible rows', async () => {
        const { vault } = makeLeakVault()
        addFiles(vault, {
            'Count.md':
                '---\ntype: base\nview: stat\nstats:\n  - label: n\n    value: count()\n---\n',
        })
        const owner = await runCli(['base', 'render', 'Count.md'], {
            channel: 'owner',
        })
        const daemon = await runCli(['base', 'render', 'Count.md'], {
            channel: 'daemon',
        })
        expect(owner.code).toBe(0)
        expect(daemon.code).toBe(0)
        const n = (s: string) =>
            Number(
                (JSON.parse(s) as { metrics: Array<{ value: unknown }> })
                    .metrics[0].value,
            )
        const deny = await buildDenyPaths(vault, 'daemon')
        const all = await listMarkdown(vault)
        expect(n(owner.stdout)).toBe(all.length)
        expect(n(daemon.stdout)).toBe(
            all.filter(p => !isDeniedPath(deny, p)).length,
        )
    })

    for (const via of ['cli', 'mcp'] as const) {
        test(`base render of a base whose ref is hidden looks like a missing ref: daemon via ${via}`, async () => {
            const { vault } = makeLeakVault()
            const base = (ref: string) =>
                `---\ntype: base\nview: table\nsource:\n  kind: base\n  ref: "${ref}"\n---\n`
            addFiles(vault, {
                'Refs Secret.md': base('[[Cal Secret]]'),
                'Refs Missing.md': base('[[Cal Secret Nope]]'),
            })
            const opts: RunOpts = { channel: 'daemon', via }
            const hidden = await runCli(['base', 'render', 'Refs Secret.md'], opts)
            // The control: the same base shape, pointing at a ref that does not exist.
            const missing = await runCli(
                ['base', 'render', 'Refs Missing.md'],
                opts,
            )
            expect(hidden.code).toBe(0)
            expect(hidden.code).toBe(missing.code)
            expect(hidden.stderr).toBe(missing.stderr)
            expect(hidden.stdout + hidden.stderr).not.toContain('refused')
            expect(renderedRowCount(hidden.stdout)).toBe(0)
            expect(renderedRowCount(missing.stdout)).toBe(0)
            expect(hidden.stdout + hidden.stderr).not.toContain(TOKENS.secret)
            const owner = await runCli(['base', 'render', 'Refs Secret.md'], {
                channel: 'owner',
            })
            expect(owner.code).toBe(0)
        })
    }

    test('a chain through a visible base into a hidden base yields no rows', async () => {
        const { vault } = makeLeakVault()
        addFiles(vault, {
            'Hop One.md':
                '---\ntype: base\nview: table\nsource:\n  kind: base\n  ref: "[[Cal Secret]]"\n---\n',
            'Hop Two.md':
                '---\ntype: base\nview: table\nsource:\n  kind: base\n  ref: "[[Hop One]]"\n---\n',
        })
        const r = await runCli(['base', 'render', 'Hop Two.md'], {
            channel: 'daemon',
        })
        expect(r.code).toBe(0)
        expect(renderedRowCount(r.stdout)).toBe(0)
        expect(r.stdout + r.stderr).not.toContain(TOKENS.secret)
    })
})

describe('base validate', () => {
    test('a ref to a hidden base shows no hidden name or path to an agent', async () => {
        const { vault } = makeLeakVault()
        addFiles(vault, {
            'Refs Secret.md':
                '---\ntype: base\nview: table\nsource:\n  kind: base\n  ref: "[[Cal Secret]]"\n---\n',
        })
        for (const via of ['cli', 'mcp'] as const) {
            const r = await runCli(['base', 'validate', 'Refs Secret.md'], {
                channel: 'daemon',
                via,
            })
            expect(r.stdout + r.stderr, `via ${via}`).not.toContain(
                'Cal Secret',
            )
            expect(r.stdout + r.stderr).not.toContain('Private/')
            expect(r.stdout).toContain('<not visible>')
        }
        // The owner still gets a clean result: the hidden base exists and resolves.
        const owner = await runCli(['base', 'validate', 'Refs Secret.md'], {
            channel: 'owner',
        })
        expect(owner.code).toBe(0)
    })

    test('a ref to a base that does not exist reads the same as a hidden one to an agent', async () => {
        const { vault } = makeLeakVault()
        addFiles(vault, {
            'Refs Secret.md':
                '---\ntype: base\nview: table\nsource:\n  kind: base\n  ref: "[[Cal Secret]]"\n---\n',
            'Refs Nothing.md':
                '---\ntype: base\nview: table\nsource:\n  kind: base\n  ref: "[[Nowhere At All]]"\n---\n',
        })
        const hidden = await runCli(['base', 'validate', 'Refs Secret.md'], {
            channel: 'daemon',
        })
        const missing = await runCli(['base', 'validate', 'Refs Nothing.md'], {
            channel: 'daemon',
        })
        expect(JSON.parse(hidden.stdout)).toEqual(JSON.parse(missing.stdout))
    })

    test('a taskFile naming a hidden note shows no hidden path', async () => {
        const { vault } = makeLeakVault()
        addFiles(vault, {
            'Task Scope.md':
                '---\ntype: base\nview: table\ntaskFile: "[[secret]]"\nsource:\n  kind: tasks\n  from: "[[All Notes]]"\n---\n',
        })
        const r = await runCli(['base', 'validate', 'Task Scope.md'], {
            channel: 'daemon',
        })
        expect(r.stdout + r.stderr).not.toContain('secret')
        expect(r.stdout + r.stderr).not.toContain('Private/')
    })
})

describe('base migrate-queries', () => {
    test('an agent never touches or names a hidden note holding a legacy block', async () => {
        const { vault } = makeLeakVault()
        addFiles(vault, {
            'Legacy Open.md': LEGACY_QUERY('LEGACYOPEN'),
            'Private/Legacy Secret.md':
                '---\nvisibility: hidden\n---\n' + LEGACY_QUERY('LEGACYSECRET'),
        })
        for (const via of ['cli', 'mcp'] as const) {
            const dry = await runCli(['base', 'migrate-queries', '--dry-run'], {
                channel: 'daemon',
                via,
            })
            expect(dry.code).toBe(0)
            expect(dry.stdout).toContain('Legacy Open.md')
            expect(dry.stdout).not.toContain('Legacy Secret')
        }
        const wet = await runCli(['base', 'migrate-queries'], {
            channel: 'daemon',
        })
        expect(wet.code).toBe(0)
        expect(wet.stdout).not.toContain('Legacy Secret')
        const { readFileSync } = await import('node:fs')
        // The hidden note is byte-for-byte what it was.
        expect(
            readFileSync(join(vault, 'Private/Legacy Secret.md'), 'utf8'),
        ).toBe('---\nvisibility: hidden\n---\n' + LEGACY_QUERY('LEGACYSECRET'))
        // The visible one was migrated.
        expect(readFileSync(join(vault, 'Legacy Open.md'), 'utf8')).not.toBe(
            LEGACY_QUERY('LEGACYOPEN'),
        )
    })

    test('the owner migrates and reports the hidden note too', async () => {
        const { vault } = makeLeakVault()
        addFiles(vault, {
            'Private/Legacy Secret.md':
                '---\nvisibility: hidden\n---\n' + LEGACY_QUERY('LEGACYSECRET'),
        })
        const r = await runCli(['base', 'migrate-queries', '--dry-run'], {
            channel: 'owner',
        })
        expect(r.stdout).toContain('Legacy Secret')
    })
})

describe('base create and row writes', () => {
    test('row add at an explicit hidden base path is refused by the argv scan', async () => {
        makeLeakVault()
        const add = await runCli(
            ['row', 'add', 'Private/Cal Secret.md', '--json', '{"a":1}'],
            { channel: 'daemon' },
        )
        expect(add.code).not.toBe(0)
    })
})

describe('fail closed', () => {
    test('an agent on a vault whose visibility cannot be determined gets no output and a non-zero exit', async () => {
        const vault = makeVault({
            'open.md': `# Open\n${TOKENS.open}\n`,
            '.settings': 'folderVisibility: [unclosed\n  : :\n',
        })
        for (const args of [
            ['rows'],
            ['base', 'render', 'open.md'],
            ['base', 'migrate-queries', '--dry-run'],
        ]) {
            const r = await runCli([...args, '--vault', vault], {
                channel: 'daemon',
            })
            expect(r.code, args.join(' ')).not.toBe(0)
            expect(r.stdout, args.join(' ')).toBe('')
        }
    })
})
