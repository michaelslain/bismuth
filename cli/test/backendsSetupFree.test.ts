import { test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { runSetupFree, formatBackendHint } from '../src/commands/backends'
import type { FreeAgentProgress } from '../../core/src/freeAgent'

// The installer is injected, so nothing here touches the network or the stub in core/src/freeAgent.ts.

let lines: string[]
let errs: string[]
let logSpy: ReturnType<typeof spyOn>
let errSpy: ReturnType<typeof spyOn>

beforeEach(() => {
    lines = []
    errs = []
    process.exitCode = 0
    logSpy = spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
        lines.push(a.join(' '))
    })
    errSpy = spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
        errs.push(a.join(' '))
    })
})
afterEach(() => {
    logSpy.mockRestore()
    errSpy.mockRestore()
    process.exitCode = 0
})

const MB = 1024 * 1024
const okInstall = async (
    _io?: unknown,
    onProgress?: (p: FreeAgentProgress) => void,
): Promise<FreeAgentProgress> => {
    onProgress?.({ phase: 'downloading', received: 12 * MB, total: 45 * MB })
    onProgress?.({ phase: 'downloading', received: 12 * MB + 10, total: 45 * MB })
    onProgress?.({ phase: 'downloading', received: 13 * MB, total: 45 * MB })
    onProgress?.({ phase: 'verifying' })
    onProgress?.({ phase: 'installing' })
    return { phase: 'ready', action: 'installed', version: '1.18.34' }
}

test('prints phase lines then the ready line', async () => {
    await runSetupFree([], okInstall)
    const text = lines.join('\n')
    expect(text).toContain('downloading opencode 12 / 45 MB')
    expect(text).toContain('downloading opencode 13 / 45 MB')
    // throttled to whole-MB changes: the +10 byte tick prints nothing
    expect(lines.filter(l => l.startsWith('downloading')).length).toBe(2)
    expect(text).toContain('checking the download…')
    expect(text).toContain('installing…')
    expect(text).toContain('ready: opencode 1.18.34 (installed)')
    expect(process.exitCode).toBe(0)
})

test('already-installed names the path', async () => {
    await runSetupFree([], async () => ({
        phase: 'ready',
        action: 'already-installed',
        path: '/opt/homebrew/bin/opencode',
    }))
    expect(lines.join('\n')).toContain(
        'ready: opencode already installed at /opt/homebrew/bin/opencode',
    )
})

test('an error exits 1 and prints the message', async () => {
    await runSetupFree([], async () => ({
        phase: 'error',
        message: 'opencode has no build for this platform',
    }))
    expect(process.exitCode).toBe(1)
    expect(errs.join('\n')).toContain('opencode has no build for this platform')
})

test('--json prints only the final object', async () => {
    await runSetupFree(['--json'], okInstall)
    expect(lines.length).toBe(1)
    expect(JSON.parse(lines[0])).toEqual({
        phase: 'ready',
        action: 'installed',
        version: '1.18.34',
    })
})

test('--json error still exits 1', async () => {
    await runSetupFree(['--json'], async () => ({ phase: 'error', message: 'x' }))
    expect(process.exitCode).toBe(1)
    expect(JSON.parse(lines[0]).phase).toBe('error')
})

test('the opencode install hint points at setup-free; others untouched', () => {
    expect(formatBackendHint('opencode', 'npm i -g opencode-ai')).toBe(
        'run `bismuth backends setup-free` for a free agent (no account), or install from opencode.ai',
    )
    expect(formatBackendHint('codex', 'npm i -g codex')).toBe('npm i -g codex')
})
