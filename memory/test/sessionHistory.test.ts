import { expect, test } from 'bun:test'
import {
    encodeProjectDir,
    parseSession,
    queryWords,
    turnInRange,
    turnMatches,
} from '../src/sessionHistory'

const line = (o: unknown) => JSON.stringify(o)
const prompt = (text: string, timestamp: string, extra = {}) =>
    line({ type: 'user', timestamp, message: { role: 'user', content: text }, ...extra })
const reply = (text: string, timestamp: string, extra = {}) =>
    line({
        type: 'assistant',
        timestamp,
        message: { role: 'assistant', content: [{ type: 'text', text }] },
        ...extra,
    })

test('encodeProjectDir matches Claude Code: every non-alphanumeric becomes -', () => {
    expect(encodeProjectDir('/Users/m/Documents/library of alexandria')).toBe(
        '-Users-m-Documents-library-of-alexandria',
    )
    expect(encodeProjectDir('/a/b.c_d')).toBe('-a-b-c-d')
})

test('parseSession pairs turns, dates them, and skips sidechains and junk lines', () => {
    const jsonl = [
        prompt('should i go to the bside event', '2026-10-09T18:00:00'),
        reply('Go.', '2026-10-09T18:00:05'),
        reply('subagent chatter', '2026-10-09T18:00:06', { isSidechain: true }),
        'not json',
        prompt('<editor-context>\nActive pane: x\n</editor-context>\n\nok i will', '2026-10-09T18:05:00'),
        reply('Good.', '2026-10-09T18:05:02'),
        '',
    ].join('\n')
    const s = parseSession('abc', jsonl)!
    expect(s.id).toBe('abc')
    expect(s.date).toBe('2026-10-09')
    expect(s.started).toBe('2026-10-09T18:00:00')
    expect(s.ended).toBe('2026-10-09T18:05:00')
    expect(s.turns.map(t => [t.user, t.claude])).toEqual([
        ['should i go to the bside event', 'Go.'],
        ['ok i will', 'Good.'],
    ])
})

test('parseSession drops cron-fired sessions and sessions with no prompt', () => {
    expect(parseSession('c', prompt('[Cron: dream] run', '2026-10-09T01:00:00'))).toBeNull()
    expect(parseSession('e', reply('hello', '2026-10-09T01:00:00'))).toBeNull()
    expect(parseSession('z', '')).toBeNull()
})

test('turnMatches needs every query word, in either side, case-insensitively', () => {
    const turn = { user: 'Should I go to BSide?', claude: 'Go for an hour.' }
    expect(turnMatches(turn, queryWords('bside hour'))).toBe(true)
    expect(turnMatches(turn, queryWords('bside essay'))).toBe(false)
    expect(turnMatches(turn, [])).toBe(true)
})

test('turnInRange compares local dates inclusively, and an undated turn is out of any range', () => {
    const turn = { user: 'x', claude: '', at: '2026-10-09T12:00:00' }
    expect(turnInRange(turn, '2026-10-09', '2026-10-09')).toBe(true)
    expect(turnInRange(turn, '2026-10-10')).toBe(false)
    expect(turnInRange(turn, undefined, '2026-10-08')).toBe(false)
    expect(turnInRange({ user: 'x', claude: '' }, '2026-10-01')).toBe(false)
    expect(turnInRange({ user: 'x', claude: '' })).toBe(true)
})

test('budgetSessions shows sessions until the budget, then lists the rest as pointers', async () => {
    const { budgetSessions } = await import('../src/sessionHistory')
    const mk = (id: string, chars: number) => {
        const s = parseSession(id, prompt('p'.repeat(chars), '2026-10-09T10:00:00'))!
        return { session: s, turns: s.turns }
    }
    const r = budgetSessions([mk('one', 600), mk('two', 600), mk('three', 10)], 1000)
    expect(r.shown.map(f => f.session.id)).toEqual(['one'])
    expect(r.more.map(p => p.id)).toEqual(['two', 'three'])
    expect(r.more[0]).toMatchObject({ date: '2026-10-09', turnCount: 1, matched: 1 })
    expect(r.more[0]!.opening).toHaveLength(120)
})
