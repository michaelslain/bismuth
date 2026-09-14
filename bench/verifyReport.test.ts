// bench/verifyReport.test.ts — TDD for the pure half of bench/verify.ts.
//
// Every test below builds its input from a CLEAN base (all counts zero, no flags, no errors) and
// flips exactly one thing, so a test that currently passes is provably capable of failing: revert
// the flip and the assertion it guards would fail too. See bench/verifyReport.ts's header for why
// this file has no I/O of its own — everything here is plain data in, plain data out.
import { describe, expect, test } from 'bun:test'
import {
    parseArgs,
    compareShots,
    HARD_AUDIT_FLAGS,
    summarize,
    type PrefixResult,
    type VerifyInput,
} from './verifyReport'

describe('parseArgs', () => {
    test('rejects missing --port', () => {
        const r = parseArgs(['--prefix', 'ui-'])
        expect('error' in r).toBe(true)
    })

    test('rejects zero --prefix', () => {
        const r = parseArgs(['--port', '6012'])
        expect('error' in r).toBe(true)
    })

    test('accepts --port and one --prefix', () => {
        const r = parseArgs(['--port', '6012', '--prefix', 'ui-'])
        expect('error' in r).toBe(false)
    })

    test('keeps repeated --prefix in order', () => {
        const r = parseArgs(['--port', '6012', '--prefix', 'a-', '--prefix', 'b-', '--prefix', 'c-'])
        if ('error' in r) throw new Error('expected success')
        expect(r.prefixes).toEqual(['a-', 'b-', 'c-'])
    })

    test('defaults keep=false and bootTimeout=120000', () => {
        const r = parseArgs(['--port', '6012', '--prefix', 'ui-'])
        if ('error' in r) throw new Error('expected success')
        expect(r.keep).toBe(false)
        expect(r.bootTimeout).toBe(120000)
    })

    test('--keep flips keep to true', () => {
        const r = parseArgs(['--port', '6012', '--prefix', 'ui-', '--keep'])
        if ('error' in r) throw new Error('expected success')
        expect(r.keep).toBe(true)
    })

    test('--boot-timeout overrides the default', () => {
        const r = parseArgs(['--port', '6012', '--prefix', 'ui-', '--boot-timeout', '5000'])
        if ('error' in r) throw new Error('expected success')
        expect(r.bootTimeout).toBe(5000)
    })

    test('reads --baseline, --out and --app', () => {
        const r = parseArgs([
            '--port', '6012', '--prefix', 'ui-',
            '--baseline', '/tmp/base', '--out', '/tmp/out', '--app', '/tmp/app',
        ])
        if ('error' in r) throw new Error('expected success')
        expect(r.baseline).toBe('/tmp/base')
        expect(r.out).toBe('/tmp/out')
        expect(r.app).toBe('/tmp/app')
    })
})

describe('compareShots', () => {
    test('fills all four buckets from hand-built maps', () => {
        const current = {
            'same.png': 'aaa',
            'diff.png': 'bbb-new',
            'new.png': 'ccc',
        }
        const baseline = {
            'same.png': 'aaa',
            'diff.png': 'bbb-old',
            'gone.png': 'ddd',
        }
        const r = compareShots(current, baseline)
        expect(r.unchanged).toEqual(['same.png'])
        expect(r.changed).toEqual(['diff.png'])
        expect(r.added).toEqual(['new.png'])
        expect(r.missing).toEqual(['gone.png'])
    })

    test('two empty maps produce four empty buckets', () => {
        const r = compareShots({}, {})
        expect(r).toEqual({ changed: [], unchanged: [], added: [], missing: [] })
    })
})

describe('HARD_AUDIT_FLAGS', () => {
    test('contains exactly the three hard kinds', () => {
        expect([...HARD_AUDIT_FLAGS].sort()).toEqual(['crashed', 'empty-render', 'probe-failed'])
    })

    test('does not contain a lead kind like overflows-viewport', () => {
        expect(HARD_AUDIT_FLAGS.has('overflows-viewport')).toBe(false)
    })
})

// ── summarize() ──────────────────────────────────────────────────────────────────────────────────

