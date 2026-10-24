// The suite's phases (scripts/fastTests.ts): which files each one runs, and the worker count.
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { testPhases, testWorkers, WATCHER_TESTS } from './fastTests'

const ignores = WATCHER_TESTS.map(f => `--path-ignore-patterns=${f}`)
const GB = 1024 ** 3

describe('testPhases', () => {
    test('the whole repo: everything else in parallel, then every watcher file serially', () => {
        expect(testPhases({ files: 'all', workers: 6 })).toEqual([
            { label: 'parallel', args: ['test', '--parallel=6', ...ignores] },
            {
                label: 'watchers, one at a time',
                args: ['test', ...WATCHER_TESTS.map(f => `./${f}`)],
            },
        ])
    })

    test('workspace dirs scope both phases', () => {
        expect(
            testPhases({ files: 'all', dirs: ['daemon/'], workers: 4 }),
        ).toEqual([
            {
                label: 'parallel',
                args: ['test', '--parallel=4', ...ignores, 'daemon/'],
            },
            {
                label: 'watchers, one at a time',
                args: ['test', './daemon/test/fileWatch.test.ts'],
            },
        ])
    })

    test('a selection runs exactly its files, ./-prefixed so Bun does not substring-match them', () => {
        const phases = testPhases({
            files: ['app/src/a.test.ts', 'core/test/server.test.ts'],
            workers: 3,
        })
        expect(phases).toEqual([
            {
                label: 'parallel',
                args: ['test', '--parallel=3', './app/src/a.test.ts'],
            },
            {
                label: 'watchers, one at a time',
                args: ['test', './core/test/server.test.ts'],
            },
        ])
    })

    test('a selection with no watcher file gets no second phase, and an empty one gets none at all', () => {
        expect(
            testPhases({ files: ['cli/test/a.test.ts'], workers: 2 }).map(
                p => p.label,
            ),
        ).toEqual(['parallel'])
        expect(testPhases({ files: [], workers: 2 })).toEqual([])
    })

    test('slow files run serially in a third phase only when the slow suites run', () => {
        const plan = {
            files: ['cli/test/a.test.ts', 'core/test/slow.test.ts'],
            slowFiles: ['core/test/slow.test.ts'],
            workers: 2,
        }
        expect(testPhases(plan).map(p => p.args.at(-1))).toEqual([
            './core/test/slow.test.ts',
        ])
        expect(testPhases({ ...plan, slow: true })).toEqual([
            {
                label: 'parallel',
                args: ['test', '--parallel=2', './cli/test/a.test.ts'],
            },
            {
                label: 'slow suites, one at a time',
                args: ['test', './core/test/slow.test.ts'],
            },
        ])
    })

    test('a timings file schedules the parallel phase slowest-first and refreshes the durations', () => {
        const [parallel] = testPhases({
            files: 'all',
            workers: 2,
            timings: '/t.json',
        })
        expect(parallel.args.slice(0, 4)).toEqual([
            'test',
            '--parallel=2',
            '--timings=/t.json',
            '--update-timings',
        ])
    })
})

describe('testWorkers', () => {
    test('half the cores, capped by memory, at least 2', () => {
        expect(testWorkers({}, 16, 64 * GB)).toBe(8)
        expect(testWorkers({}, 16, 8 * GB)).toBe(4)
        expect(testWorkers({}, 2, 64 * GB)).toBe(2)
    })

    test('BISMUTH_TEST_WORKERS overrides it; a non-number is ignored', () => {
        expect(testWorkers({ BISMUTH_TEST_WORKERS: '3' }, 16, 64 * GB)).toBe(3)
        expect(testWorkers({ BISMUTH_TEST_WORKERS: 'x' }, 16, 64 * GB)).toBe(8)
    })
})

test('every listed watcher file exists', () => {
    const root = join(import.meta.dir, '..')
    expect(WATCHER_TESTS.filter(f => !existsSync(join(root, f)))).toEqual([])
})
