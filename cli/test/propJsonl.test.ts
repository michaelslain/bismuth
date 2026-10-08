import { test as bunTest, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeVault } from '../../core/test/helpers'

const REPO_ROOT = join(import.meta.dir, '..', '..')
const test = (name: string, fn: Parameters<typeof bunTest>[1]) =>
    bunTest(name, fn, 30_000)

async function cli(vault: string, ...args: string[]) {
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.BISMUTH_AGENT_CHANNEL
    delete env.BISMUTH_MCP_CHANNEL
    delete env.BISMUTH_VAULT
    env.BROWSER = 'none'
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

test('prop set / delete on a .base.jsonl rewrite only line 1', async () => {
    const rows = '{"title":"a","n":1}\n{"title":"b",  "n":2}\n'
    const vault = makeVault({
        'Cal.base.jsonl': `{"type":"base","view":"table"}\n${rows}`,
    })
    const file = join(vault, 'Cal.base.jsonl')
    const set = await cli(vault, 'prop', 'set', 'Cal.base.jsonl', 'icon', 'y')
    expect(set.code).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(
        `{"type":"base","view":"table","icon":"y"}\n${rows}`,
    )
    const del = await cli(vault, 'prop', 'delete', 'Cal.base.jsonl', 'icon')
    expect(del.code).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(
        `{"type":"base","view":"table"}\n${rows}`,
    )
})
