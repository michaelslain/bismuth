import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
    isEmbeddingModelId,
    parseLlamaCppProps,
    parseLmStudioModels,
    parseOllamaPs,
    parseOpenAiModels,
    parseVllmModels,
    serverKindName,
} from '../../src/agentBackends/contextWindow'
import {
    detectWindow,
    probeLocalServer,
} from '../../src/agentBackends/contextWindowProbe'

// Copied from the live LM Studio GET /api/v0/models (qwen/qwen3.5-9b loaded at 8192).
const LMSTUDIO = {
    data: [
        {
            id: 'qwen/qwen3.5-9b',
            object: 'model',
            type: 'vlm',
            publisher: 'qwen',
            arch: 'qwen3_5',
            compatibility_type: 'mlx',
            quantization: '4bit',
            state: 'loaded',
            max_context_length: 262144,
            loaded_context_length: 8192,
            capabilities: ['tool_use'],
        },
        {
            id: 'qwen/qwen3-14b',
            object: 'model',
            type: 'llm',
            publisher: 'qwen',
            arch: 'qwen3',
            compatibility_type: 'mlx',
            quantization: '4bit',
            state: 'not-loaded',
            max_context_length: 40960,
            capabilities: ['tool_use'],
        },
        {
            id: 'text-embedding-nomic-embed-text-v1.5',
            object: 'model',
            type: 'embeddings',
            publisher: 'nomic-ai',
            arch: 'nomic-bert',
            compatibility_type: 'gguf',
            quantization: 'Q4_K_M',
            state: 'not-loaded',
            max_context_length: 2048,
        },
    ],
    object: 'list',
}
const OLLAMA_PS = {
    models: [
        {
            name: 'qwen3.5:9b-q4_K_M',
            model: 'qwen3.5:9b-q4_K_M',
            size: 7000000000,
            context_length: 4096,
        },
    ],
}
const V1 = {
    object: 'list',
    data: [{ id: 'gemma4:e2b-it-qat' }, { id: 'qwen3.5:9b-q4_K_M' }],
}

describe('parsers', () => {
    test('LM Studio: loaded window only, never the max; embeddings flagged', () => {
        expect(parseLmStudioModels(LMSTUDIO)).toEqual([
            { id: 'qwen/qwen3.5-9b', window: 8192, embedding: false },
            { id: 'qwen/qwen3-14b', window: null, embedding: false },
            {
                id: 'text-embedding-nomic-embed-text-v1.5',
                window: null,
                embedding: true,
            },
        ])
        expect(parseLmStudioModels(null)).toEqual([])
        expect(parseLmStudioModels({ data: 'x' })).toEqual([])
        expect(parseLmStudioModels({ data: [{ nope: 1 }, 3, null] })).toEqual([])
    })
    test('Ollama /api/ps', () => {
        expect(parseOllamaPs(OLLAMA_PS)).toEqual([
            { id: 'qwen3.5:9b-q4_K_M', window: 4096 },
        ])
        expect(parseOllamaPs({ models: [] })).toEqual([])
        expect(parseOllamaPs({ models: [{ name: 'a' }] })).toEqual([])
        expect(parseOllamaPs('x')).toEqual([])
    })
    test('llama.cpp /props n_ctx', () => {
        expect(
            parseLlamaCppProps({ default_generation_settings: { n_ctx: 16384 } }),
        ).toBe(16384)
        expect(parseLlamaCppProps({})).toBeNull()
        expect(parseLlamaCppProps(undefined)).toBeNull()
    })
    test('vLLM max_model_len, plain OpenAI ids', () => {
        const body = { data: [{ id: 'm', max_model_len: 32768 }, { id: 'e-embed' }] }
        expect(parseVllmModels(body)).toEqual([
            { id: 'm', window: 32768, embedding: false },
            { id: 'e-embed', window: null, embedding: true },
        ])
        expect(parseOpenAiModels(V1).map(m => m.window)).toEqual([null, null])
        expect(parseOpenAiModels({ data: [{ id: 3 }] })).toEqual([])
    })
    test('embedding id fallback and kind names', () => {
        expect(isEmbeddingModelId('text-embedding-3')).toBe(true)
        expect(isEmbeddingModelId('qwen3')).toBe(false)
        expect(
            (['lmstudio', 'ollama', 'llamacpp', 'vllm', 'openai'] as const).map(
                serverKindName,
            ),
        ).toEqual([
            'LM Studio',
            'Ollama',
            'llama.cpp',
            'vLLM',
            'OpenAI-compatible server',
        ])
    })
})

describe('probeLocalServer', () => {
    const servers: Record<string, ReturnType<typeof Bun.serve>> = {}
    const routes: Record<string, Record<string, unknown>> = {
        lmstudio: { '/api/v0/models': LMSTUDIO, '/v1/models': V1 },
        ollama: { '/api/ps': OLLAMA_PS, '/v1/models': V1 },
        llamacpp: {
            '/props': { default_generation_settings: { n_ctx: 8192 } },
            '/v1/models': V1,
        },
        vllm: {
            '/v1/models': { data: [{ id: 'm', max_model_len: 4096 }] },
        },
        openai: { '/v1/models': V1 },
        empty: {},
    }
    beforeAll(() => {
        for (const [k, table] of Object.entries(routes))
            servers[k] = Bun.serve({
                port: 0,
                fetch(req) {
                    const body = table[new URL(req.url).pathname]
                    return body === undefined
                        ? new Response('no', { status: 404 })
                        : Response.json(body)
                },
            })
    })
    afterAll(() => {
        for (const s of Object.values(servers)) s.stop(true)
    })
    const at = (k: string) => `http://localhost:${servers[k].port}/v1/`

    test('each kind is identified by the route that answers', async () => {
        const lm = await probeLocalServer(at('lmstudio'))
        expect(lm?.kind).toBe('lmstudio')
        expect(lm?.url).toBe(`http://localhost:${servers.lmstudio.port}`)
        expect(lm?.models.find(m => m.embedding)?.id).toBe(
            'text-embedding-nomic-embed-text-v1.5',
        )
        const ol = await probeLocalServer(at('ollama'))
        expect(ol?.kind).toBe('ollama')
        expect(ol?.models).toEqual([
            { id: 'gemma4:e2b-it-qat', window: null, embedding: false },
            { id: 'qwen3.5:9b-q4_K_M', window: 4096, embedding: false },
        ])
        const lc = await probeLocalServer(at('llamacpp'))
        expect(lc?.kind).toBe('llamacpp')
        expect(lc?.models.map(m => m.window)).toEqual([8192, 8192])
        const vl = await probeLocalServer(at('vllm'))
        expect(vl?.kind).toBe('vllm')
        expect(vl?.models).toEqual([{ id: 'm', window: 4096, embedding: false }])
        const oa = await probeLocalServer(at('openai'))
        expect(oa?.kind).toBe('openai')
        expect(oa?.models.map(m => m.window)).toEqual([null, null])
    })
    test('a server that answers nothing is null', async () => {
        expect(await probeLocalServer(at('empty'))).toBeNull()
        expect(await probeLocalServer('http://127.0.0.1:9', undefined, 300)).toBeNull()
        expect(await probeLocalServer('  ')).toBeNull()
    })
    test('detectWindow', async () => {
        expect(await detectWindow(at('lmstudio'), 'qwen/qwen3.5-9b')).toBe(8192)
        expect(await detectWindow(at('lmstudio'), 'qwen/qwen3-14b')).toBeNull()
        expect(await detectWindow(at('lmstudio'), 'nope')).toBeNull()
        expect(await detectWindow('http://127.0.0.1:9', 'x')).toBeNull()
    })
})
