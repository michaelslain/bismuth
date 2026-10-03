import { test as bunTest, expect } from 'bun:test'
import { makeVault } from '../../core/test/helpers'

// Spawns the CLI the way a user does; cold Bun starts race the 5s default, so a generous timeout.
const test = (name: string, fn: Parameters<typeof bunTest>[1]) =>
    bunTest(name, fn, 30_000)

async function cli(vault: string, ...args: string[]) {
    const proc = Bun.spawn(
        ['bun', 'run', 'cli/src/index.ts', ...args, '--vault', vault],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { out, err, code }
}

const vaultWithNestedRef = () =>
    makeVault({
        'reading/List.md': '---\ntype: base\nview: list\n---\n',
        'Table.md':
            '---\ntype: base\nview: table\nsource: base\nref: "[[List]]"\n---\n',
        'a.md': 'A',
        'b.md': 'B',
    })

test('base validate accepts a ref that names a nested base by basename', async () => {
    const r = await cli(vaultWithNestedRef(), 'base', 'validate', 'Table.md')
    expect(r.code).toBe(0)
    expect(r.out).not.toContain('does not resolve')
})

test('base render returns rows through a nested basename ref', async () => {
    const r = await cli(vaultWithNestedRef(), 'base', 'render', 'Table.md')
    expect(r.code).toBe(0)
    expect(r.out).toContain('a.md')
    expect(r.out).toContain('b.md')
})

test('base validate resolves a nested taskFile by basename inside the from scope', async () => {
    const vault = makeVault({
        'Keep.md':
            '---\ntype: base\nsource: notes\nwhere: file.inFolder("tasks")\n---\n',
        'tasks/General Tasks.md': '- [ ] one',
        'Do.md':
            '---\ntype: base\nview: list\nsource: tasks\nfrom: "[[Keep]]"\ntaskFile: "[[General Tasks]]"\n---\n',
    })
    const r = await cli(vault, 'base', 'validate', 'Do.md')
    expect(r.out).not.toContain("outside this base's source scope")
    expect(r.err).not.toContain("outside this base's source scope")
})

test('base migrate-queries reports ignored dsl lines in degraded leaves', async () => {
    const vault = makeVault({
        'q.md': '# q\n\n```query\ntasks: |-\n  not done\n  group by filename\n```\n',
    })
    const r = await cli(vault, 'base', 'migrate-queries', '--dry-run')
    expect(r.code).toBe(0)
    const json = JSON.parse(r.out)
    expect(json.degraded[0].leaves).toContain('group by filename')
})
