// app/src/chat/chatSessionPrefs.ts
// The chat session's transient localStorage preferences — last permission mode, last model (per chat
// + global fallback, provider-scoped), this tab's provider choice, last effort. Moved out of
// ChatView.tsx so the session controller (chatSession.ts) and its tests share one copy. Pure over an
// injected Storage-like object: pass `localStorage` in the app, a Map-backed stand-in in tests. Every
// read and write swallows a throwing/absent storage, because a blocked localStorage must never break
// the chat — the in-memory signals in the session still drive the UI.
import {
    DEFAULT_PERMISSION_MODE,
    sanitizePermissionMode,
} from '../chatPermissionMode'
import {
    modelStorageKeys,
    providerStorageKey,
    type ChatProviderChoice,
} from '../chatProvider'

export type StorageLike = {
    getItem: (key: string) => string | null
    setItem: (key: string, value: string) => void
}

// The last permission mode the user picked in ANY chat (FEATURE #35: "permissions keep resetting to
// default"). Falls back to DEFAULT_PERMISSION_MODE (Bypass) on a first run / bad value.
export const LAST_MODE_KEY = 'bismuth.chat.lastPermissionMode'

// The last reasoning-effort level the user picked in ANY chat (FEATURE #63). "" = never chosen,
// which leaves the model/CLI's own default untouched.
export const LAST_EFFORT_KEY = 'bismuth.chat.lastEffort'

export function readLastMode(storage: StorageLike | null): string {
    try {
        return sanitizePermissionMode(storage?.getItem(LAST_MODE_KEY) ?? null)
    } catch {
        return DEFAULT_PERMISSION_MODE
    }
}

export function rememberMode(storage: StorageLike | null, mode: string): void {
    try {
        storage?.setItem(LAST_MODE_KEY, mode)
    } catch {
        /* storage unavailable — the in-memory signal still drives the header */
    }
}

/** The last model used in THIS chat (per-chat key), else the global last-model for brand-new chats.
 *  PROVIDER-SCOPED (chatProvider.ts modelStorageKeys) so a Claude id never seeds an opencode `-m`. */
export function readLastModel(
    storage: StorageLike | null,
    provider: ChatProviderChoice,
    chatId?: string,
): string {
    try {
        if (!storage) return ''
        const keys = modelStorageKeys(provider, chatId ?? '')
        if (chatId) {
            const perChat = storage.getItem(keys.perChat)
            if (perChat) return perChat
        }
        return storage.getItem(keys.global) ?? ''
    } catch {
        return ''
    }
}

/** `global: false` (adoptions — a resumed session's own model, live drift) updates only this chat's
 *  key; the default / `global: true` (explicit picks, a fresh session's adopted default) also updates
 *  the global fallback brand-new chats seed from. An empty model is never written. */
export function rememberModel(
    storage: StorageLike | null,
    provider: ChatProviderChoice,
    chatId: string,
    model: string,
    opts?: { global?: boolean },
): void {
    if (!model) return
    try {
        const keys = modelStorageKeys(provider, chatId)
        storage?.setItem(keys.perChat, model)
        if (opts?.global !== false) storage?.setItem(keys.global, model)
    } catch {
        /* storage unavailable — the in-memory signal still updates the header */
    }
}

/** This chat TAB's explicit provider choice; null = never chosen (the vault setting decides). */
export function readProviderChoice(
    storage: StorageLike | null,
    chatId: string,
): ChatProviderChoice | null {
    try {
        const raw = storage?.getItem(providerStorageKey(chatId)) ?? null
        return raw === 'claude' || raw === 'opencode' ? raw : null
    } catch {
        return null
    }
}

export function rememberProvider(
    storage: StorageLike | null,
    chatId: string,
    provider: ChatProviderChoice,
): void {
    try {
        storage?.setItem(providerStorageKey(chatId), provider)
    } catch {
        /* storage unavailable — the in-memory signal still drives the header */
    }
}

export function readLastEffort(storage: StorageLike | null): string {
    try {
        return storage?.getItem(LAST_EFFORT_KEY) ?? ''
    } catch {
        return ''
    }
}

export function rememberEffort(
    storage: StorageLike | null,
    level: string,
): void {
    if (!level) return
    try {
        storage?.setItem(LAST_EFFORT_KEY, level)
    } catch {
        /* storage unavailable — the in-memory signal still drives the header */
    }
}

/** The browser's localStorage, or null where touching it throws (sandboxed iframe, blocked site data). */
export function browserStorage(): StorageLike | null {
    try {
        return globalThis.localStorage ?? null
    } catch {
        return null
    }
}
