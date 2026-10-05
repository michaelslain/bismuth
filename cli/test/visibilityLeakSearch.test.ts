// Leak tests for `search` and `replace`: a restricted note must not be a hit, must not be
// rewritten, and must not be named in a replace report — for every channel, both ways an agent
// reaches the CLI.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeVault } from '../../core/test/helpers'
import {
    expectNamesHiddenFrom,
    expectVisibleFor,
    makeLeakVault,
    runCli,
    TOKENS,
    type RunOpts,
} from './visibilityLeak'

const T = 30_000

const CASES: { name: string; opts: RunOpts }[] = [
    { name: 'owner', opts: { channel: 'owner' } },
    { name: 'chat', opts: { channel: 'chat' } },
    { name: 'daemon', opts: { channel: 'daemon' } },
    { name: 'daemon via mcp', opts: { channel: 'daemon', via: 'mcp' } },
]

/** Which note a token lives in, and which channels may see that note. */
const HOME: Record<keyof typeof TOKENS, string> = {
    open: 'open.md',
    secret: 'Private/secret.md',
    chatty: 'chatty.md',
    folder: 'Vault Hidden/inner.md',
}
const SEES: Record<RunOpts['channel'], (keyof typeof TOKENS)[]> = {
    owner: ['open', 'secret', 'chatty', 'folder'],
    chat: ['open', 'chatty'],
    daemon: ['open'],
}

/** Every note whose body carries some TOKEN, per channel (the fixture's bases and templates carry
 *  tokens too). */
const BROAD_HITS: Record<RunOpts['channel'], string[]> = {
    owner: [
        'Cal.md',
        'Private/Cal Secret.md',
        'Private/secret.md',
        'Vault Hidden/inner.md',
        'chatty.md',
        'open.md',
        'templates/Secret Tpl.md',
        'templates/Visible Tpl.md',
    ],
    chat: ['Cal.md', 'chatty.md', 'open.md', 'templates/Visible Tpl.md'],
    daemon: ['Cal.md', 'open.md', 'templates/Visible Tpl.md'],
}

describe('search', () => {
    for (const { name, opts } of CASES) {
        test(
            `${name}: each token hits only the notes the channel may see`,
            async () => {
                makeLeakVault()
                for (const key of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
                    const r = await runCli(['search', TOKENS[key]], opts)
                    expect(r.code, r.stderr).toBe(0)
                    const paths = (
                        JSON.parse(r.stdout) as { path: string }[]
                    ).map(h => h.path)
                    if (SEES[opts.channel].includes(key))
                        expect(paths, `${key} for ${name}`).toContain(HOME[key])
                    else
                        expect(paths, `${key} for ${name}`).not.toContain(
                            HOME[key],
                        )
                    // The output as a whole never carries a token the channel may not see.
                    if (!SEES[opts.channel].includes(key))
                        expect(r.stdout).not.toContain(TOKENS[key])
                    expectNamesHiddenFrom(r.stdout, opts.channel)
                }
            },
            T * 3,
        )
    }

    test(
        'a broad query lists exactly the visible notes',
        async () => {
            makeLeakVault()
            for (const { name, opts } of CASES) {
                const r = await runCli(['search', 'TOKEN'], opts)
                expect(r.code, r.stderr).toBe(0)
                const paths = (JSON.parse(r.stdout) as { path: string }[])
                    .map(h => h.path)
                    .sort()
                const want = BROAD_HITS[opts.channel]
                expect(paths, name).toEqual(want)
            }
        },
        T * 2,
    )

    test(
        'a regex query is filtered too',
        async () => {
            makeLeakVault()
            const r = await runCli(
                ['search', '(OPEN|SECRET|CHATTY|FOLDER)TOKEN', '--regex'],
                { channel: 'daemon' },
            )
            expect(r.code, r.stderr).toBe(0)
            expectVisibleFor(r.stdout, 'daemon')
        },
        T,
    )

    test(
        'a typo query (fuzzy tier) never surfaces a hidden note',
        async () => {
            makeLeakVault()
            const r = await runCli(['search', 'SECRETTOKN'], {
                channel: 'daemon',
            })
            expect(r.code, r.stderr).toBe(0)
            expect(r.stdout).not.toContain('secret')
        },
        T,
    )

    test(
        'an undeterminable vault exits non-zero with no output for an agent',
        async () => {
            const vault = makeVault({
                '.settings': 'folderVisibility: [unclosed\n  : :\n',
                'a.md': 'OPENTOKEN',
            })
            const r = await runCli(['search', 'OPENTOKEN', '--vault', vault], {
                channel: 'daemon',
            })
            expect(r.code).not.toBe(0)
            expect(r.stdout.trim()).toBe('')
        },
        T,
    )
})

