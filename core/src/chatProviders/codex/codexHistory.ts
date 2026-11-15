// core/src/chatProviders/codex/codexHistory.ts
// Codex chats in the chat history beside Claude Code's and opencode's: list a vault's Codex threads,
// search their text, replay one, and delete them with the same undo window other chats get. Codex
// keeps each thread as a rollout file, `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`
// (CODEX_HOME defaults to `~/.codex`), one JSON record per line:
//   - line 1 is `session_meta`, whose payload carries the thread `id`, its `cwd` and `thread_source`
//     (`user`, or `subagent` for a thread Codex spawned itself);
//   - each message is an `event_msg` record: codex 0.158 writes `item_completed` with an item of type
//     `UserMessage` (the typed text only, without the AGENTS.md and environment blocks codex injects)
//     or `AgentMessage`; earlier releases write `user_message` / `agent_message` with a `message`.
// `session_index.jsonl` beside `sessions/` names a thread (`thread_name`) once Codex titled it.
// Verified against codex-cli 0.158.0-alpha (the ChatGPT app's bundled copy): threads from
// `codex exec` and from the Codex desktop app.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
    matchChatSession,
    stripEditorContext,
    type ChatFrame,
    type ChatSearchHit,
} from '../../chat'
import { eraseCodexThread } from '../privateErase'
import { titleFromPrompt } from '../titleFromPrompt'

/** How long a deleted Codex chat can be restored, matching the Claude chat trash. */
export const CODEX_TRASH_MS = 10 * 60 * 1000

/** A Codex thread id: a version 7 UUID. Claude Code's session ids are version 4, so the version
 *  digit tells the two apart. */
