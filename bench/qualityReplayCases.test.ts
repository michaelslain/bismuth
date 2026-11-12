import { afterAll } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
    bismuthAllowed,
    gateKeys,
    hashOrder,
    insideRoot,
    policyHook,
    toolPolicy,
    intervalNotBelow,
    junkCost,
    historyVisible,
    mergeOrders,
    netIntervals,
    openedReferences,
    excerptsBlock,
    pickRoundRobin,
    SEARCH_FIRST,
    type EvalCase,
    type PromptNet,
    junkKeys,
    keepModel,
    lookupVerdict,
    meanFired,
    mutationReason,
    parsePairwise,
    savedPerHit,
    sourcesBlock,
    summarizePairs,
    toolUsesBetween,
    type Cand,
    type PairRow,
} from './qualityReplayCases'
import { bootstrapDraws } from './gateEval'
import { COMPARED, REAL_ARMS, armSummary, buildJobs, openedShare, planWork, sweep, type CaseInput, type RunResult, type Runner } from './qualityReplay'

const cand = (key: string, cosine: number, y: 0 | 1 | null, accepted = false, matched = false): Cand => ({ key, kind: key.startsWith('docs:') ? 'docs' : key.startsWith('chat:') ? 'chat' : 'file', cosine, text: `${key} body`, y, matched, accepted })

describe('which prompts qualify', () => {
    test('a read-only turn is kept, a write is not', () => {
        expect(lookupVerdict('what is due?', [{ name: 'Read', input: {} }, { name: 'Bash', input: { command: 'ls attachments' } }]).keep).toBe(true)
        expect(lookupVerdict('x', [{ name: 'Edit', input: {} }])).toMatchObject({ keep: false, why: 'writes' })
        expect(lookupVerdict('x', [{ name: 'Bash', input: { command: 'rm -rf a' } }])).toMatchObject({ keep: false, why: 'writes' })
        expect(lookupVerdict('x', [{ name: 'Bash', input: { command: 'echo hi > out.txt' } }])).toMatchObject({ keep: false, why: 'writes' })
        expect(lookupVerdict('x', null)).toMatchObject({ keep: false, why: 'no-log' })
        expect(lookupVerdict('/bust do it', [])).toMatchObject({ keep: false, why: 'command' })
    })
    test('mutation reasons', () => {
        expect(mutationReason({ name: 'mcp__bismuth__bismuth_docs_read', input: {} })).toBeNull()
        expect(mutationReason({ name: 'mcp__bismuth__bismuth_cli', input: { args: ['note', 'new', 'a.md'] } })).toBe('destructive bismuth_cli')
        expect(mutationReason({ name: 'mcp__bismuth__bismuth_cli', input: { args: ['docs', 'read', 'a.md'] } })).toBeNull()
        expect(mutationReason({ name: 'Bash', input: { command: 'git commit -m x' } })).toBe('destructive Bash')
        expect(mutationReason({ name: 'Bash', input: { command: 'git log --oneline' } })).toBeNull()
        expect(mutationReason({ name: 'Bash', input: { command: 'ls a 2>/dev/null | head; grep x b 2>&1 > /tmp/out.txt' } })).toBeNull()
        expect(mutationReason({ name: 'Bash', input: { command: 'ls a > notes.md' } })).toBe('destructive Bash')
    })
    test('tool uses are read between two log lines, sidechains skipped', () => {
        const a = (name: string, side = false) => JSON.stringify({ type: 'assistant', isSidechain: side, message: { content: [{ type: 'tool_use', name, input: {} }] } })
        const lines = [a('Read'), a('Write'), a('Grep', true), a('Glob')]
        expect(toolUsesBetween(lines, 0, 3).map(t => t.name)).toEqual(['Read', 'Write'])
        expect(toolUsesBetween(lines, 3, 99).map(t => t.name)).toEqual(['Glob'])
    })
    test('hash order is stable and a prefix property holds', () => {
        const ids = [1, 2, 3, 4, 5, 6, 7, 8]
        expect(hashOrder(ids)).toEqual(hashOrder([...ids].reverse()))
        expect(hashOrder(ids).slice(0, 3)).toEqual(hashOrder(ids).slice(0, 3))
    })
})

