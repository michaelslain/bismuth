// app/src/chat/chatVisibility.ts
// Pure decisions behind the chat history's visibility menus — no framework imports. Chat logs carry
// the same three levels notes do (FileTree's VISIBILITY_ROWS): a chat's OWN level, else the vault-wide
// chat default, which is what "hide all" sets.
import type { ChatVisibility } from '../api'

export type ChatVisibilityRow = { value: ChatVisibility; label: string }

/** The three levels, in the order the sidebar's Visibility menu lists them. */
export const CHAT_VISIBILITY_ROWS: ChatVisibilityRow[] = [
    { value: 'all', label: 'Visible to Daemon + Chat' },
    { value: 'chat-only', label: 'Chat only' },
    { value: 'hidden', label: 'Hidden from both' },
]

/** What picking `picked` writes for a chat's own entry (`null` = clear it). Picking "Visible" clears
 *  the entry so the chat follows the default again, EXCEPT under a restricting default: clearing
 *  would leave the chat hidden, and an explicit `'all'` is the only way to expose one chat there. */
export function levelToWrite(
    picked: ChatVisibility,
    defaultLevel: ChatVisibility,
): ChatVisibility | null {
    if (picked === 'all' && defaultLevel === 'all') return null
    return picked
}

/** Which row carries the Check. A chat's own entry wins. With none, it follows the default: under
 *  an open default that is the "Visible" row; under a restricting one no row is the chat's own, so
 *  nothing is checked and the disabled `Effective:` row says why. */
export function checkedLevel(
    own: ChatVisibility | undefined,
    defaultLevel: ChatVisibility,
): ChatVisibility | null {
    if (own) return own
    return defaultLevel === 'all' ? 'all' : null
}

/** The disabled first row of the submenu: shown when the chat has no own level and the default
 *  restricts it, naming where the restriction comes from. */
export function effectiveNote(
    own: ChatVisibility | undefined,
    defaultLevel: ChatVisibility,
): string | null {
    if (own || defaultLevel === 'all') return null
    const label = defaultLevel === 'hidden' ? 'Hidden' : 'Chat only'
    return `Effective: ${label} — inherited from the chat default`
}

/** Header-menu label for deleting everything in the dialog's current scope. */
export function deleteAllLabel(scope: 'user' | 'daemon' | 'all'): string {
    if (scope === 'all') return 'Delete every chat'
    return scope === 'daemon' ? 'Delete all daemon chats' : 'Delete all your chats'
}

/** The undo toast after a delete: the chat's title for one, a count for several. */
export function deletedChatsMessage(count: number, title?: string): string {
    if (count === 1) return `deleted chat: ${title?.trim() || 'untitled session'}`
    return `deleted ${count} chats`
}

/** Delete/Backspace on the arrow-key cursor row deletes it. The cursor resets whenever the
 *  query changes, so a live cursor means the user last used the arrows, not the keyboard to type. */
export function isDeleteKeyForRow(
    keyMatches: boolean,
    activeIndex: number,
): boolean {
    return keyMatches && activeIndex >= 0
}

/** Icon for the `Visibility` menu row, by the chat's resolved level (the sidebar's choice). */
export function visibilityMenuIcon(
    resolved: 'chat-only' | 'hidden' | undefined,
): string {
    return resolved === 'hidden'
        ? 'EyeSlash'
        : resolved === 'chat-only'
          ? 'ChatSlash'
          : 'Eye'
}

/** The RESOLVED level a chat carries on the wire: its own entry, else the chat default; omitted
 *  (`undefined`) when that is `all`. Mirrors how a note inherits from its folder. */
export function resolveVisibility(
    own: ChatVisibility | undefined,
    defaultLevel: ChatVisibility,
): 'chat-only' | 'hidden' | undefined {
    const level = own ?? defaultLevel
    return level === 'all' ? undefined : level
}
