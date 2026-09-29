import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'

/** The shapes a vault's settings can be in, first readable wins. The daemon is a separate process
 *  that may read a vault BEFORE core migrates it, so it falls back from the single `.settings`
 *  file to the interim `.settings/settings.yaml` and the legacy root `settings.yaml`. */
const SETTINGS_SHAPES = [
    '.settings',
    join('.settings', 'settings.yaml'),
    'settings.yaml',
]

/** Thrown by {@link readVaultSettingsDoc} in strict mode when a settings file is PRESENT but is
 *  not valid YAML. The message names the shape, e.g. ".settings is not valid YAML (...)". */
export class VaultSettingsParseError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'VaultSettingsParseError'
    }
}

/**
 * The parsed YAML doc of the first readable settings shape, or null when none is readable (absent,
 * a directory such as an interim `.settings/`, or an empty doc). Never throws by default: a shape
 * whose YAML is invalid is skipped, so a corrupt file reads like a missing one.
 *
 * `strict` makes a PRESENT-but-unparseable shape throw {@link VaultSettingsParseError} instead —
 * for callers (the visibility walk) where "cannot read" must not collapse into "nothing set".
 */
export async function readVaultSettingsDoc(
    root: string,
    opts: { strict?: boolean } = {},
): Promise<unknown | null> {
    for (const rel of SETTINGS_SHAPES) {
        let raw: string
        try {
            raw = await readFile(join(root, rel), 'utf-8')
        } catch {
            continue // absent, a directory, or unreadable in this shape → try the next
        }
        let doc: unknown
        try {
            doc = parse(raw)
        } catch (e) {
            if (opts.strict)
                throw new VaultSettingsParseError(
                    `${rel} is not valid YAML (${e instanceof Error ? e.message : String(e)})`,
                )
            continue
        }
        if (doc !== null) return doc
    }
    return null
}
