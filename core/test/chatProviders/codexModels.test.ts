import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { parseCodexModels, withExtraModel } from '../../src/chatProviders/codex/models'
import {
    buildCodexExecArgs,
    isModelMetadataWarning,
} from '../../src/chatProviders/codex/driver'
import { translateThreadEvent, newCodexTranslateState } from '../../src/chatProviders/codex/protocol'

// `codex debug models` from codex 0.169, trimmed to the fields the parser reads.
const sample = await Bun.file(join(import.meta.dir, '../fixtures/codexDebugModels.json')).text()

describe('parseCodexModels', () => {
    test('keeps listed models with their effort levels, drops hidden ones', () => {
        const models = parseCodexModels(sample)
        expect(models.map(m => m.value)).toEqual(['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna'])
        expect(models[0].effortLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
        expect(models[1].effortLevels).toContain('ultra')
    })
    test('garbage gives an empty list', () => {
        expect(parseCodexModels('nope')).toEqual([])
        expect(parseCodexModels('{"models":3}')).toEqual([])
    })
    test('withExtraModel prepends a missing model once', () => {
        const models = parseCodexModels(sample)
        const out = withExtraModel(models, 'mock')
        expect(out[0].value).toBe('mock')
        expect(out[0].effortLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
        expect(withExtraModel(out, 'mock')).toHaveLength(out.length)
        expect(withExtraModel(models, 'gpt-6-luna')).toBe(models)
    })
})

describe('codex exec args', () => {
    test('carry the Bismuth MCP server as --config overrides', () => {
        const args = buildCodexExecArgs({
            jsonFlag: '--json',
            cwd: '/v',
            threadId: null,
            imagePaths: [],
            effort: 'max',
            mcpServers: [
                {
                    name: 'bismuth',
                    command: '/bin/bismuth-mcp',
                    args: [],
                    env: [{ name: 'BISMUTH_VAULT', value: '/v' }],
                },
            ],
        })
        expect(args).toContain('mcp_servers.bismuth.command="/bin/bismuth-mcp"')
        expect(args).toContain('mcp_servers.bismuth.env.BISMUTH_VAULT="/v"')
        expect(args).toContain('model_reasoning_effort="max"')
    })
})

describe('model metadata warning', () => {
    test('is recognised as a warning', () => {
        const [f] = translateThreadEvent(
            { type: 'item.completed', item: { id: '1', type: 'error', message: 'Model metadata for `mock` not found. Defaulting to fallback metadata.' } },
            newCodexTranslateState(null),
        )
        expect(isModelMetadataWarning(f)).toBe(true)
    })
})
