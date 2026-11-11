// bench/syntheticVault.ts
//
// The made-up vault and its known-answer scoring. Everything here is pure: no model, no fs. The vault is invented
// by Haiku from a prompt that names nothing of the user's; its questions carry a known answer, so a run is scored
// against that answer and not against another run.
import { packSources } from '../core/src/sourcePack'
import type { SourceHit } from '../core/src/semanticSources'

export type SynthQuestion = { id: string; kind: 'needle' | 'aggregate' | 'unanswerable'; question: string; answer: string | null; evidence: string[] }
export type SynthVault = { notes: { path: string; text: string }[]; questions: SynthQuestion[]; distractors: Record<string, string[]> }
export type SynthArm = 'none' | 'references' | 'junk' | 'search'
export const SYNTH_ARMS: SynthArm[] = ['none', 'references', 'junk', 'search']
export type Verdict = 'correct' | 'wrong' | 'abstained'

/** Lower-case, whitespace collapsed: how an answer is looked for inside a note. */
export const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Problems with one question against the notes; [] when it holds up. */
export function questionProblems(q: SynthQuestion, byPath: Map<string, string>, distractors: Record<string, string[]>): string[] {
    const out: string[] = []
    const say = (m: string) => out.push(`${q.id}: ${m}`)
    if (q.kind !== 'needle' && q.kind !== 'aggregate' && q.kind !== 'unanswerable') return [`${q.id}: unknown kind ${String(q.kind)}`]
    if (!q.question.trim()) say('empty question')
    for (const p of q.evidence) if (!byPath.has(p)) say(`evidence note ${p} is missing`)
    if (q.kind === 'unanswerable') {
        if (q.answer !== null) say('an unanswerable question has an answer')
        if (q.evidence.length) say('an unanswerable question has evidence')
    } else {
        if (q.answer === null || !q.answer.trim()) say('no answer')
        if (!q.evidence.length) say('no evidence')
        if (q.kind === 'aggregate' && q.evidence.length < 2) say('an aggregate question needs at least two evidence notes')
        if (q.kind === 'needle' && q.answer && q.evidence.every(p => byPath.has(p))) {
            const a = norm(q.answer)
            if (a && !q.evidence.some(p => norm(byPath.get(p)!).includes(a))) say('the answer text does not appear in its evidence')
        }
    }
    const ds = distractors[q.id] ?? []
    if (!ds.length) say('no distractor notes')
    for (const p of ds) {
        if (!byPath.has(p)) say(`distractor note ${p} is missing`)
        else if (q.evidence.includes(p)) say(`distractor note ${p} is also evidence`)
        else if (q.answer && norm(byPath.get(p)!).includes(norm(q.answer))) say(`distractor note ${p} contains the answer`)
    }
    return out
}

/** Problems with the whole vault; [] is valid. */
export function validateSynth(v: SynthVault): string[] {
    const out: string[] = []
    const byPath = new Map<string, string>()
    for (const n of v.notes) {
        if (byPath.has(n.path)) out.push(`duplicate note ${n.path}`)
        byPath.set(n.path, n.text)
    }
    const ids = new Set<string>()
    for (const q of v.questions) {
        if (ids.has(q.id)) out.push(`duplicate question id ${q.id}`)
        ids.add(q.id)
        out.push(...questionProblems(q, byPath, v.distractors))
    }
    return out
}

/** The ids of the questions `validateSynth` rejects: what the generator regenerates. */
export function rejectedIds(v: SynthVault): string[] {
    const byPath = new Map(v.notes.map(n => [n.path, n.text] as const))
    return v.questions.filter(q => questionProblems(q, byPath, v.distractors).length).map(q => q.id)
}

/** One scored row. A question is answerable (needle, aggregate) or not; `correct` is for the first, `abstainedRight` the second.
 *  `misled`: the answer relied on a given note that is not evidence, and was not right. A row with nothing given is never misled. */
export function scoreRow(a: { q: SynthQuestion; verdict: Verdict; given: string[]; opened: string[]; relied: string[] }): { correct: boolean; abstainedRight: boolean; openedShare: number | null; misled: boolean } {
    const answerable = a.q.kind !== 'unanswerable'
    const correct = answerable && a.verdict === 'correct'
    const abstainedRight = !answerable && a.verdict === 'abstained'
    const openedShare = a.given.length ? a.given.filter(g => a.opened.includes(g)).length / a.given.length : null
    const reliedOnWrong = a.relied.some(r => a.given.includes(r) && !a.q.evidence.includes(r))
    return { correct, abstainedRight, openedShare, misled: reliedOnWrong && !(correct || abstainedRight) }
}

