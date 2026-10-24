// The fast suite's two phases (scripts/fastTests.ts): which files each one runs.
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fastPhases, WATCHER_TESTS } from './fastTests'

const ignores = WATCHER_TESTS.map(f => `--path-ignore-patterns=${f}`)

describe('fastPhases', () => {
    test('the whole repo: everything else four at a time, then every watcher file serially', () => {
        expect(fastPhases()).toEqual([
            { label: 'parallel', args: ['test', '--parallel=4', ...ignores] },
            {
                label: 'watchers, one at a time',
                args: ['test', ...WATCHER_TESTS],
            },
        ])
    })

    test('workspace dirs scope both phases', () => {
        expect(fastPhases(['daemon/'])).toEqual([
            {
                label: 'parallel',
                args: ['test', '--parallel=4', ...ignores, 'daemon/'],
            },
            {
                label: 'watchers, one at a time',
                args: ['test', 'daemon/test/fileWatch.test.ts'],
            },
        ])
    })

    test('a workspace with no watcher file gets no second phase', () => {
        expect(fastPhases(['app/', 'cli/']).map(p => p.label)).toEqual([
            'parallel',
        ])
    })
})

test('every listed watcher file exists', () => {
    const root = join(import.meta.dir, '..')
    expect(WATCHER_TESTS.filter(f => !existsSync(join(root, f)))).toEqual([])
})
