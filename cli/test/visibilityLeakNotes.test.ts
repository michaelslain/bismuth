import { test as bunTest, expect, describe } from 'bun:test'
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { makeVault } from '../../core/test/helpers'
import {
    TOKENS,
    makeLeakVault,
    runCli,
    expectNamesHiddenFrom,
} from './visibilityLeak'

// Leak tests for the commands that list notes: tree, templates, graph, and the two that write a
// note from a template (note new, daily). Each spawns the real CLI the ways an agent can reach it.
const SPAWN_TIMEOUT_MS = 30_000
const test = (name: string, fn: Parameters<typeof bunTest>[1]) =>
    bunTest(name, fn, SPAWN_TIMEOUT_MS)

type Case = {
    label: string
    channel: 'owner' | 'chat' | 'daemon'
    via?: 'cli' | 'mcp'
}
const CASES: Case[] = [
    { label: 'owner', channel: 'owner' },
    { label: 'chat', channel: 'chat' },
    { label: 'daemon (cli)', channel: 'daemon', via: 'cli' },
    { label: 'daemon (mcp)', channel: 'daemon', via: 'mcp' },
]

describe('tree', () => {
    for (const c of CASES)
        test(`${c.label}`, async () => {
            makeLeakVault()
            const r = await runCli(['tree'], c)
            expect(r.code, r.stderr).toBe(0)
            expect(r.stdout).toContain('open.md')
            expectNamesHiddenFrom(
                JSON.stringify(JSON.parse(r.stdout)),
                c.channel,
            )
            if (c.channel === 'owner') {
                expect(r.stdout).toContain('Private/secret.md')
                expect(r.stdout).toContain('Vault Hidden')
            }
            if (c.channel === 'chat') expect(r.stdout).toContain('chatty.md')
        })

    test('an unparseable .settings fails closed for an agent', async () => {
        const vault = makeVault({
            'open.md': `# Open\n${TOKENS.open}\n`,
            '.settings': 'folderVisibility: [unclosed\n  : : :\n',
        })
        const r = await runCli(['tree', '--vault', vault], {
            channel: 'daemon',
        })
        expect(r.code).not.toBe(0)
        expect(r.stdout).toBe('')
    })
})

describe('templates', () => {
    for (const c of CASES)
        test(`${c.label}`, async () => {
            makeLeakVault()
            const r = await runCli(
                ['templates', '--template-folder', 'templates'],
                c,
            )
            expect(r.code, r.stderr).toBe(0)
            expect(r.stdout).toContain('Visible Tpl')
            expectNamesHiddenFrom(r.stdout, c.channel)
            if (c.channel === 'owner') expect(r.stdout).toContain('Secret Tpl')
        })
})

describe('graph', () => {
    for (const c of CASES)
        test(`${c.label}`, async () => {
            makeLeakVault()
            const r = await runCli(['graph'], c)
            expect(r.code, r.stderr).toBe(0)
            expect(r.stdout).toContain('open')
            expectVisibleForGraph(r.stdout, c.channel)
        })

    test('--memory outside the vault is refused for an agent, allowed for the owner', async () => {
        const { vault } = makeLeakVault()
        const outside = makeVault({ 'mem.md': `# Mem\n${TOKENS.secret}\n` })
        const agent = await runCli(
            ['graph', '--vault', vault, '--memory', outside],
            { channel: 'daemon' },
        )
        expect(agent.code).not.toBe(0)
        expect(agent.stdout).toBe('')
        expect(agent.stderr).toContain(
            "refused: an agent's --memory must be exactly the vault's .daemon/memory",
        )
        const owner = await runCli(
            ['graph', '--vault', vault, '--memory', outside],
            { channel: 'owner' },
        )
        expect(owner.code, owner.stderr).toBe(0)
    })

    const memoryNotes = (vault: string) => {
        const mem = join(vault, '.daemon', 'memory')
        mkdirSync(join(mem, 'sub'), { recursive: true })
        const hidden = `---\nvisibility: hidden\n---\n# Msecret\nMEMSECRET\n`
        writeFileSync(join(mem, 'msecret.md'), hidden)
        writeFileSync(join(mem, 'mopen.md'), '# Mopen\nMEMOPEN\n')
        writeFileSync(join(mem, 'sub', 'msecret.md'), hidden)
        return mem
    }

    for (const via of ['cli', 'mcp'] as const)
        test(`a --memory subdirectory of <vault>/.daemon/memory is refused for daemon (${via})`, async () => {
            const { vault } = makeLeakVault()
            const mem = memoryNotes(vault)
            const r = await runCli(
                ['graph', '--vault', vault, '--memory', join(mem, 'sub')],
                { channel: 'daemon', via },
            )
            expect(r.code).not.toBe(0)
            expect(r.stdout).toBe('')
            expect(r.stdout + r.stderr).not.toContain('msecret')
            expect(r.stderr).toContain(
                "refused: an agent's --memory must be exactly the vault's .daemon/memory",
            )
        })

    for (const via of ['cli', 'mcp'] as const)
        test(`--memory exactly <vault>/.daemon/memory hides a hidden memory note from daemon (${via})`, async () => {
            const { vault } = makeLeakVault()
            const mem = memoryNotes(vault)
            const r = await runCli(
                ['graph', '--vault', vault, '--memory', mem],
                { channel: 'daemon', via },
            )
            expect(r.code, r.stderr).toBe(0)
            expect(r.stdout).toContain('mopen')
            expect(r.stdout).not.toContain('msecret')
            expect(r.stdout).not.toContain('MEMSECRET')
        })
})

