import { test as bunTest, expect } from 'bun:test'
import { join } from 'node:path'
import { makeVault } from '../../core/test/helpers'

const REPO_ROOT = join(import.meta.dir, '..', '..')
const test = (name: string, fn: Parameters<typeof bunTest>[1]) =>
    bunTest(name, fn, 30_000)

async function cli(
    vault: string,
    args: string[],
    extraEnv: Record<string, string> = {},
) {
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.BISMUTH_AGENT_CHANNEL
    delete env.BISMUTH_MCP_CHANNEL
    delete env.BISMUTH_VAULT
    env.BROWSER = 'none'
    Object.assign(env, extraEnv)
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            join(REPO_ROOT, 'cli/src/index.ts'),
            ...args,
            '--vault',
            vault,
        ],
        { cwd: REPO_ROOT, env, stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { stdout, stderr, code }
}

const SETTINGS = [
    'schemas:',
    '  book:',
    '    author:',
    '      type: string',
    '      required: true',
    '    rating: number',
    '  review:',
    '    verdict:',
    '      type:',
    '        enum: [yes, no]',
    'folderSchemas:',
    '  Books: book',
    '  Drafts: bok',
    '',
].join('\n')

function vault() {
    return makeVault({
        '.settings': SETTINGS,
        'Books/Dune.md': '---\nauthor: Herbert\nrating: 5\n---\n',
        'Books/Bad.md': '---\nrating: lots\n---\n',
        'Books/Bare.md': 'no frontmatter\n',
        'Books/Secret.md': '---\nvisibility: hidden\n---\n',
        'Inbox/Take.md': '---\nschema: review\nverdict: maybe\n---\n',
        'Inbox/Plain.md': '---\nanything: 1\n---\n',
        'Drafts/x.md': '---\nanything: 1\n---\n',
        'Books/scan.pdf': '%PDF-1.4\n',
        'Books/scan.pdf.md': '---\nauthor: Anon\n---\n',
    })
}

test('prop schema names the schemas a note follows and merges their properties', async () => {
    const v = vault()
    const r = await cli(v, ['prop', 'schema', 'Books/Dune.md'])
    expect(r.code).toBe(0)
    const res = JSON.parse(r.stdout)
    expect(res.schemas).toEqual([
        { name: 'book', source: 'folder', folder: 'Books', known: true },
    ])
    expect(res.properties.author).toEqual({ type: 'string', required: true })
    expect(res.properties.rating).toEqual({ type: 'number' })
})

test('prop check reports every note that breaks its schema and exits 1', async () => {
    const v = vault()
    const r = await cli(v, ['prop', 'check'])
    expect(r.code).toBe(1)
    const res = JSON.parse(r.stdout)
    expect(res.ok).toBe(false)
    const by = Object.fromEntries(
        res.problems.map((p: { path: string }) => [p.path, p]),
    )
    expect(Object.keys(by).sort()).toEqual([
        'Books/Bad.md',
        'Books/Bare.md',
        'Books/Secret.md',
        'Drafts/x.md',
        'Inbox/Take.md',
    ])
    expect(
        by['Books/Bad.md'].diagnostics
            .map((d: { key: string }) => d.key)
            .sort(),
    ).toEqual(['author', 'rating'])
    expect(by['Inbox/Take.md'].schemas).toEqual(['review'])
})

test('prop check on one folder or one note stays inside it', async () => {
    const v = vault()
    const folder = JSON.parse((await cli(v, ['prop', 'check', 'Inbox'])).stdout)
    expect(folder.checked).toBe(2)
    expect(folder.problems.map((p: { path: string }) => p.path)).toEqual([
        'Inbox/Take.md',
    ])
    const one = await cli(v, ['prop', 'check', 'Books/Dune.md'])
    expect(one.code).toBe(0)
    expect(JSON.parse(one.stdout)).toEqual({
        ok: true,
        checked: 1,
        problems: [],
    })
})

test('prop check as an agent drops notes it may not read', async () => {
    const v = vault()
    const r = await cli(v, ['prop', 'check', 'Books'], {
        BISMUTH_AGENT_CHANNEL: 'chat',
    })
    const res = JSON.parse(r.stdout)
    expect(res.checked).toBe(4) // Dune, Bad, Bare and the scan.pdf companion; not Secret
    expect(
        res.problems.some(
            (p: { path: string }) => p.path === 'Books/Secret.md',
        ),
    ).toBe(false)
})

test('prop check warns about a folder bound to an undeclared schema, without failing', async () => {
    const v = vault()
    const r = await cli(v, ['prop', 'check', 'Drafts'])
    expect(r.code).toBe(0)
    const res = JSON.parse(r.stdout)
    expect(res.ok).toBe(true)
    expect(res.problems).toEqual([
        {
            path: 'Drafts/x.md',
            schemas: [],
            diagnostics: [
                {
                    key: 'folderSchemas.Drafts',
                    severity: 'warning',
                    message: 'unknown schema: bok',
                },
            ],
        },
    ])
})

test("prop schema on an image or PDF reads its companion note's frontmatter", async () => {
    const v = vault()
    const res = JSON.parse(
        (await cli(v, ['prop', 'schema', 'Books/scan.pdf'])).stdout,
    )
    expect(res.path).toBe('Books/scan.pdf.md')
    expect(res.schemas.map((s: { name: string }) => s.name)).toEqual(['book'])
})

test('prop schema on a note that does not exist yet prints what it would follow', async () => {
    const v = vault()
    const r = await cli(v, ['prop', 'schema', 'Books/New.md'])
    expect(r.code).toBe(0)
    const res = JSON.parse(r.stdout)
    expect(res.schemas.map((s: { name: string }) => s.name)).toEqual(['book'])
    expect(res.properties.author.required).toBe(true)
})

test('prop check on a path that does not exist fails with ENOENT', async () => {
    const v = vault()
    const r = await cli(v, ['prop', 'check', 'Nowhere'])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('no such file: Nowhere')
})
