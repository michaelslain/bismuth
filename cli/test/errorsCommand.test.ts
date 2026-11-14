import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { realpathSync } from 'node:fs'
import { tempDir } from '../../core/test/helpers'
import { clearAppErrors, readAppErrors, recordAppError } from '../../core/src/appErrors'
import { commandTier } from '../../core/src/visibilityCliGate'
import { commands } from '../src/commands/errors'

// `errors` reads the app error log under BISMUTH_HOME, which the test preload points at a temp dir.

const saved = process.env.BISMUTH_VAULT
beforeEach(() => {
    clearAppErrors()
    delete process.env.BISMUTH_VAULT
})
afterEach(() => {
    clearAppErrors()
    if (saved === undefined) delete process.env.BISMUTH_VAULT
    else process.env.BISMUTH_VAULT = saved
})

async function run(name: string, args: string[]): Promise<unknown> {
    const printed: string[] = []
    const spy = spyOn(console, 'log').mockImplementation(l => void printed.push(String(l)))
    try {
        await commands[name]!.run(args)
    } finally {
        spy.mockRestore()
    }
    return JSON.parse(printed.join('\n'))
}

test('errors lists this vault by default, every vault with --all, and clear empties the log', async () => {
    const a = realpathSync(tempDir('bismuth-errors-a-'))
    const b = realpathSync(tempDir('bismuth-errors-b-'))
    recordAppError({ kind: 'error', message: 'in a', vault: a }, new Date('2026-11-01T00:00:00Z'))
    recordAppError({ kind: 'rejection', message: 'in b', vault: b }, new Date('2026-11-02T00:00:00Z'))
    recordAppError({ kind: 'error', message: 'in a again', vault: a }, new Date('2026-11-03T00:00:00Z'))

    const mine = (await run('errors', ['--vault', a])) as { message: string }[]
    expect(mine.map(e => e.message)).toEqual(['in a', 'in a again'])

    const all = (await run('errors', ['--vault', a, '--all'])) as { message: string }[]
    expect(all.map(e => e.message)).toEqual(['in a', 'in b', 'in a again'])

    const newest = (await run('errors', ['--all', '--limit', '1'])) as { message: string }[]
    expect(newest.map(e => e.message)).toEqual(['in a again'])

    expect(await run('errors clear', [])).toEqual({ cleared: 3 })
    expect(readAppErrors()).toEqual([])
})

test('errors refuses a --limit that is not a positive whole number', () => {
    const exit = spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit')
    }) as never)
    const err = spyOn(console, 'error').mockImplementation(() => {})
    try {
        expect(() => commands.errors!.run(['--limit', '0'])).toThrow('exit')
    } finally {
        exit.mockRestore()
        err.mockRestore()
    }
})

test('an agent may read the error log in any vault', () => {
    expect(commandTier(['errors'])).toBe('always-safe')
    expect(commandTier(['errors', 'clear'])).toBe('always-safe')
})
