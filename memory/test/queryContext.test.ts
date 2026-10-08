import { describe, test, expect } from 'bun:test'
import {
    agentPrompts,
    contextFromTranscript,
    lastAgentPrompt,
    pathWords,
    queryFromToolCalls,
    semanticQueryText,
    toolQuery,
} from '../src/queryContext.ts'
import type { TranscriptEntry } from '../src/transcript.ts'

const jsonl = (lines: unknown[]): TranscriptEntry[] =>
    lines.map(l => JSON.parse(JSON.stringify(l)) as TranscriptEntry)

const fixture = jsonl([
    { type: 'user', message: { role: 'user', content: 'the month grid looks off' } },
    {
        type: 'assistant',
        message: {
            role: 'assistant',
            content: [
                { type: 'tool_use', name: 'Read', input: { file_path: 'app/src/calendar/MonthGrid.tsx' } },
                { type: 'text', text: 'Fixed the overflow. Do you want me to rename the calendar view?' },
            ],
        },
    },
    { type: 'user', message: { role: 'user', content: 'ok do it' } },
])

describe('contextFromTranscript', () => {
    test('a bare "ok do it" still yields the topic', () => {
        const ctx = contextFromTranscript(fixture)
        expect(ctx).toContain('calendar')
        expect(ctx).toContain('month grid')
        expect(ctx).not.toContain('ok do it')
    })

    test('injected memory blocks are stripped and maxChars is honoured', () => {
        const entries = jsonl([
            {
                type: 'assistant',
                message: {
                    role: 'assistant',
                    content: '<bismuth-memory>SECRETRECALL</bismuth-memory>real text ' + 'z'.repeat(500),
                },
            },
        ])
        const ctx = contextFromTranscript(entries, { maxChars: 100 })
        expect(ctx).not.toContain('SECRETRECALL')
        expect(ctx.length).toBeLessThanOrEqual(100)
    })

    test('empty transcript gives an empty string', () => {
        expect(contextFromTranscript([])).toBe('')
    })
})

describe('lastAgentPrompt', () => {
    test('returns the latest Agent tool_use prompt', () => {
        const entries = jsonl([
            { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Agent', input: { prompt: 'first' } }] } },
            { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'x' } }] } },
            { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Task', input: { prompt: 'second' } }] } },
        ])
        expect(lastAgentPrompt(entries)).toBe('second')
    })
    test('null when there is none', () => {
        expect(lastAgentPrompt(fixture)).toBeNull()
    })
})

describe('queryFromToolCalls', () => {
    test('a Read of a calendar path carries the topic', () => {
        const q = queryFromToolCalls([
            { tool_name: 'Read', tool_input: { file_path: 'app/src/calendar/MonthGrid.tsx' } },
        ])
        expect(q).toContain('calendar')
    })
    test('patterns, commands and a capped response head are included', () => {
        const q = queryFromToolCalls([
            { tool_name: 'Grep', tool_input: { pattern: 'flashcards' }, tool_response: 'x'.repeat(2000) },
            { tool_name: 'Bash', tool_input: { command: 'bun test core' } },
        ])
        expect(q).toContain('flashcards')
        expect(q).toContain('bun test core')
        expect(q.length).toBeLessThanOrEqual(1500)
    })
})

