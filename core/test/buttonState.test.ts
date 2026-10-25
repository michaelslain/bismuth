// core/test/buttonState.test.ts — pressButton refusals, composed prompts and the stored states.
import { test, expect, afterEach } from 'bun:test'
import {
    writeFileSync,
    readFileSync,
    rmSync,
    existsSync,
} from 'node:fs'
import { join } from 'node:path'
import {
    pressButton,
    readButtonStates,
    buttonStateDir,
    buttonTriggerDir,
} from '../src/buttons/buttonState'
import { buttonKey } from '../src/buttons/buttonBlock'
import { tempDir } from './helpers'

const made: string[] = []
afterEach(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

const BODY = 'label: go\nprompt: do the thing'

function vaultWith(daemon: boolean, note?: string): string {
    const v = tempDir('bismuth-buttons-')
    made.push(v)
    if (daemon)
        writeFileSync(join(v, '.settings'), 'daemon:\n  enabled: true\n')
    if (note !== undefined) writeFileSync(join(v, 'n.md'), note)
    return v
}
const noteHost = { kind: 'note', path: 'n.md' } as const
const chatHost = { kind: 'chat', chatId: 'c1' } as const
const fenced = (b: string) => `# t\n\n\`\`\`button\n${b}\n\`\`\`\n`

test('a note press writes working state with the note context and drops the trigger', () => {
    const v = vaultWith(true, fenced(BODY))
    const r = pressButton(v, { host: noteHost, body: BODY, index: 0 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.key).toBe(buttonKey(noteHost, BODY, 0))
    expect(r.state).toMatchObject({
        status: 'working',
        host: 'note:n.md',
        label: 'go',
        model: 'haiku',
        timeoutSecs: 300,
        completedAt: null,
        note: null,
        prompt: 'do the thing\n\n---\nThis button is in the note n.md.',
    })
    const onDisk = JSON.parse(
        readFileSync(join(buttonStateDir(v), `${r.key}.json`), 'utf8'),
    )
    expect(onDisk).toEqual(r.state)
    expect(existsSync(join(buttonTriggerDir(v), r.key))).toBe(true)
})

test('a chat press composes the chat context and needs no note', () => {
    const v = vaultWith(true)
    const r = pressButton(v, { host: chatHost, body: BODY, index: 0 })
    expect(r.ok && r.state.prompt).toBe(
        'do the thing\n\n---\nThis button was pressed in a chat.',
    )
    expect(r.ok && r.state.host).toBe('chat:c1')
})

test('refuses daemon-off when the vault daemon is disabled', () => {
    const v = vaultWith(false, fenced(BODY))
    const r = pressButton(v, { host: noteHost, body: BODY, index: 0 })
    expect(r).toMatchObject({ ok: false, reason: 'daemon-off' })
    expect(existsSync(buttonStateDir(v))).toBe(false)
})

test('refuses not-found for a missing note, a missing fence and an edited body', () => {
    const v = vaultWith(true, fenced(BODY))
    for (const req of [
        {
            host: { kind: 'note', path: 'gone.md' } as const,
            body: BODY,
            index: 0,
        },
        {
            host: { kind: 'note', path: '../outside.md' } as const,
            body: BODY,
            index: 0,
        },
        { host: noteHost, body: 'label: go\nprompt: other', index: 0 },
    ])
        expect(pressButton(v, req)).toMatchObject({
            ok: false,
            reason: 'not-found',
        })
})

test('refuses invalid for an unparseable body, a bad index and a non-prompt button', () => {
    const bad = 'label: a'
    const send = '- label: s\n  send: hi\n- label: p\n  prompt: x'
    const v = vaultWith(true)
    expect(
        pressButton(v, { host: chatHost, body: bad, index: 0 }),
    ).toMatchObject({
        ok: false,
        reason: 'invalid',
        message: 'needs exactly one of prompt, send, command',
    })
    expect(
        pressButton(v, { host: chatHost, body: send, index: 0 }),
    ).toMatchObject({ ok: false, reason: 'invalid' })
    expect(
        pressButton(v, { host: chatHost, body: send, index: 5 }),
    ).toMatchObject({ ok: false, reason: 'invalid' })
    expect(pressButton(v, { host: chatHost, body: send, index: 1 }).ok).toBe(
        true,
    )
})

test('refuses running while working, and a done button can be pressed again', () => {
    const v = vaultWith(true)
    const req = { host: chatHost, body: BODY, index: 0 }
    const first = pressButton(v, req)
    expect(first.ok).toBe(true)
    expect(pressButton(v, req)).toMatchObject({ ok: false, reason: 'running' })
    if (!first.ok) return
    const done = {
        ...first.state,
        status: 'done',
        completedAt: 'now',
        note: 'ok',
    }
    writeFileSync(
        join(buttonStateDir(v), `${first.key}.json`),
        JSON.stringify(done),
    )
    const again = pressButton(v, req)
    expect(again.ok && again.state.status).toBe('working')
})

test('a stale working state can be pressed again', () => {
    const v = vaultWith(true)
    const req = { host: chatHost, body: BODY, index: 0 }
    const first = pressButton(v, req)
    if (!first.ok) throw new Error('press failed')
    const stale = {
        ...first.state,
        status: 'working',
        timeoutSecs: 300,
        pressedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    }
    writeFileSync(
        join(buttonStateDir(v), `${first.key}.json`),
        JSON.stringify(stale),
    )
    expect(pressButton(v, req).ok).toBe(true)
})

test('readButtonStates returns present states and omits missing, corrupt and malformed keys', () => {
    const v = vaultWith(true)
    const r = pressButton(v, { host: chatHost, body: BODY, index: 0 })
    if (!r.ok) throw new Error('press failed')
    writeFileSync(join(buttonStateDir(v), 'aaaaaaaaaaaaaaaa.json'), '{ nope')
    const out = readButtonStates(v, [
        r.key,
        'aaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbb',
        '../x',
    ])
    expect(Object.keys(out)).toEqual([r.key])
    expect(out[r.key]).toEqual(r.state)
    expect(readButtonStates(vaultWith(true), [r.key])).toEqual({})
})
