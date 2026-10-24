// cli/test/cliHarness.ts
//
// What the cli/test/cli*.test.ts files share: the spawn-budget `test`, the per-test environment
// isolation, and the helpers that spawn `bismuth` or fake the servers it talks to. They are one
// suite split into several files so `bun test --parallel` can run them side by side.
import { test as bunTest, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Every test in the cli/test/cli*.test.ts files drives the CLI the way a user does — `bun run cli/src/index.ts …` in a
 * REAL subprocess — which is the whole point: it proves the dispatcher, arg parsing and exit codes
 * work end to end, not just that a function returns. The cost is that a cold Bun start is
 * ~0.4-0.65s on an idle machine BEFORE the command does any work, and those files spawn 53 of them.
 * Several tests spawn two; `checkpoint diff` spawns five. That is ~1-3s of pure startup racing
 * Bun's 5s default timeout.
 *
 * On an idle machine it passes. Under the full pre-push suite it does not: a spawn-heavy test
 * fails on the CLOCK while the behaviour it asserts is perfectly fine. Worse, it does not fail
 * legibly — Bun kills the subprocess mid-read, so the reported error is a bare
 * `SyntaxError: JSON Parse error: Unexpected EOF` from the truncated stdout, which reads like a
 * CLI bug and sends you looking in the wrong place. That is what the one "flaky" CLI failure was.
 *
 * Seven tests here already carry a hand-written 20-60s timeout, which is the same diagnosis
 * reached one test at a time; this makes it the files' default instead, so the next spawn-heavy
 * test is not written straight back into the trap. An explicit third argument still wins — the
 * calendar test's 60s is longer than this floor and must stay that way.
 *
 * This budgets for the spawns, not for the work. A command that genuinely hangs still fails, just
 * later.
 */
export const SPAWN_TIMEOUT_MS = 30_000
export const test = (
    name: string,
    fn: Parameters<typeof bunTest>[1],
    opts: Parameters<typeof bunTest>[2] = SPAWN_TIMEOUT_MS,
) => bunTest(name, fn, opts)

/**
 * These tests mutate BISMUTH_API/CLAUDE_RELAY_URL/BISMUTH_RUN_DIR, and the CLIs they spawn inherit
 * the environment: snapshot + restore around every test, with a fresh run dir so a spawned CLI
 * never sees a real core's run record. Call once at the top of each file.
 */
export function isolateCliEnv(): void {
    let savedEnv: Record<string, string | undefined>
    let runDir: string
    beforeEach(() => {
        savedEnv = {
            api: process.env.BISMUTH_API,
            relay: process.env.CLAUDE_RELAY_URL,
            run: process.env.BISMUTH_RUN_DIR,
            vault: process.env.BISMUTH_VAULT,
        }
        delete process.env.BISMUTH_API
        delete process.env.CLAUDE_RELAY_URL
        delete process.env.BISMUTH_VAULT
        runDir = mkdtempSync(join(tmpdir(), 'bismuth-cli-run-'))
        process.env.BISMUTH_RUN_DIR = runDir
    })
    afterEach(() => {
        rmSync(runDir, { recursive: true, force: true })
        for (const [k, envKey] of [
            ['api', 'BISMUTH_API'],
            ['relay', 'CLAUDE_RELAY_URL'],
            ['run', 'BISMUTH_RUN_DIR'],
            ['vault', 'BISMUTH_VAULT'],
        ] as const) {
            if (savedEnv[k] === undefined) delete process.env[envKey]
            else process.env[envKey] = savedEnv[k]!
        }
    })
}

/** Spawn `bismuth <args>` against a vault; returns { code, json } (json parsed from stdout). */
export async function runCli(
    vault: string,
    ...args: string[]
): Promise<{ code: number | null; json: any; err: string }> {
    const proc = Bun.spawn(
        ['bun', 'run', 'cli/src/index.ts', ...args, '--vault', vault],
        {
            stdout: 'pipe',
            stderr: 'pipe',
        },
    )
    const [outText, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    let json: any = undefined
    try {
        json = JSON.parse(outText)
    } catch {
        /* non-JSON output (or empty) */
    }
    return { code, json, err }
}

/** Spawn `bismuth <args>` with NO forced --vault (checkpoint uses --dir, not --vault). Optional
 *  `env` override for the missing-BISMUTH_VAULT arg-validation case. */
export async function spawnCli(
    args: string[],
    env: Record<string, string | undefined> = process.env,
): Promise<{ code: number | null; out: string; err: string }> {
    // FORCE_COLOR in the parent's env makes Bun wrap console.error in ANSI codes, so an exact
    // stderr assertion would fail on output that prints identically
    const proc = Bun.spawn(['bun', 'run', 'cli/src/index.ts', ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...env, FORCE_COLOR: undefined },
    })
    const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { code, out, err }
}

/** Spin up a throwaway HTTP server that records every POST /ui/command body and answers it with
 *  `reply`. Caller must `stop()` it. */
export function mockUiControlServer(reply: unknown = { ok: true }): {
    url: string
    calls: any[]
    stop: () => void
} {
    const calls: any[] = []
    const server = Bun.serve({
        port: 0,
        fetch: async req => {
            if (
                req.method === 'POST' &&
                new URL(req.url).pathname === '/ui/command'
            ) {
                calls.push(await req.json())
                return new Response(JSON.stringify(reply), {
                    headers: { 'content-type': 'application/json' },
                })
            }
            return new Response('not found', { status: 404 })
        },
    })
    return {
        url: `http://localhost:${server.port}`,
        calls,
        stop: () => server.stop(true),
    }
}

/** Spin up a throwaway HTTP server that records every request and answers GET /update/status /
 *  POST /update/apply / POST /update/cancel with the given payloads. Caller must `stop()` it. */
export function mockUpdateServer(
    replies: { status?: unknown; apply?: unknown; cancel?: unknown } = {},
): {
    url: string
    calls: { method: string; path: string }[]
    stop: () => void
} {
    const calls: { method: string; path: string }[] = []
    const server = Bun.serve({
        port: 0,
        fetch: req => {
            const { pathname } = new URL(req.url)
            calls.push({ method: req.method, path: pathname })
            if (req.method === 'GET' && pathname === '/update/status') {
                return new Response(
                    JSON.stringify(
                        replies.status ?? { available: false, behind: 0 },
                    ),
                    {
                        headers: { 'content-type': 'application/json' },
                    },
                )
            }
            if (req.method === 'POST' && pathname === '/update/cancel') {
                return new Response(
                    JSON.stringify(replies.cancel ?? { phase: 'idle' }),
                    {
                        headers: { 'content-type': 'application/json' },
                    },
                )
            }
            if (req.method === 'POST' && pathname === '/update/apply') {
                return new Response(
                    JSON.stringify(replies.apply ?? { phase: 'idle' }),
                    {
                        headers: { 'content-type': 'application/json' },
                    },
                )
            }
            return new Response('not found', { status: 404 })
        },
    })
    return {
        url: `http://localhost:${server.port}`,
        calls,
        stop: () => server.stop(true),
    }
}
