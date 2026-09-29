import { describe, expect, test } from 'bun:test'
import {
    createVaultTagsCache,
    mergeTagOptions,
    vaultTagNames,
} from './tagSuggestions'

describe('vaultTagNames', () => {
    test('reads tag nodes only, strips the leading #', () => {
        expect(
            vaultTagNames({
                nodes: [
                    { kind: 'note', label: 'Groceries' },
                    { kind: 'tag', label: '#chicken' },
                    { kind: 'tag', label: '#project/alpha' },
                    { kind: 'memory', label: '#not-a-tag' },
                ],
            }),
        ).toEqual(['chicken', 'project/alpha'])
    })
    test('empty / missing graph → no tags', () => {
        expect(vaultTagNames(null)).toEqual([])
        expect(vaultTagNames({ nodes: [] })).toEqual([])
    })
    test('dedupes and drops a bare #', () => {
        expect(
            vaultTagNames({
                nodes: [
                    { kind: 'tag', label: '#a' },
                    { kind: 'tag', label: '#' },
                    { kind: 'tag', label: '#a' },
                ],
            }),
        ).toEqual(['a'])
    })
})

describe('mergeTagOptions', () => {
    test('first-seen order across lists, exact dedup', () => {
        expect(
            mergeTagOptions(['beta', 'alpha'], ['alpha', 'chicken'], ['beta', 'docs']),
        ).toEqual(['beta', 'alpha', 'chicken', 'docs'])
    })
    test('skips empty strings', () => {
        expect(mergeTagOptions(['', 'a'], [''])).toEqual(['a'])
    })
})

describe('createVaultTagsCache', () => {
    test('one fetch is shared within the ttl and last() carries the result', async () => {
        let calls = 0
        let t = 0
        const cache = createVaultTagsCache(
            async () => {
                calls++
                return ['a', 'b']
            },
            { now: () => t },
        )
        expect(cache.last()).toEqual([])
        expect(await cache.load()).toEqual(['a', 'b'])
        t = 29_000
        await cache.load()
        expect(calls).toBe(1)
        expect(cache.last()).toEqual(['a', 'b'])
    })
    test('refetches once the ttl has passed', async () => {
        let calls = 0
        let t = 0
        const cache = createVaultTagsCache(
            async () => ['x' + ++calls],
            { now: () => t },
        )
        await cache.load()
        t = 30_001
        expect(await cache.load()).toEqual(['x2'])
    })
    test('a failed fetch is forgotten so the next load retries', async () => {
        let calls = 0
        const cache = createVaultTagsCache(async () => {
            if (++calls === 1) throw new Error('offline')
            return ['ok']
        })
        await expect(cache.load()).rejects.toThrow('offline')
        expect(await cache.load()).toEqual(['ok'])
    })
    test('reset forgets the last tags and the fetch', async () => {
        let calls = 0
        const cache = createVaultTagsCache(async () => ['n' + ++calls])
        await cache.load()
        cache.reset()
        expect(cache.last()).toEqual([])
        expect(await cache.load()).toEqual(['n2'])
    })
})
