import { test, expect } from 'bun:test'
import {
    cronScheduleProblem,
    cronTimeoutProblem,
    isCronPath,
} from '../../src/schema/cronSchema'
import { loadSchemaSet, resolveNoteSchema } from '../../src/schema/namedSchemas'
import { validateDocument } from '../../src/schema/validate'

const set = loadSchemaSet({
    folderSchemas: { '.daemon': 'book' },
    schemas: { book: { author: { type: 'string', required: true } } },
})

function check(fm: Record<string, unknown>, path = '.daemon/crons/x.md') {
    return validateDocument(fm, resolveNoteSchema(set, path, fm), {
        mode: 'frontmatter',
    }).map(d => `${d.severity} ${d.path.join('.')}: ${d.message}`)
}

test('isCronPath matches only files directly in .daemon/crons', () => {
    expect(isCronPath('.daemon/crons/dream.md')).toBe(true)
    expect(isCronPath('/.daemon/crons/dream.md')).toBe(true)
    expect(isCronPath('.daemon/crons/dream.md.disabled')).toBe(false)
    expect(isCronPath('.daemon/crons/sub/dream.md')).toBe(false)
    expect(isCronPath('.daemon/processes/server.md')).toBe(false)
    expect(isCronPath('notes/.daemon/crons/dream.md')).toBe(false)
})

test('every documented cron key is known and a valid cron lints clean', () => {
    expect(
        check({
            name: 'dream',
            schedule: '0 * * * *',
            timeout: 1800,
            catchup: true,
            incremental: true,
            checkpointDirs: 'vault, memory',
            checkpointDir: 'memory',
            tier: 'balanced',
            effort: 'high',
            model: 'sonnet',
            notify: 'false',
            enabled: false,
            waitFor: 'node server',
            on: 'schedule',
        }),
    ).toEqual([])
    expect(
        check({ on: 'file-change', watch: 'journal/**', timeout: 'none' }),
    ).toEqual([])
})

test('a cron file gets neither note properties nor folder-bound schemas', () => {
    expect(check({ schedule: '0 8 * * 1-5', tags: ['a'] })).toEqual([
        'info tags: unknown property: tags',
    ])
})

test('schedule is required unless on file-change, where watch is required', () => {
    expect(check({ name: 'x' })).toEqual([
        'error schedule: missing required property: schedule',
    ])
    expect(check({ on: 'file-change' })).toEqual([
        'error watch: missing required property: watch',
    ])
})

test('values the daemon misreads are flagged', () => {
    expect(
        check({
            schedule: '0 8 * * *',
            effort: 'xhigh',
            enabled: 'off',
            timeout: '10m',
            tier: 'quick',
            checkpointDirs: 'vault, git',
        }),
    ).toEqual([
        'error effort: expected one of: low, medium, high',
        'error enabled: expected one of: true, false',
        'error timeout: expected whole seconds, or none for no limit',
        'error tier: expected one of: fast, balanced, deep',
        'error checkpointDirs.1: expected one of: vault, memory',
    ])
})

test('cronScheduleProblem follows the daemon parser', () => {
    for (const ok of [
        '0 * * * *',
        '*/15 9-17 * * 1-5',
        '0 0 30 2 *',
        '7 10 */2 * *',
        '0 8,12,18 * * 0',
    ])
        expect(cronScheduleProblem(ok)).toBeNull()
    expect(cronScheduleProblem('0 8 * * * # daily')?.message).toContain(
        'expected five fields',
    )
    expect(cronScheduleProblem('@hourly')?.message).toContain('found 1')
    expect(cronScheduleProblem('*/0 * * * *')?.message).toContain(
        'minute field "*/0" never matches',
    )
    expect(cronScheduleProblem('0 8 * * 7')?.message).toContain(
        'day-of-week field "7" never matches',
    )
    expect(cronScheduleProblem('0 8 * * MON')?.severity).toBe('error')
    expect(cronScheduleProblem('0 8 * * 1-10/2')?.severity).toBe('error')
    expect(cronScheduleProblem('0 24 * * *')?.severity).toBe('error')
    expect(cronScheduleProblem('0 17-9 * * *')?.message).toContain(
        'runs backwards',
    )
    expect(cronScheduleProblem('0 8 * * 1-3,5')).toEqual({
        severity: 'warning',
        message:
            'day-of-week field "1-3,5": a range inside a list counts as its first number only',
    })
})

test('cronTimeoutProblem accepts whole seconds and none', () => {
    expect(cronTimeoutProblem(300)).toBeNull()
    expect(cronTimeoutProblem('0')).toBeNull()
    expect(cronTimeoutProblem('none')).toBeNull()
    expect(cronTimeoutProblem(1.5)).not.toBeNull()
    expect(cronTimeoutProblem(-1)).not.toBeNull()
})
