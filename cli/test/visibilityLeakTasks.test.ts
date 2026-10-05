import { test as bunTest, expect, describe } from 'bun:test'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeVault } from '../../core/test/helpers'
import {
    TOKENS,
    makeLeakVault,
    runCli,
    expectVisibleFor,
    expectNamesHiddenFrom,
    type RunOpts,
} from './visibilityLeak'

// Leak tests for the task and flashcard command groups. The fixture's flashcards live only in
// open.md and Private/secret.md (chatty.md and the hidden folder carry no `flashcards` tag), so the
// card commands assert the open + secret tokens by hand rather than through expectVisibleFor.
const SPAWN_TIMEOUT_MS = 30_000
const test = (name: string, fn: Parameters<typeof bunTest>[1]) =>
    bunTest(name, fn, SPAWN_TIMEOUT_MS)

const CASES: { name: string; opts: RunOpts }[] = [
    { name: 'owner', opts: { channel: 'owner' } },
    { name: 'chat', opts: { channel: 'chat' } },
    { name: 'daemon via cli', opts: { channel: 'daemon', via: 'cli' } },
    { name: 'daemon via mcp', opts: { channel: 'daemon', via: 'mcp' } },
]

function expectCardsFor(out: string, channel: RunOpts['channel']): void {
    expect(out, `${TOKENS.open} missing for ${channel}`).toContain(TOKENS.open)
    if (channel === 'owner')
        expect(out, 'owner must see the secret card').toContain(TOKENS.secret)
    else {
        expect(out, `${TOKENS.secret} leaked to ${channel}`).not.toContain(
            TOKENS.secret,
        )
        expectNamesHiddenFrom(out, channel)
    }
}

describe('task list', () => {
    for (const { name, opts } of CASES)
        test(`${name}`, async () => {
            makeLeakVault()
            const r = await runCli(['task', 'list'], opts)
            expect(r.code).toBe(0)
            expectVisibleFor(r.stdout, opts.channel)
        })

    test('daemon with --query still sees only visible tasks', async () => {
        makeLeakVault()
        const r = await runCli(['task', 'list', '--query', 'not done'], {
            channel: 'daemon',
            via: 'mcp',
        })
        expect(r.code).toBe(0)
        expectVisibleFor(r.stdout, 'daemon')
    })
})

describe('card all', () => {
    for (const { name, opts } of CASES)
        test(`${name}`, async () => {
            makeLeakVault()
            const r = await runCli(['card', 'all'], opts)
            expect(r.code).toBe(0)
            expectCardsFor(r.stdout, opts.channel)
        })
})

describe('card due', () => {
    for (const { name, opts } of CASES)
        test(`${name}`, async () => {
            makeLeakVault()
            const r = await runCli(['card', 'due'], opts)
            expect(r.code).toBe(0)
            expectCardsFor(r.stdout, opts.channel)
        })
})

describe('card decks', () => {
    for (const { name, opts } of CASES)
        test(`${name}`, async () => {
            makeLeakVault()
            const r = await runCli(['card', 'decks'], opts)
            expect(r.code).toBe(0)
            const decks = JSON.parse(r.stdout) as {
                name: string
                total: number
                due: number
            }[]
            const total = decks.reduce((n, d) => n + d.total, 0)
            const due = decks.reduce((n, d) => n + d.due, 0)
            // open.md and Private/secret.md carry one card each; only the owner counts both.
            const expected = opts.channel === 'owner' ? 2 : 1
            expect(total).toBe(expected)
            expect(due).toBe(expected)
        })
})

describe('card note', () => {
    test('daemon is refused for a hidden note', async () => {
        makeLeakVault()
        const r = await runCli(['card', 'note', 'Private/secret.md'], {
            channel: 'daemon',
            via: 'mcp',
        })
        expect(r.code).not.toBe(0)
        expect(r.stdout).not.toContain(TOKENS.secret)
    })
})

describe('card review', () => {
    test('daemon is refused for a card id in a hidden note, note unchanged', async () => {
        const { vault } = makeLeakVault()
        const file = join(vault, 'Private/secret.md')
        const before = readFileSync(file, 'utf8')
        for (const via of ['cli', 'mcp'] as const) {
            const r = await runCli(
                ['card', 'review', 'Private/secret.md::0::0', 'good'],
                { channel: 'daemon', via },
            )
            expect(r.code).not.toBe(0)
        }
        expect(readFileSync(file, 'utf8')).toBe(before)
    })

    test('daemon is refused for a hidden card id in a spelling the path scan misses', async () => {
        const { vault } = makeLeakVault()
        const file = join(vault, 'Private/secret.md')
        const before = readFileSync(file, 'utf8')
        const r = await runCli(
            ['card', 'review', 'Private//secret.md::0::0', 'good'],
            { channel: 'daemon', via: 'mcp' },
        )
        expect(r.code).not.toBe(0)
        expect(readFileSync(file, 'utf8')).toBe(before)
    })

    test('the owner can still review a card in the same note', async () => {
        const { vault } = makeLeakVault()
        const r = await runCli(
            ['card', 'review', 'Private/secret.md::0::0', 'good'],
            { channel: 'owner' },
        )
        expect(r.code).toBe(0)
        expect(readFileSync(join(vault, 'Private/secret.md'), 'utf8')).not.toBe(
            readFileSync(join(vault, 'open.md'), 'utf8'),
        )
    })
})

describe('task toggle', () => {
    test('daemon is refused for a hidden note, note unchanged', async () => {
        const { vault } = makeLeakVault()
        const file = join(vault, 'Private/secret.md')
        const before = readFileSync(file, 'utf8')
        for (const via of ['cli', 'mcp'] as const) {
            const r = await runCli(['task', 'toggle', 'Private/secret.md', '7'], {
                channel: 'daemon',
                via,
            })
            expect(r.code).not.toBe(0)
        }
        expect(readFileSync(file, 'utf8')).toBe(before)
    })
})

