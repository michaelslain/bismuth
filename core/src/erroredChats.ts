/**
 * core/src/erroredChats.ts — the list of agent sessions that marked themselves as errored.
 *
 * A Bismuth agent session (a daemon cron, inbox page or daemon chat, or an in-app chat) that hits
 * trouble with Bismuth itself runs `bismuth daemon errored --reason "<why>"`. Each mark is one JSON
 * line in `<vault>/.daemon/logs/.errored-chats.jsonl`: the session id, the reason, the channel the
 * session ran under and when. It is a debugging list for reviewing sessions after the fact, so
 * nothing in the app reads or shows it; the dot keeps it out of the file tree.
 *
 * Appending a whole line per mark keeps concurrent writers from corrupting each other, the same
 * discipline as the activity log (daemonActivity.ts). The reader never throws: a missing file or
 * a malformed line degrades to fewer entries.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type ErroredChat = {
    ts: string
    sessionId: string
    reason: string
    /** `daemon`, `chat`, or absent for a session Bismuth did not start (a terminal). */
    channel?: string
}

export const ERRORED_CHATS_FILE = '.errored-chats.jsonl'

export function erroredChatsPath(daemonDir: string): string {
    return join(daemonDir, 'logs', ERRORED_CHATS_FILE)
}

/** Append one mark. `now` is injectable for tests. */
export function markErroredChat(
    daemonDir: string,
    mark: Omit<ErroredChat, 'ts'>,
    now: Date = new Date(),
): ErroredChat {
    const entry: ErroredChat = { ts: now.toISOString(), ...mark }
    if (!entry.channel) delete entry.channel
    mkdirSync(join(daemonDir, 'logs'), { recursive: true })
    appendFileSync(erroredChatsPath(daemonDir), JSON.stringify(entry) + '\n')
    return entry
}

/** Every mark, oldest first; `since` (an ISO instant) keeps only marks after it. */
export function readErroredChats(
    daemonDir: string,
    opts: { since?: string } = {},
): ErroredChat[] {
    let text: string
    try {
        text = readFileSync(erroredChatsPath(daemonDir), 'utf8')
    } catch {
        return []
    }
    const floor = opts.since ? Date.parse(opts.since) : NaN
    const out: ErroredChat[] = []
    for (const line of text.split('\n')) {
        if (!line.trim()) continue
        let e: unknown
        try {
            e = JSON.parse(line)
        } catch {
            continue
        }
        if (!e || typeof e !== 'object') continue
        const { ts, sessionId, reason, channel } = e as Record<string, unknown>
        if (typeof ts !== 'string' || typeof sessionId !== 'string') continue
        if (!Number.isNaN(floor) && !(Date.parse(ts) > floor)) continue
        out.push({
            ts,
            sessionId,
            reason: typeof reason === 'string' ? reason : '',
            ...(typeof channel === 'string' ? { channel } : {}),
        })
    }
    return out
}