/** The graph prints node ids + labels, never body text, so the tokens never appear: assert on the
 *  restricted notes' names instead, plus the tags only they carried. */
function expectVisibleForGraph(
    out: string,
    channel: 'owner' | 'chat' | 'daemon',
) {
    expectNamesHiddenFrom(out, channel)
    for (const tag of ['onlysecret', 'onlychatty']) {
        const visible =
            channel === 'owner' || (channel === 'chat' && tag === 'onlychatty')
        if (visible) expect(out).toContain(tag)
        else expect(out, `${tag} leaked to ${channel}`).not.toContain(tag)
    }
    for (const t of Object.values(TOKENS))
        if (channel !== 'owner' && t !== TOKENS.open && t !== TOKENS.chatty)
            expect(out).not.toContain(t)
}

describe('note new', () => {
    test('owner may use a hidden template', async () => {
        const { vault } = makeLeakVault()
        const r = await runCli(
            [
                'note',
                'new',
                'x.md',
                '--template',
                'Secret Tpl',
                '--template-folder',
                'templates',
            ],
            { channel: 'owner' },
        )
        expect(r.code, r.stderr).toBe(0)
        expect(readFileSync(join(vault, 'x.md'), 'utf8')).toContain(
            TOKENS.secret,
        )
    })

    for (const via of ['cli', 'mcp'] as const)
        test(`daemon (${via}) is refused a hidden template by name`, async () => {
            const { vault } = makeLeakVault()
            const r = await runCli(
                [
                    'note',
                    'new',
                    'x.md',
                    '--template',
                    'Secret Tpl',
                    '--template-folder',
                    'templates',
                ],
                { channel: 'daemon', via },
            )
            expect(r.code).not.toBe(0)
            expect(r.stderr).toContain(
                'refused: that template is not visible to this agent',
            )
            expect(r.stdout).not.toContain(TOKENS.secret)
            expect(existsSync(join(vault, 'x.md'))).toBe(false)
        })

    test('daemon may use a visible template', async () => {
        const { vault } = makeLeakVault()
        const r = await runCli(
            [
                'note',
                'new',
                'x.md',
                '--template',
                'Visible Tpl',
                '--template-folder',
                'templates',
            ],
            { channel: 'daemon' },
        )
        expect(r.code, r.stderr).toBe(0)
        expect(readFileSync(join(vault, 'x.md'), 'utf8')).toContain(TOKENS.open)
    })

    for (const via of ['cli', 'mcp'] as const) {
        test(`daemon (${via}) is refused a target inside a hidden folder`, async () => {
            const { vault } = makeLeakVault()
            const r = await runCli(['note', 'new', 'Vault Hidden/x.md'], {
                channel: 'daemon',
                via,
            })
            expect(r.code).not.toBe(0)
            expect(r.stderr).toContain(
                'refused: that path is not visible to this agent',
            )
            expect(existsSync(join(vault, 'Vault Hidden', 'x.md'))).toBe(false)
        })

        test(`daemon (${via}) gets no existence oracle for a hidden note spelled without .md`, async () => {
            makeLeakVault()
            const hidden = await runCli(['note', 'new', 'Private/secret'], {
                channel: 'daemon',
                via,
            })
            expect(hidden.code).not.toBe(0)
            // The gate now checks the `.md` twin itself and answers first; the command's own
            // refusal remains the second line of defence. Either way: no "already exists".
            expect(hidden.stderr).toMatch(
                /Refused: |refused: that path is not visible to this agent/,
            )
            expect(hidden.stderr).not.toContain('already exists')
            const withExt = await runCli(['note', 'new', 'Private/secret.md'], {
                channel: 'daemon',
                via,
            })
            expect(withExt.code).not.toBe(0)
            expect(withExt.stderr).not.toContain('already exists')
        })

        test(`daemon (${via}) may still create a visible note`, async () => {
            const { vault } = makeLeakVault()
            const r = await runCli(['note', 'new', 'open-new.md'], {
                channel: 'daemon',
                via,
            })
            expect(r.code, r.stderr).toBe(0)
            expect(existsSync(join(vault, 'open-new.md'))).toBe(true)
        })
    }

    test('the owner may create a note inside a hidden folder', async () => {
        const { vault } = makeLeakVault()
        const r = await runCli(['note', 'new', 'Vault Hidden/x.md'], {
            channel: 'owner',
        })
        expect(r.code, r.stderr).toBe(0)
        expect(existsSync(join(vault, 'Vault Hidden', 'x.md'))).toBe(true)
    })

    test('a hidden default template yields a blank note plus a stderr warning, never its body', async () => {
        const { vault } = makeLeakVault()
        appendFileSync(
            join(vault, '.settings'),
            '  newNote: templates/Secret Tpl.md\n',
        )
        const r = await runCli(['note', 'new', 'y.md'], { channel: 'daemon' })
        expect(r.code, r.stderr).toBe(0)
        expect(r.stderr).toContain('warning:')
        expect(r.stderr).not.toContain(TOKENS.secret)
        expect(readFileSync(join(vault, 'y.md'), 'utf8')).not.toContain(
            TOKENS.secret,
        )
        // The owner still gets the template.
        const o = await runCli(['note', 'new', 'z.md'], { channel: 'owner' })
        expect(o.code, o.stderr).toBe(0)
        expect(readFileSync(join(vault, 'z.md'), 'utf8')).toContain(
            TOKENS.secret,
        )
    })
})

