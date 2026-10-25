import { test, expect, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processButtonTriggers } from '../src/daemon/buttons'
import { vaultPaths } from '../src/lib/config'

const made: string[] = []
afterEach(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup() {
    const root = mkdtempSync(join(tmpdir(), 'bismuth-buttons-'))
    made.push(root)
    const ctx = vaultPaths(root)
    mkdirSync(ctx.buttonStateDir, { recursive: true })
    mkdirSync(ctx.buttonTriggerDir, { recursive: true })
    return ctx
}
const state = (extra: Record<string, unknown> = {}) => ({
    status: 'working',
    host: 'note:a.md',
    label: 'go',
    prompt: 'do it\n\n---\nThis button is in the note a.md.',
    model: 'haiku',
    timeoutSecs: 300,
    pressedAt: '2026-10-20T00:00:00.000Z',
    completedAt: null,
    note: null,
    ...extra,
})
function put(ctx: ReturnType<typeof setup>, key: string, s: unknown, trigger = true) {
    if (s) writeFileSync(join(ctx.buttonStateDir, `${key}.json`), JSON.stringify(s))
    if (trigger) writeFileSync(join(ctx.buttonTriggerDir, key), '')
}
const read = (ctx: ReturnType<typeof setup>, key: string) =>
    JSON.parse(readFileSync(join(ctx.buttonStateDir, `${key}.json`), 'utf-8'))
const owner = async () => true
async function settled(ctx: ReturnType<typeof setup>, key: string) {
    for (let i = 0; i < 100; i++) {
        if (read(ctx, key).status !== 'working') return read(ctx, key)
        await new Promise(r => setTimeout(r, 10))
    }
    throw new Error('never settled')
}

test('done: sends state.prompt in a new session and writes a 500-char note', async () => {
    const ctx = setup()
    put(ctx, 'k1', state())
    const calls: any[] = []
    const send = (async (msg: string, _c: unknown, opts: unknown) => {
        calls.push([msg, opts])
        return { result: 'x'.repeat(900) }
    }) as any
    await processButtonTriggers(ctx, { send, owner })
    const s = await settled(ctx, 'k1')
    expect(calls[0][0]).toBe(state().prompt)
    expect(calls[0][1]).toEqual({ newSession: true, model: 'haiku', timeoutSecs: 300 })
    expect(s.status).toBe('done')
    expect(s.note.length).toBe(500)
    expect(s.completedAt).toBeTruthy()
    expect(s.label).toBe('go')
    expect(existsSync(join(ctx.buttonTriggerDir, 'k1'))).toBe(false)
})

test('failed: writes the error and completedAt', async () => {
    const ctx = setup()
    put(ctx, 'k2', state())
    const send = (async () => {
        throw new Error('boom')
    }) as any
    await processButtonTriggers(ctx, { send, owner })
    const s = await settled(ctx, 'k2')
    expect(s.status).toBe('failed')
    expect(s.note).toContain('boom')
    expect(s.completedAt).toBeTruthy()
})

test('stale trigger with no state, and non-working states, fire nothing', async () => {
    const ctx = setup()
    put(ctx, 'none', null)
    put(ctx, 'done', state({ status: 'done', note: 'old' }))
    put(ctx, 'noprompt', state({ prompt: undefined }))
    let n = 0
    const send = (async () => {
        n++
        return { result: 'r' }
    }) as any
    await processButtonTriggers(ctx, { send, owner })
    await new Promise(r => setTimeout(r, 30))
    expect(n).toBe(0)
    expect(read(ctx, 'done').note).toBe('old')
    expect(existsSync(join(ctx.buttonTriggerDir, 'none'))).toBe(false)
})

test('overlapping polls never double-fire a running key', async () => {
    const ctx = setup()
    put(ctx, 'k3', state())
    let n = 0
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const send = (async () => {
        n++
        await gate
        return { result: 'ok' }
    }) as any
    await processButtonTriggers(ctx, { send, owner })
    put(ctx, 'k3', null) // second trigger while the first still runs
    await processButtonTriggers(ctx, { send, owner })
    release()
    await settled(ctx, 'k3')
    expect(n).toBe(1)
})

test('not the owner: nothing runs and the trigger is dropped', async () => {
    const ctx = setup()
    put(ctx, 'k4', state())
    let n = 0
    const send = (async () => {
        n++
        return { result: 'r' }
    }) as any
    await processButtonTriggers(ctx, { send, owner: async () => false })
    expect(n).toBe(0)
    expect(read(ctx, 'k4').status).toBe('working')
    expect(existsSync(join(ctx.buttonTriggerDir, 'k4'))).toBe(false)
})
