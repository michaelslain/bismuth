import { describe, expect, test } from 'bun:test'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateVault, type AskFn } from './syntheticEval'
import {
    GRADER_SYSTEM,
    givenPaths,
    graderText,
    messageFor,
    parseBible,
    parseGrade,
    parseNotes,
    parseQuestions,
    referencesBlock,
    rejectedIds,
    scoreRow,
    summarize,
    validateSynth,
    type SynthQuestion,
    type SynthRow,
    type SynthVault,
} from './syntheticVault'

const notes = [
    { path: 'people/mira-tolland.md', text: '# Mira Tolland\nLeads the Brindlewood project. Desk is on floor 4.' },
    { path: 'logs/brindlewood-2026-02-03.md', text: '# Brindlewood 2026-02-03\nThe budget was set at 41200 credits.' },
    { path: 'logs/brindlewood-2026-02-10.md', text: '# Brindlewood 2026-02-10\nThe review moved to Thursday.' },
    { path: 'archive/note-1.md', text: '# Old budget\nThe budget was 38000 credits last year.' },
    { path: 'archive/note-2.md', text: '# Floor plan\nThe printers are on floor 2.' },
]
const needle: SynthQuestion = { id: 'n1', kind: 'needle', question: 'What budget was set for Brindlewood?', answer: '41200 credits', evidence: ['logs/brindlewood-2026-02-03.md'] }
const agg: SynthQuestion = { id: 'a1', kind: 'aggregate', question: 'What happened across the Brindlewood logs?', answer: 'budget set then review moved', evidence: ['logs/brindlewood-2026-02-03.md', 'logs/brindlewood-2026-02-10.md'] }
const un: SynthQuestion = { id: 'u1', kind: 'unanswerable', question: 'Who paid for the Brindlewood launch party?', answer: null, evidence: [] }
const good = (): SynthVault => ({ notes, questions: [needle, agg, un], distractors: { n1: ['archive/note-1.md'], a1: ['archive/note-2.md'], u1: ['archive/note-2.md'] } })

describe('validateSynth', () => {
    test('a sound vault has no problems', () => expect(validateSynth(good())).toEqual([]))
    test('rejects a missing evidence note', () => {
        const v = good()
        v.questions[0] = { ...needle, evidence: ['logs/nope.md'] }
        expect(validateSynth(v).join('\n')).toContain('evidence note logs/nope.md is missing')
        expect(rejectedIds(v)).toEqual(['n1'])
    })
    test('rejects a needle whose answer is not in its evidence, but not an aggregate', () => {
        const v = good()
        v.questions[0] = { ...needle, answer: '99999 credits' }
        v.questions[1] = { ...agg, answer: 'something never written down' }
        expect(rejectedIds(v)).toEqual(['n1'])
    })
    test('answer matching ignores case and whitespace', () => {
        const v = good()
        v.questions[0] = { ...needle, answer: '41200   CREDITS' }
        expect(validateSynth(v)).toEqual([])
    })
    test('an unanswerable question must carry no answer and no evidence', () => {
        const v = good()
        v.questions[2] = { ...un, answer: 'someone' }
        expect(rejectedIds(v)).toEqual(['u1'])
    })
    test('a distractor that holds the answer or is evidence is rejected', () => {
        const v = good()
        v.distractors.n1 = ['archive/note-1.md', 'logs/brindlewood-2026-02-03.md']
        expect(validateSynth(v).join('\n')).toContain('also evidence')
        v.notes[3] = { path: 'archive/note-1.md', text: 'It was 41200 credits after all.' }
        v.distractors.n1 = ['archive/note-1.md']
        expect(validateSynth(v).join('\n')).toContain('contains the answer')
    })
    test('duplicate ids, duplicate paths and a question with no distractors are reported', () => {
        const v = good()
        v.questions.push({ ...needle })
        v.notes.push(notes[0]!)
        v.distractors.n1 = []
        const p = validateSynth(v).join('\n')
        expect(p).toContain('duplicate question id n1')
        expect(p).toContain('duplicate note people/mira-tolland.md')
        expect(p).toContain('no distractor notes')
    })
})

