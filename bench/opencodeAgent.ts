// bench/opencodeAgent.ts
//
// One opencode turn under an OS read-deny. Only ever pointed at made-up text (the synthetic vault):
// every run is wrapped in the Seatbelt profile from core's sandboxWrapper, refuses to run unwrapped,
// and sees an environment built from PATH plus a throwaway home the caller owns.
//
// Expressed for opencode v2.0.32 (verified live): the system prompt is `agent.build.prompt` and the
// permission rules are `permission: { edit, bash: { '*': 'deny', 'bismuth *': 'allow' } }`, both
// passed inline through OPENCODE_CONFIG_CONTENT. `--auto` approves anything not explicitly denied.
import { mkdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
    buildSeatbeltProfile,
    checkSandboxWrapperAvailability,
    describeSandboxWrapperUnavailable,
    isSandboxApplyFailure,
    wrapArgv,
} from '../core/src/agentBackends/sandboxWrapper'

export type OpencodeRun = {
    status: 'ok' | 'timeout' | 'error'
    answer: string
    tools: { name: string; arg: string }[]
    toolCalls: number
    denied: number
    durationMs: number
    rawStdout: string
}

export type OpencodeOptions = {
    model: string
    message: string
    system: string
    cwd: string
    home: string
    denyPaths: string[]
    binDir: string
    timeoutMs: number
}

/** The inline opencode config: the system prompt, no edits, and no shell except `bismuth` read commands. */
export function buildOpencodeConfig(system: string): string {
    return JSON.stringify({
        permission: {
            edit: 'deny',
            external_directory: 'deny',
            webfetch: 'deny',
            websearch: 'deny',
            bash: {
                '*': 'deny',
                'bismuth search *': 'allow',
                'bismuth history *': 'allow',
                'bismuth read *': 'allow',
                'bismuth docs *': 'allow',
                'bismuth map *': 'allow',
                'bismuth brain': 'allow',
                'bismuth highlights *': 'allow',
                'bismuth task list *': 'allow',
                'bismuth prop get *': 'allow',
                // listed after the allows so they win: no other vault, no other core
                'bismuth * --vault*': 'deny',
                'bismuth * --api*': 'deny',
            },
        },
        agent: { build: { prompt: system } },
    })
}

/** Nothing but PATH (binDir first) and a home the caller owns, plus the inline config. */
export function buildOpencodeEnv(o: {
    home: string
    binDir: string
    path: string
    config: string
    password: string
}): Record<string, string> {
    return {
        PATH: `${o.binDir}:${o.path}`,
        HOME: o.home,
        XDG_CONFIG_HOME: join(o.home, '.config'),
        XDG_DATA_HOME: join(o.home, '.data'),
        XDG_CACHE_HOME: join(o.home, '.cache'),
        XDG_STATE_HOME: join(o.home, '.state'),
        TMPDIR: join(o.home, '.tmp'),
        OPENCODE_DISABLE_CLAUDE_CODE: '1',
        OPENCODE_CONFIG_CONTENT: o.config,
        OPENCODE_PASSWORD: o.password,
    }
}

/** The client half: `run` against a private server on `port`. A standalone run picks a random loopback
 *  port, which no profile can allow in advance, so the server is started on a port we choose. */
export function buildOpencodeArgv(opencodePath: string, model: string, message: string, port: number): string[] {
    return [opencodePath, 'run', '--server', `http://127.0.0.1:${port}`, '--auto', '-m', model, '--format', 'json', message]
}

export function buildOpencodeServeArgv(opencodePath: string, port: number): string[] {
    return [opencodePath, 'serve', '--hostname', '127.0.0.1', '--port', String(port)]
}

const ARG_KEYS = ['command', 'path', 'filePath', 'file_path', 'pattern', 'query', 'url']

function toolArg(input: unknown): string {
    if (!input || typeof input !== 'object') return ''
    const rec = input as Record<string, unknown>
    for (const k of ARG_KEYS) if (typeof rec[k] === 'string') return rec[k] as string
    return ''
}

/** PURE. Fold the JSON-lines event stream into what the bench needs. Malformed lines are skipped.
 *  The answer is the text after the last tool call (the model's final turn), else all text. */
export function parseOpencodeEvents(stdout: string): Omit<OpencodeRun, 'durationMs' | 'status' | 'rawStdout'> & { failed: boolean; errorMessage: string } {
    const tools: { name: string; arg: string }[] = []
    let denied = 0
    let failed = false
    let errorMessage = ''
    let sinceTool: string[] = []
    const all: string[] = []
    for (const line of stdout.split('\n')) {
        if (!line.trim()) continue
        let ev: any
        try {
            ev = JSON.parse(line)
        } catch {
            continue
        }
        if (!ev || typeof ev !== 'object') continue
        const part = ev.part
        if (ev.type === 'error') {
            failed = true
            errorMessage ||= String(ev.error?.message ?? '')
        } else if (ev.type === 'text' && typeof part?.text === 'string') {
            sinceTool.push(part.text)
            all.push(part.text)
        } else if (ev.type === 'tool_use' && part) {
            const state = part.state ?? {}
            if (state.status !== 'completed' && state.status !== 'error') continue
            tools.push({ name: String(part.tool ?? ''), arg: toolArg(state.input) })
            if (state.status === 'error' && /denied|not permitted|rejected/i.test(String(state.error ?? ''))) denied++
            sinceTool = []
        }
    }
    const answer = (sinceTool.length ? sinceTool : all).join('\n').trim()
    return { answer, tools, toolCalls: tools.length, denied, failed, errorMessage }
}

