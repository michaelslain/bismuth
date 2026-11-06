import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { optionalVault } from '../src/args'
import { resolveCore } from '../src/http'

// An agent's shell sits in the vault and passes no flags. The CLI resolves that vault from the working
// directory, and finds the running app serving it, rather than guessing :4321 when several run.

const dirs: string[] = []
const saved = {
    cwd: process.cwd(),
    vault: process.env.BISMUTH_VAULT,
    runDir: process.env.BISMUTH_RUN_DIR,
    api: process.env.BISMUTH_API,
    relay: process.env.CLAUDE_RELAY_URL,
}

function tmp(prefix: string): string {
    const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
    dirs.push(d)
    return d
}

function vault(): string {
    const v = tmp('bismuth-cwd-vault-')
    writeFileSync(join(v, '.settings'), '')
    mkdirSync(join(v, 'notes', 'deep'), { recursive: true })
    return v
}

afterEach(() => {
    process.chdir(saved.cwd)
    for (const [k, v] of [
        ['BISMUTH_VAULT', saved.vault],
        ['BISMUTH_RUN_DIR', saved.runDir],
        ['BISMUTH_API', saved.api],
        ['CLAUDE_RELAY_URL', saved.relay],
    ] as const) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
    }
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('the vault a flagless command resolves', () => {
    test('is the vault the working directory sits in', () => {
        const v = vault()
        delete process.env.BISMUTH_VAULT
        process.chdir(join(v, 'notes', 'deep'))
        expect(optionalVault([])).toBe(v)
    })

    test('--vault and BISMUTH_VAULT still win over the working directory', () => {
        const v = vault()
        process.chdir(v)
        process.env.BISMUTH_VAULT = '/env/vault'
        expect(optionalVault([])).toBe('/env/vault')
        expect(optionalVault(['--vault', '/flag/vault'])).toBe('/flag/vault')
    })

    test('is undefined outside any vault', () => {
        delete process.env.BISMUTH_VAULT
        process.chdir(tmp('bismuth-cwd-none-'))
        expect(optionalVault([])).toBeUndefined()
    })
})

test('with two apps running, a flagless command inside a vault reaches the app serving that vault', () => {
    const mine = vault()
    const other = vault()
    const runDir = tmp('bismuth-cwd-run-')
    writeFileSync(join(runDir, 'a.json'), JSON.stringify({ port: 51111, vault: other, pid: process.pid }))
    writeFileSync(join(runDir, 'b.json'), JSON.stringify({ port: 52222, vault: mine, pid: process.pid }))
    process.env.BISMUTH_RUN_DIR = runDir
    delete process.env.BISMUTH_VAULT
    delete process.env.BISMUTH_API
    delete process.env.CLAUDE_RELAY_URL
    process.chdir(join(mine, 'notes'))
    expect(resolveCore([])).toBe('http://localhost:52222')
})