describe('scoreRow', () => {
    const base = { given: [] as string[], opened: [] as string[], relied: [] as string[] }
    test('correct answer to an answerable question', () => expect(scoreRow({ q: needle, verdict: 'correct', ...base })).toEqual({ correct: true, abstainedRight: false, openedShare: null, misled: false }))
    test('abstaining on an unanswerable question is right; answering it is not', () => {
        expect(scoreRow({ q: un, verdict: 'abstained', ...base }).abstainedRight).toBe(true)
        expect(scoreRow({ q: un, verdict: 'wrong', ...base }).abstainedRight).toBe(false)
        expect(scoreRow({ q: un, verdict: 'correct', ...base }).correct).toBe(false)
    })
    test('opened share is the share of given notes opened', () => {
        const s = scoreRow({ q: needle, verdict: 'correct', given: ['a.md', 'b.md'], opened: ['a.md', 'z.md'], relied: [] })
        expect(s.openedShare).toBe(0.5)
    })
    test('misled: wrong answer that leaned on a given non-evidence note', () => {
        const row = { q: needle, given: ['archive/note-1.md'], opened: ['archive/note-1.md'], relied: ['archive/note-1.md'] }
        expect(scoreRow({ ...row, verdict: 'wrong' }).misled).toBe(true)
        expect(scoreRow({ ...row, verdict: 'correct' }).misled).toBe(false)
        expect(scoreRow({ ...row, relied: [], verdict: 'wrong' }).misled).toBe(false)
        expect(scoreRow({ q: un, given: ['archive/note-2.md'], opened: [], relied: ['archive/note-2.md'], verdict: 'wrong' }).misled).toBe(true)
        expect(scoreRow({ q: un, given: ['archive/note-2.md'], opened: [], relied: ['archive/note-2.md'], verdict: 'abstained' }).misled).toBe(false)
    })
    test('relying on its evidence is never misled', () => {
        expect(scoreRow({ q: needle, verdict: 'wrong', given: needle.evidence, opened: [], relied: needle.evidence }).misled).toBe(false)
    })
})

describe('references arms', () => {
    const byPath = new Map(notes.map(n => [n.path, n.text] as const))
    test('references = evidence, junk = distractors, search and none = nothing', () => {
        const d = good().distractors
        expect(givenPaths(needle, d, 'references')).toEqual(needle.evidence)
        expect(givenPaths(needle, d, 'junk')).toEqual(['archive/note-1.md'])
        expect(givenPaths(needle, d, 'search')).toEqual([])
        expect(givenPaths(needle, d, 'none')).toEqual([])
    })
    test('the block is the shipped rendering, capped at the shipped file limit, with an absolute path to open', () => {
        const three = ['logs/brindlewood-2026-02-03.md', 'logs/brindlewood-2026-02-10.md', 'people/mira-tolland.md']
        const r = referencesBlock(three, byPath, '/v')
        expect(r.given).toEqual(three.slice(0, 2))
        expect(r.text).toContain('Possibly related, unverified')
        expect(r.text).toContain('(open: `/v/logs/brindlewood-2026-02-03.md`)')
        expect(r.text).not.toContain('mira-tolland')
        expect(messageFor('Q?', r.text).endsWith('Q?')).toBe(true)
        expect(messageFor('Q?', null)).toBe('Q?')
    })
    test('no evidence gives no block', () => expect(referencesBlock([], byPath, '/v')).toEqual({ text: null, given: [] }))
})