describe('arms', () => {
    const cands = [cand('note:a.md', 0.9, 1, true), cand('note:b.md', 0.8, 0, true), cand('note:c.md', 0.7, 0), cand('note:d.md', 0.75, 0), cand('docs:x.md', 0.6, 1, false, true), cand('note:e.md', 0.5, null)]
    test('gate keys are the accepted ones, best first', () => expect(gateKeys(cands)).toEqual(['note:a.md', 'note:b.md']))
    test('junk keys: own junk first, then near misses, never relevant, matched or unjudged', () => {
        expect(junkKeys(cands, 1)).toEqual(['note:b.md'])
        expect(junkKeys(cands, 3)).toEqual(['note:b.md', 'note:d.md'])
        expect(junkKeys(cands, 9)).toEqual(['note:b.md', 'note:d.md'])
    })
    test('junk keys stop at the shipped cap per source, the most the block shows', () => {
        const many = [...['a', 'b', 'c', 'd'].map((n, i) => cand(`note:${n}.md`, 0.9 - i / 10, 0)), cand('chat:s1', 0.5, 0), cand('docs:x.md', 0.4, 0)]
        const keys = junkKeys(many, 6)
        expect(keys).toEqual(['note:a.md', 'note:b.md', 'chat:s1', 'docs:x.md'])
        const items = keys.map(k => ({ cand: many.find(c => c.key === k)! }))
        for (const k of keys) expect(sourcesBlock(items, '/v')).toContain(k.slice(k.indexOf(':') + 1))
    })
    test('meanFired ignores cases where the gate stayed shut', () => {
        expect(meanFired([0, 0, 2, 4])).toBe(3)
        expect(meanFired([0, 0])).toBe(1)
    })
    test('the block is what packSources renders', () => {
        const b = sourcesBlock([{ cand: cand('note:a.md', 0.9, 1) }, { cand: cand('docs:x.md', 0.9, 1) }], '/v')
        expect(b).toContain('# Vault files')
        expect(b).toContain('(open: `/v/a.md`)')
        expect(b).toContain('# Bismuth docs')
        expect(sourcesBlock([], '/v')).toBeNull()
    })
    test('a note candidate renders its title as the hook', () => {
        const b = sourcesBlock([{ cand: { ...cand('note:a.md', 0.9, 1), text: 'Hive Locations\nthe bees live in the north field.' } }], '/v')
        expect(b).toContain('a.md (note) — Hive Locations (open:')
    })
})

describe('what the agent may call', () => {
    test('bismuth reads pass, writes and chaining do not', () => {
        expect(bismuthAllowed('bismuth read notes/a.md').ok).toBe(true)
        expect(bismuthAllowed('bismuth docs search tasks').ok).toBe(true)
        expect(bismuthAllowed('bismuth search foo --regex').ok).toBe(true)
        expect(bismuthAllowed('bismuth search foo').ok).toBe(true)
        expect(bismuthAllowed('bismuth note new a.md').ok).toBe(false)
        expect(bismuthAllowed('bismuth read a.md; rm -rf /').ok).toBe(false)
        expect(bismuthAllowed('bismuth read $(cat x)').ok).toBe(false)
        expect(bismuthAllowed('ls').ok).toBe(false)
    })
    test('paths stay inside the copy', () => {
        expect(insideRoot('/c', 'notes/a.md')).toBe(true)
        expect(insideRoot('/c', '/c/notes/a.md')).toBe(true)
        expect(insideRoot('/c', '/other/a.md')).toBe(false)
        expect(insideRoot('/c', '../a.md')).toBe(false)
        expect(insideRoot('/c', '~/a.md')).toBe(false)
        expect(insideRoot('/c', '$HOME/a.md')).toBe(false)
    })
})