// ---- references ---------------------------------------------------------------------------------

const titleOf = (text: string): string => (text.split('\n').find(l => l.trim()) ?? '').replace(/^#+\s*/, '').trim()

/** The notes a question's arm gives the agent: `references` its evidence, `junk` its distractors. */
export function givenPaths(q: SynthQuestion, distractors: Record<string, string[]>, arm: SynthArm): string[] {
    return arm === 'references' ? q.evidence : arm === 'junk' ? (distractors[q.id] ?? []) : []
}

/** The shipped references rendering (`packSources`, prompt mode, so at most the shipped file limit) for those notes.
 *  `given` is the paths that made it into the block. */
export function referencesBlock(paths: string[], byPath: Map<string, string>, vaultDir: string): { text: string | null; given: string[] } {
    const hits: SourceHit[] = paths
        .filter(p => byPath.has(p))
        .map((p, i) => {
            const text = byPath.get(p)!
            return { kind: 'note' as const, id: p, score: 1 - i * 0.001, excerpt: text.replace(/\s+/g, ' ').trim(), title: titleOf(text) }
        })
    const packed = packSources(hits, 'prompt', 1_000_000, vaultDir)
    return { text: packed.text, given: packed.injected.map(h => h.id) }
}

/** The agent's message for an arm: the references block (when it has one) above the question. */
export const messageFor = (question: string, block: string | null): string => (block ? `${block}\n${question}` : question)

// ---- parsing model replies ------------------------------------------------------------------------

/** The first JSON object in a reply; null when none parses. */
export function jsonObject(reply: string | null): Record<string, any> | null {
    const m = reply?.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
        const v = JSON.parse(m[0])
        return v && typeof v === 'object' ? v : null
    } catch {
        return null
    }
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

export type Bible = { people: { name: string; role: string; project: string }[]; projects: { name: string; summary: string }[] }

/** The invented cast: unique names only, every person on a listed project. Null when it cannot be used. */
export function parseBible(reply: string | null): Bible | null {
    const j = jsonObject(reply)
    if (!j || !Array.isArray(j.people) || !Array.isArray(j.projects)) return null
    const projects = j.projects.filter((p: any) => nonEmpty(p?.name) && nonEmpty(p?.summary)).map((p: any) => ({ name: p.name.trim(), summary: p.summary.trim() }))
    const names = new Set(projects.map((p: any) => p.name.toLowerCase()))
    if (names.size !== projects.length || !projects.length) return null
    const seen = new Set<string>()
    const people: Bible['people'] = []
    for (const p of j.people) {
        if (!nonEmpty(p?.name) || !nonEmpty(p?.role) || !nonEmpty(p?.project)) continue
        if (seen.has(p.name.toLowerCase()) || !names.has(p.project.trim().toLowerCase())) continue
        seen.add(p.name.toLowerCase())
        people.push({ name: p.name.trim(), role: p.role.trim(), project: p.project.trim() })
    }
    return people.length ? { people, projects } : null
}

export const slugOf = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** `{"notes":[{"for":key,"text":...}]}` -> text by key, only for keys asked for. */
export function parseNotes(reply: string | null, keys: string[]): Map<string, string> {
    const out = new Map<string, string>()
    const j = jsonObject(reply)
    if (!j || !Array.isArray(j.notes)) return out
    for (const n of j.notes) {
        const key = nonEmpty(n?.for) ? n.for.trim().replace(/^key\s+/i, '') : ''
        if (keys.includes(key) && nonEmpty(n?.text) && n.text.trim().length > 80 && !out.has(key)) out.set(key, n.text.trim())
    }
    return out
}

export type RawQuestion = { question: string; answer: string | null; evidence: string[]; distractors: string[] }

/** `{"questions":[...]}` with the kind's own shape; anything malformed is ignored. */
export function parseQuestions(reply: string | null, kind: SynthQuestion['kind']): RawQuestion[] {
    const j = jsonObject(reply)
    if (!j || !Array.isArray(j.questions)) return []
    const out: RawQuestion[] = []
    for (const q of j.questions) {
        if (!nonEmpty(q?.question)) continue
        const evidence = Array.isArray(q.evidence) && q.evidence.every(nonEmpty) ? (q.evidence as string[]).map(e => e.trim()) : null
        const distractors = Array.isArray(q.distractors) ? (q.distractors as unknown[]).filter(nonEmpty).map(d => d.trim()) : []
        if (!evidence || !distractors.length) continue
        if (kind === 'unanswerable') out.push({ question: q.question.trim(), answer: null, evidence: [], distractors })
        else if (nonEmpty(q.answer)) out.push({ question: q.question.trim(), answer: q.answer.trim(), evidence, distractors })
    }
    return out
}

// ---- grading ---------------------------------------------------------------------------------------

export const GRADER_SYSTEM =
    'You grade an assistant\'s answer to a question about a made-up notes vault. You are given the question, the known answer (or "none: the vault does not say"), and the assistant\'s final reply. ' +
    'Verdict "correct": the reply states the known answer (wording may differ, a number or name must match); extra true detail or caveats around it do not make it wrong. "abstained": the reply says it cannot find the answer or does not know, and states no answer. "wrong": anything else, including a confident answer that differs from the known answer, and a confident answer to a question whose known answer is "none". ' +
    'If numbered items are listed, also list the numbers of the items the reply actually depends on (a fact taken from the item); an item that is merely present is not relied on. ' +
    'Reply with one JSON object and nothing else: {"verdict":"correct"|"wrong"|"abstained","relied":[numbers]}.'

/** The grader's text for one answer. `items` are the notes the agent was given, in the order numbered. */
export function graderText(q: SynthQuestion, answer: string, items: { path: string; text: string }[]): string {
    const parts = [`QUESTION: ${q.question}`, `KNOWN ANSWER: ${q.answer ?? 'none: the vault does not say'}`, `REPLY:\n${answer || '(empty)'}`]
    if (items.length) parts.push('ITEMS:\n' + items.map((it, i) => `${i + 1}. ${it.path}\n${it.text.slice(0, 700)}`).join('\n\n'))
    return parts.join('\n\n')
}

/** The verdict and the relied-on paths from a grader reply; null when unreadable. */
export function parseGrade(reply: string | null, given: string[]): { verdict: Verdict; relied: string[] } | null {
    const j = jsonObject(reply)
    if (!j || (j.verdict !== 'correct' && j.verdict !== 'wrong' && j.verdict !== 'abstained')) return null
    const nums: number[] = Array.isArray(j.relied) ? j.relied.filter((n: unknown) => Number.isInteger(n)) : []
    return { verdict: j.verdict, relied: [...new Set(nums.map(n => given[n - 1]).filter((p): p is string => !!p))] }
}

// ---- the summary -----------------------------------------------------------------------------------

export type SynthRow = { model: string; arm: SynthArm; qid: string; kind: SynthQuestion['kind']; status: 'ok' | 'failed'; correct: boolean; abstainedRight: boolean; openedShare: number | null; misled: boolean; given: number }
export type SummaryRow = { model: string; arm: SynthArm; answerable: number; accuracy: number | null; unanswerable: number; abstention: number | null; withReferences: number; openedShare: number | null; misledShare: number | null; failed: number }

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** One row per model and arm. Runs that failed (error, timeout) are counted apart and left out of every share. A share
 *  with nothing to divide is null, never 0. No pass line: rows only. */
export function summarize(rows: SynthRow[]): SummaryRow[] {
    const keys = [...new Set(rows.map(r => `${r.model}\u0000${r.arm}`))]
    return keys.map(k => {
        const [model, arm] = k.split('\u0000') as [string, SynthArm]
        const mine = rows.filter(r => r.model === model && r.arm === arm)
        const ok = mine.filter(r => r.status === 'ok')
        const ans = ok.filter(r => r.kind !== 'unanswerable')
        const un = ok.filter(r => r.kind === 'unanswerable')
        const given = ok.filter(r => r.given > 0)
        return {
            model,
            arm,
            answerable: ans.length,
            accuracy: mean(ans.map(r => (r.correct ? 1 : 0))),
            unanswerable: un.length,
            abstention: mean(un.map(r => (r.abstainedRight ? 1 : 0))),
            withReferences: given.length,
            openedShare: mean(given.map(r => r.openedShare ?? 0)),
            misledShare: mean(given.map(r => (r.misled ? 1 : 0))),
            failed: mine.length - ok.length,
        }
    })
}
