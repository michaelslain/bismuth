import { homedir } from 'node:os'
import { join } from 'node:path'

/** `~/.bismuth[/...parts]` — the machine-wide Bismuth home. homedir() is called on every call, but Bun resolves HOME once at process start, so a runtime HOME change is not seen.
 *
 *  `BISMUTH_HOME` replaces `~/.bismuth` wholesale: the test preload (core/test/setup.ts) points it at
 *  a throwaway dir so no suite can touch the user's real home. Under `bun test` (NODE_ENV=test)
 *  with no override this THROWS rather than hand back the real path: a run that reached here
 *  without the preload (a workspace `bun test` from inside its own dir, a child spawned with a
 *  scrubbed env) would otherwise write vaults.json, run records and the rest into the real home.
 *  daemon/src/lib/bismuthPaths.ts carries a literal copy; core/test/testHomeGuard.test.ts pins them. */
export function bismuthHome(...parts: string[]): string {
    const override = process.env.BISMUTH_HOME
    if (override) return join(override, ...parts)
    if (process.env.NODE_ENV === 'test')
        throw new Error(
            'refusing to resolve the real ~/.bismuth under test: BISMUTH_HOME is unset (run `bun test` from the repo root so bunfig.toml loads core/test/setup.ts)',
        )
    return join(homedir(), '.bismuth', ...parts)
}