describe('daily', () => {
    const dailyConfig = (folder: string, template: string) =>
        `dailyNotes:\n  - id: daily\n    fileName: "{{date}}"\n    folder: "${folder}"\n    template: "${template}"\n`

    test('a hidden template creates the note without it for daemon', async () => {
        const { vault } = makeLeakVault()
        appendFileSync(
            join(vault, '.settings'),
            dailyConfig('', 'templates/Secret Tpl.md'),
        )
        const r = await runCli(['daily'], { channel: 'daemon', via: 'mcp' })
        expect(r.code, r.stderr).toBe(0)
        expect(r.stderr).toContain('warning:')
        const { path } = JSON.parse(r.stdout)
        expect(readFileSync(join(vault, path), 'utf8')).not.toContain(
            TOKENS.secret,
        )
        expect(r.stdout + r.stderr).not.toContain(TOKENS.secret)
    })

    test('the owner still gets the template', async () => {
        const { vault } = makeLeakVault()
        appendFileSync(
            join(vault, '.settings'),
            dailyConfig('', 'templates/Secret Tpl.md'),
        )
        const r = await runCli(['daily'], { channel: 'owner' })
        expect(r.code, r.stderr).toBe(0)
        const { path } = JSON.parse(r.stdout)
        expect(readFileSync(join(vault, path), 'utf8')).toContain(TOKENS.secret)
    })

    test('a denied target path is refused and never reported', async () => {
        const { vault } = makeLeakVault()
        appendFileSync(join(vault, '.settings'), dailyConfig('', ''))
        // Seed the day's note as a hidden note, so the target path is in the deny list.
        const first = await runCli(['daily'], { channel: 'owner' })
        const { path } = JSON.parse(first.stdout)
        writeFileSync(
            join(vault, path),
            `---\nvisibility: hidden\n---\n${TOKENS.secret}\n`,
        )
        for (const channel of ['daemon', 'chat'] as const) {
            const r = await runCli(['daily'], { channel })
            expect(r.code).not.toBe(0)
            expect(r.stderr).toContain('refused:')
            expect(r.stdout).toBe('')
        }
    })

    test('a target inside a hidden folder is refused for daemon', async () => {
        const { vault } = makeLeakVault()
        appendFileSync(
            join(vault, '.settings'),
            dailyConfig('Vault Hidden', ''),
        )
        const r = await runCli(['daily'], { channel: 'daemon' })
        expect(r.code).not.toBe(0)
        expect(r.stderr).toContain('refused:')
        expect(r.stdout).toBe('')
    })
})