export function isCodexThreadId(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

export type CodexChatRow = {
    sessionId: string
    summary: string
    lastModified: number
    origin: 'user'
    provider: 'codex'
}

/** The parts of one rollout file the history needs. */
export type CodexRollout = {
    id: string
    cwd: string
    subagent: boolean
    frames: ChatFrame[]
}

function codexHome(env: Record<string, string | undefined> = process.env): string {
    return env.CODEX_HOME || join(homedir(), '.codex')
}

const record = (line: string): Record<string, unknown> | null => {
    try {
        const v = JSON.parse(line)
        return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
    } catch {
        return null
    }
}

const textOf = (content: unknown): string =>
    Array.isArray(content)
        ? content
              .map(c =>
                  c && typeof (c as { text?: unknown }).text === 'string'
                      ? (c as { text: string }).text
                      : '',
              )
              .join('')
        : ''

/** One rollout file's text as a thread: its meta and its user and assistant messages in order, or
 *  null when its first line is not `session_meta`. Pure. */
export function parseCodexRollout(text: string): CodexRollout | null {
    const lines = text.split('\n')
    const meta = record(lines[0] ?? '')
    const p = meta?.payload as Record<string, unknown> | undefined
    if (meta?.type !== 'session_meta' || typeof p?.id !== 'string') return null
    const frames: ChatFrame[] = []
    for (const line of lines.slice(1)) {
        if (!line.includes('"event_msg"')) continue
        const r = record(line)
        const e = r?.payload as Record<string, unknown> | undefined
        if (r?.type !== 'event_msg' || !e) continue
        let role: 'user' | 'assistant' | null = null
        let body = ''
        if (e.type === 'item_completed') {
            const item = e.item as { type?: unknown; content?: unknown } | undefined
            if (item?.type === 'UserMessage') role = 'user'
            else if (item?.type === 'AgentMessage') role = 'assistant'
            body = textOf(item?.content)
        } else if (e.type === 'user_message' || e.type === 'agent_message') {
            role = e.type === 'user_message' ? 'user' : 'assistant'
            body = typeof e.message === 'string' ? e.message : ''
        }
        if (!role) continue
        if (role === 'user') {
            const clean = stripEditorContext(body).trim()
            if (clean) frames.push({ type: 'user-message', text: clean })
        } else if (body.trim()) frames.push({ type: 'assistant-text', text: body })
    }
    return {
        id: p.id,
        cwd: typeof p.cwd === 'string' ? p.cwd : '',
        subagent: p.thread_source === 'subagent',
        frames,
    }
}

/** Every rollout file under `<root>/<dir>` (`sessions`, dated folders, or the flat
 *  `archived_sessions`), newest day first. */
function rolloutFiles(root: string, dir = 'sessions'): string[] {
    const out: string[] = []
    const walk = (dir: string) => {
        let names: string[]
        try {
            names = readdirSync(dir).sort().reverse()
        } catch {
            return
        }
        for (const n of names) {
            const p = join(dir, n)
            if (n.startsWith('rollout-') && n.endsWith('.jsonl')) out.push(p)
            else if (/^\d+$/.test(n)) walk(p)
        }
    }
    walk(join(root, dir))
    return out
}

/** Thread names from `session_index.jsonl`, the last line for an id winning. */
function threadNames(root: string): Map<string, string> {
    const names = new Map<string, string>()
    let text = ''
    try {
        text = readFileSync(join(root, 'session_index.jsonl'), 'utf8')
    } catch {
        return names
    }
    for (const line of text.split('\n')) {
        const r = record(line)
        if (typeof r?.id === 'string' && typeof r.thread_name === 'string' && r.thread_name)
            names.set(r.id, r.thread_name)
    }
    return names
}

const parsed = new Map<string, { mtime: number; rollout: CodexRollout | null }>()

/** A rollout file parsed, cached until its mtime changes. */
function readRollout(path: string, mtime: number): CodexRollout | null {
    const hit = parsed.get(path)
    if (hit && hit.mtime === mtime) return hit.rollout
    let rollout: CodexRollout | null = null
    try {
        rollout = parseCodexRollout(readFileSync(path, 'utf8'))
    } catch {
        rollout = null
    }
    parsed.set(path, { mtime, rollout })
    return rollout
}

const real = (p: string) => {
    try {
        return realpathSync(p)
    } catch {
        return p
    }
}

const trash = new Map<string, ReturnType<typeof setTimeout>>()

type Thread = { row: CodexChatRow; frames: ChatFrame[] }

/** The user's own Codex threads started in `cwd`, newest first, minus those in the trash. */
function threads(cwd: string, env = process.env): Thread[] {
    const root = codexHome(env)
    if (!existsSync(join(root, 'sessions'))) return []
    const want = real(cwd)
    const names = threadNames(root)
    const out: Thread[] = []
    for (const path of rolloutFiles(root)) {
        let mtime = 0
        try {
            mtime = statSync(path).mtimeMs
        } catch {
            continue
        }
        const r = readRollout(path, mtime)
        if (!r || r.subagent || trash.has(r.id) || !isCodexThreadId(r.id)) continue
        if (r.cwd !== cwd && real(r.cwd) !== want) continue
        const first = r.frames.find(f => f.type === 'user-message')
        out.push({
            row: {
                sessionId: r.id,
                summary:
                    names.get(r.id) ||
                    (first?.type === 'user-message' ? titleFromPrompt(first.text) : '') ||
                    'codex chat',
                lastModified: Math.round(mtime),
                origin: 'user',
                provider: 'codex',
            },
            frames: r.frames,
        })
    }
    return out.sort((a, b) => b.row.lastModified - a.row.lastModified)
}

/** The newest `limit` Codex chats started in `cwd`. Tolerant: any failure lists nothing. */
export async function listCodexChats(
    cwd: string,
    limit = 50,
    env = process.env,
): Promise<CodexChatRow[]> {
    try {
        return threads(cwd, env)
            .slice(0, limit)
            .map(t => t.row)
    } catch {
        return []
    }
}

/** Codex chats in `cwd` whose title or text matches `query` (matchChatSession's rule), newest
 *  first, each tagged with its provider. */
export async function searchCodexChats(
    cwd: string,
    query: string,
    env = process.env,
): Promise<(ChatSearchHit & { provider: 'codex' })[]> {
    if (!query.trim()) return []
    const hits: (ChatSearchHit & { provider: 'codex' })[] = []
    try {
        for (const t of threads(cwd, env)) {
            const texts = t.frames.map(f =>
                f.type === 'user-message' || f.type === 'assistant-text' ? f.text : '',
            )
            const hit = matchChatSession({ ...t.row, texts }, query)
            if (hit) hits.push({ ...hit, provider: 'codex' })
        }
    } catch {
        return []
    }
    return hits
}

/** A Codex thread's messages, for reopening it from history. Tolerant: an unknown id yields []. */
export async function codexHistoryFrames(
    threadId: string,
    env = process.env,
): Promise<ChatFrame[]> {
    if (!isCodexThreadId(threadId)) return []
    const root = codexHome(env)
    const path = [...rolloutFiles(root), ...rolloutFiles(root, 'archived_sessions')].find(p =>
        p.endsWith(`-${threadId}.jsonl`),
    )
    if (!path) return []
    try {
        return parseCodexRollout(readFileSync(path, 'utf8'))?.frames ?? []
    } catch {
        return []
    }
}

/** Delete Codex chats after the trash window (eraseCodexThread: the rollout, its index line and its
 *  rows in Codex's databases); returns the ids taken. */
export function trashCodexChats(ids: string[], cwd: string): string[] {
    const taken = ids.filter(isCodexThreadId)
    for (const id of taken) {
        clearTimeout(trash.get(id))
        const timer = setTimeout(() => {
            trash.delete(id)
            void eraseCodexThread({
                sessionId: id,
                chatId: id,
                cwd,
                startedAt: 0,
                env: process.env,
            }).catch(() => {})
        }, CODEX_TRASH_MS)
        // A pending delete never keeps a process alive on its own.
        ;(timer as { unref?: () => void }).unref?.()
        trash.set(id, timer)
    }
    return taken
}

/** Take Codex chats back out of the trash; returns the ids restored. */
export function restoreCodexChats(ids: string[]): string[] {
    const back = ids.filter(id => trash.has(id))
    for (const id of back) {
        clearTimeout(trash.get(id))
        trash.delete(id)
    }
    return back
}
