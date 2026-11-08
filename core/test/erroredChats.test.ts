import { expect, test } from 'bun:test'
import { appendFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './helpers'
import {
    erroredChatsPath,
    markErroredChat,
    readErroredChats,
} from '../src/erroredChats'

test('a mark appends one line under logs/ and reads back', () => {
    const dir = join(tempDir('bismuth-errored-'), '.daemon')
    markErroredChat(
        dir,
        { sessionId: 's1', reason: 'cron hung', channel: 'daemon' },
        new Date('2026-11-07T10:00:00Z'),
    )
    markErroredChat(
        dir,
        { sessionId: 's2', reason: 'tool failed' },
        new Date('2026-11-07T12:00:00Z'),
    )
    expect(erroredChatsPath(dir)).toBe(join(dir, 'logs', '.errored-chats.jsonl'))
    expect(readFileSync(erroredChatsPath(dir), 'utf8').trim().split('\n')).toHaveLength(2)
    expect(readErroredChats(dir)).toEqual([
        { ts: '2026-11-07T10:00:00.000Z', sessionId: 's1', reason: 'cron hung', channel: 'daemon' },
        { ts: '2026-11-07T12:00:00.000Z', sessionId: 's2', reason: 'tool failed' },
    ])
    expect(readErroredChats(dir, { since: '2026-11-07T11:00:00Z' }).map(e => e.sessionId)).toEqual(['s2'])
    rmSync(dir, { recursive: true, force: true })
})

test('a missing file reads as empty and a malformed line is skipped', () => {
    const dir = join(tempDir('bismuth-errored-bad-'), '.daemon')
    expect(readErroredChats(dir)).toEqual([])
    markErroredChat(dir, { sessionId: 's1', reason: 'x' }, new Date('2026-11-07T10:00:00Z'))
    appendFileSync(erroredChatsPath(dir), '{not json\n{"ts":1}\n')
    expect(readErroredChats(dir).map(e => e.sessionId)).toEqual(['s1'])
    rmSync(dir, { recursive: true, force: true })
})
