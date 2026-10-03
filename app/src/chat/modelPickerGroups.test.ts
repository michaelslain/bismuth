import { describe, expect, test } from 'bun:test'
import { groupModels } from './modelPickerGroups'

const m = (value: string, label = value) => ({
    value,
    label,
    description: '',
    effortLevels: [],
})

describe('groupModels', () => {
    test('opencode groups by the part before the first slash, in first-seen order', () => {
        const g = groupModels(
            [
                m('anthropic/claude-sonnet-4-5'),
                m('opencode/kimi-k2'),
                m('anthropic/claude-opus-4-8'),
                m('local/qwen/32b'),
            ],
            'opencode',
        )
        expect(g.map(x => x.name)).toEqual(['anthropic', 'opencode', 'local'])
        expect(g[0].models.map(x => x.shortLabel)).toEqual([
            'claude-sonnet-4-5',
            'claude-opus-4-8',
        ])
        expect(g[2].models[0].shortLabel).toBe('qwen/32b')
    })
    test('other connectors are one flat unnamed group of labels', () => {
        const g = groupModels([m('opus', 'Opus 4.8')], 'claude')
        expect(g).toHaveLength(1)
        expect(g[0].name).toBe('')
        expect(g[0].models[0].shortLabel).toBe('Opus 4.8')
    })
})