describe('the tool guard', () => {
    const root = mkdtempSync(join(tmpdir(), 'qr-guard-'))
    const outside = mkdtempSync(join(tmpdir(), 'qr-outside-'))
    mkdirSync(join(root, 'notes'))
    writeFileSync(join(root, 'notes', 'a.md'), 'x')
    writeFileSync(join(outside, 'secret.md'), 'y')
    symlinkSync(outside, join(root, 'link'))
    afterAll(() => {
        rmSync(root, { recursive: true, force: true })
        rmSync(outside, { recursive: true, force: true })
    })
    const denied: string[] = []
    const hook = policyHook(root, (n, _i, why) => denied.push(`${n}: ${why}`))
    const run = (tool_name: string, tool_input: Record<string, unknown>) => hook({ tool_name, tool_input }) as Promise<{ continue?: boolean; hookSpecificOutput?: { permissionDecision: string } }>

    test('the hook denies shell commands the permission system approves unasked', async () => {
        for (const command of ['cat ~/.claude/CLAUDE.md', 'ls /', 'ls -R . | head -80', 'cd notes && ls', 'grep -rh foo /Users', 'head -5 /etc/hosts', 'find / -name x']) {
            const r = await run('Bash', { command })
            expect(r.hookSpecificOutput?.permissionDecision).toBe('deny')
        }
        expect(denied.length).toBe(7)
    })
    test('the hook lets a read-only bismuth call through', async () => {
        expect((await run('Bash', { command: 'bismuth read notes/a.md' })).continue).toBe(true)
        expect((await run('Bash', { command: 'bismuth search "a|b" --regex' })).continue).toBe(true)
    })
    test('a bismuth argument through a symlink that leads out of the copy is refused', async () => {
        expect(bismuthAllowed('bismuth read link/secret.md', root)).toEqual({ ok: false, why: 'paths outside the vault are not allowed' })
        expect(bismuthAllowed('bismuth read --file=link/secret.md', root).ok).toBe(false)
        expect(bismuthAllowed('bismuth read notes/a.md', root).ok).toBe(true)
        expect(bismuthAllowed('bismuth search linked words --regex', root).ok).toBe(true)
        expect((await run('Bash', { command: 'bismuth read link/secret.md' })).hookSpecificOutput?.permissionDecision).toBe('deny')
    })
    test('--vault and outside paths in a bismuth call are refused', () => {
        expect(bismuthAllowed('bismuth read a.md --vault /Users/m/vault').ok).toBe(false)
        expect(bismuthAllowed('bismuth read --vault=/x a.md').ok).toBe(false)
        expect(bismuthAllowed('bismuth read /etc/hosts').ok).toBe(false)
        expect(bismuthAllowed('bismuth read ../x.md').ok).toBe(false)
        expect(bismuthAllowed('bismuth read ~/x.md').ok).toBe(false)
        expect(bismuthAllowed('bismuth read "../x.md"').ok).toBe(false)
        expect(bismuthAllowed('bismuth read "~/x"').ok).toBe(false)
        expect(bismuthAllowed('bismuth read $HOME/x.md').ok).toBe(false)
        expect(bismuthAllowed("bismuth read '$HOME/x.md'").ok).toBe(false)
        expect(bismuthAllowed('bismuth read a.md "--vault=/Users/m/secret"').ok).toBe(false)
        expect(bismuthAllowed('bismuth read a.md --vau""lt=/x').ok).toBe(false)
        expect(bismuthAllowed('bismuth search x --api http://127.0.0.1:4321').ok).toBe(false)
        expect(bismuthAllowed("bismuth read ''/etc/hosts").ok).toBe(false)
        expect(bismuthAllowed('bismuth read "."./x.md').ok).toBe(false)
        expect(bismuthAllowed('bismuth read .?/x.md').ok).toBe(false)
        expect(bismuthAllowed("bismuth search 'a*b' --regex").ok).toBe(true)
        expect(bismuthAllowed('bismuth search a b c').ok).toBe(true)
        expect(bismuthAllowed('bismuth search "a..b" --regex').ok).toBe(true)
        expect(bismuthAllowed('bismuth search "a|b" --regex').ok).toBe(true)
        expect(bismuthAllowed('bismuth search "L&S (x)" --regex').ok).toBe(true)
        expect(bismuthAllowed("bismuth search 'a;b' --regex").ok).toBe(true)
        expect(bismuthAllowed('bismuth search "$(cat x)" --regex').ok).toBe(false)
        expect(bismuthAllowed('bismuth search "a" --regex | head').ok).toBe(false)
        expect(bismuthAllowed('bismuth search "a" --regex; ls').ok).toBe(false)
    })
    test('Read, Grep and Glob stay inside the real root', () => {
        expect(toolPolicy(root, 'Read', { file_path: join(root, 'notes', 'a.md') }).ok).toBe(true)
        expect(toolPolicy(root, 'Read', { file_path: '/etc/hosts' }).ok).toBe(false)
        expect(toolPolicy(root, 'Read', { file_path: join(root, 'link', 'secret.md') }).ok).toBe(false)
        expect(toolPolicy(root, 'Grep', { pattern: 'x', path: join(root, 'link') }).ok).toBe(false)
        expect(toolPolicy(root, 'Grep', { pattern: 'x', glob: '/Users/**' }).ok).toBe(false)
        expect(toolPolicy(root, 'Glob', { pattern: '**/*.md' }).ok).toBe(true)
        expect(toolPolicy(root, 'Glob', { pattern: '/Users/m/.claude/**' }).ok).toBe(false)
        expect(toolPolicy(root, 'Glob', { pattern: '../**' }).ok).toBe(false)
        expect(toolPolicy(root, 'Glob', { pattern: '~/.claude/*' }).ok).toBe(false)
        expect(toolPolicy(root, 'Glob', { pattern: '{/Users,x}/**' }).ok).toBe(false)
        expect(toolPolicy(root, 'Write', { file_path: join(root, 'x') }).ok).toBe(false)
        expect(toolPolicy(root, 'Bash', { command: 'bismuth read a.md' }, false).ok).toBe(false)
    })
})

