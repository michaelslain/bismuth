import { describe, expect, test } from 'bun:test'
import { fixturesFor, GEMINI_CLASSIFIER_FIXTURE, loadScenarios, runTarget, type RunDeps } from './run'
import type { BenchTarget, ChatDriver, Scenario } from './types'

const target = (kind: 'mock' | 'cloud' = 'mock'): BenchTarget =>
    ({
        label: `fake@${kind}`,
        backend: 'opencode',
        source: kind === 'mock' ? { kind: 'mock' } : { kind: 'cloud' },
        binary: '/bin/fake',
        caps: {},
    }) as unknown as BenchTarget

const chat = (closed: string[]): ChatDriver =>
    ({
        chatId: 'c1',
        open: async () => {},
        close: async () => {
            closed.push('c1')
        },
    }) as unknown as ChatDriver

const harness = () => {
    const lines: string[] = []
    const closed: string[] = []
    const stopped: number[] = []
    const deps: RunDeps = {
        seedVault: () => '/tmp/fake-vault',
        startModelServer: async () => ({
            url: 'http://127.0.0.1:1',
            requests: () => [],
            setWindow: () => {},
            stop: async () => {
                stopped.push(1)
            },
        }),
        createChatDriver: () => chat(closed),
        resumeChatDriver: async () => chat(closed),
        historyFrames: async () => [],
        bismuth: async () => ({ code: 0, stdout: '', stderr: '' }),
        print: l => lines.push(l),
    }
    return { deps, lines, closed, stopped }
}

const sc = (id: string, over: Partial<Scenario> = {}): Scenario => ({
    id,
    suite: 'parity',
    title: id,
    applies: () => null,
    timeoutMs: 1000,
    mockFixtures: [],
    run: async () => ({ verdict: 'pass', detail: 'ok' }),
    ...over,
})

describe('runTarget', () => {
    test('a hang becomes timeout and the next scenario still runs', async () => {
        const h = harness()
        const cells = await runTarget(
            target(),
            [
                sc('hang', {
                    timeoutMs: 50,
                    run: () => new Promise(() => {}),
                }),
                sc('after'),
            ],
            h.deps,
        )
        expect(cells.map(c => c.verdict)).toEqual(['timeout', 'pass'])
    })

    test('applies verdict is used and run is never called', async () => {
        const h = harness()
        let ran = false
        const cells = await runTarget(
            target(),
            [
                sc('g', {
                    applies: () => ({ verdict: 'gap', reason: 'no agents' }),
                    run: async () => {
                        ran = true
                        return { verdict: 'pass', detail: '' }
                    },
                }),
            ],
            h.deps,
        )
        expect(cells[0]!.verdict).toBe('gap')
        expect(cells[0]!.detail).toBe('no agents')
        expect(ran).toBe(false)
    })

    test('no mockFixtures under mock is skip; cloud still runs it', async () => {
        const h = harness()
        const s = sc('nofix', { mockFixtures: undefined })
        expect((await runTarget(target(), [s], h.deps))[0]!.verdict).toBe('skip')
        expect(
            (await runTarget(target('cloud'), [s], h.deps))[0]!.verdict,
        ).toBe('pass')
    })

    test('a throwing scenario is fail with its message', async () => {
        const h = harness()
        const cells = await runTarget(
            target(),
            [
                sc('boom', {
                    run: async () => {
                        throw new Error('kaboom')
                    },
                }),
            ],
            h.deps,
        )
        expect(cells[0]!.verdict).toBe('fail')
        expect(cells[0]!.detail).toContain('kaboom')
    })

    test('each cell prints as a CELL line, chats close, server stops', async () => {
        const h = harness()
        await runTarget(
            target(),
            [
                sc('a', {
                    run: async ctx => {
                        await ctx.newChat()
                        ctx.log('hello')
                        return { verdict: 'pass', detail: 'ok' }
                    },
                }),
                sc('b'),
            ],
            h.deps,
        )
        expect(h.lines).toHaveLength(2)
        const first = JSON.parse(h.lines[0]!.replace(/^CELL /, ''))
        expect(first.scenario).toBe('a')
        expect(first.log).toEqual(['hello'])
        expect(h.lines[1]!.startsWith('CELL ')).toBe(true)
        expect(h.closed).toEqual(['c1'])
        expect(h.stopped).toHaveLength(2)
    })
})

