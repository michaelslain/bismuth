import { describe, expect, test } from 'bun:test'
import { groupModels } from './modelPickerGroups'
import type { ChatModelOption } from './chatSession'

const m = (value: string, label = value): ChatModelOption => ({
    value,
    label,
    description: '',
    effortLevels: [],
})

const LM = { id: 'lmstudio', label: 'lm studio', kind: 'local' } as const
const OLLAMA = { id: 'ollama', label: 'ollama', kind: 'local' } as const
const ZEN = { id: 'opencode', label: 'opencode zen', kind: 'zen' } as const

const lm = (value: string, label: string): ChatModelOption => ({
    ...m(value, label),
    group: LM,
})
const ollama = (value: string, label: string): ChatModelOption => ({
    ...m(value, label),
    group: OLLAMA,
})
const zen = (value: string, label: string): ChatModelOption => ({
    ...m(value, label),
    free: true,
    group: ZEN,
})

/** The user's real 19 listed entries + the virtual rotate entry (20) (research-models.md §0), in
 *  the server's order: the rotating entry first, then Zen, then LM Studio and Ollama. */
const REAL: ChatModelOption[] = [
    zen('bismuth/zen-free-rotate', 'Zen Free (rotating)'),
    zen('opencode/beam-free', 'Beam Free'),
    zen('opencode/big-pickle', 'Big Pickle'),
    zen('opencode/deepseek-v4.1-flash-free', 'DeepSeek V4.1 Flash Free'),
    zen('opencode/flint-40b-free', 'Flint 40B Free'),
    zen('opencode/glm-5.3-flash-free', 'GLM-5.3-Flash Free'),
    zen('opencode/iceman-free', 'Iceman Free'),
    zen('opencode/inkling-2-small-free', 'Inkling 2 Small Free'),
    zen('opencode/longcat-2.5-free', 'LongCat 2.5 Free'),
    zen('opencode/mimo-v2.6-flash-free', 'MiMo-V2.6-Flash Free'),
    zen('opencode/minimax-m3.1-flash-free', 'MiniMax M3.1 Flash Free'),
    zen('opencode/nemotron-3.5-lightning-free', 'Nemotron 3.5 Lightning Free'),
    zen('opencode/nemotron-3.5-super-vl-free', 'Nemotron 3.5 Super VL Free'),
    lm('lmstudio/openai/gpt-oss-20b', 'GPT-OSS 20B'),
    lm('lmstudio/qwen/qwen3.5-9b', 'Qwen3.5 9B (local)'),
    lm('lmstudio/qwen/qwen3.8-27b', 'Qwen3.8 27B'),
    lm(
        'lmstudio/qwen3-coder-30b-a3b-instruct-mlx',
        'Qwen3 Coder 30B A3B Instruct',
    ),
    lm('lmstudio/gpt-oss-20b', 'gpt-oss 20B (local)'),
    ollama('ollama/gemma4:e2b-it-qat', 'gemma4:e2b-it-qat'),
    ollama('ollama/qwen3.5:9b-q4_K_M', 'qwen3.5:9b-q4_K_M'),
]

describe('groupModels', () => {
    test('the real opencode list: local first, zen last, group names from core', () => {
        const g = groupModels(REAL, 'opencode')
        expect(g.map(x => x.name)).toEqual(['lm studio', 'ollama', 'opencode zen'])
        expect(g.map(x => x.kind)).toEqual(['local', 'local', 'zen'])
        expect(g.map(x => x.models.length)).toEqual([5, 2, 13])
        expect(g.reduce((n, x) => n + x.models.length, 0)).toBe(20)
    })
    test('rows show the model name through modelWord, in opencode order', () => {
        const g = groupModels(REAL, 'opencode')
        expect(g[0].models.map(x => x.shortLabel)).toEqual([
            'gpt-oss 20b',
            'qwen3.5 9b (local)',
            'qwen3.8 27b',
            'qwen3 coder 30b a3b instruct',
            'gpt-oss 20b (local)',
        ])
        expect(g[1].models.map(x => x.shortLabel)).toEqual([
            'gemma4:e2b-it-qat',
            'qwen3.5:9b-q4_k_m',
        ])
        expect(g[2].models[0].shortLabel).toBe('zen free (rotating)')
        expect(g[2].models[1].shortLabel).toBe('beam free')
    })
    test('free is true only when every row is free', () => {
        const g = groupModels(REAL, 'opencode')
        expect(g.map(x => x.free)).toEqual([false, false, true])
        const mixed = groupModels(
            [zen('opencode/a', 'A'), { ...zen('opencode/b', 'B'), free: false }],
            'opencode',
        )
        expect(mixed[0].free).toBe(false)
    })
    test('a trailing (<provider id>) suffix is stripped in-group, other suffixes stay', () => {
        const g = groupModels(
            [
                lm('lmstudio/foo', 'Foo (lmstudio)'),
                lm('lmstudio/qwen/qwen3.5-9b', 'Qwen3.5 9B (local)'),
            ],
            'opencode',
        )
        expect(g[0].models.map(x => x.shortLabel)).toEqual([
            'foo',
            'qwen3.5 9b (local)',
        ])
    })
    test('a label that is the raw id falls back to the id after the first slash', () => {
        const g = groupModels([m('local/qwen/32b')], 'opencode')
        expect(g[0].models[0].shortLabel).toBe('qwen/32b')
        expect(g[0].name).toBe('local')
        expect(g[0].kind).toBe('cloud')
    })
    test('without a group: prefix names it, bismuth joins opencode as zen', () => {
        const g = groupModels(
            [
                m('anthropic/claude-sonnet-4-5'),
                m('bismuth/zen-free-rotate', 'Zen Free (rotating)'),
                m('opencode/kimi-k2'),
            ],
            'opencode',
        )
        expect(g.map(x => x.name)).toEqual(['anthropic', 'opencode'])
        expect(g.map(x => x.kind)).toEqual(['cloud', 'zen'])
        expect(g[1].models).toHaveLength(2)
    })
    test('order is local, cloud, zen; first appearance within a kind', () => {
        const g = groupModels(
            [
                zen('opencode/a', 'A'),
                m('openai/gpt', 'GPT'),
                lm('lmstudio/x', 'X'),
                m('anthropic/c', 'C'),
                ollama('ollama/y', 'Y'),
            ],
            'opencode',
        )
        expect(g.map(x => x.name)).toEqual([
            'lm studio',
            'ollama',
            'openai',
            'anthropic',
            'opencode zen',
        ])
    })
    test('other connectors are one flat unnamed group of labels', () => {
        const g = groupModels([m('opus', 'Opus 4.8')], 'claude')
        expect(g).toHaveLength(1)
        expect(g[0].name).toBe('')
        expect(g[0].kind).toBe('')
        expect(g[0].models[0].shortLabel).toBe('Opus 4.8')
    })
})
