import { describe, expect, test } from 'bun:test'
import { readStoredFlag, graphClusters, setGraphClusters } from './graphLayers'

describe('graphLayers', () => {
    test('defaults to on with no localStorage (test env / private mode)', () => {
        expect(readStoredFlag('bismuth:graph:nope')).toBe(true)
        expect(graphClusters()).toBe(true)
    })

    test('the setter flips the signal', () => {
        setGraphClusters(false)
        expect(graphClusters()).toBe(false)
        setGraphClusters(true)
        expect(graphClusters()).toBe(true)
    })

    test('only a stored literal false turns a layer off', () => {
        const store = new Map<string, string>()
        const g = globalThis as { localStorage?: unknown }
        const prev = g.localStorage
        g.localStorage = {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
        }
        try {
            store.set('k', 'false')
            expect(readStoredFlag('k')).toBe(false)
            store.set('k', 'true')
            expect(readStoredFlag('k')).toBe(true)
            store.set('k', '"yes"')
            expect(readStoredFlag('k')).toBe(true)
            store.set('k', 'null')
            expect(readStoredFlag('k')).toBe(true)
            store.set('k', '{not json')
            expect(readStoredFlag('k')).toBe(true)
        } finally {
            g.localStorage = prev
        }
    })
})
