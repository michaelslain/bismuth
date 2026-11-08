import { afterAll } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
    armIsA,
    bismuthAllowed,
    gateKeys,
    hashOrder,
    insideRoot,
    policyHook,
    toolPolicy,
    intervalNotBelow,
    junkCost,
    historySessions,
    junkKeys,
    keepModel,
    lookupVerdict,
    meanFired,
    mutationReason,
    outcomeOf,
    parsePairwise,
    savedPerHit,
    sourcesBlock,
    summarizePairs,
    toolUsesBetween,
    type Cand,
    type PairRow,
} from './qualityReplayCases'
import { bootstrapDraws } from './gateEval'

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
        expect(junkKeys(cands, 3)).toEqual(['note:b.md', 'note:d.md', 'note:c.md'])
        expect(junkKeys(cands, 9)).toEqual(['note:b.md', 'note:d.md', 'note:c.md'])
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
        expect(bismuthAllowed('bismuth search foo').ok).toBe(false)
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
    test('--vault and outside paths in a bismuth call are refused', () => {
        expect(bismuthAllowed('bismuth read a.md --vault /Users/m/vault').ok).toBe(false)
        expect(bismuthAllowed('bismuth read --vault=/x a.md').ok).toBe(false)
        expect(bismuthAllowed('bismuth read /etc/hosts').ok).toBe(false)
        expect(bismuthAllowed('bismuth read ../x.md').ok).toBe(false)
        expect(bismuthAllowed('bismuth read ~/x.md').ok).toBe(false)
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
    test('pairwise parse and order', () => {
        expect(parsePairwise('{"better":"A","reason":"fuller"}')).toEqual({ better: 'A', reason: 'fuller' })
        expect(parsePairwise('sure: {"better": "tie", "reason": "same"}')?.better).toBe('tie')
        expect(parsePairwise('no idea')).toBeNull()
        expect(outcomeOf('A', true)).toBe('win')
        expect(outcomeOf('A', false)).toBe('loss')
        expect(outcomeOf('tie', true)).toBe('tie')
        expect(armIsA(3, 'gate')).toBe(armIsA(3, 'gate'))
        const sides = Array.from({ length: 200 }, (_, i) => armIsA(i, 'gate'))
        expect(sides.filter(Boolean).length).toBeGreaterThan(70)
        expect(sides.filter(Boolean).length).toBeLessThan(130)
    })
})

describe('history links', () => {
    test('train and validation sessions are linked, test sessions are not', () => {
        const split = { train: new Set(['a']), validation: new Set(['b']), test: new Set(['c']) }
        expect(historySessions(split, ['a', 'b', 'c', 'd'])).toEqual(['a', 'b'])
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