describe('resetBackends', () => {
    test('runs once per scenario, after chats close and before the server stops', async () => {
        const h = harness()
        const order: string[] = []
        h.deps.resetBackends = () => order.push('reset')
        const start = h.deps.startModelServer
        h.deps.startModelServer = async o => {
            const s = await start(o)
            const stop = s.stop
            s.stop = async () => {
                order.push('stop')
                await stop()
            }
            return s
        }
        await runTarget(target(), [sc('a'), sc('b')], h.deps)
        expect(order).toEqual(['reset', 'stop', 'reset', 'stop'])
    })
})

describe('loadScenarios', () => {
    test('filters by suite and rejects an unknown id', async () => {
        expect(await loadScenarios({ suites: ['nope'] })).toEqual([])
        await expect(loadScenarios({ ids: ['no-such-id'] })).rejects.toThrow(
            /no scenario 'no-such-id'/,
        )
    })
})

describe('mock targets', () => {
    test('every mock target is seeded with the mock as its localModel', async () => {
        const h = harness()
        const seeded: unknown[] = []
        h.deps.seedVault = (_t, opts) => {
            seeded.push(opts)
            return '/tmp/fake-vault'
        }
        await runTarget(target(), [sc('a')], h.deps)
        expect(seeded).toEqual([{ localModel: { url: 'http://127.0.0.1:1', model: 'mock' } }])
    })

    test('a cloud target is not seeded', async () => {
        const h = harness()
        const seeded: unknown[] = []
        h.deps.seedVault = (_t, opts) => {
            seeded.push(opts)
            return '/tmp/fake-vault'
        }
        await runTarget(target('cloud'), [sc('a', { mockFixtures: undefined })], h.deps)
        expect(seeded).toEqual([undefined])
    })

    test('gemini fixtures get the routing classifier first, others are untouched', async () => {
        const mine = [{ match: { userMessage: 'x' } }]
        const gem = { ...target(), backend: 'gemini' } as unknown as BenchTarget
        expect(fixturesFor(gem, mine)).toEqual([GEMINI_CLASSIFIER_FIXTURE, ...mine])
        expect(fixturesFor(target(), mine)).toEqual(mine)
        const h = harness()
        let started: unknown[] = []
        h.deps.startModelServer = async o => {
            started = (o as { fixtures: unknown[] }).fixtures
            return { url: 'http://127.0.0.1:1', requests: () => [], setWindow: () => {}, stop: async () => {} }
        }
        await runTarget(gem, [sc('a', { mockFixtures: mine })], h.deps)
        expect(started[0]).toBe(GEMINI_CLASSIFIER_FIXTURE)
    })

    test('the sidecar starts before the scenario runs and stops after it, even on failure', async () => {
        const h = harness()
        const order: string[] = []
        h.deps.sidecar = async () => {
            order.push('start')
            return { stop: async () => void order.push('stop') }
        }
        await runTarget(
            target(),
            [
                sc('ok', { run: async () => (order.push('run'), { verdict: 'pass', detail: '' }) }),
                sc('boom', {
                    run: async () => {
                        order.push('run')
                        throw new Error('x')
                    },
                }),
            ],
            h.deps,
        )
        expect(order).toEqual(['start', 'run', 'stop', 'start', 'run', 'stop'])
    })

    test('a sidecar that fails to start is a fail cell naming why', async () => {
        const h = harness()
        h.deps.sidecar = async () => {
            throw new Error('gateway did not start')
        }
        const [cell] = await runTarget(target(), [sc('a')], h.deps)
        expect(cell!.verdict).toBe('fail')
        expect(cell!.detail).toContain('gateway did not start')
    })
})