describe('replace', () => {
    for (const via of ['cli', 'mcp'] as const) {
        test(
            `daemon (${via}): a hidden note is left byte-identical and not reported`,
            async () => {
                const { vault } = makeLeakVault()
                const files = [
                    'Private/secret.md',
                    'chatty.md',
                    'Vault Hidden/inner.md',
                ]
                const before = files.map(f =>
                    readFileSync(join(vault, f), 'utf8'),
                )
                for (const tok of [
                    TOKENS.secret,
                    TOKENS.chatty,
                    TOKENS.folder,
                ]) {
                    const r = await runCli(
                        ['replace', tok, 'REWRITTEN', '--no-snapshot'],
                        { channel: 'daemon', via },
                    )
                    expect(r.code, r.stderr).toBe(0)
                    expect(JSON.parse(r.stdout)).toEqual({
                        replaced: 0,
                        files: [],
                    })
                }
                expect(
                    files.map(f => readFileSync(join(vault, f), 'utf8')),
                ).toEqual(before)
            },
            T * 3,
        )
    }

    test(
        'daemon: a visible note is still rewritten and the report names only it',
        async () => {
            const { vault } = makeLeakVault()
            const r = await runCli(
                ['replace', TOKENS.open, 'REWRITTEN', '--no-snapshot'],
                { channel: 'daemon' },
            )
            expect(r.code, r.stderr).toBe(0)
            const res = JSON.parse(r.stdout) as {
                replaced: number
                files: string[]
            }
            expect(res.files.sort()).toEqual([
                'Cal.md',
                'open.md',
                'templates/Visible Tpl.md',
            ])
            expect(res.replaced).toBeGreaterThan(0)
            expect(readFileSync(join(vault, 'open.md'), 'utf8')).not.toContain(
                TOKENS.open,
            )
            expectNamesHiddenFrom(r.stdout, 'daemon')
        },
        T,
    )

    test(
        'chat: rewrites chat-only but never hidden notes',
        async () => {
            const { vault } = makeLeakVault()
            const hidden = readFileSync(join(vault, 'Private/secret.md'), 'utf8')
            const a = await runCli(
                ['replace', TOKENS.secret, 'X', '--no-snapshot'],
                { channel: 'chat' },
            )
            expect(JSON.parse(a.stdout).files).toEqual([])
            expect(readFileSync(join(vault, 'Private/secret.md'), 'utf8')).toBe(
                hidden,
            )
            const b = await runCli(
                ['replace', TOKENS.chatty, 'X', '--no-snapshot'],
                { channel: 'chat' },
            )
            expect(JSON.parse(b.stdout).files).toEqual(['chatty.md'])
        },
        T * 2,
    )

    test(
        'owner: every note is rewritten',
        async () => {
            const { vault } = makeLeakVault()
            const r = await runCli(
                ['replace', TOKENS.secret, 'X', '--no-snapshot'],
                { channel: 'owner' },
            )
            expect(JSON.parse(r.stdout).files.sort()).toEqual([
                'Private/Cal Secret.md',
                'Private/secret.md',
                'templates/Secret Tpl.md',
            ])
            expect(
                readFileSync(join(vault, 'Private/secret.md'), 'utf8'),
            ).not.toContain(TOKENS.secret)
        },
        T,
    )

    test(
        'an undeterminable vault exits non-zero and writes nothing for an agent',
        async () => {
            const vault = makeVault({
                '.settings': 'folderVisibility: [unclosed\n  : :\n',
                'a.md': 'OPENTOKEN',
            })
            const r = await runCli(
                ['replace', 'OPENTOKEN', 'X', '--no-snapshot', '--vault', vault],
                { channel: 'daemon' },
            )
            expect(r.code).not.toBe(0)
            expect(r.stdout.trim()).toBe('')
            expect(readFileSync(join(vault, 'a.md'), 'utf8')).toBe('OPENTOKEN')
        },
        T,
    )
})