describe('statistics', () => {
    const draws = (n: number) => bootstrapDraws(n, 400, 7)
    const row = (caseId: number, session: string, outcome: PairRow['outcome'], extra: Partial<PairRow> = {}): PairRow => ({ caseId, session, outcome, items: 2, dTokens: 100, dTokensAll: 300, dToolCalls: 1, dTurns: 1, misled: false, ...extra })
    test('rates add to one and a constant sample has zero width', () => {
        const rows = [row(1, 's1', 'win'), row(2, 's1', 'tie'), row(3, 's2', 'loss'), row(4, 's2', 'tie')]
        const s = summarizePairs(rows, draws)
        expect(s.win.mean + s.tie.mean + s.loss.mean).toBeCloseTo(1, 1)
        const c = summarizePairs([row(1, 's1', 'tie'), row(2, 's2', 'tie'), row(3, 's3', 'tie')], draws)
        expect(c.tie.lo).toBe(1)
        expect(c.meanDTokens.lo).toBe(100)
        expect(c.meanDTokens.hi).toBe(100)
    })
    test('junk cost: direct + extra + loss, each from its input', () => {
        // 4 cases x 2 items = 8 items; token delta 100 per case = 50 per item; direct 40 -> extra 10;
        // 1 loss, 0 wins -> 1/8 x 80 = 10 per item
        const rows = [row(1, 's1', 'loss'), row(2, 's2', 'tie'), row(3, 's3', 'tie'), row(4, 's4', 'tie')]
        const c = junkCost(rows, { directTokens: 40, turnTokens: 80, fetchTokens: 1000 }, draws)
        expect(c.items).toBe(8)
        expect(c.extraTokensPerItem.point).toBeCloseTo(10, 6)
        expect(c.lossTokensPerItem.point).toBeCloseTo(10, 6)
        expect(c.costTokensPerItem.point).toBeCloseTo(60, 6)
        expect(c.lambda).toBeCloseTo(1000 / 60, 6)
    })
    test('a junk item that helps lowers the cost', () => {
        const rows = [row(1, 's1', 'win', { dTokens: 0 }), row(2, 's2', 'tie', { dTokens: 0 })]
        const c = junkCost(rows, { directTokens: 40, turnTokens: 80, fetchTokens: 1000 }, draws)
        expect(c.lossTokensPerItem.point).toBeLessThan(0)
    })
    test('saved per hit: tokens not spent, junk added back, quality as corrective turns', () => {
        const hit = (id: number, s: string, outcome: PairRow['outcome'], dTokens: number, junkItems: number): PairRow => ({ caseId: id, session: s, outcome, items: 2, dTokens, dTokensAll: dTokens, dToolCalls: 0, dTurns: 0, misled: false, hit: true, junkItems })
        const rows = [hit(1, 's1', 'win', -1000, 1), hit(2, 's2', 'tie', -500, 0), { ...hit(3, 's3', 'tie', 0, 0), hit: false }]
        const r = savedPerHit(rows, { junkTokensPerItem: 100, turnTokens: 80 }, draws)
        expect(r.hitCases).toBe(2)
        // case 1: 1000 + 100 + 80 ; case 2: 500
        expect(r.saved.point).toBeCloseTo((1180 + 500) / 2, 6)
        expect(r.tokens.point).toBeCloseTo((1100 + 500) / 2, 6)
        expect(r.quality.point).toBeCloseTo(40, 6)
    })
    test('interval not below', () => {
        expect(intervalNotBelow({ lo: 1, hi: 5 }, { lo: 0, hi: 4 })).toBe(true)
        expect(intervalNotBelow({ lo: -1, hi: 5 }, { lo: 0, hi: 4 })).toBe(false)
    })
})

