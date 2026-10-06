// collectTranscript names the note after the session id; an EMPTY id must fall back to
// 'unknown' (not leave a trailing dash), which is why memory.ts uses `||`, not `??`.
import { afterAll, test, expect } from 'bun:test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectTranscript } from '../lib/memory'
import { sweepTempDirs, tempDir } from './tempDirs'

afterAll(sweepTempDirs)

function tmp(): string {
    return tempDir('bismuth-relay-memory-test-')
}

function transcript(dir: string): string {
    const p = join(dir, 't.jsonl')
    const lines = [
        {
            type: 'user',
            message: { role: 'user', content: 'how do I configure the daemon cron schedule' },
        },
        {
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'Set the cron expression in the daemon settings and reload.' }],
            },
        },
    ]
    writeFileSync(p, lines.map(l => JSON.stringify(l)).join('\n'))
    return p
}

test('empty session id writes a note ending -unknown', async () => {
    const work = tmp()
    const mem = join(work, 'mem')
    await collectTranscript(mem, transcript(work), '')
    const files = readdirSync(mem)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^auto-\d{8}-\d{6}-unknown\.md$/)
})

test('a normal session id is truncated to 8 chars in the name', async () => {
    const work = tmp()
    const mem = join(work, 'mem')
    await collectTranscript(mem, transcript(work), 'abcdef0123456789')
    expect(readdirSync(mem)[0]).toMatch(/-abcdef01\.md$/)
})
