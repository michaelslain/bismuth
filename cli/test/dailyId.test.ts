import { test, expect } from 'bun:test'
import { makeVault } from '../../core/test/helpers'

async function runCli(
    vault: string,
    ...args: string[]
): Promise<{ code: number | null; json: any; err: string }> {
    const proc = Bun.spawn(
        ['bun', 'run', 'cli/src/index.ts', ...args, '--vault', vault],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [outText, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    let json: any = undefined
    try {
        json = JSON.parse(outText)
    } catch {
        /* non-JSON output */
    }
    return { code, json, err }
}

const TWO_TYPES =
    'dailyNotes:\n' +
    '  - id: daily\n    label: Daily\n    icon: CalendarDays\n    folder: Journal\n    fileName: "{{date}}"\n    template: ""\n' +
    '  - id: work\n    label: Work\n    icon: Briefcase\n    folder: Work\n    fileName: "{{date}}"\n    template: ""\n'

test('`daily --id work` picks the config whose id is work', async () => {
    const vault = makeVault({ '.settings': TWO_TYPES })
    const r = await runCli(vault, 'daily', '--id', 'work')
    expect(r.code).toBe(0)
    expect(r.json.path.startsWith('Work/')).toBe(true)
}, 30_000)

test('`daily --id 1` still picks the second config by index', async () => {
    const vault = makeVault({ '.settings': TWO_TYPES })
    const r = await runCli(vault, 'daily', '--id', '1')
    expect(r.code).toBe(0)
    expect(r.json.path.startsWith('Work/')).toBe(true)
}, 30_000)

test('`daily --id nope` fails listing every configured id', async () => {
    const vault = makeVault({ '.settings': TWO_TYPES })
    const r = await runCli(vault, 'daily', '--id', 'nope')
    expect(r.code).toBe(1)
    expect(r.err).toContain(
        'daily: no daily-note type with id "nope" — configured ids: daily, work',
    )
}, 30_000)

test('with no configured types `daily --id daily` works and other ids fail', async () => {
    const vault = makeVault({ '.settings': 'dailyNotes: []\n' })
    const ok = await runCli(vault, 'daily', '--id', 'daily')
    expect(ok.code).toBe(0)
    expect(ok.json.path).toMatch(/^\d{4}-\d{2}-\d{2}\.md$/)
    const bad = await runCli(vault, 'daily', '--id', 'work')
    expect(bad.code).toBe(1)
    expect(bad.err).toContain('no daily-note type with id "work"')
}, 30_000)
