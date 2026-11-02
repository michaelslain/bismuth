import { describe, expect, test } from 'bun:test'
import { fileKey, keyMatches, parseReplaySession, refersToPast, vaultPathsIn } from './recallReplayCases'

const VAULT = '/Users/me/my vault'
const FILES = new Set(['notes/plan.md', 'papers/a b.pdf', 'photos/board.png', 'photos/board.png.md'])

const user = (text: string, at = '2026-10-01T10:00:00Z', extra: object = {}) =>
    JSON.stringify({ type: 'user', timestamp: at, message: { content: text }, ...extra })
const toolResult = () =>
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } })
const tool = (name: string, input: object, extra: object = {}) =>
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] }, ...extra })

describe('vaultPathsIn', () => {
    test('finds absolute, escaped and relative vault paths, only when the file exists', () => {
        expect(vaultPathsIn({ file_path: `${VAULT}/papers/a b.pdf` }, VAULT, FILES)).toEqual(['papers/a b.pdf'])
        expect(vaultPathsIn({ command: 'cat /Users/me/my\\ vault/notes/plan.md' }, VAULT, FILES)).toEqual(['notes/plan.md'])
        expect(vaultPathsIn({ command: 'cd "/Users/me/my vault" && head notes/plan.md' }, VAULT, FILES)).toEqual(['notes/plan.md'])
        expect(vaultPathsIn({ command: 'cat notes/missing.md' }, VAULT, FILES)).toEqual([])
        expect(vaultPathsIn({ command: 'cat .daemon/memory/x.md' }, VAULT, new Set(['.daemon/memory/x.md']))).toEqual([])
    })
})

describe('fileKey', () => {
    test('maps files and companions to the kind the index uses', () => {
        expect(fileKey('notes/plan.md')).toBe('note:notes/plan.md')
        expect(fileKey('papers/a b.pdf')).toBe('pdf:papers/a b.pdf')
        expect(fileKey('photos/board.png')).toBe('image:photos/board.png')
        expect(fileKey('photos/board.png.md')).toBe('image:photos/board.png')
        expect(fileKey('papers/x.pdf.md')).toBe('pdf:papers/x.pdf')
        expect(fileKey('a.txt')).toBeNull()
    })
})

describe('parseReplaySession', () => {
    test('labels each prompt with what the agent fetched before the next prompt', () => {
        const log = [
            user('how do I write a calendar base?', '2026-10-01T10:00:00Z'),
            tool('mcp__bismuth__bismuth_docs_read', { path: 'bases/authoring/calendar.md#config-keys' }),
            toolResult(),
            tool('Read', { file_path: `${VAULT}/photos/board.png` }),
            tool('Write', { file_path: `${VAULT}/notes/plan.md`, content: 'x' }),
            user('thanks', '2026-10-01T10:05:00Z'),
            user('what did we talk about yesterday?', '2026-10-01T10:06:00Z'),
            tool('Bash', { command: 'cat notes/plan.md' }, { isSidechain: true }),
        ].join('\n')
        const s = parseReplaySession('s1', log, VAULT, FILES)
        expect(s.started).toBe('2026-10-01T10:00:00Z')
        expect(s.cases.map(c => c.prompt)).toEqual(['how do I write a calendar base?', 'thanks', 'what did we talk about yesterday?'])
        expect(s.cases[0]!.labels.sort()).toEqual(['docs:bases/authoring/calendar.md', 'image:photos/board.png'])
        expect(s.cases[0]!.usedTools).toBe(true)
        expect(s.cases[1]!.labels).toEqual([])
        expect(s.cases[1]!.usedTools).toBe(false)
        expect(s.cases.map(c => c.line)).toEqual([0, 5, 6])
        expect(s.cases[2]!.refersToPast).toBe(true)
        expect(s.cases[2]!.labels).toEqual([]) // the sidechain read is not the agent's
    })

    test('a cron session yields no cases, and injected blocks are stripped from prompts', () => {
        expect(parseReplaySession('c', user('[Cron: dream] run'), VAULT, FILES).cases).toEqual([])
        const s = parseReplaySession('e', user('<editor-context>\nActive file: x.md\n</editor-context>\nfix this'), VAULT, FILES)
        expect(s.cases[0]!.prompt).toBe('fix this')
    })
})

describe('keyMatches + refersToPast', () => {
    test('docs match by page, files exactly', () => {
        expect(keyMatches('docs:bases/authoring/calendar.md', 'docs:bases/authoring/calendar.md#config-keys')).toBe(true)
        expect(keyMatches('docs:bases/authoring/calendar.md', 'docs:bases/views/calendar.md')).toBe(false)
        expect(keyMatches('pdf:a.pdf', 'pdf:a.pdf')).toBe(true)
        expect(keyMatches('pdf:a.pdf', 'note:a.pdf')).toBe(false)
    })
    test('past-chat phrasing', () => {
        expect(refersToPast('remember when we fixed the cron?')).toBe(true)
        expect(refersToPast('write a calendar base')).toBe(false)
    })
})