describe('toolQuery', () => {
    const tmp = '/var/folders/7q/zp1x4l2n3b5c6d8f9g0h0000gn/T/memrecall-e2e-b92H/vault/notes/weekend.md'
    test('a path keeps its name and nearest parents; temp dirs, home dirs, hashes and extensions go', () => {
        expect(pathWords(tmp)).toEqual({ leaf: 'weekend', dirs: 'memrecall e2e notes', named: true })
        expect(pathWords('/Users/odile/Documents/field/thesis/chapters/02-methods.md')).toEqual({
            leaf: '02 methods',
            dirs: 'thesis chapters',
            named: true,
        })
        expect(pathWords('C:/Users/odile/projects/hive log.pdf.md').leaf).toBe('hive log')
    })
    test('a code file or generic name is not named for its subject', () => {
        expect(pathWords('/Users/x/dev/shop/src/components/ProductCard.tsx').named).toBe(false)
        expect(pathWords('/Users/x/dev/shop/package.json').named).toBe(false)
        expect(pathWords('/Users/x/notes/index.md').named).toBe(false)
    })
    test('a named Read: leaf is primary, parents are location, the body is context', () => {
        const q = toolQuery([
            { tool_name: 'Read', tool_input: { file_path: tmp }, tool_response: '# weekend plan\n\nSaturday: farmers market.' },
        ])
        expect(q.primary).toBe('weekend')
        expect(q.location).toBe('memrecall e2e notes')
        expect(q.context).toContain('farmers market')
        expect(`${q.primary} ${q.location} ${q.context}`).not.toMatch(/folders|b92H|zp1x4l2n|\.md/)
    })
    test('the relay\'s stringified, 2000-char-cut response yields its content, not keys or escapes', () => {
        const content = `# weekend plan\n\nSaturday morning: stop by the farmers market.\n${'more words here '.repeat(200)}`
        const sent = JSON.stringify({ type: 'text', file: { filePath: tmp, content, numLines: 4 } }).slice(0, 2000)
        const q = toolQuery([{ tool_name: 'Read', tool_input: { file_path: tmp }, tool_response: sent }])
        expect(q.context).toContain('Saturday morning: stop by the farmers market.')
        expect(q.context).not.toMatch(/filePath|numLines|"type"|\\n|nSaturday/)
    })
    test('code, JSON and log lines in a response are dropped; prose and math prose stay', () => {
        const body = [
            "import { useState } from 'react'",
            '  "name": "storefront",',
            'export default function Card() {',
            '(pass) cart > adds an item [0.41ms]',
            'Use the bisection method on $f(x) = x^3 - 2$ to find a root.',
            'Saturday: farmers market for produce.',
        ].join('\n')
        const q = toolQuery([{ tool_name: 'Read', tool_input: { file_path: '/a/notes/x.md' }, tool_response: body }])
        expect(q.context).toBe(
            'Use the bisection method on $f(x) = x^3 - 2$ to find a root.\nSaturday: farmers market for produce.',
        )
    })
    test('grep output loses its path:line prefixes; a command\'s program is location', () => {
        const g = toolQuery([
            {
                tool_name: 'Grep',
                tool_input: { pattern: 'extractor', path: '/Users/odile/apiary' },
                tool_response: { mode: 'content', content: 'season/2027-08.md:12:Spun frames in the radial extractor.' },
            },
        ])
        expect(g.primary).toContain('extractor')
        expect(g.context).toBe('Spun frames in the radial extractor.')
        const b = toolQuery([{ tool_name: 'Bash', tool_input: { command: 'cd ~/dev/quant && git pull origin main' } }])
        expect(b.primary).toBe('pull origin main')
        expect(b.location).toBe('git')
    })
    test('semanticQueryText puts the tiers in salience order and caps the text', () => {
        const t = semanticQueryText({ primary: 'weekend', location: 'notes', context: 'x '.repeat(2000) })
        expect(t.startsWith('weekend\nnotes\nx')).toBe(true)
        expect(t.length).toBe(1000)
    })
})

describe('agentPrompts', () => {
    test('every Agent/Task tool_use in order with its id', () => {
        const entries = jsonl([
            { type: 'assistant', message: { role: 'assistant', content: [
                { type: 'tool_use', id: 'a1', name: 'Agent', input: { prompt: 'one' } },
                { type: 'tool_use', id: 'a2', name: 'Task', input: { prompt: 'two' } },
                { type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'x' } },
            ] } },
            { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a3', name: 'Agent', input: { prompt: 'three' } }] } },
        ])
        expect(agentPrompts(entries)).toEqual([
            { id: 'a1', prompt: 'one' },
            { id: 'a2', prompt: 'two' },
            { id: 'a3', prompt: 'three' },
        ])
        expect(agentPrompts(fixture)).toEqual([])
    })
    test('tool_uses that already have a tool_result are skipped', () => {
        const entries = jsonl([
            { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { prompt: 'one' } }] } },
            { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }] } },
            { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Agent', input: { prompt: 'two' } }] } },
        ])
        expect(agentPrompts(entries)).toEqual([{ id: 't2', prompt: 'two' }])
    })
})
