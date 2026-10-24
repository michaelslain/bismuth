/**
 * Make `Bun.spawn` / `Bun.spawnSync` hand a child the CURRENT `process.env` when the caller gave
 * no `env`.
 *
 * Bun's default is the environment the process STARTED with, not `process.env` as it is now, so
 * an assignment made at runtime never reaches a child spawned without an explicit `env`. Measured:
 * `process.env.X = 'a'; Bun.spawnSync(['sh', '-c', 'echo $X'])` prints nothing, while
 * `{ env: process.env }` prints `a` (node:child_process behaves the second way by default).
 * The test preload (setup.ts) sets `BISMUTH_HOME`, `BISMUTH_RUN_DIR` and `BISMUTH_LAYOUT_CACHE_DIR`
 * at runtime, so without this every CLI, core or daemon a test spawns that way ran against the
 * user's real `~/.bismuth`. Called once, from the preload. A caller's own `env` is left alone.
 */
export function inheritRuntimeEnv(): void {
    for (const name of ['spawn', 'spawnSync'] as const) {
        const original = Bun[name] as (...args: unknown[]) => unknown
        const wrapped = (...args: unknown[]) => {
            const [first, second] = args
            if (Array.isArray(first)) {
                const opts = (second ?? {}) as { env?: unknown }
                if (opts.env === undefined)
                    return original(first, { ...opts, env: process.env })
            } else if (first && typeof first === 'object') {
                const opts = first as { env?: unknown }
                if (opts.env === undefined)
                    return original(
                        { ...opts, env: process.env },
                        ...args.slice(1),
                    )
            }
            return original(...args)
        }
        ;(Bun as unknown as Record<string, unknown>)[name] = wrapped
    }
}
