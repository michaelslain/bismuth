// core/test/routes/baseJsonlConfig.test.ts — config-edit routes + doctor on JSON Lines bases.
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from '../../src/server'
import { makeVault } from '../helpers'
import { flattenBaseViews } from '../../src/bases/flattenViews'
import { vaultSection } from '../../src/doctor/sections/vault'

const ROWS = '{"title":"a","n":1}\n{"title":"b",  "n":2}\n'
const BASE = `{"type":"base","view":"table"}\n${ROWS}`

async function withServer(
    files: Record<string, string>,
    fn: (base: string, vault: string) => Promise<void>,
) {
    const vault = makeVault(files)
    const server = createServer({ vault, port: 0 })
    try {
        await fn(`http://localhost:${server.port}`, vault)
    } finally {
        server.stop(true)
    }
}

const post = (base: string, route: string, body: unknown) =>
    fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    })

test('set-property / delete-property change only line 1 of a jsonl base', async () => {
    await withServer({ 'Cal.base.jsonl': BASE }, async (base, vault) => {
        const path = 'Cal.base.jsonl'
        expect(
            (
                await post(base, '/set-property', {
                    path,
                    key: 'view',
                    value: 'cards',
                })
            ).status,
        ).toBe(200)
        let text = readFileSync(join(vault, path), 'utf8')
        expect(text).toBe(`{"type":"base","view":"cards"}\n${ROWS}`)
        expect(
            (await post(base, '/delete-property', { path, key: 'view' }))
                .status,
        ).toBe(200)
        text = readFileSync(join(vault, path), 'utf8')
        expect(text).toBe(`{"type":"base"}\n${ROWS}`)
    })
})

test('set-properties batches several keys into one line-1 rewrite', async () => {
    await withServer(
        { 'Cal.base.jsonl': BASE, 'n.md': '---\ntype: note\n---\nbody\n' },
        async (base, vault) => {
            const path = 'Cal.base.jsonl'
            const res = await post(base, '/set-properties', {
                writes: [
                    { path, key: 'a', value: 1 },
                    { path, key: 'b', value: ['x'] },
                    { path: 'gone.base.jsonl', key: 'a', value: 1 },
                ],
            })
            expect(
                ((await res.json()) as { skipped: string[] }).skipped,
            ).toEqual(['gone.base.jsonl'])
            expect(readFileSync(join(vault, path), 'utf8')).toBe(
                `{"type":"base","view":"table","a":1,"b":["x"]}\n${ROWS}`,
            )
        },
    )
})

test('a markdown note behaves as before', async () => {
    await withServer(
        { 'n.md': '---\ntitle: t\n---\nbody\n' },
        async (base, vault) => {
            await post(base, '/set-property', {
                path: 'n.md',
                key: 'k',
                value: 'v',
            })
            expect(readFileSync(join(vault, 'n.md'), 'utf8')).toBe(
                '---\ntitle: t\nk: v\n---\nbody\n',
            )
            await post(base, '/delete-property', { path: 'n.md', key: 'k' })
            expect(readFileSync(join(vault, 'n.md'), 'utf8')).toBe(
                '---\ntitle: t\n---\nbody\n',
            )
        },
    )
})

test('a missing jsonl base is a 404', async () => {
    await withServer({}, async base => {
        expect(
            (
                await post(base, '/set-property', {
                    path: 'x.base.jsonl',
                    key: 'a',
                    value: 1,
                })
            ).status,
        ).toBe(404)
    })
})

test('flattenBaseViews leaves jsonl text untouched', () => {
    const t =
        '{"type":"base","views":[{"type":"table"},{"type":"cards"}]}\n{"a":1}\n'
    expect(flattenBaseViews(t)).toBe(t)
})

test('doctor reports nothing for jsonl bases', async () => {
    const vault = makeVault({
        'Cal.base.jsonl':
            '{"type":"base","views":[{"type":"table"}]}\n{"a":1}\n',
    })
    const findings = await vaultSection.check({
        vault,
        now: Date.now(),
    } as never)
    expect(findings.filter(f => f.id.startsWith('vault.base-views'))).toEqual(
        [],
    )
})

test('set-property on a plain .md note starting with { gains frontmatter, not PARSE_ERROR', async () => {
    await withServer(
        { 'n.md': '{not a base}\nbody\n' },
        async (base, vault) => {
            const res = await post(base, '/set-property', {
                path: 'n.md',
                key: 'icon',
                value: 'y',
            })
            expect(res.status).toBe(200)
            const text = readFileSync(join(vault, 'n.md'), 'utf8')
            expect(text.startsWith('---\n')).toBe(true)
            expect(text).toContain('icon: y')
            expect(text).toContain('{not a base}\nbody')
        },
    )
})
