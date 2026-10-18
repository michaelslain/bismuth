// memory/src/chatVisibility.ts
// AI visibility for past chats, the chat-log twin of a note's `visibility:` (docs/vault/visibility.md).
// A chat log is the agent CLI's own session file (`<config>/projects/<encoded vault>/<id>.jsonl`), so
// it has no frontmatter: its level lives in the vault's `.settings`, beside `folderVisibility`:
//
//   chatVisibility:
//     default: hidden      # every chat without a level of its own (absent = all)
//     <session id>: all    # one chat's own level, which wins over the default
//
// The same three levels and the same resolution as a note inside a folder: a chat's own level wins,
// else the default, else `all`. Shared by core (deny list, routes, chat capture), the daemon's deny
// list, the relay's transcript capture and the `bismuth history` command.
import { existsSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { encodeProjectDir } from './sessionHistory'

export type ChatVisibility = 'all' | 'chat-only' | 'hidden'
export type ChatVisibilityChannel = 'chat' | 'daemon'

/** The `.settings` key holding the map, and the map key holding the default. */
export const CHAT_VISIBILITY_KEY = 'chatVisibility'
export const CHAT_DEFAULT_KEY = 'default'

export interface ChatVisibilityRules {
    default: ChatVisibility
    /** Every chat's own level, `all` included (an explicit `all` beats a restricting default). */
    sessions: Record<string, ChatVisibility>
}

export type ChatVisibilityResult =
    | { ok: true; rules: ChatVisibilityRules }
    | { ok: false; reason: string }

export const NO_CHAT_RULES: ChatVisibilityRules = { default: 'all', sessions: {} }

export function isChatVisibility(v: unknown): v is ChatVisibility {
    return v === 'all' || v === 'chat-only' || v === 'hidden'
}

/**
 * The rules from a parsed `.settings` document. Fails closed like `folderVisibility`: a
 * `chatVisibility` that is not a map, or holds any value other than all/chat-only/hidden, is an
 * error, never an empty map — an empty map would silently un-hide every chat it listed.
 */
export function readChatVisibilityFrom(doc: unknown): ChatVisibilityResult {
    if (doc === null || doc === undefined) return { ok: true, rules: NO_CHAT_RULES }
    if (typeof doc !== 'object' || Array.isArray(doc))
        return { ok: true, rules: NO_CHAT_RULES }
    const raw = (doc as Record<string, unknown>)[CHAT_VISIBILITY_KEY]
    if (raw === undefined || raw === null) return { ok: true, rules: NO_CHAT_RULES }
    if (typeof raw !== 'object' || Array.isArray(raw))
        return {
            ok: false,
            reason: '.settings chatVisibility must be a map of chat id → all|chat-only|hidden',
        }
    const rules: ChatVisibilityRules = { default: 'all', sessions: {} }
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!isChatVisibility(v))
            return {
                ok: false,
                reason: '.settings a chatVisibility entry is not all, chat-only or hidden',
            }
        if (k === CHAT_DEFAULT_KEY) rules.default = v
        else rules.sessions[k] = v
    }
    return { ok: true, rules }
}

/** Read the rules from `<vault>/.settings`. An absent file restricts nothing; a present file that
 *  does not parse is an error (see {@link readChatVisibilityFrom}). */
export async function readChatVisibility(vault: string): Promise<ChatVisibilityResult> {
    let text: string
    try {
        text = await readFile(join(vault, '.settings'), 'utf8')
    } catch {
        return { ok: true, rules: NO_CHAT_RULES }
    }
    let doc: unknown
    try {
        doc = parseYaml(text)
    } catch (e) {
        return {
            ok: false,
            reason: `.settings is not valid YAML (${e instanceof Error ? e.message : String(e)})`,
        }
    }
    return readChatVisibilityFrom(doc)
}

/** A chat's effective level: its own, else the default. */
export function resolveChatVisibility(
    sessionId: string,
    rules: ChatVisibilityRules,
): ChatVisibility {
    return rules.sessions[sessionId] ?? rules.default
}

export function isChatVisibleTo(
    level: ChatVisibility,
    channel: ChatVisibilityChannel,
): boolean {
    if (level === 'all') return true
    return level === 'chat-only' && channel === 'chat'
}

