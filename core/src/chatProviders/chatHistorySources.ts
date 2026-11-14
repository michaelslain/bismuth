// core/src/chatProviders/chatHistorySources.ts
// Every backend whose chats the history picker lists, `bismuth chat list` prints and search reaches:
// one source per backend, keyed by its id, each owning its own ids. The chat history routes
// (routes/agents.ts) read only this table, and the catalog's `sessionPicker` flag must match it
// (core/test/chatProviders/backendContract.test.ts), so a backend cannot claim a history it does
// not list, or list one the app hides.
import {
    listChatSessions,
    searchChatSessions,
    type ChatOrigin,
    type ChatScope,
    type ChatSearchHit,
} from '../chat'
import { deleteChats, deleteChatsInScope, restoreChats } from '../chatLogs'
import type { BackendId } from '../agentBackends/catalog'
import {
    isOpencodeSessionId,
    listOpencodeChats,
    restoreOpencodeChats,
    searchOpencodeChats,
    trashOpencodeChats,
} from './opencode/opencodeHistory'

export type ChatHistoryRow = {
    sessionId: string
    summary: string
    lastModified: number
    origin: ChatOrigin
    provider: BackendId
}

export type ChatHistorySource = {
    /** Whether `sessionId` is one of this backend's ids. */
    owns(sessionId: string): boolean
    list(vault: string, scope: ChatScope): Promise<ChatHistoryRow[]>
    search(
        vault: string,
        query: string,
        scope: ChatScope,
    ): Promise<(ChatSearchHit & { provider: BackendId })[]>
    /** Delete chats, undoable by `restore` for the trash window; returns the ids taken. */
    remove(vault: string, ids: string[]): Promise<string[]>
    /** Delete every chat in `scope`; returns the ids. */
    removeScope(vault: string, scope: ChatScope): Promise<string[]>
    /** Restore deleted chats; returns how many came back. */
    restore(vault: string, ids: string[]): Promise<number>
}

const CLAUDE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const CHAT_HISTORY_SOURCES: Partial<Record<BackendId, ChatHistorySource>> = {
    claude: {
        owns: id => CLAUDE_ID.test(id),
        list: async (vault, scope) =>
            (await listChatSessions(vault, undefined, scope)).map(s => ({
                ...s,
                provider: 'claude' as const,
            })),
        search: async (vault, query, scope) =>
            (await searchChatSessions(vault, query, undefined, scope)).map(h => ({
                ...h,
                provider: 'claude' as const,
            })),
        remove: (vault, ids) => deleteChats(vault, ids),
        removeScope: (vault, scope) => deleteChatsInScope(vault, scope),
        restore: (vault, ids) => restoreChats(vault, ids),
    },
    // opencode chats are the user's own: they join the `user` and `all` scopes, never `daemon`.
    opencode: {
        owns: isOpencodeSessionId,
        list: (vault, scope) =>
            scope === 'daemon' ? Promise.resolve([]) : listOpencodeChats(vault),
        search: (vault, query, scope) =>
            scope === 'daemon'
                ? Promise.resolve([])
                : searchOpencodeChats(vault, query),
        remove: async (_, ids) => trashOpencodeChats(ids),
        removeScope: async (vault, scope) =>
            scope === 'daemon'
                ? []
                : trashOpencodeChats(
                      (await listOpencodeChats(vault, 2000)).map(r => r.sessionId),
                  ),
        restore: async (_, ids) => restoreOpencodeChats(ids).length,
    },
}

const sources = () => Object.values(CHAT_HISTORY_SOURCES) as ChatHistorySource[]

/** The newest `limit` chats across every source. */
export async function listAllChats(
    vault: string,
    scope: ChatScope,
    limit = 50,
): Promise<ChatHistoryRow[]> {
    const lists = await Promise.all(
        sources().map(s => s.list(vault, scope).catch(() => [])),
    )
    return lists
        .flat()
        .sort((a, b) => b.lastModified - a.lastModified)
        .slice(0, limit)
}

/** Search hits across every source, newest first. */
export async function searchAllChats(
    vault: string,
    query: string,
    scope: ChatScope,
): Promise<(ChatSearchHit & { provider: BackendId })[]> {
    const lists = await Promise.all(
        sources().map(s => s.search(vault, query, scope).catch(() => [])),
    )
    return lists.flat().sort((a, b) => b.lastModified - a.lastModified)
}

/** The backend whose source owns `sessionId`, or null. */
export function historyOwner(sessionId: string): BackendId | null {
    for (const [id, s] of Object.entries(CHAT_HISTORY_SOURCES))
        if (s?.owns(sessionId)) return id as BackendId
    return null
}

function byOwner(ids: string[]): Map<ChatHistorySource, string[]> {
    const out = new Map<ChatHistorySource, string[]>()
    for (const id of ids) {
        const owner = historyOwner(id)
        const s = owner ? CHAT_HISTORY_SOURCES[owner] : undefined
        if (s) out.set(s, [...(out.get(s) ?? []), id])
    }
    return out
}

/** Delete chats through their owning sources; returns the ids taken. */
export async function removeChats(vault: string, ids: string[]): Promise<string[]> {
    const parts = await Promise.all(
        [...byOwner(ids)].map(([s, own]) => s.remove(vault, own)),
    )
    return parts.flat()
}

/** Delete every chat in `scope` across every source. */
export async function removeChatsInScope(
    vault: string,
    scope: ChatScope,
): Promise<string[]> {
    const parts = await Promise.all(sources().map(s => s.removeScope(vault, scope)))
    return parts.flat()
}

/** Restore deleted chats through their owning sources; returns how many came back. */
export async function restoreAllChats(vault: string, ids: string[]): Promise<number> {
    const counts = await Promise.all(
        [...byOwner(ids)].map(([s, own]) => s.restore(vault, own)),
    )
    return counts.reduce((a, b) => a + b, 0)
}