function fail(message: string, started: number): OpencodeRun {
    return { status: 'error', answer: message, tools: [], toolCalls: 0, denied: 0, durationMs: Date.now() - started, rawStdout: '' }
}

/** Everything the kernel is told to keep opencode out of. PURE. Rule order is load-bearing (the last
 *  matching rule wins): base denies, then the allows, then the denies again so an allowed directory
 *  that contains a denied one cannot reopen it, then loopback denied with only `port` allowed. */
export function buildGuardProfile(o: { denyPaths: string[]; allowed: string[]; port: number; home: string }): string {
    const quote = (p: string) => JSON.stringify(p)
    const ancestors = new Set<string>()
    for (const a of o.allowed) for (let d = dirname(a); d !== dirname(d); d = dirname(d)) ancestors.add(d)
    return [
        // the shared temp roots stay denied too: the user's scratch files live there, not just under home
        buildSeatbeltProfile([...o.denyPaths, o.home, '/private/tmp', '/private/var/folders', '/Volumes', '/Users/Shared']).trimEnd(),
        ...o.allowed.map(p => `(allow file-read* (subpath ${quote(p)}))`),
        // opencode realpaths its cwd, which stats every ancestor: the directory entries themselves, not their contents
        ...[...ancestors].map(p => `(allow file-read* (literal ${quote(p)}))`),
        ...o.denyPaths.map(p => `(deny file-read* (subpath ${quote(p)}))`),
        '(deny network-outbound (remote ip "localhost:*"))',
        // the one loopback port opencode talks to itself on; the last matching rule wins
        `(allow network-outbound (remote ip "localhost:${o.port}"))`,
        '',
    ].join('\n')
}

export async function runOpencode(o: OpencodeOptions): Promise<OpencodeRun> {
    const started = Date.now()
    const avail = checkSandboxWrapperAvailability()
    if (!avail.available) return fail(`refused: ${describeSandboxWrapperUnavailable(avail.reason)}`, started)
    if (o.denyPaths.length === 0) return fail('refused: no denyPaths, would run unwrapped', started)
    const opencode = Bun.which('opencode')
    if (!opencode) return fail('opencode not found on PATH', started)
    const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') })
    const port = probe.port as number
    probe.stop(true)
    const real = (p: string) => {
        try {
            return realpathSync(p)
        } catch {
            return p
        }
    }
    const repo = resolve(import.meta.dir, '..')
    const deny = [...new Set([...o.denyPaths, ...o.denyPaths.map(real), join(repo, '.claude')])]
    const allowed = [o.cwd, o.home, o.binDir, repo, dirname(process.execPath)].map(real)
    const profile = join(o.home, 'guard.sb')
    mkdirSync(join(o.home, '.tmp'), { recursive: true })
    await Bun.write(profile, buildGuardProfile({ denyPaths: deny, allowed, port, home: real(homedir()) }))
    const env = buildOpencodeEnv({
        home: o.home,
        binDir: o.binDir,
        path: process.env.PATH ?? '/usr/bin:/bin',
        config: buildOpencodeConfig(o.system),
        password: crypto.randomUUID(),
    })
    const server = Bun.spawn(wrapArgv(buildOpencodeServeArgv(opencode, port), profile), {
        cwd: o.cwd, env, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore',
    })
    for (let i = 0; i < 100; i++) {
        if (await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)) break
        await Bun.sleep(100)
    }
    const argv = wrapArgv(buildOpencodeArgv(opencode, o.model, o.message, port), profile)
    const proc = Bun.spawn(argv, { cwd: o.cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    let timedOut = false
    const timer = setTimeout(() => {
        timedOut = true
        proc.kill('SIGKILL')
    }, o.timeoutMs)
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    clearTimeout(timer)
    server.kill('SIGKILL')
    const parsed = parseOpencodeEvents(stdout)
    const { failed, errorMessage, ...parsedRest } = parsed
    const rest = { ...parsedRest, rawStdout: stdout }
    const durationMs = Date.now() - started
    if (timedOut) return { ...rest, status: 'timeout', durationMs }
    if (isSandboxApplyFailure(code))
        return { ...rest, status: 'error', answer: 'sandbox_apply failed, refused', durationMs }
    if (code !== 0 || failed) {
        return { ...rest, status: 'error', answer: rest.answer || errorMessage || stderr.slice(0, 300), durationMs }
    }
    return { ...rest, status: 'ok', durationMs }
}
