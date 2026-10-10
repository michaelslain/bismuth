import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { SETTINGS_FILE } from './settings'

/** `embeddings.enabled` from the vault's `.settings`: the one switch for memory recall's semantic
 *  channel and vault-note semantic search. Sync + tolerant: a missing, corrupt or partial file
 *  reads as `false`, and it never throws. */
export function readEmbeddingsEnabledSync(vault: string): boolean {
    try {
        const full = join(vault, SETTINGS_FILE)
        if (!existsSync(full)) return false
        const parsed = parse(readFileSync(full, 'utf8')) as {
            embeddings?: { enabled?: unknown }
        } | null
        return parsed?.embeddings?.enabled === true
    } catch {
        return false
    }
}
