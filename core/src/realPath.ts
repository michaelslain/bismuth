// core/src/realPath.ts
// One shared "realpath of something that may not exist yet", used by the visibility gate, the
// visibility filter and the CLI's memory commands so they all agree on what a path IS.
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/** realpath of `p`, resolving as much as exists and appending the not-yet-created remainder. */
export function realpathLoose(p: string): string {
    const rest: string[] = []
    let cur = resolve(p)
    while (!existsSync(cur) && dirname(cur) !== cur) {
        rest.unshift(basename(cur))
        cur = dirname(cur)
    }
    return join(realpathSync(cur), ...rest)
}
