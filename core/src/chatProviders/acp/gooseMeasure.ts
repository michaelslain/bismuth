// core/src/chatProviders/acp/gooseMeasure.ts
// How large goose's opening request is for this user, per profile, measured rather than guessed:
// goose builds it from the user's own goose config, agents and skills, so no constant holds across
// machines. Runs `goose run` once per profile against an in-process stand-in model that answers
// "ok", and reads the request goose sent. The result is cached for the life of the process.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { charsToTokens, gooseProfileEnv, type GooseProfile } from './gooseBudget'

const cache = new Map<string, number | null>()

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`

/** An OpenAI-compatible stand-in that records every request body and streams a one-word reply. */
function standIn(): { url: string; bodies: unknown[]; stop: () => void } {
    const bodies: unknown[] = []
    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: async req => {
            if (req.method !== 'POST') return new Response('not found', { status: 404 })
            bodies.push(await req.json().catch(() => null))
            const id = 'chatcmpl-measure'
            const chunk = (delta: unknown, finish: string | null) =>
                sse({
                    id,
                    object: 'chat.completion.chunk',
                    created: 0,
                    model: 'measure',
                    choices: [{ index: 0, delta, finish_reason: finish }],
                })
            return new Response(
                chunk({ role: 'assistant' }, null) +
                    chunk({ content: 'ok' }, null) +
                    chunk({}, 'stop') +
                    'data: [DONE]\n\n',
                { headers: { 'Content-Type': 'text/event-stream' } },
            )
        },
    })
    return { url: `http://127.0.0.1:${server.port}`, bodies, stop: () => server.stop(true) }
}

/**
 * goose's opening request for `profile`, in tokens, or null when the measurement failed. `env` is
 * the env a chat would spawn goose with (the user's own config dirs stay in effect); the provider
 * is pointed at the stand-in, and goose's logs go to a temp dir so the user's are untouched.
 */
export async function measureGooseOpening(
    bin: string,
    env: Record<string, string>,
    profile: GooseProfile,
    /** The Bismuth MCP server a chat session adds, so its tool is counted: goose's
     *  `--with-extension` form, `name:ENV=value … command`. */
    extension?: string,
    timeoutMs = 30_000,
): Promise<number | null> {
    const key = `${bin}\0${profile}\0${extension ?? ''}`
    if (cache.has(key)) return cache.get(key) ?? null
    const model = standIn()
    const state = mkdtempSync(join(tmpdir(), 'bismuth-goose-measure-'))
    let tokens: number | null = null
    try {
        const args = ['run', '--no-session', '-t', 'ok']
        if (extension) args.push('--with-extension', extension)
        const proc = Bun.spawn([bin, ...args], {
            cwd: state,
            stdin: 'ignore',
            stdout: 'ignore',
            stderr: 'ignore',
            env: {
                ...env,
                ...gooseProfileEnv(profile),
                GOOSE_PROVIDER: 'openai',
                GOOSE_MODEL: 'measure',
                OPENAI_HOST: model.url,
                OPENAI_BASE_PATH: 'v1/chat/completions',
                OPENAI_API_KEY: 'measure',
                GOOSE_MODE: 'auto',
                GOOSE_DISABLE_SESSION_NAMING: 'true',
                XDG_STATE_HOME: state,
            },
        })
        const timer = setTimeout(() => proc.kill(), timeoutMs)
        await proc.exited
        clearTimeout(timer)
        // The opening request is the largest: anything else goose sends (a title) is short.
        const largest = Math.max(0, ...model.bodies.map(b => JSON.stringify(b ?? '').length))
        tokens = largest > 0 ? charsToTokens(largest) : null
    } catch {
        tokens = null
    } finally {
        model.stop()
        rmSync(state, { recursive: true, force: true })
    }
    cache.set(key, tokens)
    return tokens
}

/** Forget measured sizes (a test seam; the cache otherwise lives as long as the process). */
export function clearGooseMeasurements(): void {
    cache.clear()
}
