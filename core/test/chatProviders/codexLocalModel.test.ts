// Task 2 of the local-models plan: codex's local-model argv + env. Pure — no codex binary needed.
import { describe, expect, test } from 'bun:test'
import {
    buildCodexEnv,
    buildCodexExecArgs,
    isModelMetadataWarning,
    isSkillsBudgetNotice,
} from '../../src/chatProviders/codex/driver'
import { localSpawnFor } from '../../src/agentBackends/localModel'

const LM = { url: 'http://localhost:1234', model: '', apiKey: '' }
const base = {
    jsonFlag: '--json' as const,
    cwd: '/v',
    threadId: null,
    imagePaths: [],
}

describe('buildCodexExecArgs with a local model', () => {
    const local = localSpawnFor('codex', LM, 'qwen3')!

    test('the provider overrides follow --skip-git-repo-check, in order, with the model on --model', () => {
        const args = buildCodexExecArgs({
            ...base,
            model: 'qwen3',
            localArgs: local.args,
        })
        expect(
            args.slice(args.indexOf('--model'), args.indexOf('--model') + 2),
        ).toEqual(['--model', 'qwen3'])
        const at = args.indexOf('--skip-git-repo-check')
        expect(at).toBeGreaterThan(-1)
        expect(args.slice(at + 1, at + 1 + local.args.length)).toEqual(
            local.args,
        )
        expect(local.args).toContain(
            'model_providers.bismuth_local.wire_api="responses"',
        )
    })

    test('without local args the argv is unchanged', () => {
        const off = buildCodexExecArgs({ ...base, model: 'qwen3' })
        expect(off.join(' ')).not.toContain('bismuth_local')
        expect(off).toEqual(
            buildCodexExecArgs({ ...base, model: 'qwen3', localArgs: [] }),
        )
    })
})

describe('buildCodexEnv', () => {
    test('carries the local key only when local is on', () => {
        const local = localSpawnFor('codex', LM, 'qwen3')!
        expect(buildCodexEnv(local.env).BISMUTH_LOCAL_MODEL_KEY).toBe('local')
        expect(buildCodexEnv().BISMUTH_LOCAL_MODEL_KEY).toBeUndefined()
    })
})

describe('isModelMetadataWarning', () => {
    test('matches codex fallback-metadata warning only', () => {
        const err = (message: string) =>
            ({ type: 'error', code: 'error', message }) as const
        expect(
            isModelMetadataWarning(
                err(
                    'Model metadata for `qwen3` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.',
                ),
            ),
        ).toBe(true)
        expect(isModelMetadataWarning(err('stream disconnected'))).toBe(false)
        expect(isModelMetadataWarning({ type: 'done' })).toBe(false)
    })
})

describe('isSkillsBudgetNotice', () => {
    test('matches the small-window skills notice only', () => {
        const err = (message: string) =>
            ({ type: 'error', code: 'error', message }) as const
        expect(
            isSkillsBudgetNotice(
                err(
                    'Exceeded skills context budget. All skill descriptions were removed and 35 additional skills were not included in the model-visible skills list.',
                ),
            ),
        ).toBe(true)
        expect(isSkillsBudgetNotice(err('stream disconnected'))).toBe(false)
    })
})
