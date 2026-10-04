import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStatusRunner } from './statusBarRun'

const vault = () => mkdtempSync(join(tmpdir(), 'sbrun-'))

describe('createStatusRunner', () => {
    test('echo', async () => {
        expect(await createStatusRunner({ vault: vault() })('echo hi', 60)).toEqual({ output: 'hi' })
    })
    test('strips ANSI', async () => {
        const r = await createStatusRunner({ vault: vault() })("printf '\\033[31mred\\033[0m'", 60)
        expect(r).toEqual({ output: 'red' })
    })
    test('caps at 120 chars', async () => {
        const r = await createStatusRunner({ vault: vault() })('head -c 500 /dev/zero | tr "\\0" a', 60)
        expect('output' in r && r.output.length).toBe(120)
    })
    test('timeout kills', async () => {
        const r = await createStatusRunner({ vault: vault(), timeoutMs: 200 })('sleep 10', 60)
        expect('error' in r && r.error).toContain('timed out')
    })
    test('timeout bounds a compound command and its children', async () => {
        const t = performance.now()
        const r = await createStatusRunner({ vault: vault(), timeoutMs: 200 })('sleep 10; echo late', 60)
        expect('error' in r && r.error).toContain('timed out')
        expect(performance.now() - t).toBeLessThan(1500)
    })
    test('an output flood is read only up to the cap', async () => {
        expect(await createStatusRunner({ vault: vault() })('yes', 60)).toEqual({ output: 'y' })
    })
    test('false -> exit 1', async () => {
        expect(await createStatusRunner({ vault: vault() })('false', 60)).toEqual({ error: 'exit 1' })
    })
    test('stderr first line on failure; cwd + env are the vault', async () => {
        const v = vault()
        const run = createStatusRunner({ vault: v })
        expect(await run('echo boom >&2; exit 3', 60)).toEqual({ error: 'boom' })
        const r = await run('echo $BISMUTH_VAULT', 60)
        expect(r).toEqual({ output: v })
    })
    test('owner tokens are not passed to the command', async () => {
        const prev = { o: process.env.BISMUTH_OWNER_TOKEN, v: process.env.VITE_OWNER_TOKEN }
        process.env.BISMUTH_OWNER_TOKEN = 'x'
        process.env.VITE_OWNER_TOKEN = 'y'
        try {
            const run = createStatusRunner({ vault: vault() })
            expect(await run('echo "${BISMUTH_OWNER_TOKEN:-none}"', 60)).toEqual({ output: 'none' })
            expect(await run('echo "${VITE_OWNER_TOKEN:-none}"', 61)).toEqual({ output: 'none' })
        } finally {
            if (prev.o === undefined) delete process.env.BISMUTH_OWNER_TOKEN
            else process.env.BISMUTH_OWNER_TOKEN = prev.o
            if (prev.v === undefined) delete process.env.VITE_OWNER_TOKEN
            else process.env.VITE_OWNER_TOKEN = prev.v
        }
    })
    test('cache within every, respawn after, shared in-flight', async () => {
        const v = vault()
        const log = join(v, 'count')
        let t = 1000
        const run = createStatusRunner({ vault: v, now: () => t })
        const cmd = `echo x >> count; echo ok`
        await Promise.all([run(cmd, 10), run(cmd, 10)])
        expect(readFileSync(log, 'utf8').trim().split('\n').length).toBe(1)
        t += 5000
        await run(cmd, 10)
        expect(readFileSync(log, 'utf8').trim().split('\n').length).toBe(1)
        t += 6000
        await run(cmd, 10)
        expect(existsSync(log) && readFileSync(log, 'utf8').trim().split('\n').length).toBe(2)
    })
})