describe('parsing', () => {
    test('parseBible keeps unique names on a listed project', () => {
        const b = parseBible('here {"projects":[{"name":"Brindlewood","summary":"x"}],"people":[{"name":"Mira","role":"lead","project":"brindlewood"},{"name":"mira","role":"dup","project":"Brindlewood"},{"name":"Ned","role":"r","project":"Nowhere"}]}')
        expect(b?.people.map(p => p.name)).toEqual(['Mira'])
        expect(parseBible('not json')).toBeNull()
        expect(parseBible('{"projects":[],"people":[]}')).toBeNull()
    })
    test('parseNotes matches by key and drops short or unknown ones', () => {
        const long = 'x'.repeat(100)
        const m = parseNotes(JSON.stringify({ notes: [{ for: 'a', text: long }, { for: 'b', text: 'short' }, { for: 'zzz', text: long }] }), ['a', 'b'])
        expect([...m.keys()]).toEqual(['a'])
        expect(parseNotes('oops', ['a']).size).toBe(0)
        expect([...parseNotes(JSON.stringify({ notes: [{ for: 'key a', text: long }] }), ['a']).keys()]).toEqual(['a'])
    })
    test('parseQuestions applies the kind shape and ignores malformed items', () => {
        const reply = JSON.stringify({ questions: [{ question: 'q1', answer: 'a', evidence: ['p.md'], distractors: ['d'] }, { question: 'q2', evidence: ['p.md'], distractors: ['d'] }, { question: 'q3', answer: 'a', evidence: ['p.md'] }] })
        expect(parseQuestions(reply, 'needle').map(q => q.question)).toEqual(['q1'])
        expect(parseQuestions(JSON.stringify({ questions: [{ question: 'u', evidence: [], distractors: ['d'] }] }), 'unanswerable')[0]).toEqual({ question: 'u', answer: null, evidence: [], distractors: ['d'] })
        expect(parseQuestions('nope', 'needle')).toEqual([])
    })
    test('parseGrade maps item numbers to paths and rejects an unknown verdict', () => {
        expect(parseGrade('{"verdict":"wrong","relied":[2,9]}', ['a.md', 'b.md'])).toEqual({ verdict: 'wrong', relied: ['b.md'] })
        expect(parseGrade('{"verdict":"maybe"}', [])).toBeNull()
        expect(parseGrade(null, [])).toBeNull()
    })
    test('the grader text carries the known answer and the numbered items', () => {
        const t = graderText(needle, 'It was 41200.', [{ path: 'archive/note-1.md', text: 'old' }])
        expect(t).toContain('KNOWN ANSWER: 41200 credits')
        expect(t).toContain('1. archive/note-1.md')
        expect(graderText(un, 'x', [])).toContain('none: the vault does not say')
        expect(GRADER_SYSTEM).toContain('abstained')
    })
})

describe('summarize', () => {
    const row = (o: Partial<SynthRow>): SynthRow => ({ model: 'm', arm: 'none', qid: 'q', kind: 'needle', status: 'ok', correct: false, abstainedRight: false, openedShare: null, misled: false, given: 0, ...o })
    test('one row per model and arm with shares over the right denominators', () => {
        const s = summarize([
            row({ qid: '1', correct: true }),
            row({ qid: '2' }),
            row({ qid: '3', kind: 'unanswerable', abstainedRight: true }),
            row({ qid: '4', kind: 'unanswerable' }),
            row({ qid: '5', kind: 'unanswerable', status: 'failed' }),
            row({ arm: 'junk', qid: '1', given: 2, openedShare: 0.5, misled: true }),
            row({ arm: 'junk', qid: '2', given: 1, openedShare: 1 }),
            row({ model: 'o', arm: 'junk', qid: '1', correct: true }),
        ])
        expect(s).toHaveLength(3)
        const none = s.find(r => r.model === 'm' && r.arm === 'none')!
        expect(none).toMatchObject({ answerable: 2, accuracy: 0.5, unanswerable: 2, abstention: 0.5, failed: 1, withReferences: 0, openedShare: null, misledShare: null })
        const junk = s.find(r => r.model === 'm' && r.arm === 'junk')!
        expect(junk).toMatchObject({ withReferences: 2, openedShare: 0.75, misledShare: 0.5, accuracy: 0, abstention: null })
        expect(s.find(r => r.model === 'o')!.accuracy).toBe(1)
    })
})

// ---- generation with a fake model ---------------------------------------------------------------------

