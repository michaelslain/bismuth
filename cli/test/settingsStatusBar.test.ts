import { test, expect } from 'bun:test'
import { join } from 'node:path'
import { makeVault, tempDir } from '../../core/test/helpers'
import { trustCommand } from '../../core/src/statusBarTrust'

async function runCli(
    vault: string,
    trustFile: string,
    ...args: string[]
): Promise<{ code: number | null; json: any; err: string }> {
    const proc = Bun.spawn(
        ['bun', 'run', 'cli/src/index.ts', ...args, '--vault', vault],
        {
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env, BISMUTH_TRUST_FILE: trustFile },
        },
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

const SETTINGS =
    "statusBar:\n  - text: '{notes} notes'\n  - text: 'files: {files}'\n  - run: 'echo hi'\n"

test('`settings status-bar` renders tokens, leaves untrusted run alone, runs it once trusted', async () => {
    const vault = makeVault({ '.settings': SETTINGS, 'a.md': '# a\n' })
    const trustFile = join(tempDir('bismuth-trust-'), 'trusted.json')

    const before = await runCli(vault, trustFile, 'settings', 'status-bar')
    expect(before.code).toBe(0)
    const [count, files, run] = before.json.segments
    expect(files.text).toBe('files: 1')
    expect(count.text).toBe('1 notes')
    expect(run.untrusted).toEqual({ command: 'echo hi' })
    expect(run.text).toBe('')

    const prev = process.env.BISMUTH_TRUST_FILE
    process.env.BISMUTH_TRUST_FILE = trustFile
    try {
        trustCommand(vault, 'echo hi')
    } finally {
        if (prev === undefined) delete process.env.BISMUTH_TRUST_FILE
        else process.env.BISMUTH_TRUST_FILE = prev
    }

    const after = await runCli(vault, trustFile, 'settings', 'status-bar')
    expect(after.code).toBe(0)
    expect(after.json.segments[2].text).toBe('hi')
    expect(after.json.segments[2].untrusted).toBeUndefined()
}, 30_000)
