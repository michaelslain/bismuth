// core/src/statusBarRun.ts — runs a status bar `run:` command. Bun-only (spawns a process);
// never imported by app code. Only ever called for commands the owner approved.
import type { StatusRunResult } from './statusBarEval'

export type StatusRunner = (command: string, every: number) => Promise<StatusRunResult>

const MAX_OUTPUT = 120
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

const READ_CAP = 16 * 1024
const firstLine = (s: string) =>
    s
        .replace(ANSI, '')
        .split('\n')
        .map(l => l.trim())
        .find(l => l !== '')

async function readCapped(stream: ReadableStream<Uint8Array>, cap: number): Promise<string> {
    const reader = stream.getReader()
    const dec = new TextDecoder()
    let text = ''
    try {
        while (text.length < cap) {
            const { done, value } = await reader.read()
            if (done) break
            text += dec.decode(value, { stream: true })
        }
    } finally {
        reader.cancel().catch(() => {})
    }
    return text.slice(0, cap)
}

async function spawnOnce(command: string, vault: string, timeoutMs: number): Promise<StatusRunResult> {
    let proc: ReturnType<typeof Bun.spawn>
    // a run: command comes from .settings; it must never inherit the owner token
    const env: Record<string, string | undefined> = { ...process.env, BISMUTH_VAULT: vault }
    delete env.BISMUTH_OWNER_TOKEN
    delete env.VITE_OWNER_TOKEN
    try {
        proc = Bun.spawn(['/bin/sh', '-c', command], {
            cwd: vault,
            env,
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
            // own process group, so a timeout kills the shell AND everything it spawned
            detached: true,
        })
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
    }
    const killGroup = () => {
        try {
            process.kill(-proc.pid, 'SIGKILL')
        } catch {
            proc.kill('SIGKILL')
        }
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>(res => {
        timer = setTimeout(() => res('timeout'), timeoutMs)
    })
    try {
        const r = await Promise.race([
            Promise.all([
                readCapped(proc.stdout as ReadableStream<Uint8Array>, READ_CAP),
                readCapped(proc.stderr as ReadableStream<Uint8Array>, READ_CAP),
                proc.exited,
            ]),
            timeout,
        ])
        if (r === 'timeout') return { error: `timed out after ${Math.round(timeoutMs / 1000)}s` }
        const [out, err, code] = r
        const first = firstLine(out)
        if (first !== undefined) return { output: first.slice(0, MAX_OUTPUT) }
        if (code !== 0) return { error: firstLine(err)?.slice(0, MAX_OUTPUT) ?? `exit ${code}` }
        return { output: '' }
    } finally {
        clearTimeout(timer)
        killGroup()
    }
}

/** `/bin/sh -c <command>`, cwd = vault, env = process.env minus the owner tokens (BISMUTH_OWNER_TOKEN, VITE_OWNER_TOKEN) + BISMUTH_VAULT, stdin ignored.
 *  Killed after timeoutMs (default 5000). Output = first non-empty stdout line, ANSI stripped,
 *  trimmed, capped at 120 chars. Cached per command for `every` seconds; concurrent calls for
 *  the same command share one in-flight spawn. */
export function createStatusRunner(opts: {
    vault: string
    timeoutMs?: number
    now?: () => number
}): StatusRunner {
    const timeoutMs = opts.timeoutMs ?? 5000
    const now = opts.now ?? Date.now
    const cache = new Map<string, { at: number; result: StatusRunResult }>()
    const inflight = new Map<string, Promise<StatusRunResult>>()
    return (command, every) => {
        const hit = cache.get(command)
        if (hit && now() - hit.at < every * 1000) return Promise.resolve(hit.result)
        const pending = inflight.get(command)
        if (pending) return pending
        const p = spawnOnce(command, opts.vault, timeoutMs)
            .then(result => {
                cache.set(command, { at: now(), result })
                return result
            })
            .finally(() => inflight.delete(command))
        inflight.set(command, p)
        return p
    }
}
