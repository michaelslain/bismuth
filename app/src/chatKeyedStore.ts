// app/src/chatKeyedStore.ts
// The shared shape behind chatColors.ts / chatSessionStore.ts / chatComputerUse.ts: a chatId-keyed,
// capped, localStorage-persisted list. All three hand-rolled the SAME filter-then-push upsert, the
// SAME reversed-loop newest-wins lookup, the SAME try/catch JSON.parse with an array-of-plain-objects
// type guard, and the SAME try/catch write — this factors that mechanics out so a future change to it
// (e.g. corruption recovery) lands once instead of three times.
//
// Each module keeps its OWN storage key, cap, entry shape and validator strictness, and wraps these
// primitives in its own exported function names/signatures — callers of chatColors/chatSessionStore/
// chatComputerUse see no change at all. That preservation is load-bearing: these keys are real data
// already sitting in users' browsers, so a changed key or shape would silently lose their state.

/** Every store entry is keyed by the chat TAB id (the ::chat:<uuid> content id's suffix). */
export interface ChatKeyedEntry {
    chatId: string
}

/** Pure upsert: drop any existing entry for `chatId`, append the new one (most-recent last), cap the
 *  list (oldest dropped). */
export function upsertEntry<T extends ChatKeyedEntry>(
    list: T[],
    chatId: string,
    entry: T,
    cap: number,
): T[] {
    const next = list.filter(e => e.chatId !== chatId)
    next.push(entry)
    return next.length > cap ? next.slice(next.length - cap) : next
}

/** Pure removal: drop any existing entry for `chatId`, no replacement (a "clear" upsert). */
export function removeEntry<T extends ChatKeyedEntry>(
    list: T[],
    chatId: string,
): T[] {
    return list.filter(e => e.chatId !== chatId)
}

/** Pure lookup: the entry for `chatId`, or undefined. Reads newest-first so a duplicate (shouldn't
 *  happen after upsert, but be defensive) resolves to the most recent. */
export function lookupEntry<T extends ChatKeyedEntry>(
    list: T[],
    chatId: string,
): T | undefined {
    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].chatId === chatId) return list[i]
    }
    return undefined
}

/** One chatId-keyed, capped, localStorage-persisted list: read/write/upsert/lookup over `storageKey`,
 *  validated by the caller's own `isEntry` guard. `cap` is the default passed to `upsert` (callers
 *  that expose their own `cap` parameter, e.g. for unit tests, can still override it per call). */
export function createChatKeyedStore<T extends ChatKeyedEntry>(
    storageKey: string,
    cap: number,
    isEntry: (x: unknown) => x is T,
) {
    function read(): T[] {
        const raw =
            typeof localStorage !== 'undefined'
                ? localStorage.getItem(storageKey)
                : null
        if (!raw) return []
        try {
            const arr = JSON.parse(raw)
            return Array.isArray(arr) ? arr.filter(isEntry) : []
        } catch {
            return []
        }
    }

    function write(list: T[]): void {
        try {
            localStorage.setItem(storageKey, JSON.stringify(list))
        } catch {
            // storage unavailable/full — the caller's in-memory copy still works this run
        }
    }

    return {
        read,
        write,
        upsert: (list: T[], chatId: string, entry: T, c = cap): T[] =>
            upsertEntry(list, chatId, entry, c),
        remove: (list: T[], chatId: string): T[] => removeEntry(list, chatId),
        lookup: (list: T[], chatId: string): T | undefined =>
            lookupEntry(list, chatId),
    }
}
