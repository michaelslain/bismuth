import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeProjectDir } from '../memory/src/sessionHistory'
import { AGENT_SYSTEM, argOf, allSessionStarts, armSummary, buildJobs, buildNeedleJobs, fallbacksIn, needleSummary, needleSweep, needleVisible, pairVerdict, parseNeedleVerdict, planNeedles, planWork, prepareCase, REAL_ARMS, runWithRetry, searchesIn, sleptDuring, searchFallbacksByArm, searchSlots, sweep, usageReport, warmCases, warmReport, withoutDropped, type CaseInput, type RunResult, type Runner, type SearchExec } from './qualityReplay'
import type { Needle } from './needleCases'
import { SEARCH_FIRST, historyVisible, type Cand } from './qualityReplayCases'

const root = mkdtempSync(join(tmpdir(), 'qr-test-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const copy = join(root, 'copy')

const cand = (key: string, y: 0 | 1, accepted: boolean): Cand => ({ key, kind: 'file', cosine: 0.8, text: `${key}\nbody of ${key}`, y, matched: y === 1, accepted })
const withGate = [cand('note:a.md', 1, true), cand('note:b.md', 1, true), cand('note:c.md', 0, false), cand('note:d.md', 0, false), cand('note:e.md', 0, false)]
const gateShut = [cand('note:c.md', 0, false), cand('note:d.md', 0, false)]
const mk = (id: number, session: string, heldOut: boolean, cands: Cand[], visible: string[] = []): CaseInput => ({ id, session, set: 'labelled', heldOut, at: '2026-05-01T10:00:00Z', prompt: `question ${id}`, convo: '', visible, cands, dates: () => undefined })
const cases = [mk(1, 's1', false, withGate), mk(2, 's2', true, withGate), mk(3, 's3', true, gateShut)]
const opts = { samples: 2, agentModel: 'm-agent', copy, kFallback: 1 }

let calls = { agent: 0, ask: 0 }
const asked: { text: string; lookup: boolean }[] = []
/** Answers say GOOD when a sources block was in the message; the judge picks the side whose reply says GOOD (or always A when `biased`). */
const fake = (biased = false): Runner => ({
    agent: async c => {
        calls.agent++
        const r: RunResult = { status: 'ok', answer: `${c.message.includes('<bismuth-memory>') ? 'GOOD' : 'plain'} reply ${calls.agent}`, toolCalls: 1, turns: 2, tools: [{ name: 'Bash', arg: 'bismuth read x' }], denied: 0, denials: [], searches: 0, searchFallbacks: 0, usage: { input_tokens: 10, output_tokens: 5 }, tokens: 15, tokensAll: 15, costUsd: 0.01, durationMs: 5, model: c.model }
        return r
    },
    ask: async (_model, system, text, _t, lookup) => {
        calls.ask++
        asked.push({ text, lookup })
        if (system.startsWith('You are shown numbered items')) return { text: '{"relied":[1]}', usage: { input_tokens: 4, output_tokens: 1 }, cost: 0.001 }
        if (system.startsWith('You compare two answers')) {
            const [a, b] = text.split('=== Answer B ===')
            const better = biased ? 'A' : a!.includes('GOOD') ? 'A' : b!.includes('GOOD') ? 'B' : 'tie'
            return { text: `{"better":"${better}","reason":"r"}`, usage: { input_tokens: 8, output_tokens: 2 }, cost: 0.002 }
        }
        return { text: 'ok', usage: { input_tokens: 100 }, cost: 0.0001 }
    },
})
const base = (dir: string) => ({ dir, jobs: buildJobs(cases, opts), cases, models: { agent: 'm-agent', judge: 'm-judge', reliance: 'm-rel' }, workers: 3, log: () => {} })

describe('jobs', () => {
    const jobs = buildJobs(cases, opts)
    const get = (id: number, arm: string, s: number) => jobs.find(j => j.caseId === id && j.arm === arm && j.sample === s)!
    test('search has none message under a longer system prompt and its own key', () => {
        expect(get(1, 'search', 0).message).toBe(get(1, 'none', 0).message)
        expect(get(1, 'search', 0).system).toBe(`${AGENT_SYSTEM} ${SEARCH_FIRST}`)
        expect(get(1, 'search', 0).runKey).not.toBe(get(1, 'none', 0).runKey)
    })
    test('samples have distinct keys and an arm with no block shares none key', () => {
        expect(get(1, 'none', 0).runKey).not.toBe(get(1, 'none', 1).runKey)
        expect(get(3, 'references', 0).runKey).toBe(get(3, 'none', 0).runKey)
        expect(get(1, 'references', 0).runKey).not.toBe(get(1, 'none', 0).runKey)
        expect(get(1, 'excerpts', 0).message).toContain('body of note:a.md')
        expect(get(1, 'references', 0).message).not.toContain('body of note:a.md')
    })
    test('what history shows is part of the key', () => {
        const other = buildJobs([mk(1, 's1', false, withGate, ['older'])], opts)
        expect(other.find(j => j.arm === 'none' && j.sample === 0)!.runKey).not.toBe(get(1, 'none', 0).runKey)
    })
    test('plan counts distinct runs, both orders of each non-identical pair, and reliance per block run', () => {
        const p = planWork(jobs, [1, 2, 3])
        // case 3: references, excerpts and junk equal none (no block) and each sample pairs; search differs
        expect(p.identicalToNone).toBeGreaterThan(0)
        expect(p.judgements).toBe(p.pairs * 2)
        expect(p.reliance).toBe(new Set(jobs.filter(j => j.keys.length).map(j => j.runKey)).size)
    })
})

describe('sweep with a fake runner', () => {
    test('a rerun resumes from the cache and makes no call; both orders are distinct and blind', async () => {
        const dir = join(root, 'sweep')
        calls = { agent: 0, ask: 0 }
        const first = await sweep({ ...base(dir), runner: fake() })
        expect(calls.agent).toBeGreaterThan(0)
        const made = { ...calls }
        const again = await sweep({ ...base(dir), runner: fake() })
        expect(calls).toEqual(made)
        expect(again.fresh.runs.size).toBe(0)
        expect(again.fresh.verdicts.size).toBe(0)
        for (const p of first.pairs.filter(x => !x.same)) {
            expect(p.keys[0]).not.toBe(p.keys[1])
            expect(p.texts[0]).not.toBe(p.texts[1])
        }
        const judged = asked.filter(a => a.lookup)
        expect(judged.length).toBeGreaterThan(0)
        for (const a of judged) expect(a.text).not.toMatch(/\b(references|excerpts|junk|search|none)\b|bismuth-memory/)
        expect(first.pairs.filter(p => p.arm === 'control').length).toBe(3 * opts.samples)
        // an arm run that is identical to none makes no judge call and ties by construction
        const same = first.pairs.find(p => p.same)!
        expect(pairVerdict(same, first.verdicts)).toMatchObject({ outcome: 'tie', byConstruction: true })
    })

    test('a second sweep over rebuilt jobs on the same directory makes no agent call, and says how many it reused', async () => {
        const dir = join(root, 'resume-rebuilt')
        calls = { agent: 0, ask: 0 }
        await sweep({ ...base(dir), runner: fake() })
        const made = calls.agent
        const rebuilt = cases.map(c => ({ ...c, cands: [...c.cands], visible: [...c.visible] }))
        const lines: string[] = []
        const again = await sweep({ ...base(dir), jobs: buildJobs(rebuilt, { ...opts }), cases: rebuilt, runner: fake(), log: s => lines.push(s) })
        expect(calls.agent).toBe(made)
        expect(again.fresh.runs.size).toBe(0)
        expect(lines.find(l => l.startsWith('agent runs:'))).toMatch(/^agent runs: 0 to run of (\d+) distinct .*, \1 reused from \1 cached/)
    })

    test('a run killed mid-append leaves a torn last line that costs the next record nothing', async () => {
        const dir = join(root, 'resume-torn')
        calls = { agent: 0, ask: 0 }
        await sweep({ ...base(dir), runner: fake() })
        const path = join(dir, 'runs.jsonl')
        const all = readFileSync(path, 'utf8').split('\n').filter(Boolean)
        // the last record cut in half, as a kill leaves it, and the sweep started again
        writeFileSync(path, all.slice(0, -1).join('\n') + '\n' + all.at(-1)!.slice(0, 40))
        const before = calls.agent
        await sweep({ ...base(dir), runner: fake() })
        expect(calls.agent - before).toBe(1)
        const third = calls.agent
        await sweep({ ...base(dir), runner: fake() })
        expect(calls.agent).toBe(third)
    })

    test('a judge that follows content gives references a win in both orders, a biased judge gives ties', async () => {
        const good = await sweep({ ...base(join(root, 'good')), runner: fake() })
        const s = armSummary('references', good, cases, 200)
        expect(s.all.net).toBeGreaterThan(0)
        expect(s.outcomes.win).toBeGreaterThan(0)
        expect(s.orderConsistency).toBe(1)
        expect(s.heldOut.n).toBeLessThan(s.all.n)
        const biased = await sweep({ ...base(join(root, 'biased')), runner: fake(true) })
        const b = armSummary('references', biased, cases, 200)
        expect(b.outcomes.win).toBe(0)
        expect(b.outcomes.loss).toBe(0)
        expect(b.orderConsistency).toBe(0)
        // the control compares none with none: the content-following judge ties it
        expect(armSummary('control', good, cases, 200).all.net).toBe(0)
    })

    test('usage is summed by phase and projected from the per-case means', async () => {
        const res = await sweep({ ...base(join(root, 'usage')), runner: fake() })
        const u = usageReport(res, buildJobs(cases, opts), 3, 30)
        expect(u.agentRuns).toBe(new Set(buildJobs(cases, opts).map(j => j.runKey)).size)
        expect(u.phases.agentRuns.tokens.total).toBe(u.agentRuns * 15)
        expect(u.phases.agentRuns.projectedAtTarget.tokensTotal).toBe(u.phases.agentRuns.tokens.total * 10)
        expect(u.phases.judges.costUsd).toBeCloseTo(u.judgements * 0.002)
        expect(JSON.stringify(u)).not.toMatch(/"[a-zA-Z]*[Pp]ercent/)
    })
})

describe('history per case', () => {
    test('a case sees links to its visible sessions only, and removing them leaves the logs', () => {
        const logs = join(root, 'logs')
        mkdirSync(logs, { recursive: true })
        for (const id of ['old', 'mid', 'later']) writeFileSync(join(logs, `${id}.jsonl`), '{}\n')
        const out = join(root, 'out')
        const dirs = { out, copy, logs, indexHome: join(out, 'index-home'), realModels: null, cli: '/x/cli.ts' }
        const bin = prepareCase(dirs, 7, ['old', 'mid'])
        const h = join(out, 'history-config', 'case-7', 'projects', encodeProjectDir(copy))
        expect(readdirSync(h).sort()).toEqual(['mid.jsonl', 'old.jsonl'])
        expect(readlinkSync(join(h, 'old.jsonl'))).toBe(join(logs, 'old.jsonl'))
        const wrapper = readFileSync(join(bin, 'bismuth'), 'utf8')
        expect(wrapper).toContain(`CLAUDE_CONFIG_DIR="${join(out, 'history-config', 'case-7')}"`)
        expect(wrapper).toContain(`BISMUTH_HOME="${join(out, 'case-home', '7')}"`)
        expect(wrapper).toContain('--all')
        expect(wrapper).toContain('unset BISMUTH_API CLAUDE_RELAY_URL')
        expect(wrapper).toContain(`export BISMUTH_VAULT="${copy}"`)
        expect(argOf({ file_path: '/' + 'x'.repeat(400) }).length).toBe(401)
        rmSync(join(out, 'history-config'), { recursive: true, force: true })
        expect(existsSync(join(logs, 'old.jsonl'))).toBe(true)
    })
    test('a rerun over the links a killed run left behind does not throw EEXIST, and the new visible set wins', () => {
        const logs = join(root, 'logs-rerun')
        mkdirSync(logs, { recursive: true })
        for (const id of ['old', 'mid']) writeFileSync(join(logs, `${id}.jsonl`), '{}\n')
        const out = join(root, 'out-rerun')
        const indexHome = join(out, 'index-home')
        mkdirSync(join(indexHome, 'cache', 'chat-vectors'), { recursive: true })
        const dirs = { out, copy, logs, indexHome, realModels: null, cli: '/x/cli.ts' }
        prepareCase(dirs, 9, ['old', 'mid'])
        expect(() => prepareCase(dirs, 9, ['old'])).not.toThrow()
        const h = join(out, 'history-config', 'case-9', 'projects', encodeProjectDir(copy))
        expect(readdirSync(h)).toEqual(['old.jsonl'])
        expect(readdirSync(join(out, 'case-home', '9', 'cache')).sort()).toEqual(['chat-vectors', 'docs-vectors', 'vault-vectors'])
        expect(existsSync(join(logs, 'mid.jsonl'))).toBe(true)
    })
})

describe('a machine sleep', () => {
    const run = (status: RunResult['status'], sleptMs = 0): RunResult => ({ status, answer: '', toolCalls: 0, turns: 0, tools: [], denied: 0, denials: [], searches: 0, searchFallbacks: 0, usage: {}, tokens: 0, tokensAll: 0, costUsd: 0, durationMs: 1, model: 'm', sleptMs })
    const scripted = (list: RunResult[]) => {
        let i = 0
        return { agent: async () => list[i++]!, calls: () => i }
    }
    test('a failed run is retried once when the machine stayed awake', async () => {
        const f = scripted([run('timeout'), run('timeout'), run('ok')])
        expect((await runWithRetry(f.agent, {})).status).toBe('timeout')
        expect(f.calls()).toBe(2)
    })
    test('runs that overlapped a sleep keep being retried, up to four retries', async () => {
        const f = scripted([run('timeout', 600_000), run('timeout', 60_000), run('ok')])
        const lines: string[] = []
        expect((await runWithRetry(f.agent, {}, s => lines.push(s))).status).toBe('ok')
        expect(f.calls()).toBe(3)
        expect(lines[0]).toContain('machine slept 600s')
        const g = scripted(Array.from({ length: 9 }, () => run('error', 60_000)))
        await runWithRetry(g.agent, {})
        expect(g.calls()).toBe(5)
    })
    test('sleep gaps count only where they overlap the run', () => {
        const gaps = [{ from: 100, to: 200 }, { from: 500, to: 900 }]
        expect(sleptDuring(0, 1000, gaps)).toBe(500)
        expect(sleptDuring(150, 600, gaps)).toBe(150)
        expect(sleptDuring(300, 400, gaps)).toBe(0)
    })
})

describe('a warm search for every case', () => {
    const fellBack = 'meaning search unavailable (warming): keyword results only\n'
    const execAs = (of: (bin: string) => string[], seen: string[]): SearchExec => async bin => {
        seen.push(bin)
        const next = of(bin).shift() ?? ''
        return { exitCode: next === 'crash' ? 1 : 0, stderr: next === 'crash' ? '' : next, timedOut: next === 'hang' }
    }

    test('a case that stays keyword-only is dropped, counted, and never run', async () => {
        const plans: Record<string, string[]> = { b1: [''], b2: [fellBack, fellBack], b3: [fellBack, ''], b4: ['crash', 'crash'] }
        const seen: string[] = []
        const w = await warmCases([1, 2, 3, 4].map(id => ({ id, bin: `b${id}` })), { workers: 2, exec: execAs(b => plans[b]!, seen), log: () => {} })
        expect([...w.ready].sort()).toEqual([1, 3])
        expect(w.dropped.sort((a, b) => a.id - b.id)).toEqual([{ id: 2, why: 'warming' }, { id: 4, why: 'exit 1' }])
        // the warm attempts: one for a case that answers, two for the rest
        expect(seen.length).toBe(1 + 2 + 2 + 2)
        const rep = warmReport(w, 0)
        expect(rep).toMatchObject({ checked: 4, ready: 2, dropped: 2, droppedByReason: { warming: 1, 'exit 1': 1 } })

        const four = [mk(1, 's1', false, gateShut), mk(2, 's2', false, gateShut), mk(3, 's3', false, gateShut), mk(4, 's4', false, gateShut)]
        const live = withoutDropped(four, buildJobs(four, opts), w.dropped)
        expect(live.cases.map(c => c.id)).toEqual([1, 3])
        const ran = new Set<number>()
        const runner = fake()
        const res = await sweep({ dir: join(root, 'warm-drop'), jobs: live.jobs, cases: live.cases, runner: { ...runner, agent: c => (ran.add(c.caseId), runner.agent(c)) }, models: { agent: 'm-agent', judge: 'm-judge', reliance: 'm-rel' }, workers: 2, log: () => {} })
        expect([...ran].sort()).toEqual([1, 3])
        expect(res.runs.size).toBeGreaterThan(0)
    })

    test('a warm attempt that hangs is dropped as a timeout', async () => {
        const w = await warmCases([{ id: 9, bin: 'b' }], { workers: 1, attempts: 1, exec: async () => ({ exitCode: null, stderr: '', timedOut: true }), log: () => {} })
        expect(w.dropped).toEqual([{ id: 9, why: 'timeout' }])
    })

    test('a run counts the fallbacks its tool results report, per arm', () => {
        const toolResult = (content: unknown) => ({ type: 'user', message: { content: [{ type: 'tool_result', content }] } })
        expect(fallbacksIn(toolResult(`${fellBack}a.md 0.5 x`))).toBe(1)
        expect(fallbacksIn(toolResult([{ type: 'text', text: `${fellBack}y` }, { type: 'text', text: fellBack }]))).toBe(2)
        expect(fallbacksIn(toolResult('a.md 0.9 fine'))).toBe(0)
        expect(fallbacksIn({ type: 'assistant', message: { content: [{ type: 'text' }] } })).toBe(0)
        expect(searchesIn('bismuth search some words')).toBe(1)
        expect(searchesIn('bismuth docs search x && bismuth search y')).toBe(2)
        expect(searchesIn('bismuth read a.md')).toBe(0)
        const run = (searches: number, searchFallbacks: number) => ({ searches, searchFallbacks }) as RunResult
        const sum = searchFallbacksByArm(REAL_ARMS, [{ arm: 'none', run: run(3, 1) }, { arm: 'none', run: run(2, 0) }, { arm: 'search', run: run(5, 2) }, { arm: 'junk', run: undefined }])
        expect(sum.none).toEqual({ runs: 2, searches: 5, fellBack: 1, runsWithFallback: 1 })
        expect(sum.search).toEqual({ runs: 1, searches: 5, fellBack: 2, runsWithFallback: 1 })
        expect(sum.junk).toEqual({ runs: 0, searches: 0, fellBack: 0, runsWithFallback: 0 })
    })

    test('the search slots follow the machine and never exceed the agent pool', () => {
        const gb = 1024 ** 3
        expect(searchSlots(15, 24 * gb, 8)).toBe(2)
        expect(searchSlots(64, 256 * gb, 8)).toBe(8)
        expect(searchSlots(2, 4 * gb, 8)).toBe(1)
    })

    describe('the gate, with real processes', () => {
        const gateRoot = join(root, 'gate')
        const trace = join(gateRoot, 'trace')
        const cli = join(gateRoot, 'cli.ts')
        const wrapperWith = (id: number, slots: number) => {
            mkdirSync(gateRoot, { recursive: true })
            writeFileSync(cli, `import { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(trace)}, 'in\\n')\nawait Bun.sleep(200)\nappendFileSync(${JSON.stringify(trace)}, 'out\\n')\n`)
            const logs = join(gateRoot, 'logs')
            mkdirSync(logs, { recursive: true })
            return prepareCase({ out: join(gateRoot, `out${id}`), copy, logs, indexHome: join(gateRoot, `ih${id}`), realModels: null, cli, searchGate: { dir: join(gateRoot, `g${id}`), slots } }, id, [])
        }
        const run = (bin: string, ...args: string[]) => Bun.spawn([join(bin, 'bismuth'), ...args], { stdout: 'ignore', stderr: 'ignore' }).exited

        test('searches queue on the slots while other commands pass straight through', async () => {
            const bin = wrapperWith(1, 2)
            rmSync(trace, { force: true })
            expect(await Promise.all(Array.from({ length: 6 }, () => run(bin, 'search', 'x')))).toEqual([0, 0, 0, 0, 0, 0])
            let now = 0
            let peak = 0
            for (const l of readFileSync(trace, 'utf8').split('\n').filter(Boolean)) peak = Math.max(peak, (now += l === 'in' ? 1 : -1))
            expect(peak).toBe(2)
            expect(readdirSync(join(gateRoot, 'g1'))).toEqual([])
            // every slot taken by a live process: a command that does not embed still runs
            mkdirSync(join(gateRoot, 'g1', '0'))
            writeFileSync(join(gateRoot, 'g1', '0', 'pid'), String(process.pid))
            mkdirSync(join(gateRoot, 'g1', '1'))
            writeFileSync(join(gateRoot, 'g1', '1', 'pid'), String(process.pid))
            expect(await run(bin, 'read', 'a.md')).toBe(0)
            rmSync(join(gateRoot, 'g1'), { recursive: true, force: true })
        })

        test('a slot left by a process that is gone is reclaimed', async () => {
            const bin = wrapperWith(2, 1)
            const dead = Bun.spawn(['true'])
            await dead.exited
            mkdirSync(join(gateRoot, 'g2', '0'), { recursive: true })
            writeFileSync(join(gateRoot, 'g2', '0', 'pid'), String(dead.pid))
            expect(await run(bin, 'search', 'x')).toBe(0)
            expect(readdirSync(join(gateRoot, 'g2'))).toEqual([])
        })
    })
})

describe('needles', () => {
    const starts = new Map([['old', 100], ['mid', 200], ['own', 300], ['later', 400]])
    const needle = (id: string, kind: Needle['kind'], session: string | null, answer = 'blue'): Needle => ({ id, kind, session, question: `question ${id}`, answer, evidence: ['e'] })
    const ns = [needle('n1', 'needle', 'own'), needle('a1', 'aggregate', null, 'three')]

    test('a needle sees every log, its own included, if its session has one; an aggregate sees every log', () => {
        expect(needleVisible(starts, ns[0]!)).toEqual(['later', 'mid', 'old', 'own'])
        expect(needleVisible(starts, ns[1]!)).toEqual(['later', 'mid', 'old', 'own'])
        expect(needleVisible(starts, needle('x', 'needle', 'nolog'))).toBeNull()
    })
    test('real prompts see logs of sessions that have no case', () => {
        const logs = join(root, 'all-logs')
        mkdirSync(logs, { recursive: true })
        const at = (iso: string) => `{"type":"user","timestamp":"${iso}"}\n`
        writeFileSync(join(logs, 'nocase-old.jsonl'), at('2026-04-01T10:00:00Z'))
        writeFileSync(join(logs, 'own.jsonl'), at('2026-05-01T09:00:00Z'))
        writeFileSync(join(logs, 'nocase-later.jsonl'), at('2026-06-01T10:00:00Z'))
        const all = allSessionStarts(logs, new Map([['own', Date.parse('2026-05-01T10:00:00Z')], ['nolog', Date.parse('2026-03-01T00:00:00Z')]]))
        expect([...all.keys()].sort()).toEqual(['nocase-later', 'nocase-old', 'nolog', 'own'])
        // a prompt in `own` sees the older sessions, case or not, and neither itself nor the later one
        expect(historyVisible(all, all.get('own')!)).toEqual(['nocase-old', 'nolog'])
    })
    test('jobs: arms none and search, samples each, distinct keys, history in the key, unlogged needles skipped', () => {
        const { jobs, skipped } = buildNeedleJobs([...ns, needle('x', 'needle', 'nolog')], starts, { samples: 2, agentModel: 'm-agent' })
        expect(jobs.length).toBe(2 * 2 * 2)
        expect(new Set(jobs.map(j => j.runKey)).size).toBe(8)
        expect(jobs.every(j => j.arm === 'none' || j.arm === 'search')).toBe(true)
        expect(jobs.find(j => j.arm === 'search')!.system).toBe(`${AGENT_SYSTEM} ${SEARCH_FIRST}`)
        expect(jobs.find(j => j.n.id === 'a1')!.visible).toEqual(['later', 'mid', 'old', 'own'])
        expect(skipped.length).toBe(1)
        expect(planNeedles(jobs)).toEqual({ questions: 2, needle: 1, aggregate: 1, agentRuns: 8, judgements: 8 })
        const shifted = buildNeedleJobs([ns[0]!], new Map([...starts].filter(([k]) => k !== 'mid')), { samples: 2, agentModel: 'm-agent' }).jobs
        expect(shifted[0]!.runKey).not.toBe(jobs.find(j => j.n.id === 'n1')!.runKey)
    })
    test('parseNeedleVerdict takes the three verdicts only', () => {
        expect(parseNeedleVerdict('{"verdict":"correct","reason":"r"}')).toEqual({ verdict: 'correct' })
        expect(parseNeedleVerdict('{"verdict":"abstained"}')).toEqual({ verdict: 'abstained' })
        expect(parseNeedleVerdict('{"verdict":"maybe"}')).toBeNull()
        expect(parseNeedleVerdict('nope')).toBeNull()
    })

    test('scoring against the stored answer, cached on a rerun, counted per arm and per kind', async () => {
        const dir = join(root, 'needle-sweep')
        const seen: { arm: string; visibleHint: number }[] = []
        let n = { agent: 0, ask: 0 }
        // the search arm finds the stored answer, none abstains on needles and guesses wrong on the aggregate
        const runner: Runner = {
            agent: async c => {
                n.agent++
                const search = c.system.includes(SEARCH_FIRST)
                const aggregate = c.message.includes('a1')
                seen.push({ arm: search ? 'search' : 'none', visibleHint: c.caseId })
                const answer = search ? (aggregate ? 'there were three' : 'it is blue') : aggregate ? 'five' : 'I could not find it'
                return { status: 'ok', answer, toolCalls: search ? 2 : 0, turns: 1, tools: [], denied: 0, denials: [], searches: 0, searchFallbacks: 0, usage: { input_tokens: 3 }, tokens: 3, tokensAll: 3, costUsd: 0, durationMs: 1, model: c.model }
            },
            ask: async (_m, system, text) => {
                n.ask++
                expect(system).toContain('stored answer')
                const stored = text.match(/<stored>(.*?)<\/stored>/s)![1]!
                const reply = text.match(/<reply>(.*?)<\/reply>/s)![1]!
                const v = reply.includes(stored) ? 'correct' : reply.includes('could not find') ? 'abstained' : 'wrong'
                return { text: `{"verdict":"${v}","reason":"r"}`, usage: { input_tokens: 2 }, cost: 0 }
            },
        }
        const { jobs } = buildNeedleJobs(ns, starts, { samples: 2, agentModel: 'm-agent' })
        const o = { dir, jobs, runner, models: { agent: 'm-agent', judge: 'm-judge' }, workers: 2, log: () => {} }
        const res = await needleSweep(o)
        expect(n.agent).toBe(8)
        const sum = needleSummary(res, 2)
        expect(sum.arms.search).toMatchObject({ runs: 4, correct: 4, wrong: 0, abstained: 0, accuracy: 1 })
        expect(sum.arms.none).toMatchObject({ runs: 4, correct: 0, wrong: 2, abstained: 2, accuracy: 0 })
        expect(sum.byKind.needle!.none).toMatchObject({ abstained: 2, wrong: 0 })
        expect(sum.byKind.aggregate!.none).toMatchObject({ abstained: 0, wrong: 2 })
        expect(sum.byKind.aggregate!.search).toMatchObject({ correct: 2 })
        expect(existsSync(join(dir, 'quality.jsonl'))).toBe(false)
        const before = { ...n }
        const again = await needleSweep(o)
        expect(n).toEqual(before)
        expect(needleSummary(again, 2)).toEqual(sum)
    })
})
