// cli/test/button.test.ts — `button list` and `button press` run in-process against a temp vault.
import { test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registry } from '../src/registry'

let vault: string
const FENCE = [
    '# t',
    '',
    '```button',
    '- label: Summarize',
    '  prompt: sum it up',
    '- label: Open daemon',
    '  command: open-daemon',
    '- label: Ask',
    '  send: hello',
    '```',
    '',
    '```button',
    'label: summarize',
    'prompt: again',
    '```',
    '',
    '```button',
    'label: broken',
    '```',
    '',
].join('\n')

beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'button-cli-'))
    writeFileSync(join(vault, '.settings'), 'daemon:\n  enabled: true\n')
    writeFileSync(join(vault, 'n.md'), FENCE)
    writeFileSync(
        join(vault, 'one.md'),
        '```button\nlabel: Go\nprompt: do it\n```\n',
    )
})
afterEach(() => rmSync(vault, { recursive: true, force: true }))

async function run(phrase: string, args: string[]) {
    const lines: string[] = []
    const errs: string[] = []
    const log = spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')))
    const err = spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errs.push(a.join(' ')))
    const exit = spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`)
    }) as never)
    let code: number | null = 0
    try {
        await registry[phrase].run([...args, '--vault', vault])
    } catch (e) {
        const m = /^exit:(\d+)$/.exec((e as Error).message)
        if (!m) throw e
        code = Number(m[1])
    } finally {
        log.mockRestore()
        err.mockRestore()
        exit.mockRestore()
    }
    return { stdout: lines.join('\n'), stderr: errs.join('\n'), code }
}

test('list prints every button with type, key and idle status, and an invalid fence as one error entry', async () => {
    const r = await run('button list', ['n.md'])
    expect(r.code).toBe(0)
    const rows = JSON.parse(r.stdout)
    expect(rows.map((x: { label?: string }) => x.label)).toEqual([
        'Summarize', 'Open daemon', 'Ask', 'summarize', undefined,
    ])
    expect(rows[0]).toMatchObject({ fence: 0, index: 0, type: 'prompt', status: 'idle' })
    expect(rows[0].key).toMatch(/^[0-9a-f]{16}$/)
    expect(rows[1].type).toBe('command')
    expect(rows[2].type).toBe('send')
    expect(rows[4].fence).toBe(2)
    expect(typeof rows[4].error).toBe('string')
})

test('press of a prompt button writes the working state and the trigger', async () => {
    const r = await run('button press', ['one.md', 'go'])
    expect(r.code).toBe(0)
    const res = JSON.parse(r.stdout)
    expect(res.ok).toBe(true)
    expect(res.state.status).toBe('working')
    expect(existsSync(join(vault, '.daemon/buttons/.state', `${res.key}.json`))).toBe(true)
    expect(readdirSync(join(vault, '.daemon/buttons/.triggers'))).toContain(res.key)
    const again = JSON.parse((await run('button list', ['one.md'])).stdout)
    expect(again[0].status).toBe('working')
})

test('press of a button already working exits 1 with the running refusal', async () => {
    await run('button press', ['one.md', 'Go'])
    const r = await run('button press', ['one.md', 'Go'])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, reason: 'running' })
})

test('press refuses an ambiguous label and lists the fences', async () => {
    const r = await run('button press', ['n.md', 'summarize'])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('2 buttons')
    expect(r.stderr).toContain('fences 0, 1')
})

test('press refuses a missing label and names the buttons that exist', async () => {
    const r = await run('button press', ['n.md', 'nope'])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('"Summarize"')
})

test('press refuses a send or command button', async () => {
    const c = await run('button press', ['n.md', 'open daemon'])
    expect(c.code).toBe(1)
    expect(c.stderr).toContain('a command button runs in the app; press it there')
    const s = await run('button press', ['n.md', 'ask'])
    expect(s.stderr).toContain('a send button runs in the app; press it there')
})

test('a missing note and a path outside the vault fail with a fix', async () => {
    const m = await run('button list', ['gone.md'])
    expect(m.code).toBe(1)
    expect(m.stderr).toContain('bismuth tree')
    const o = await run('button list', ['../x.md'])
    expect(o.code).toBe(1)
    expect(o.stderr).toContain('outside the vault')
})

test('press with the daemon off prints the daemon-off refusal and exits 1', async () => {
    writeFileSync(join(vault, '.settings'), 'daemon:\n  enabled: false\n')
    const r = await run('button press', ['one.md', 'go'])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.stdout).reason).toBe('daemon-off')
})

test('press keys the state under the normalized vault-relative path, like list', async () => {
    const listed = JSON.parse((await run('button list', ['one.md'])).stdout)[0].key
    const dotted = JSON.parse((await run('button press', ['./one.md', 'go'])).stdout)
    expect(dotted.key).toBe(listed)
    rmSync(join(vault, '.daemon'), { recursive: true, force: true })
    const abs = JSON.parse((await run('button press', [join(vault, 'one.md'), 'go'])).stdout)
    expect(abs.key).toBe(listed)
})
