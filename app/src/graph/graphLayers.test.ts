import { describe, expect, test } from 'bun:test'
import {
    readStoredFlag,
    graphClusters,
    graphGradient,
    setGraphClusters,
    setGraphGradient,
} from './graphLayers'

describe('graphLayers', () => {
    test('defaults to on with no localStorage (test env / private mode)', () => {
        expect(readStoredFlag('bismuth:graph:nope')).toBe(true)
        expect(graphClusters()).toBe(true)
        expect(graphGradient()).toBe(true)
    })

    test('setters flip the signals independently', () => {
        setGraphClusters(false)
        expect(graphClusters()).toBe(false)
        expect(graphGradient()).toBe(true)
        setGraphGradient(false)
        expect(graphGradient()).toBe(false)
        setGraphClusters(true)
        setGraphGradient(true)
        expect(graphClusters()).toBe(true)
        expect(graphGradient()).toBe(true)
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