const DONE = '\n- [x] finished chore\n'

describe('task archive', () => {
    test('daemon whole-vault archive skips hidden notes and reports only visible', async () => {
        const { vault } = makeLeakVault()
        for (const rel of ['open.md', 'Private/secret.md', 'chatty.md'])
            appendFileSync(join(vault, rel), DONE)
        const secret = readFileSync(join(vault, 'Private/secret.md'), 'utf8')
        const chatty = readFileSync(join(vault, 'chatty.md'), 'utf8')
        const r = await runCli(['task', 'archive'], {
            channel: 'daemon',
            via: 'mcp',
        })
        expect(r.code).toBe(0)
        expect(JSON.parse(r.stdout)).toEqual({ removed: 1, files: 1 })
        expect(readFileSync(join(vault, 'Private/secret.md'), 'utf8')).toBe(
            secret,
        )
        expect(readFileSync(join(vault, 'chatty.md'), 'utf8')).toBe(chatty)
        expect(readFileSync(join(vault, 'open.md'), 'utf8')).not.toContain(
            'finished chore',
        )
    })

    test('chat archives chat-only notes but not hidden ones', async () => {
        const { vault } = makeLeakVault()
        for (const rel of ['open.md', 'Private/secret.md', 'chatty.md'])
            appendFileSync(join(vault, rel), DONE)
        const secret = readFileSync(join(vault, 'Private/secret.md'), 'utf8')
        const r = await runCli(['task', 'archive'], { channel: 'chat' })
        expect(r.code).toBe(0)
        expect(JSON.parse(r.stdout)).toEqual({ removed: 2, files: 2 })
        expect(readFileSync(join(vault, 'Private/secret.md'), 'utf8')).toBe(
            secret,
        )
    })

    test('the owner archives everything', async () => {
        const { vault } = makeLeakVault()
        for (const rel of ['open.md', 'Private/secret.md', 'chatty.md'])
            appendFileSync(join(vault, rel), DONE)
        const r = await runCli(['task', 'archive'], { channel: 'owner' })
        expect(r.code).toBe(0)
        expect(JSON.parse(r.stdout)).toEqual({ removed: 3, files: 3 })
    })

    test('daemon naming a hidden file is refused, file unchanged', async () => {
        const { vault } = makeLeakVault()
        appendFileSync(join(vault, 'Private/secret.md'), DONE)
        const before = readFileSync(join(vault, 'Private/secret.md'), 'utf8')
        const r = await runCli(['task', 'archive', 'Private/secret.md'], {
            channel: 'daemon',
            via: 'mcp',
        })
        expect(r.code).not.toBe(0)
        expect(readFileSync(join(vault, 'Private/secret.md'), 'utf8')).toBe(
            before,
        )
    })
})

const EMOJI = '\n- [ ] emoji chore \u{1F4C5} 2026-10-10\n'

describe('task migrate', () => {
    test('daemon skips hidden notes and reports only visible ones', async () => {
        const { vault } = makeLeakVault()
        for (const rel of ['open.md', 'Private/secret.md', 'chatty.md'])
            appendFileSync(join(vault, rel), EMOJI)
        const secret = readFileSync(join(vault, 'Private/secret.md'), 'utf8')
        const chatty = readFileSync(join(vault, 'chatty.md'), 'utf8')
        const r = await runCli(['task', 'migrate'], {
            channel: 'daemon',
            via: 'mcp',
        })
        expect(r.code).toBe(0)
        const res = JSON.parse(r.stdout) as {
            changed: number
            files: { file: string }[]
        }
        expect(res.files.map(f => f.file)).toEqual(['open.md'])
        expect(res.changed).toBe(1)
        expect(r.stdout).not.toContain('secret')
        expect(r.stdout).not.toContain('chatty')
        expect(readFileSync(join(vault, 'Private/secret.md'), 'utf8')).toBe(
            secret,
        )
        expect(readFileSync(join(vault, 'chatty.md'), 'utf8')).toBe(chatty)
    })

    test('a dry run reports only visible notes too', async () => {
        const { vault } = makeLeakVault()
        for (const rel of ['open.md', 'Private/secret.md'])
            appendFileSync(join(vault, rel), EMOJI)
        const r = await runCli(['task', 'migrate', '--dry-run'], {
            channel: 'daemon',
            via: 'cli',
        })
        expect(r.code).toBe(0)
        expect(r.stdout).not.toContain('secret')
    })

    test('the owner migrates everything', async () => {
        const { vault } = makeLeakVault()
        for (const rel of ['open.md', 'Private/secret.md'])
            appendFileSync(join(vault, rel), EMOJI)
        const r = await runCli(['task', 'migrate', '--dry-run'], {
            channel: 'owner',
        })
        expect(r.code).toBe(0)
        expect(JSON.parse(r.stdout).files).toHaveLength(2)
    })
})

describe('undeterminable visibility fails closed', () => {
    for (const args of [
        ['task', 'list'],
        ['card', 'all'],
        ['card', 'decks'],
    ])
        test(`${args.join(' ')} exits non-zero with no output`, async () => {
            const vault = makeVault({
                'a.md': `---\ntags: [flashcards]\n---\n- [ ] t ${TOKENS.open}\n\nq::a\n`,
                '.settings': 'folderVisibility: [unclosed\n  : : {\n',
            })
            const r = await runCli([...args, '--vault', vault], {
                channel: 'daemon',
                via: 'mcp',
            })
            expect(r.code).not.toBe(0)
            expect(r.stdout).toBe('')
        })
})