describe('judge replies', () => {
    test('pairwise parse', () => {
        expect(parsePairwise('{"better":"A","reason":"fuller"}')).toEqual({ better: 'A', reason: 'fuller' })
        expect(parsePairwise('sure: {"better": "tie", "reason": "same"}')?.better).toBe('tie')
        expect(parsePairwise('no idea')).toBeNull()
    })
})

describe('kept model', () => {
    const model = { w: 'current' }
    const atOld = { current: { row: 'old' }, ship: true, shipped: { w: 'refit' }, shippedRow: { row: 'refit' } }
    test('without a refit the current model is shipped as itself', () => {
        const k = keepModel(null, () => atOld, model)
        expect(k.ship).toBe(false)
        expect(k.shipped).toBe(model)
        expect(k.shippedRow).toEqual({ row: 'old' })
    })
    test('a refit is kept as is', () => {
        const refit = { ...atOld, current: { row: 'x' } }
        expect(keepModel(refit, () => atOld, model)).toBe(refit)
    })
})

describe('real-prompt selection and merging', () => {
    const mk = (id: number, session: string): EvalCase => ({ id, session, set: 'labelled', heldOut: false })
    test('round robin takes one per session before any second', () => {
        const cases = [mk(1, 'a'), mk(2, 'a'), mk(3, 'a'), mk(4, 'b'), mk(5, 'b'), mk(6, 'c')]
        const three = pickRoundRobin(cases, 3)
        expect(new Set(three.map(c => c.session)).size).toBe(3)
        const five = pickRoundRobin(cases, 5)
        expect(five.slice(0, 3).map(c => c.session).sort()).toEqual(['a', 'b', 'c'])
        expect(five.map(c => c.id)).toEqual(pickRoundRobin([...cases].reverse(), 5).map(c => c.id))
        expect(pickRoundRobin(cases, 99).length).toBe(6)
        expect(pickRoundRobin([], 5)).toEqual([])
    })
    test('both orders must agree for a win or a loss', () => {
        const vs: ('A' | 'B' | 'tie')[] = ['A', 'B', 'tie']
        const got = vs.flatMap(f => vs.map(s => `${f}${s}:${mergeOrders(f, s)}`))
        expect(got).toEqual(['AA:tie', 'AB:win', 'Atie:tie', 'BA:loss', 'BB:tie', 'Btie:tie', 'tieA:tie', 'tieB:tie', 'tietie:tie'])
    })
    test('clustered prompts make the prompt interval narrower than the session interval', () => {
        // 10 sessions of 4 prompts each; sorted by outcome so sessions are nearly uniform: 14 wins, 7 ties, 19 losses
        const outcomes = [...Array(14).fill(1), ...Array(7).fill(0), ...Array(19).fill(-1)] as number[]
        const rows: PromptNet[] = outcomes.map((net, i) => ({ caseId: i, session: `s${Math.floor(i / 4)}`, net }))
        const r = netIntervals(rows, 600)
        expect(r.n).toBe(40)
        expect(r.sessions).toBe(10)
        expect(r.net).toBeCloseTo(-5 / 40, 6)
        const w = (i: { lo: number; hi: number }) => i.hi - i.lo
        expect(w(r.overSessions)).toBeGreaterThan(w(r.overPrompts))
    })
    test('a session cannot see itself or later ones', () => {
        const starts = new Map([['b', 20], ['a', 10], ['c', 30], ['d', 20]])
        expect(historyVisible(starts, 20)).toEqual(['a'])
        expect(historyVisible(starts, 31)).toEqual(['a', 'b', 'c', 'd'])
    })
    test('excerpts carry the text and openings are matched to their keys', () => {
        const c = cand('note:a.md', 0.9, 1)
        const b = excerptsBlock([{ cand: c }], '/v')
        expect(b).toContain('(open: `/v/a.md`)')
        expect(b).toContain('note:a.md body')
        expect(excerptsBlock([], '/v')).toBeNull()
        const keys = ['note:a.md', 'note:b.md', 'chat:s1', 'docs:x.md']
        const tools = [{ name: 'Read', arg: '/v/a.md' }, { name: 'Bash', arg: 'bismuth history show s1' }, { name: 'Bash', arg: 'bismuth docs read x.md' }, { name: 'Read', arg: '/v/ab.md' }]
        expect(openedReferences(keys, tools, '/v')).toEqual(['note:a.md', 'chat:s1', 'docs:x.md'])
        const pdf = ['note:paper.pdf', 'docs:x.md']
        const near = [{ name: 'Read', arg: '/v/paper.pdf.md' }, { name: 'Bash', arg: 'bismuth read paper.pdf.draw' }, { name: 'Bash', arg: 'bismuth docs read x.md.bak' }]
        expect(openedReferences(pdf, near, '/v')).toEqual([])
        expect(openedReferences(pdf, [{ name: 'Bash', arg: 'bismuth read "paper.pdf" --page 2' }], '/v')).toEqual(['note:paper.pdf'])
    })
})

