// app/src/treeStore.ts
// A module-level cache of the vault file tree (`GET /tree`), kept warm so consumers
// — chiefly the cmd+O Quick Switcher — can render INSTANTLY off the last-known list
// instead of doing a lazy fetch on every open (which flashes an empty/stale list while
// the request is in flight). Pre-warmed on module load and re-fetched on SSE tree
// changes, so the cache tracks the vault without each opener paying the round-trip.
import { createSignal, type Accessor } from "solid-js";
import { api } from "./api";
import { onServerChange } from "./serverVersion";
import type { TreeEntry } from "../../core/src/graph";

// The exact element type `api.tree()` yields, so consumers (QuickSwitcher's isFile/toItem)
// keep type-checking against the real shape.
const [tree, setTree] = createSignal<TreeEntry[]>([]);

// Dedupe concurrent refreshes: a burst of SSE events (or an opener kicking a refresh while
// the boot pre-warm is still in flight) share one in-flight request rather than stacking.
let inflight: Promise<void> | null = null;

/** Reactive accessor for the cached vault tree (last-good on error). */
export const vaultTree: Accessor<TreeEntry[]> = tree;

/**
 * Re-fetch the tree and update the cache. On failure we KEEP the last-good list
 * (a transient backend blip shouldn't blank the Quick Switcher). Concurrent calls
 * collapse onto one request.
 */
export function refreshVaultTree(): Promise<void> {
  if (inflight) return inflight;
  inflight = api
    .tree()
    .then((entries) => {
      setTree(entries);
    })
    .catch(() => {
      // Keep the last-good tree; a dropped/refused fetch must not clear the cache.
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// Pre-warm on module load + stay in sync with the vault. Guarded for non-browser
// (Bun test) contexts where there's no live backend to talk to.
if (typeof window !== "undefined") {
  void refreshVaultTree();
  // Re-fetch whenever the file tree structurally changes. The server sets `dirty.tree`
  // false for content-only edits (no add/rename/delete) — skip those. An absent `dirty`
  // (initial snapshot / fallback poll) means "extent unknown" → refresh to be safe.
  onServerChange((c) => {
    if (c.dirty?.tree !== false) void refreshVaultTree();
  });
}