/** A model that answers from the prompt alone: the same prompt always gets the same reply, as a cached store assumes. */
const fakeModel = (calls: { n: number }): AskFn => async (system, text) => {
    calls.n++
    if (system.startsWith('You invent the cast')) {
        const [, p, n] = text.match(/Invent (\d+) projects and (\d+) people/)!.map(Number)
        const projects = Array.from({ length: p! }, (_, i) => ({ name: `Proj${i} Alpha`, summary: `makes thing ${i}` }))
        const people = Array.from({ length: n! }, (_, i) => ({ name: `Pers${i} Quill`, role: 'staff', project: projects[i % projects.length]!.name }))
        return JSON.stringify({ projects, people })
    }
    if (system.startsWith('You write notes')) {
        const keys = [...text.matchAll(/^- ([\w/.-]+\.md): /gm)].map(m => m[1]!)
        return JSON.stringify({ notes: keys.map(k => ({ for: k, text: `# ${k}\nThe code for ${k} is zq-${k}. It was filed on a Tuesday by the front desk, with the usual stamp and a second copy for the archive.` })) })
    }
    const paths = [...text.matchAll(/^PATH: (\S+)/gm)].map(m => m[1]!)
    const n = Number(system.match(/Write exactly (\d+) questions/)![1])
    const kind = system.includes('needle questions') ? 'needle' : system.includes('aggregate questions') ? 'aggregate' : 'unanswerable'
    const distractors = (path: string) => [`# Old ${path}\nAn outdated figure for the same topic: nine hundred and ten, struck out last year.`, `# Misc ${path}\nA different desk had a different stamp, and nobody kept the receipt for it.`]
    const questions = Array.from({ length: n }, (_, i) => {
        const path = paths[i % paths.length]!
        if (kind === 'needle') return { question: `What is the code for ${path}?`, answer: `zq-${path}`, evidence: [path], distractors: distractors(path) }
        if (kind === 'aggregate') return { question: `Across ${paths.join(' and ')}, which codes were filed?`, answer: 'all of them', evidence: paths.slice(0, 2), distractors: distractors(path) }
        return { question: `Who paid for ${path}?`, evidence: [], distractors: distractors(path) }
    })
    return JSON.stringify({ questions })
}

describe('generateVault', () => {
    const gen = async (out: string, ask: AskFn, notes = 120, questions = 60) => generateVault({ out, notes, questions, concurrency: 6, timeoutMs: 5000, ask })
    const lines = (out: string) => readFileSync(join(out, 'batches.jsonl'), 'utf8').split('\n').filter(Boolean)
    const keysOf = (out: string) => lines(out).map(l => JSON.parse(l).k as string)

    test('gives the asked-for notes and questions with unique paths and ids, and a repeated key never reaches batches.jsonl', async () => {
        const out = mkdtempSync(join(tmpdir(), 'synth-gen-'))
        try {
            const { vault, problems, short } = await gen(out, fakeModel({ n: 0 }))
            expect(problems).toEqual([])
            expect(short).toEqual({})
            expect(vault.questions).toHaveLength(60)
            expect(new Set(vault.questions.map(q => q.id)).size).toBe(60)
            expect(new Set(vault.notes.map(n => n.path)).size).toBe(vault.notes.length)
            expect(vault.notes.filter(n => !n.path.startsWith('archive/'))).toHaveLength(120)
            const keys = keysOf(out)
            expect(new Set(keys).size).toBe(keys.length)
        } finally {
            rmSync(out, { recursive: true, force: true })
        }
    })

    test('a rerun asks nothing and gives the same vault, even when batches.jsonl repeats keys', async () => {
        const out = mkdtempSync(join(tmpdir(), 'synth-gen-'))
        try {
            const first = await gen(out, fakeModel({ n: 0 }))
            const before = lines(out).length
            appendFileSync(join(out, 'batches.jsonl'), lines(out).slice(-4).join('\n') + '\n')
            const calls = { n: 0 }
            const again = await gen(out, fakeModel(calls))
            expect(calls.n).toBe(0)
            expect(again.vault).toEqual(first.vault)
            expect(again.problems).toEqual([])
            expect(lines(out).length).toBe(before + 4)
        } finally {
            rmSync(out, { recursive: true, force: true })
        }
    })

    test('a question rejected in one round is regenerated, not served again from the cache', async () => {
        const out = mkdtempSync(join(tmpdir(), 'synth-gen-'))
        try {
            const calls = { n: 0 }
            const base = fakeModel(calls)
            let spoiled = 0
            // the first needle batch cites a note that does not exist, so validation rejects it and the next round asks again
            const ask: AskFn = async (system, text) => {
                const r = await base(system, text)
                if (system.includes('needle questions') && spoiled++ === 0) return r!.replace(/"evidence":\["[^"]+"\]/, '"evidence":["nope.md"]')
                return r
            }
            const { vault, problems } = await gen(out, ask, 60, 30)
            expect(problems).toEqual([])
            expect(vault.questions.filter(q => q.kind === 'needle')).toHaveLength(10)
            expect(new Set(vault.questions.map(q => q.id)).size).toBe(vault.questions.length)
        } finally {
            rmSync(out, { recursive: true, force: true })
        }
    })
})