describe('selection to summary, with fake runners', () => {
    // 5 prompts in 3 sessions, two held out. Every case has one accepted candidate and one rejected one, so the references and
    // junk arms each carry a block. The fake agent writes a marker per arm and sample; only the references arm opens its item and says RICH.
    const copy = '/vault-copy'
    const mkCase = (id: number, session: string, heldOut: boolean): CaseInput => ({
        id, session, set: 'labelled', heldOut, at: '2026-10-14T10:00:00Z', prompt: `question ${id}`, convo: '', visible: [],
        cands: [cand(`note:good${id}.md`, 0.9, 1, true), cand(`note:bad${id}.md`, 0.8, 0, false)],
        dates: () => undefined,
    })
    const cases = [mkCase(1, 's1', false), mkCase(2, 's1', false), mkCase(3, 's2', false), mkCase(4, 's2', true), mkCase(5, 's3', true)]
    const usage = { input_tokens: 10, output_tokens: 5 }
    const run = (answer: string, tools: RunResult['tools']): RunResult => ({ status: 'ok', answer, toolCalls: tools.length, turns: 2, tools, denied: 0, denials: [], usage, tokens: 100, tokensAll: 120, costUsd: 0, durationMs: 5, model: 'fake' })
    const calls = { agent: 0, ask: 0 }
    const runner: Runner = {
        async agent(c) {
            calls.agent++
            const id = /question (\d+)/.exec(c.message)![1]
            const mark = `${c.system.includes(SEARCH_FIRST) ? 'search' : c.message.includes(`good${id}`) ? 'references' : c.message.includes(`bad${id}`) ? 'junk' : 'none'}`
            // unique text per run, so the two none samples differ and the control is a real judgement
            const tools = mark === 'references' ? [{ name: 'Read', arg: `${copy}/good${id}.md` }] : []
            return run(`${mark === 'references' ? 'RICH ' : ''}answer ${mark} ${calls.agent}`, tools)
        },
        async ask(_model, system, text) {
            calls.ask++
            const usageOnly = { usage, cost: 0 }
            if (system.startsWith('You are shown numbered items')) return { text: '{"relied":[1]}', ...usageOnly }
            if (text.includes('=== Answer A ===')) {
                const [a, b] = text.split('=== Answer B ===')
                const [ra, rb] = [a!.includes('RICH'), b!.includes('RICH')]
                return { text: JSON.stringify({ better: ra === rb ? 'tie' : ra ? 'A' : 'B', reason: 'fixture' }), ...usageOnly }
            }
            return { text: 'ok', ...usageOnly }
        },
    }
    const interval = (i: { lo: number; hi: number }) => expect(Number.isFinite(i.lo) && Number.isFinite(i.hi) && i.lo <= i.hi).toBe(true)

    test('every summary field is present and the control is none against none', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'qr-fixture-'))
        try {
            const models = { agent: 'fake', judge: 'fake', reliance: 'fake' }
            const jobs = buildJobs(cases, { samples: 2, agentModel: models.agent, copy, kFallback: 3 })
            // K=2 samples per arm, plus K more none runs for the control
            expect(jobs.length).toBe(cases.length * REAL_ARMS.length * 2 + cases.length * 2)
            expect(jobs.filter(j => j.control).map(j => [j.arm, j.sample])).toEqual(cases.flatMap(() => [['none', 2], ['none', 3]]))
            const plan = planWork(jobs, cases.map(c => c.id))
            expect(plan).toMatchObject({ cases: 5 })
            const res = await sweep({ dir, jobs, cases, runner, models, workers: 2, log: () => {} })
            expect(res.failures).toEqual([])

            const control = res.pairs.filter(p => p.arm === 'control')
            // K control pairs per prompt, none#i against none#K+i, as each arm averages K pairs
            expect(control.length).toBe(cases.length * 2)
            for (const p of control) {
                expect([p.base.arm, p.other.arm]).toEqual(['none', 'none'])
                expect([p.base.sample, p.other.sample]).toEqual([p.sample, p.sample + 2])
                expect(p.same).toBe(false)
            }
            // every arm's sample i is paired with none's sample i, never a control run
            for (const p of res.pairs.filter(x => x.arm !== 'control')) {
                expect(p.base.arm).toBe('none')
                expect(p.base.sample).toBe(p.other.sample)
                expect(p.base.control).toBeUndefined()
            }
            expect(res.pairs.length).toBe(plan.pairs)

            for (const arm of [...COMPARED, 'control'] as const) {
                const s = armSummary(arm, res, cases, 400)
                for (const w of [s.all, s.heldOut]) {
                    for (const k of ['n', 'sessions', 'net', 'overPrompts', 'overSessions'] as const) expect(w[k]).toBeDefined()
                    interval(w.overPrompts)
                    interval(w.overSessions)
                }
                expect(s.all.n).toBe(5)
                expect(s.all.sessions).toBe(3)
                expect(s.heldOut.n).toBe(2)
                expect(s.heldOut.sessions).toBe(2)
                expect(s.orderConsistency).not.toBeNull()
                expect(s.judgedPairs).toBeGreaterThan(0)
                expect(s.outcomes.missing).toBe(0)
            }
            // the control compares two none answers, neither says RICH, so every judgement is a tie
            const c = armSummary('control', res, cases, 400)
            expect(c.judgedPairs).toBe(cases.length * 2)
            expect(c.outcomes).toMatchObject({ win: 0, loss: 0, tie: cases.length * 2 })
            expect(c.all.net).toBe(0)
            // references is the only arm whose answer is richer than none's: all wins, so the control is not just echoing every arm
            const r = armSummary('references', res, cases, 400)
            expect(r.all.net).toBe(1)
            expect(r.outcomes.win).toBe(cases.length * 2)
            expect(armSummary('junk', res, cases, 400).all.net).toBe(0)

            // referencesOpenedShare: references opened its one given item every time, junk never
            expect(openedShare('references', res, jobs, copy)).toBe(1)
            expect(openedShare('junk', res, jobs, copy)).toBe(0)
            expect(openedShare('none', res, jobs, copy)).toBeNull()

            // a rerun finds everything cached: no new call
            const [a0, k0] = [calls.agent, calls.ask]
            await sweep({ dir, jobs, cases, runner, models, workers: 2, log: () => {} })
            expect([calls.agent, calls.ask]).toEqual([a0, k0])
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