/** Where a deleted chat waits for its undo, inside its own session directory: the agent CLI lists
 *  only `<id>.jsonl` at the top level, so a trashed chat drops out of every listing. */
export const CHAT_TRASH_DIR = '.bismuth-trash'

/** The agent CLI's session directories for a vault, one per spelling of its root (the session's cwd
 *  may be the canonical path or the one it was opened as). */
export function claudeProjectDirs(vaultPaths: readonly string[]): string[] {
    const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
    return [
        ...new Set(vaultPaths.map(p => join(config, 'projects', encodeProjectDir(p)))),
    ]
}

/**
 * Every file of every chat whose level hides it from `channel`: its `<id>.jsonl` and, when present,
 * its `<id>/` subagent-transcript folder. Empty when no rule restricts the channel, so a vault
 * without chat rules adds nothing to a deny list. A chat started after this call is not listed;
 * the next call (every daemon message, every chat re-gate) picks it up.
 */
export async function restrictedChatFiles(
    vaultPaths: readonly string[],
    rules: ChatVisibilityRules,
    channel: ChatVisibilityChannel,
): Promise<string[]> {
    const restricts = (l: ChatVisibility) => !isChatVisibleTo(l, channel)
    if (!restricts(rules.default) && !Object.values(rules.sessions).some(restricts))
        return []
    const out: string[] = []
    // A deleted chat waiting in the trash for its undo keeps its level, so it is denied there too.
    const dirs = claudeProjectDirs(vaultPaths).flatMap(d => [d, join(d, CHAT_TRASH_DIR)])
    for (const dir of dirs) {
        let names: string[]
        try {
            names = await readdir(dir)
        } catch {
            continue
        }
        for (const name of names) {
            if (!name.endsWith('.jsonl')) continue
            const id = name.slice(0, -'.jsonl'.length)
            if (!restricts(resolveChatVisibility(id, rules))) continue
            out.push(join(dir, name))
            if (existsSync(join(dir, id))) out.push(join(dir, id))
        }
    }
    return out
}

/** The memory note a chat's transcript was captured into (`writeAutoNote` names it
 *  `auto-<timestamp>-<first 8 of the id>`). */
export function isAutoNoteFor(fileName: string, sessionId: string): boolean {
    return (
        fileName.startsWith('auto-') &&
        fileName.endsWith(`-${sessionId.slice(0, 8)}.md`)
    )
}

/**
 * Remove the not-yet-dreamed transcript notes of these chats from a memory dir, so a chat hidden
 * from the daemon (or deleted) never reaches the dream. Facts the dream already folded into other
 * notes stay, as with a note hidden after it was read. Returns how many notes were removed.
 */
export async function removeAutoNotes(
    memoryDir: string,
    sessionIds: readonly string[],
): Promise<number> {
    if (sessionIds.length === 0) return 0
    let names: string[]
    try {
        names = await readdir(memoryDir)
    } catch {
        return 0
    }
    let removed = 0
    for (const name of names) {
        if (!sessionIds.some(id => isAutoNoteFor(name, id))) continue
        await rm(join(memoryDir, name), { force: true })
        removed++
    }
    return removed
}

/** What the history list shows for one chat: its resolved level (omitted for `all`) and its own
 *  entry (omitted when it inherits the default). */
export function chatVisibilityFields(
    sessionId: string,
    rules: ChatVisibilityRules,
): { visibility?: 'chat-only' | 'hidden'; ownVisibility?: ChatVisibility } {
    const own = rules.sessions[sessionId]
    const resolved = resolveChatVisibility(sessionId, rules)
    return {
        ...(resolved === 'all' ? {} : { visibility: resolved }),
        ...(own === undefined ? {} : { ownVisibility: own }),
    }
}

/** Every chat id with a session file for this vault, from the agent CLI's session directories. */
export async function listChatSessionIds(
    vaultPaths: readonly string[],
): Promise<string[]> {
    const ids = new Set<string>()
    for (const dir of claudeProjectDirs(vaultPaths)) {
        let names: string[]
        try {
            names = await readdir(dir)
        } catch {
            continue
        }
        for (const name of names)
            if (name.endsWith('.jsonl')) ids.add(name.slice(0, -'.jsonl'.length))
    }
    return [...ids]
}
