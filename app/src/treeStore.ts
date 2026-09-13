// app/src/treeStore.ts
// A module-level cache of the vault file tree (`GET /tree`), kept warm so consumers
// — chiefly the cmd+O Quick Switcher — can render INSTANTLY off the last-known list
// instead of doing a lazy fetch on every open (which flashes an empty/stale list while
// the request is in flight). Pre-warmed on module load and re-fetched on SSE tree
// changes, so the cache tracks the vault without each opener paying the round-trip.
import { createSignal, type Accessor } from 'solid-js'
import { api } from './api'
import { onServerChange, serverVersion } from './serverVersion'
import type { TreeEntry } from '../../core/src/graph'

// The exact element type `api.tree()` yields, so consumers (vaultFileItems' isFile/toItem)
// keep type-checking against the real shape.
const [tree, setTree] = createSignal<TreeEntry[]>([])

// Dedupe concurrent refreshes, version-aware: a burst of calls made at the SAME server
// version (a pile of SSE events, or an opener kicking a refresh while the boot pre-warm is
// still in flight) share one in-flight request. A call made once the version has advanced
// PAST the in-flight request's start version must not resolve early with a response that
// predates the change the caller now knows about — it chains a fresh request after the
// in-flight one settles instead of starting a second one concurrently (which could resolve
// out of order and leave a stale tree behind a newer one that finished first).
let inflight: { version: number; promise: Promise<TreeEntry[]> } | null = null

/** Reactive accessor for the cached vault tree (last-good on error). */
export const vaultTree: Accessor<TreeEntry[]> = tree

/** One `GET /tree` round trip: update the cache on success, keep the last-good tree on
 *  failure (a transient backend blip shouldn't blank the Quick Switcher/file tree) — never
 *  rejects, so a chained caller never has to handle a failure that isn't its own. */
function fetchTree(): Promise<TreeEntry[]> {
    return api
        .tree()
        .then(entries => {
            setTree(entries)
            return entries
        })
        .catch(() => tree())
}

/**
 * Re-fetch the tree and update the cache, returning the resolved entries. Concurrent calls
 * at the same server version collapse onto one request; a call made after the version has
 * advanced past the in-flight request's start version chains a fresh request after it.
 */
export function refreshVaultTree(): Promise<TreeEntry[]> {
    const startVersion = serverVersion()
    if (inflight && inflight.version >= startVersion) return inflight.promise
    const promise = inflight ? inflight.promise.then(fetchTree) : fetchTree()
    const entry = { version: startVersion, promise }
    inflight = entry
    void promise.finally(() => {
        if (inflight === entry) inflight = null
    })
    return promise
}

// Pre-warm on module load + stay in sync with the vault. Guarded for non-browser
// (Bun test) contexts where there's no live backend to talk to.
if (typeof window !== 'undefined') {
    void refreshVaultTree()
    // Re-fetch whenever the file tree structurally changes. The server sets `dirty.tree`
    // false for content-only edits (no add/rename/delete) — skip those. An absent `dirty`
    // (initial snapshot / fallback poll) means "extent unknown" → refresh to be safe.
    onServerChange(c => {
        if (c.dirty?.tree !== false) void refreshVaultTree()
    })
}
