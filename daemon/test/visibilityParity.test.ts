// The daemon's visibility.ts is a hand port of core/src/visibility.ts (the daemon workspace cannot
// depend on core). Nothing but this test keeps the two in step: each case builds ONE vault, runs both
// walks over it, and asserts identical results. A divergence that is genuinely there is pinned as
// `test.todo` with the difference described, never papered over.
import { describe, expect, test } from 'bun:test'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tempDir } from '../../core/test/tempDirs.ts'
import * as daemon from '../src/lib/visibility.ts'

// core is loaded through a computed specifier on purpose: the daemon workspace typechecks under
// stricter flags than core, and a static import would pull all of core/src into daemon's tsc.
type Impl = typeof daemon
type CoreVisibility = Omit<Impl, 'resolveDenyPlan' | 'buildDenyPaths'> & {
    resolveDenyPlan: (
        root: string,
        channel: 'daemon',
    ) => ReturnType<Impl['resolveDenyPlan']>
    buildDenyPaths: (
        root: string,
        channel: 'daemon',
    ) => ReturnType<Impl['buildDenyPaths']>
}
const corePath = '../../core/src/visibility.ts'
const core = (await import(corePath)) as CoreVisibility

type Files = Record<string, string>

function vault(files: Files): string {
    const root = tempDir('vis-parity-')
    for (const [rel, body] of Object.entries(files)) {
        mkdirSync(dirname(join(root, rel)), { recursive: true })
        writeFileSync(join(root, rel), body)
    }
    return root
}

const fm = (v: string) => `---\nvisibility: ${v}\n---\nbody\n`
const settings = (map: Record<string, string>) =>
    `folderVisibility:\n${Object.entries(map)
        .map(([k, v]) => `  ${k}: ${v}\n`)
        .join('')}`

/** Normalised plan: sorted rels plus abs + sorted aliases, or the undetermined state. */
async function plan(impl: 'core' | 'daemon', root: string) {
    const p =
        impl === 'core'
            ? await core.resolveDenyPlan(root, 'daemon')
            : await daemon.resolveDenyPlan(root)
    if (!p.determined) return { determined: false as const }
    return {
        determined: true as const,
        entries: p.entries
            .map(e => ({
                rel: e.rel,
                abs: e.abs,
                aliases: [...(e.aliases ?? [])].sort(),
            }))
            .sort((a, b) => a.rel.localeCompare(b.rel)),
    }
}

async function expectParity(root: string) {
    const [c, d] = await Promise.all([plan('core', root), plan('daemon', root)])
    expect(d).toEqual(c)
    // the throwing variant must agree on throw vs. return too
    const thrown = (impl: 'core' | 'daemon') =>
        (impl === 'core'
            ? core.buildDenyPaths(root, 'daemon')
            : daemon.buildDenyPaths(root)
        ).then(
            e => e.map(x => x.rel).sort(),
            (e: unknown) => (e instanceof Error ? e.name : 'threw'),
        )
    expect(await thrown('daemon')).toEqual(await thrown('core'))
    return c
}

const cases: Record<string, Files> = {
    'empty vault': { 'a.md': 'plain\n' },
    'file frontmatter hidden': { 'a.md': fm('hidden'), 'b.md': fm('all') },
    'file frontmatter chat-only': { 'a.md': fm('chat-only'), 'b.md': 'x' },
    'folder rule cascades': {
        '.settings': settings({ private: 'hidden' }),
        'private/a.md': 'x',
        'private/deep/b.png': 'x',
        'open.md': 'x',
    },
    'deepest folder wins + all re-opens': {
        '.settings': settings({ a: 'hidden', 'a/b': 'all' }),
        'a/x.md': 'x',
        'a/b/y.md': 'y',
    },
    'file frontmatter overrides folder': {
        '.settings': settings({ f: 'hidden' }),
        'f/shown.md': fm('all'),
        'f/other.md': 'x',
    },
    'stem sidecars inherit': {
        'note.md': fm('hidden'),
        'note.export.pdf': 'x',
        'note.png': 'x',
        'other.md': 'x',
    },
    'trash restricted when a file restricts': {
        'secret.md': fm('hidden'),
        '.trash/1-secret.md': 'x',
        '.trash/2-plain.md': 'x',
    },
    'trash restricted by a rule on an empty folder': {
        '.settings': settings({ ghost: 'hidden' }),
        '.trash/1-a.md': 'x',
    },
    'memory notes ignore folder cascade': {
        '.settings': settings({ '.daemon': 'hidden' }),
        '.daemon/memory/a.md': 'x',
        '.daemon/memory/b.md': fm('hidden'),
    },
    'unclosed frontmatter fails closed': {
        'a.md': '---\nvisibility: all\nnever closed\n',
    },
    'unparseable frontmatter fails closed': {
        'a.md': '---\n: : [\n---\nbody\n',
    },
    'non-map frontmatter fails closed': {
        'a.md': '---\n- a\n- b\n---\nbody\n',
    },
    'unknown visibility literal fails closed': { 'a.md': fm('secret') },
    'jsonl base hidden': {
        'a.base.jsonl': '{"type":"base","visibility":"hidden"}\n{"r":1}\n',
        'b.base.jsonl': '{"type":"base"}\n',
    },
    'jsonl base chat-only': {
        'a.base.jsonl': '{"type":"base","visibility":"chat-only"}\n',
    },
    'jsonl base garbage line 1 fails closed': {
        'a.base.jsonl': '{"type":"base","visibility":\nrow\n',
    },
    'jsonl base typeless + padded': {
        'a.base.jsonl': '{"visibility":"hidden"}\n',
        'b.base.jsonl':
            ' '.repeat(2000) + '{"type":"base","visibility":"hidden"}\n',
    },
    'malformed folderVisibility (non-map)': {
        '.settings': 'folderVisibility: hidden\n',
        'a.md': 'x',
    },
    'malformed folderVisibility (unknown value)': {
        '.settings': settings({ p: 'bogus' }),
        'p/a.md': 'x',
    },
}

