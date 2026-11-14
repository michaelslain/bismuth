// core/src/chatProviders/opencode/opencodeHistory.ts
// opencode chats in the chat history beside Claude Code's: list a vault's opencode sessions, search
// their text, and delete them with the same undo window Claude chats get. Reads go through the
// shared opencode 2 server (`GET /api/session?directory=…`); an opencode 1 install or no opencode
// lists nothing. A deleted session waits CHAT_TRASH_MS before opencode deletes it, hidden from the
// list meanwhile, so `restore` can put it back; a restart inside that window leaves it undeleted.
import { whichBinary } from '../../claudeWhich'
import { matchChatSession, type ChatFrame, type ChatSearchHit } from '../../chat'
import { ensureOpencodeServer } from './opencodeServer'
import { translateOpencodeSessionMessages } from './opencodeTranslate'

/** How long a deleted opencode chat can be restored, matching the Claude chat trash. */
export const OPENCODE_TRASH_MS = 10 * 60 * 1000

/** An opencode session id: what tells a history id apart from a Claude Code session's UUID. */
export function isOpencodeSessionId(id: string): boolean {
    return /^ses_[\w-]+$/.test(id)
}

export type OpencodeChatRow = {
    sessionId: string
    summary: string
    lastModified: number
    origin: 'user'
    provider: 'opencode'
}

/** A raw `GET /api/session` entry as a history row, or null for a subagent's child session or an
 *  entry missing its id. Pure. */
export function opencodeChatRow(raw: unknown): OpencodeChatRow | null {
    const s = raw as {
        id?: unknown
        title?: unknown
        parentID?: unknown
        time?: { created?: unknown; updated?: unknown }
    }
    if (typeof s?.id !== 'string' || !isOpencodeSessionId(s.id)) return null
    if (typeof s.parentID === 'string' && s.parentID) return null
    const updated =
        typeof s.time?.updated === 'number'
            ? s.time.updated
            : typeof s.time?.created === 'number'
              ? s.time.created
              : 0
    return {
        sessionId: s.id,
        summary: typeof s.title === 'string' && s.title ? s.title : 'opencode chat',
        lastModified: updated,
        origin: 'user',
        provider: 'opencode',
    }
}

const trash = new Map<string, ReturnType<typeof setTimeout>>()

async function v2Server() {
    const bin = whichBinary('opencode')
    if (!bin) return null
    const server = await ensureOpencodeServer(bin).catch(() => null)
    return server?.version === 2 ? server : null
}

/** The newest `limit` opencode chats started in `cwd`, minus those waiting in the trash. Tolerant:
 *  any failure lists nothing. */
export async function listOpencodeChats(
    cwd: string,
    limit = 50,
): Promise<OpencodeChatRow[]> {
    try {
        const server = await v2Server()
        if (!server) return []
        const raw = await server.client.sessions(cwd, limit + trash.size)
        return raw
            .map(opencodeChatRow)
            .filter((r): r is OpencodeChatRow => !!r && !trash.has(r.sessionId))
            .slice(0, limit)
    } catch {
        return []
    }
}

/** The user and assistant text of a replayed session, for search. Pure. */
export function searchTexts(frames: ChatFrame[]): string[] {
    const out: string[] = []
    for (const f of frames)
        if (f.type === 'user-message' || f.type === 'assistant-text')
            if (f.text.trim()) out.push(f.text)
    return out
}

/** opencode chats in `cwd` whose title or text matches `query` (matchChatSession's rule), newest
 *  first, each tagged with its provider. Scans the newest `limit` chats. */
export async function searchOpencodeChats(
    cwd: string,
    query: string,
    limit = 100,
): Promise<(ChatSearchHit & { provider: 'opencode' })[]> {
    if (!query.trim()) return []
    const server = await v2Server()
    if (!server) return []
    const rows = await listOpencodeChats(cwd, limit)
    const hits: (ChatSearchHit & { provider: 'opencode' })[] = []
    await Promise.all(
        rows.map(async r => {
            let texts: string[] = []
            try {
                texts = searchTexts(
                    translateOpencodeSessionMessages(
                        await server.client.messages(r.sessionId),
                    ),
                )
            } catch {
                texts = []
            }
            const hit = matchChatSession({ ...r, texts }, query)
            if (hit) hits.push({ ...hit, provider: 'opencode' })
        }),
    )
    return hits.sort((a, b) => b.lastModified - a.lastModified)
}

/** Delete opencode chats after the trash window; returns the ids taken. */
export function trashOpencodeChats(ids: string[]): string[] {
    const taken = ids.filter(isOpencodeSessionId)
    for (const id of taken) {
        clearTimeout(trash.get(id))
        const timer = setTimeout(() => {
            trash.delete(id)
            void v2Server()
                .then(s => s?.client.deleteSession(id))
                .catch(() => {})
        }, OPENCODE_TRASH_MS)
        // A pending delete never keeps a process alive on its own.
        ;(timer as { unref?: () => void }).unref?.()
        trash.set(id, timer)
    }
    return taken
}

/** Take opencode chats back out of the trash; returns the ids restored. */
export function restoreOpencodeChats(ids: string[]): string[] {
    const back = ids.filter(id => trash.has(id))
    for (const id of back) {
        clearTimeout(trash.get(id))
        trash.delete(id)
    }
    return back
}
