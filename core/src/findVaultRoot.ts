// The vault that contains a directory: the nearest ancestor (or the dir itself) holding the vault's
// settings file. The CLI resolves its vault through this when neither `--vault` nor `BISMUTH_VAULT`
// is given, and core/src/visibilityCliGate.ts gates the same root, so an agent's shell sitting in a
// vault reaches that vault and is gated on it with no flags.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// Only `.settings`: the legacy `settings.yaml` is a common file name in unrelated projects, and
// mistaking one of those for a vault would point every flagless command at it.
const MARKER = '.settings'

/** Walk up from `start` to the first directory holding `.settings`, or null at the filesystem
 *  root. */
export function findVaultRoot(start: string): string | null {
    let dir = resolve(start)
    for (;;) {
        if (existsSync(join(dir, MARKER))) return dir
        const parent = dirname(dir)
        if (parent === dir) return null
        dir = parent
    }
}
