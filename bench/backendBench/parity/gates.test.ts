// bench/backendBench/parity/gates.test.ts
import { describe, expect, test } from 'bun:test'
import type { BenchTarget } from '../types'
import { needsLocalModel, switchableModels } from './gates'

const t = (backend: string, kind: string) => ({ backend, source: { kind } }) as unknown as BenchTarget
const all = [{ value: 'mock/mock' }, { value: 'opencode/free' }]

describe('switchableModels', () => {
    test('opencode on a mock keeps only the mock models', () => {
        expect(switchableModels(t('opencode', 'mock'), all)).toEqual([{ value: 'mock/mock' }])
    })
    test('another backend on a mock keeps every model', () => {
        expect(switchableModels(t('claude', 'mock'), all)).toEqual(all)
    })
    test('opencode on a local model keeps every model', () => {
        expect(switchableModels(t('opencode', 'local'), all)).toEqual(all)
    })
})

describe('needsLocalModel', () => {
    const c = (localModel: boolean) => ({ caps: { localModel } }) as unknown as BenchTarget
    test('a backend without localModel is a gap', () => {
        expect(needsLocalModel(c(false))).toEqual({
            verdict: 'gap',
            reason: 'this backend cannot run on a local model',
        })
    })
    test('a backend with localModel passes', () => {
        expect(needsLocalModel(c(true))).toBeNull()
    })
})
