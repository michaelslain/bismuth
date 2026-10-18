// core/src/chatLogs.ts
// Hide and delete past chats — the history dialog's row menu and its "default for all chats" /
// "delete all" actions, and their `bismuth chat` CLI twins. A chat's level lives in `.settings`
// `chatVisibility` (memory/src/chatVisibility.ts holds the rules and how they resolve); this module
// writes it, keeps a hidden chat out of the daemon's memory, and deletes chats into a trash that an
// undo restores from.
import { existsSync } from 'node:fs'
import { mkdir, readdir, realpath, rename, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import {
    CHAT_DEFAULT_KEY,
    CHAT_TRASH_DIR,
    claudeProjectDirs,
    isChatVisibleTo,
    listChatSessionIds,
    readChatVisibility,
    removeAutoNotes,
    resolveChatVisibility,
    type ChatVisibility,
} from '@bismuth/memory'
import { setChatVisibilityEntries } from './settings'
import {
    invalidateChatVisibility,
    listChatSessionIdsInScope,
    type ChatScope,
} from './chat'

/** The vault's daemon memory dir, where a finished chat's transcript note waits for the dream. */
const memoryDirOf = (vault: string) => join(vault, '.daemon', 'memory')

async function vaultPaths(vault: string): Promise<string[]> {
    const canonical = await realpath(vault).catch(() => vault)
    return [canonical, vault]
}

export type ChatVisibilityTarget = { sessionId: string } | { default: true }

/**
 * Set one chat's own level (`null` clears it, so the chat inherits the default) or the default every
 * chat without its own level inherits (`all` and `null` both clear it). Every chat this leaves hidden
 * from the daemon loses its not-yet-dreamed transcript note, and every open chat re-gates on its next
 * turn. Returns false when `.settings` is invalid and nothing was written.
 */
export async function setChatVisibility(
    vault: string,
    target: ChatVisibilityTarget,
    level: ChatVisibility | null,
): Promise<boolean> {
    const isDefault = 'default' in target
    const key = isDefault ? CHAT_DEFAULT_KEY : target.sessionId
    const value =
        level === null || (isDefault && level === 'all') ? undefined : level
    const persisted = await setChatVisibilityEntries(vault, [[key, value]])
    if (!persisted) return false
    invalidateChatVisibility()
    const chats = await readChatVisibility(vault)
    if (chats.ok) {
        const ids = isDefault
            ? await listChatSessionIds(await vaultPaths(vault))
            : [key]
        await removeAutoNotes(
            memoryDirOf(vault),
            ids.filter(
                id =>
                    !isChatVisibleTo(
                        resolveChatVisibility(id, chats.rules),
                        'daemon',
                    ),
            ),
        )
    }
    return true
}

/** How long a deleted chat waits in the trash for its undo before it is removed for good. */
export const CHAT_TRASH_TTL_MS = 10 * 60 * 1000

/** Every session directory of this vault and its trash beside it. */
async function sessionDirs(vault: string): Promise<{ dir: string; trash: string }[]> {
    return claudeProjectDirs(await vaultPaths(vault)).map(dir => ({
        dir,
        trash: join(dir, CHAT_TRASH_DIR),
    }))
}

/** Move `<id>.jsonl` and its `<id>/` subagent folder from one directory to another. Returns whether
 *  the session file moved. The move stamps the file's mtime, which the trash purge reads. */
async function moveSession(id: string, from: string, to: string): Promise<boolean> {
    const file = join(from, `${id}.jsonl`)
    if (!existsSync(file)) return false
    await mkdir(to, { recursive: true })
    await rename(file, join(to, `${id}.jsonl`))
    const now = new Date()
    await utimes(join(to, `${id}.jsonl`), now, now).catch(() => {})
    if (existsSync(join(from, id))) await rename(join(from, id), join(to, id))
    return true
}

/**
 * Remove for good every trashed chat older than {@link CHAT_TRASH_TTL_MS}: its session file, its
 * subagent folder and its `chatVisibility` entry. Runs on every delete and restore.
 */
export async function purgeChatTrash(vault: string, now = Date.now()): Promise<void> {
    const gone: string[] = []
    for (const { trash } of await sessionDirs(vault)) {
        let names: string[]
        try {
            names = await readdir(trash)
        } catch {
            continue
        }
        for (const name of names) {
            if (!name.endsWith('.jsonl')) continue
            const id = name.slice(0, -'.jsonl'.length)
            const at = await stat(join(trash, name)).then(s => s.mtimeMs, () => now)
            if (now - at < CHAT_TRASH_TTL_MS) continue
            await rm(join(trash, name), { force: true })
            await rm(join(trash, id), { recursive: true, force: true })
            gone.push(id)
        }
    }
    if (gone.length)
        await setChatVisibilityEntries(vault, gone.map(id => [id, undefined] as const))
}

/**
 * Delete these chats: each session file and subagent folder moves to the trash beside it, where
 * {@link restoreChats} can put it back until {@link purgeChatTrash} removes it. The chat's
 * not-yet-dreamed transcript note goes at once. An id with no session is skipped. Returns the ids
 * deleted, which the undo hands back.
 */
export async function deleteChats(
    vault: string,
    sessionIds: readonly string[],
): Promise<string[]> {
    await purgeChatTrash(vault)
    const dirs = await sessionDirs(vault)
    const deleted: string[] = []
    for (const id of new Set(sessionIds)) {
        if (!/^[\w-]+$/.test(id)) continue
        for (const { dir, trash } of dirs)
            if (await moveSession(id, dir, trash)) {
                deleted.push(id)
                break
            }
    }
    if (deleted.length === 0) return []
    await removeAutoNotes(memoryDirOf(vault), deleted)
    invalidateChatVisibility()
    return deleted
}

/** Put deleted chats back from the trash. Returns how many came back. */
export async function restoreChats(
    vault: string,
    sessionIds: readonly string[],
): Promise<number> {
    const dirs = await sessionDirs(vault)
    let restored = 0
    for (const id of new Set(sessionIds)) {
        if (!/^[\w-]+$/.test(id)) continue
        for (const { dir, trash } of dirs)
            if (await moveSession(id, trash, dir)) {
                restored++
                break
            }
    }
    if (restored) invalidateChatVisibility()
    return restored
}

/** Delete every chat in `scope` (the history dialog's you / daemon / all). Returns the ids. */
export async function deleteChatsInScope(
    vault: string,
    scope: ChatScope,
): Promise<string[]> {
    const all: string[] = []
    // The listing scans a bounded window of the store, so repeat until a pass deletes nothing.
    for (;;) {
        const ids = await listChatSessionIdsInScope(vault, scope)
        const gone = ids.length ? await deleteChats(vault, ids) : []
        all.push(...gone)
        if (gone.length === 0) return all
    }
}
