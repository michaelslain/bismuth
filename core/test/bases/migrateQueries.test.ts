import { describe, expect, test } from 'bun:test'
import {
    findQueryFences,
    migrateQueryBody,
} from '../../src/bases/migrateQueries'

const TODAY = '2026-11-14'

describe('migrateQueryBody', () => {
    test('a legacy tasks DSL body becomes tasks + where', () => {
        const result = migrateQueryBody('tasks: not done', TODAY)
        expect(result?.changed).toBe(true)
        expect(result?.body).toStartWith('tasks:\n')
        expect(result?.body).toContain('where:')
    })

    test('an already migrated body is unchanged', () => {
        const migrated = migrateQueryBody('tasks: not done', TODAY)!.body
        const again = migrateQueryBody(migrated, TODAY)
        expect(again).toEqual({ body: migrated, changed: false })
    })

    test('a body with its own where is not convertible', () => {
        expect(
            migrateQueryBody('tasks: not done\nwhere: done == false', TODAY),
        ).toBeNull()
    })
})

describe('findQueryFences', () => {
    test('finds query fences and skips other languages', () => {
        const text = [
            '```query',
            'tasks: not done',
            '```',
            '',
            '```js',
            'let x = 1',
            '```',
            '',
            '```query',
            'from: [[A]]',
            '```',
        ].join('\n')
        const fences = findQueryFences(text)
        expect(fences.map(f => f.body)).toEqual([
            'tasks: not done',
            'from: [[A]]',
        ])
    })
})
