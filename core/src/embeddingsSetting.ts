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

type SettingsDoc = {
    embeddings?: { describeImages?: unknown }
    daemon?: { recall?: { enabled?: unknown; files?: unknown; chats?: unknown; docs?: unknown } }
} | null

function readSettingsDoc(vault: string): SettingsDoc {
    try {
        const full = join(vault, SETTINGS_FILE)
        if (!existsSync(full)) return null
        return parse(readFileSync(full, 'utf8')) as SettingsDoc
    } catch {
        return null
    }
}

/** `embeddings.describeImages`: `true` only when set to `true`; anything else reads as `false`. */
export function readDescribeImagesSync(vault: string): boolean {
    return readSettingsDoc(vault)?.embeddings?.describeImages === true
}

export type RecallSourceSwitches = { files: boolean; chats: boolean; docs: boolean }

/** `daemon.recall.files|chats|docs`, each `true` unless set to `false`. A missing or corrupt file
 *  reads as all `true`; the master switches (`daemon.recall.enabled`, `embeddings.enabled`) still
 *  gate them. */
export function readRecallSourcesSync(vault: string): RecallSourceSwitches {
    const r = readSettingsDoc(vault)?.daemon?.recall
    return { files: r?.files !== false, chats: r?.chats !== false, docs: r?.docs !== false }
}

/** `daemon.recall.enabled`: `true` only when set to `true` (its default is off). */
export function readRecallEnabledSync(vault: string): boolean {
    return readSettingsDoc(vault)?.daemon?.recall?.enabled === true
}

/** Whether the boot builds the docs index: only when recall can inject docs, since
 *  `embeddings.enabled` alone may be on just for search. `daemonEnabled` is settings.ts's
 *  `readDaemonEnabledSync`, passed in so this module stays free of it. */
export function docsIndexWantedSync(vault: string, daemonEnabled: boolean): boolean {
    return (
        daemonEnabled &&
        readEmbeddingsEnabledSync(vault) &&
        readRecallEnabledSync(vault) &&
        readRecallSourcesSync(vault).docs
    )
}
