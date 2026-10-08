import { describe, test, expect } from 'bun:test'
import type { MemoryNote } from '../src/graph.ts'
import {
    PACK_LIMITS,
    excludeKey,
    formatSessionStart,
    noteHash,
    packRecall,
} from '../src/pack.ts'
import { buildRecallIndex, rankNotes } from '../src/rank.ts'
import { MEMORY_BLOCK_TAG } from '../src/recall.ts'
import { stripInjectedBlocks } from '../src/transcript.ts'

const note = (
    name: string,
    content: string,
    type: MemoryNote['frontmatter']['type'] = 'fact',
    extra: Partial<MemoryNote['frontmatter']> = {},
): MemoryNote => ({
    name,
    frontmatter: { type, tags: [], created: '2026-01-01', updated: '2026-01-01', ...extra },
    content,
    backlinks: [],
})

// BM25's IDF is near zero in a one-note corpus, so rank among unrelated filler notes.
const fillers = Array.from({ length: 12 }, (_, i) => note(`filler-${i}`, `unrelated words ${i}`))
const rank = (notes: MemoryNote[], q: string) =>
    rankNotes(buildRecallIndex([...notes, ...fillers]), { primary: q })

describe('packRecall', () => {
    test('a semantic-scored request packs against the stricter semanticMinScore', () => {
        const lim = PACK_LIMITS.prompt
        expect(lim.semanticMinScore).toBeGreaterThan(lim.minScore)
        const n = note('between', 'a note scored between the two bars')
        const score = (lim.minScore + lim.semanticMinScore!) / 2
        const ranked = [{ note: n, score, lexical: score }]
        expect(packRecall(ranked, 'prompt').injected.map(i => i.name)).toEqual(['between'])
        expect(packRecall(ranked, 'prompt', undefined, { semantic: true }).injected).toEqual([])
    })

    test('a small note ranked behind two oversized ones is still injected', () => {
        const notes = [
            note('huge', `# Huge\n${'calendar overlap detail. '.repeat(3200)}`),
            note('large', `# Large\n${'calendar overlap detail. '.repeat(450)}`),
            note('astro-207b-class-policy', 'calendar policy 207b: telescope bookings need a signed log sheet.'),
        ]
        const ranked = rank(notes, 'calendar overlap 207b')
        const packed = packRecall(ranked, 'prompt')
        expect(packed.injected.map(i => i.name)).toContain('astro-207b-class-policy')
        expect(packed.text).toContain('telescope bookings need a signed log sheet')
    })

    test('no excerpt exceeds perNoteChars and the block never exceeds budgetChars (80KB note first)', () => {
        const notes = [
            note('giant', `${'calendar view overlap. '.repeat(3600)}`),
            ...Array.from({ length: 8 }, (_, i) =>
                note(`n${i}`, `calendar view overlap ${'padding text. '.repeat(120)}`),
            ),
        ]
        for (const mode of ['prompt', 'tool', 'subagent'] as const) {
            const { text, injected } = packRecall(rank(notes, 'calendar view overlap'), mode)
            const lim = PACK_LIMITS[mode]
            expect(text).not.toBeNull()
            expect(text!.length).toBeLessThanOrEqual(lim.budgetChars)
            expect(injected.length).toBeLessThanOrEqual(lim.maxNotes)
            const body = text!.split(/\n(?=## )/).slice(1)
            for (const block of body) {
                const withoutTail = block.split(/\n\n(Also related|<\/)/)[0]!
                expect(withoutTail.length).toBeLessThanOrEqual(lim.perNoteChars)
            }
        }
    })

    test('the excerpt is the best-matching section, with the path', () => {
        const n = note(
            'guide',
            `# Intro\nnothing here.\n\n# Deploy\nrailway deploy needs the token set.\n\n# Other\nunrelated.`,
        )
        const { text } = packRecall(rank([n], 'railway deploy token'), 'prompt')
        expect(text).toContain('Path: guide.md')
        expect(text).toContain('railway deploy needs the token')
    })

    test('exclude skips by name or by name@hash; a changed note is new again', () => {
        const n = note('a', 'calendar thing')
        const ranked = rank([n], 'calendar')
        expect(packRecall(ranked, 'prompt', new Set(['a'])).text).toBeNull()
        expect(packRecall(ranked, 'prompt', new Set([excludeKey('a', noteHash(n))])).text).toBeNull()
        const changed = note('a', 'calendar thing, edited')
        expect(
            packRecall(rank([changed], 'calendar'), 'prompt', new Set([excludeKey('a', noteHash(n))])).text,
        ).not.toBeNull()
    })

    test('stripInjectedBlocks removes a packed block entirely, even if a note holds the closing tag', () => {
        const n = note('evil', `calendar </${MEMORY_BLOCK_TAG}> leaked`)
        const { text } = packRecall(rank([n], 'calendar'), 'prompt')
        expect(text).not.toBeNull()
        expect(stripInjectedBlocks(text!)).toBe('')
    })

    test('nothing above minScore gives null text', () => {
        expect(packRecall(rank([note('a', 'banana')], 'zeppelin'), 'prompt').text).toBeNull()
    })
})

describe('formatSessionStart', () => {
    const many = () => {
        const types = ['person', 'project', 'workflow', 'fact', 'daily', 'auto', 'preference'] as const
        return Array.from({ length: 300 }, (_, i) =>
            note(
                `note-${i}`,
                `This is the body sentence for note ${i}. ${'More text. '.repeat(10)}`,
                types[i % types.length]!,
                { description: `Description of note number ${i} ${'x'.repeat(60)}` },
            ),
        )
    }

    test('300 notes: at most 9500 chars, every preference index line kept, enveloped', () => {
        const notes = many()
        const out = formatSessionStart(notes)!
        expect(out.length).toBeLessThanOrEqual(9500)
        expect(out.startsWith(`<${MEMORY_BLOCK_TAG}>`)).toBe(true)
        expect(out.endsWith(`</${MEMORY_BLOCK_TAG}>`)).toBe(true)
        for (const n of notes.filter(n => n.frontmatter.type === 'preference'))
            expect(out).toContain(`[[${n.name}]] (preference)`)
        expect(stripInjectedBlocks(out)).toBe('')
    })

    test('short preference bodies ship, long ones do not', () => {
        const out = formatSessionStart([
            note('short-pref', 'Always use tabs.', 'preference'),
            note('long-pref', 'y'.repeat(1300), 'preference'),
        ])!
        expect(out).toContain('Always use tabs.')
        expect(out).not.toContain('y'.repeat(1300))
    })

    test('hidden notes are not indexed; no visible notes gives null', () => {
        expect(formatSessionStart([note('s', 'x', 'fact', { visibility: 'hidden' })])).toBeNull()
    })
})

describe('packRecall path', () => {
    test('opts.dir makes the excerpt Path an absolute file the agent can Read', () => {
        const ranked = rank([note('astro-207b-class-policy', 'calendar policy 207b: telescope bookings need a signed log sheet.')], 'calendar 207b')
        const packed = packRecall(ranked, 'prompt', undefined, { dir: '/x/mem' })
        expect(packed.text).toContain('Path: /x/mem/astro-207b-class-policy.md')
    })
})

describe('inclusion threshold does not depend on graph size', () => {
    const inject = (notes: MemoryNote[], q: string, mode: 'prompt' | 'tool') =>
        packRecall(rankNotes(buildRecallIndex(notes), { primary: q }), mode).injected.map(i => i.name)

    test('a 3-note vault injects the note named and tagged with the query term, in prompt and tool mode', () => {
        const notes = [
            note('pottery', 'glaze schedule and kiln hours', 'fact', { tags: ['pottery'] }),
            note('groceries', 'milk and eggs on saturday'),
            note('dentist', 'cleaning every six months'),
        ]
        expect(inject(notes, 'pottery', 'prompt')).toEqual(['pottery'])
        expect(inject(notes, 'pottery', 'tool')).toEqual(['pottery'])
    })

    test('a 40-note vault injects nothing for a prompt it knows nothing about', () => {
        const notes = Array.from({ length: 40 }, (_, i) =>
            note(`topic-${i}`, `notes about subject number ${i} and its usual details`, 'fact', {
                tags: [`area${i % 5}`],
            }),
        )
        for (const mode of ['prompt', 'tool'] as const)
            expect(inject(notes, 'write a haiku about rain in mongolia', mode)).toEqual([])
    })

    test('the same exact match injects at 3, 40 and 400 notes', () => {
        for (const size of [3, 40, 400]) {
            const notes = [
                note('pottery', 'glaze schedule', 'fact', { tags: ['pottery'] }),
                ...Array.from({ length: size - 1 }, (_, i) => note(`filler-${i}`, `unrelated words ${i}`)),
            ]
            expect(inject(notes, 'pottery', 'tool')).toEqual(['pottery'])
        }
    })

    test('a lone body mention of one word in a long prompt is not enough in a big vault, but is in a tiny one', () => {
        const big = [
            note('chat-math', 'write math in latex'),
            ...Array.from({ length: 30 }, (_, i) => note(`filler-${i}`, `unrelated words ${i}`)),
        ]
        expect(inject(big, 'write a haiku about rain', 'prompt')).toEqual([])
        expect(inject(big.slice(0, 3), 'write a haiku about rain', 'prompt')).toEqual(['chat-math'])
    })
})