describe('daemon visibility matches core over shared vaults', () => {
    for (const [name, files] of Object.entries(cases))
        test(name, async () => {
            await expectParity(vault(files))
        })

    test('fixtures are not vacuous', async () => {
        const hidden = await expectParity(vault(cases['folder rule cascades']!))
        expect(hidden.determined && hidden.entries.map(e => e.rel)).toEqual([
            'private/a.md',
            'private/deep/b.png',
        ])
        expect(
            await expectParity(
                vault(cases['malformed folderVisibility (non-map)']!),
            ),
        ).toEqual({
            determined: false,
        })
    })

    test('symlinked directory aliases', async () => {
        const root = vault({ 'real/a.md': fm('hidden'), 'b.md': 'x' })
        symlinkSync(join(root, 'real'), join(root, 'link'))
        await expectParity(root)
    })

    test('hidden file head larger than the first read', async () => {
        const pad = '# pad\n'.repeat(20_000)
        await expectParity(
            vault({
                'big.md': `---\nnote: |\n${pad.replace(/^/gm, '  ')}visibility: hidden\n---\n`,
            }),
        )
    })

    test('nonexistent root is undetermined in both', async () => {
        const root = join(tempDir('vis-parity-'), 'missing')
        const c = await plan('core', root)
        expect(await plan('daemon', root)).toEqual(c)
    })
})

describe('pure helpers agree', () => {
    const folders = { a: 'hidden', 'a/b': 'all', c: 'chat-only' } as const
    const paths = ['a/x.md', 'a/b/y.md', 'c/z.md', 'c/d/e.md', 'top.md', '']
    for (const p of paths)
        for (const own of [undefined, 'all', 'chat-only', 'hidden'] as const)
            test(`resolveVisibility(${JSON.stringify(p)}, ${own})`, () => {
                expect(daemon.resolveVisibility(p, own, { ...folders })).toBe(
                    core.resolveVisibility(p, own, { ...folders }),
                )
            })
    for (const p of ['a', 'a/b', 'a/b/c', 'c', 'zzz'])
        test(`resolveFolderVisibility(${p})`, () => {
            expect(daemon.resolveFolderVisibility(p, { ...folders })).toBe(
                core.resolveFolderVisibility(p, { ...folders }),
            )
        })
    for (const v of ['all', 'chat-only', 'hidden'] as const)
        test(`isVisibleToDaemon(${v})`, () => {
            expect(daemon.isVisibleToDaemon(v)).toBe(core.isVisibleToDaemon(v))
        })
})

describe('managed settings deny rules agree', () => {
    const entries: Parameters<Impl['buildManagedSettingsDeny']>[0] = [
        { rel: 'private/secret.md', abs: '/v/private/secret.md' },
        {
            rel: 'a/b.md',
            abs: '/v/a/b.md',
            aliases: ['/alias/a/b.md', '/other/a/b.md'],
        },
    ]
    test('identical output for the same entries', () => {
        expect(daemon.buildManagedSettingsDeny(entries)).toEqual(
            core.buildManagedSettingsDeny(entries),
        )
    })
    test('empty input agrees', () => {
        expect(daemon.buildManagedSettingsDeny([])).toEqual(
            core.buildManagedSettingsDeny([]),
        )
    })
    test('denies the writing tools, not only the reading ones', () => {
        const rules = daemon.buildManagedSettingsDeny(entries)
        expect(rules).toContain('Write(private/secret.md)')
        expect(rules).toContain('NotebookEdit(/v/private/secret.md)')
    })
})
