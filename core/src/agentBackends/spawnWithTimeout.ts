// core/src/agentBackends/spawnWithTimeout.ts
// Spawn a child with stdin ignored, capture stdout/stderr, and kill it after `ms`. Never throws:
// a spawn failure comes back as `{code: null, error}`. `timedOut` is true ONLY when the kill timer
// fired — a child that crashes fast with no output is not a timeout, however silent it was.

export interface SpawnResult {
    code: number | null
    stdout: string
    stderr: string
    timedOut: boolean
    error?: string
}

export async function spawnWithTimeout(
    argv: string[],
    ms: number,
    opts: { env?: Record<string, string | undefined>; cwd?: string } = {},
): Promise<SpawnResult> {
    try {
        const proc = Bun.spawn(argv, {
            ...opts,
            // Never inherit stdin: a CLI that decides to prompt would otherwise hang forever.
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
        })
        let timedOut = false
        const timer = setTimeout(() => {
            timedOut = true
            try {
                proc.kill()
            } catch {
                /* already gone */
            }
        }, ms)
        try {
            const [stdout, stderr, code] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
                proc.exited,
            ])
            return { code, stdout, stderr, timedOut }
        } finally {
            clearTimeout(timer)
        }
    } catch (e) {
        return {
            code: null,
            stdout: '',
            stderr: '',
            timedOut: false,
            error: e instanceof Error ? e.message : String(e),
        }
    }
}
