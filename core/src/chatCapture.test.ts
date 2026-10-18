import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { captureToMemory } from './chat'
import { sweepTempDirs, tempDir } from '../test/tempDirs'

afterAll(sweepTempDirs)

const messages = [
    {
        type: 'user',
        message: { role: 'user', content: 'How do I rebase a branch onto main without losing my work?' },
    },
    {
        type: 'assistant',
        message: {
            role: 'assistant',
            content:
                'Run git fetch, then git rebase origin/main, and resolve conflicts file by file before continuing the rebase.',
        },
    },
] as never

async function finishChat(settings: string | null) {
    const root = tempDir('chat-capture-')
    const memoryDir = join(root, '.daemon', 'memory')
    mkdirSync(memoryDir, { recursive: true })
    if (settings !== null) writeFileSync(join(root, '.settings'), settings)
    await captureToMemory(
        { cwd: root, memoryDir, sessionId: 'abcdef123456', turnCount: 1, captured: false },
        (async () => messages) as never,
    )
    return readdirSync(memoryDir).filter(f => f.startsWith('auto-'))
}

describe('chat capture gates on daemon.saveSessions', () => {
    test('key absent writes no note', async () => {
        expect(await finishChat('daemon:\n  enabled: true\n')).toEqual([])
    })
    test('false writes no note', async () => {
        expect(await finishChat('daemon:\n  saveSessions: false\n')).toEqual([])
    })
    test('true writes one note', async () => {
        expect(await finishChat('daemon:\n  saveSessions: true\n')).toHaveLength(1)
    })
})

describe('chat capture gates on chat visibility', () => {
    const save = 'daemon:\n  saveSessions: true\n'
    test('a visible chat writes one note', async () => {
        expect(
            await finishChat(`${save}chatVisibility:\n  default: all\n`),
        ).toHaveLength(1)
    })
    test('a chat-only default writes no note', async () => {
        expect(
            await finishChat(`${save}chatVisibility:\n  default: chat-only\n`),
        ).toEqual([])
    })
    test('a hidden default writes no note', async () => {
        expect(
            await finishChat(`${save}chatVisibility:\n  default: hidden\n`),
        ).toEqual([])
    })
    test('the chat own level hides it under a visible default', async () => {
        expect(
            await finishChat(
                `${save}chatVisibility:\n  default: all\n  abcdef123456: chat-only\n`,
            ),
        ).toEqual([])
    })
    test('the chat own all beats a restricting default', async () => {
        expect(
            await finishChat(
                `${save}chatVisibility:\n  default: hidden\n  abcdef123456: all\n`,
            ),
        ).toHaveLength(1)
    })
    test('an unreadable chatVisibility fails closed', async () => {
        expect(await finishChat(`${save}chatVisibility: bogus\n`)).toEqual([])
    })
})