const cleanPlay = (): PrefixResult['play'] => ({
    pass: 3, fail: 0, skip: 0, error: 0, unsafe: 0, failed: [],
})
const cleanInvariants = (): PrefixResult['invariants'] => ({
    exit: 0, findings: 0, blank: 0, failed: [],
})
const cleanAudit = (): PrefixResult['audit'] => ({
    stories: 3, hard: [], leads: [],
})
const cleanPrefix = (prefix = 'ui-'): PrefixResult => ({
    prefix,
    play: cleanPlay(),
    invariants: cleanInvariants(),
    audit: cleanAudit(),
})
const cleanInput = (): VerifyInput => ({
    base: 'http://localhost:6012',
    storybook: 'started',
    stopped: true,
    out: '/abs/out',
    prefixes: [cleanPrefix()],
})

describe('summarize', () => {
    test('ok=true for a clean input', () => {
        const { ok, text } = summarize(cleanInput())
        expect(ok).toBe(true)
        expect(text.split('\n').at(-1)).toBe('RESULT: PASS   out: /abs/out   logs: /abs/out/logs')
    })

    test('ok=true for a clean input that includes SKIPs', () => {
        const input = cleanInput()
        input.prefixes[0]!.play = { pass: 3, fail: 0, skip: 5, error: 0, unsafe: 0, failed: [] }
        const { ok } = summarize(input)
        expect(ok).toBe(true)
    })

    test('a clean run with a SKIP-only prefix carries (nothing asserted)', () => {
        const input = cleanInput()
        input.prefixes[0]!.play = { pass: 0, fail: 0, skip: 5, error: 0, unsafe: 0, failed: [] }
        const { ok, text } = summarize(input)
        expect(ok).toBe(true)
        expect(text).toContain('(nothing asserted)')
    })

    test('play fail > 0 flips ok to false', () => {
        const input = cleanInput()
        input.prefixes[0]!.play = { pass: 2, fail: 1, skip: 0, error: 0, unsafe: 0, failed: ['ui-broken'] }
        const { ok, text } = summarize(input)
        expect(ok).toBe(false)
        expect(text.split('\n').at(-1)).toMatch(/^RESULT: FAIL/)
        expect(text).toContain('ui-broken')
    })

    test('play error > 0 flips ok to false', () => {
        const input = cleanInput()
        input.prefixes[0]!.play = { pass: 2, fail: 0, skip: 0, error: 1, unsafe: 0, failed: ['ui-crashed'] }
        const { ok } = summarize(input)
        expect(ok).toBe(false)
    })

    test('play unsafe > 0 flips ok to false', () => {
        const input = cleanInput()
        input.prefixes[0]!.play = { pass: 2, fail: 0, skip: 0, error: 0, unsafe: 1, failed: ['ui-unsafe'] }
        const { ok } = summarize(input)
        expect(ok).toBe(false)
    })

    test('invariants findings > 0 (exit 1) flips ok to false', () => {
        const input = cleanInput()
        input.prefixes[0]!.invariants = { exit: 1, findings: 2, blank: 0, failed: ['ui-thing'] }
        const { ok, text } = summarize(input)
        expect(ok).toBe(false)
        expect(text).toContain('ui-thing')
    })

    test('invariants blank > 0 (exit 1) flips ok to false', () => {
        const input = cleanInput()
        input.prefixes[0]!.invariants = { exit: 1, findings: 0, blank: 1, failed: ['ui-blank'] }
        const { ok } = summarize(input)
        expect(ok).toBe(false)
    })

    test('a hard audit flag flips ok to false', () => {
        const input = cleanInput()
        input.prefixes[0]!.audit = {
            stories: 3,
            hard: [{ id: 'ui-broken', kind: 'empty-render', detail: '0 painted elements' }],
            leads: [],
        }
        const { ok, text } = summarize(input)
        expect(ok).toBe(false)
        expect(text).toContain('ui-broken')
        expect(text).toContain('empty-render')
    })

    test('a lead (non-hard flag) never flips ok', () => {
        const input = cleanInput()
        input.prefixes[0]!.audit = {
            stories: 3,
            hard: [],
            leads: [{ id: 'ui-thing', kind: 'overflows-viewport', detail: '6px past' }],
        }
        const { ok, text } = summarize(input)
        expect(ok).toBe(true)
        expect(text).toContain('ui-thing')
        expect(text).toContain('overflows-viewport')
    })

    test("storybook 'failed-to-boot' flips ok to false", () => {
        const input = cleanInput()
        input.storybook = 'failed-to-boot'
        input.prefixes = []
        const { ok, text } = summarize(input)
        expect(ok).toBe(false)
        expect(text.split('\n').at(-1)).toMatch(/^RESULT: FAIL/)
    })

    test('a toolError on any tool flips ok to false', () => {
        const input = cleanInput()
        input.prefixes[0]!.audit = { toolError: 'no stories matched (--story does-not-exist-)' }
        const { ok, text } = summarize(input)
        expect(ok).toBe(false)
        expect(text).toContain('no stories matched')
    })

    test('a toolError longer than its column still gets a real gap before the next column', () => {
        const input = cleanInput()
        input.prefixes[0]!.play = { toolError: 'no stories matched (--story does-not-exist-)' }
        input.prefixes[0]!.invariants = { toolError: 'no stories matched (--story does-not-exist-)' }
        input.prefixes[0]!.audit = { toolError: 'no stories matched (--story does-not-exist-)' }
        const { text } = summarize(input)
        const row = text.split('\n')[1]!
        expect(row).toContain(')  invariants')
        expect(row).toContain(')  audit')
    })

    test('baseline differences never fail — only changed/added/missing are reported', () => {
        const input = cleanInput()
        input.shots = {
            changed: ['a.png'],
            unchanged: ['b.png'],
            added: ['c.png'],
            missing: ['d.png'],
            baseline: '/abs/audit-base/shots',
        }
        const { ok, text } = summarize(input)
        expect(ok).toBe(true)
        expect(text).toContain('1 changed, 1 unchanged, 1 added, 1 missing')
        expect(text).toContain('a.png')
        expect(text).toContain('/abs/audit-base/shots')
    })

    // Reproduces the plan's worked example shape byte-for-byte, except the audit count is 1 (not the
    // plan's 2) because this fixture lists exactly one lead — a count and a listed-lines count must
    // agree, and this test's job is to prove they do consistently, not to replay the plan's prose
    // verbatim (its example line was illustrative, not a literal two-lead fixture).
    test('the two-prefix shape from the plan renders byte-for-byte (self-consistent lead count)', () => {
        const input: VerifyInput = {
            base: 'http://localhost:6012',
            storybook: 'started',
            stopped: true,
            out: '/abs/path/.claude/audit',
            prefixes: [
                {
                    prefix: 'bases-baseview--tasks',
                    play: { pass: 14, fail: 0, skip: 0, error: 0, unsafe: 0, failed: [] },
                    invariants: { exit: 0, findings: 0, blank: 0, failed: [] },
                    audit: {
                        stories: 14,
                        hard: [],
                        leads: [
                            {
                                id: 'bases-baseview--tasks-table-query',
                                kind: 'overflows-viewport',
                                detail: 'th-resize 6px past …',
                            },
                        ],
                    },
                },
                {
                    prefix: 'bases-taskcheck',
                    play: { pass: 2, fail: 0, skip: 0, error: 0, unsafe: 0, failed: [] },
                    invariants: { exit: 0, findings: 0, blank: 0, failed: [] },
                    audit: { stories: 2, hard: [], leads: [] },
                },
            ],
            shots: {
                changed: [],
                unchanged: Array.from({ length: 16 }, (_, i) => `s${i}.png`),
                added: [],
                missing: [],
                baseline: '/abs/path/audit-base/shots',
            },
        }
        const { ok, text } = summarize(input)
        expect(ok).toBe(true)
        expect(text).toBe(
            [
                '== verify: 2 prefix(es) @ http://localhost:6012 — storybook started by verify, stopped ==',
                'bases-baseview--tasks  play PASS=14 SKIP=0 FAIL=0 ERROR=0 UNSAFE=0   invariants 0 findings, 0 blank   audit 14 stories, 0 hard, 1 leads',
                'bases-taskcheck        play PASS=2 SKIP=0 FAIL=0 ERROR=0 UNSAFE=0    invariants 0 findings, 0 blank   audit 2 stories, 0 hard, 0 leads',
                'shots: 0 changed, 16 unchanged, 0 added, 0 missing   (baseline: /abs/path/audit-base/shots)',
                'leads:',
                '  bases-baseview--tasks-table-query  overflows-viewport  th-resize 6px past …',
                'failures:',
                '  (none)',
                'RESULT: PASS   out: /abs/path/.claude/audit   logs: /abs/path/.claude/audit/logs',
            ].join('\n'),
        )
    })
})
