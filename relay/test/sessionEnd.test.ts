import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sweepTempDirs, tempDir } from './tempDirs'

const BIN = join(import.meta.dir, '..', 'bin')
afterAll(sweepTempDirs)

const server = Bun.serve({ port: 0, fetch: () => new Response('{}') })
afterAll(() => server.stop(true))

const line = (type: string, text: string) =>
    JSON.stringify({ type, message: { role: type, content: text } })

function vault(settings: string | null) {
    const root = tempDir('session-end-')
    const mem = join(root, '.daemon', 'memory')
    mkdirSync(mem, { recursive: true })
    if (settings !== null) writeFileSync(join(root, '.settings'), settings)
    const transcript = join(root, 't.jsonl')
    writeFileSync(
        transcript,
        [
            line('user', 'How do I rebase a branch onto main without losing my work?'),
            line(
                'assistant',
                'Run git fetch, then git rebase origin/main, and resolve conflicts file by file before continuing the rebase.',
            ),
        ].join('\n'),
    )
    return { mem, transcript }
}

async function endSession(settings: string | null) {
    const { mem, transcript } = vault(settings)
    const proc = Bun.spawn(['bun', 'run', join(BIN, 'session-end-hook.ts')], {
        stdin: new Blob([
            JSON.stringify({ session_id: 'abcdef123456', reason: 'exit', transcript_path: transcript }),
        ]),
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            ...process.env,
            CLAUDE_TERMINAL_ID: 't1',
            CLAUDE_RELAY_URL: `http://localhost:${server.port}`,
            BISMUTH_MEMORY_DIR: mem,
        },
    })
    await proc.exited
    return readdirSync(mem).filter(f => f.startsWith('auto-'))
}

describe('session end gates transcript capture on daemon.saveSessions', () => {
    test('key absent writes no note', async () => {
        expect(await endSession('daemon:\n  enabled: true\n')).toEqual([])
    })
    test('no settings file writes no note', async () => {
        expect(await endSession(null)).toEqual([])
    })
    test('false writes no note', async () => {
        expect(await endSession('daemon:\n  saveSessions: false\n')).toEqual([])
    })
    test('malformed settings write no note', async () => {
        expect(await endSession('daemon: [unclosed\n')).toEqual([])
    })
    test('true writes one note', async () => {
        expect(await endSession('daemon:\n  saveSessions: true\n')).toHaveLength(1)
    })
})
