// app/src/closedSession.ts
// Persisted "recently closed window sessions" for Reopen Closed Tab (Cmd+Shift+T).
//
// Each window keeps an in-memory stack of single tabs it closed this session (App.tsx).
// That stack dies with the window — so when a WHOLE window is closed (Tauri
// onCloseRequested) we instead stash its serialized tab layout HERE, in localStorage,
// which is shared across every window of the origin and survives a relaunch. The window's
// own per-window tabs key is cleared at the same time so its tabs don't auto-restore on
// next launch; the user brings them back explicitly with Cmd+Shift+T (reopenClosedTab
// falls back to this stack once the in-memory single-tab stack is empty).
//
// Values are opaque serializeTabs() blobs (panes.ts) — this module never parses them.

import { readArray, writeCache } from './viewCache'

const KEY = 'bismuth-closed-sessions-v1'
const CAP = 10

/** Pure stack push with a cap (oldest dropped). Exported for unit testing. */
export function pushSession(
    stack: string[],
    item: string,
    cap = CAP,
): string[] {
    const next = [...stack, item]
    return next.length > cap ? next.slice(next.length - cap) : next
}

const read = (): string[] =>
    readArray(KEY, (x): x is string => typeof x === 'string')

// a blocked/full store just means reopen-across-windows isn't available this run
const write = (stack: string[]): void => writeCache(KEY, stack)

/** Stash a closed window's serialized tab layout (most-recent last). */
export function pushClosedSession(serializedTabs: string): void {
    write(pushSession(read(), serializedTabs))
}

/** Pop the most recently closed window session, or null if there are none. */
export function popClosedSession(): string | null {
    const stack = read()
    const last = stack.pop()
    if (last === undefined) return null
    write(stack)
    return last
}
