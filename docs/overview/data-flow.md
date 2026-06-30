# Data Flow: Reactive Loop, Caching, and Layouts

This document covers the complete reactive pipeline that keeps the Bismuth frontend synchronized with the vault on disk: the file-watch → debounce → change classification → cache invalidation → version bump → SSE broadcast path, the `/version` poll fallback, the server-side cache architecture (`cachedGraph` / `cachedTree` / `cachedRows`), and the backend-precomputed layout system that ships precomputed node positions to the browser. Every claim is grounded in the actual implementation files listed at the bottom.

---

## 1. The Reactive Loop at a Glance

```
fs.watch(vault)
  └─ scheduleVault(filename)          [debounce accumulation]
       └─ arm() → setTimeout(250ms)   [configurable: server.fileWatchDebounceMs]
            └─ classifyVault(paths)   [changeClassifier: fingerprint diff]
                 └─ applyDirty(paths, dirty)
                      ├─ graphCache.invalidate()   [if dirty.graph]
                      ├─ treeCache.invalidate()    [if dirty.tree]
                      ├─ cachedRows = null
                      ├─ cachedTasks = null
                      ├─ version++
                      └─ sse.publish({ version, paths, dirty })
                           └─ EventSource /events → frontend fireChange()
```

The frontend also runs a `/version` poll (5 s normal, 1 s when disconnected) as a belt-and-suspenders fallback for silently-dropped SSE streams.

---

## 2. File Watch and Debounce

### Setting up the watcher

`createServer()` in `core/src/server.ts` calls Node's `fs.watch()` on `cfg.vault` (and optionally on `cfg.memory`) immediately on boot:

```ts
watch(cfg.vault, { recursive: true }, (_event, filename) => {
  if (filename && isHidden(filename)) return;
  scheduleVault(filename ?? undefined);
});
```

Hidden paths (any segment starting with `.`) are dropped immediately — this suppresses `.git/` churn from backup commits, `.trash/` moves, and `.obsidian/` updates, none of which feed the graph or file tree.

Memory-directory changes schedule only a graph rebuild, never a tree rebuild:

```ts
if (memory) dirty.graph = true;
```

### Debounce accumulation (`scheduleVault` / `arm`)

Each watch callback calls `scheduleVault(filename)`, which:

1. Adds the vault-relative path to `pendingVault` (a `Set<string>`).
2. Calls `arm()`, which clears any existing timer and sets a new `setTimeout` for `appConfig.server.fileWatchDebounceMs` (default **250 ms**, min 50, max 2000 — configurable in `settings.yaml`).

When the timer fires, all accumulated paths are processed together in one `classifyVault` call and the pending sets are cleared. **Two edits within the debounce window produce exactly one invalidation event**, not two.

If `filename` is `null` (the OS couldn't identify which file changed), `scheduleVault()` is called without an argument, setting `pendingVaultUnknown = true`. An unknown change forces `dirty = { graph: true, tree: true }` with an empty `paths` array, so consumers treat it as "everything may have changed."

---

## 3. Change Classification (`changeClassifier.ts`)

### Why classification exists

The graph is built only from a note's wikilinks, tags, and frontmatter `icon`. The file tree shows only structural entries plus `icon`. Everything else in a file — prose, task lines, timestamps, status tables — is irrelevant to both. Without classification, every autosave or daemon heartbeat-stamp would trigger a full graph rebuild.

### Fingerprint

`extractFingerprint(content)` computes a three-field struct:

```ts
export interface Fingerprint {
  links: string;   // sorted, deduped wikilink targets, joined by "\n"
  tags:  string;   // sorted, deduped tags (frontmatter + body), joined by "\n"
  icon:  string;   // frontmatter `icon` value, or "" if absent
}
```

The normalization (`norm`) deduplicates and sorts, so reordering `[[A]], [[B]]` to `[[B]], [[A]]` produces an identical fingerprint.

### Dirty flags

`diffFingerprints(prev, next)` returns `{ graph: boolean, tree: boolean }`:

| Condition | `graph` | `tree` |
|-----------|---------|--------|
| `prev` absent (new file) | `true` | `true` |
| `next` is `null` (deleted file) | `true` | `true` |
| `links` or `tags` changed | `true` | `false` |
| `icon` changed | `false` | `true` |
| No structural change | `false` | `false` |

### Stateful tracker

`createChangeTracker()` returns a `ChangeTracker` with a single method:

```ts
classify(paths: string[], read: ReadContent): Promise<Dirty>
```

It fingerprints each path against its stored previous fingerprint, ORs the dirty flags across all changed paths, updates the store, and returns the aggregate. The `ReadContent` callback returns the current file content or `null` for a deleted file.

### `classifyVault` in the server

The server's `classifyVault` wraps the tracker with additional logic:

- **Hidden paths** (`.git/`, `.trash/`, etc.) are skipped before reaching the tracker.
- **`settings.yaml`** forces `{ graph: true, tree: true }` and also reloads `appConfig` (so debounce/heartbeat settings take effect live, without a server restart).
- **Non-`.md` files** force `{ graph: true, tree: true }` — only markdown notes get fingerprinted.

---

## 4. Cache Invalidation (`applyDirty`)

After classification, `applyDirty(paths, dirty)` selectively clears caches:

```ts
function applyDirty(paths: string[], dirty: { graph: boolean; tree: boolean }) {
  if (dirty.graph) graphCache.invalidate();
  if (dirty.tree)  treeCache.invalidate();
  invalidateSearchIndex(cfg.vault);   // always — any content change affects search
  cachedRows  = null;                 // always — frontmatter/body feeds rows
  cachedTasks = null;                 // always
  version++;
  sse.publish({ version, paths, dirty });
}
```

Key observations:

- **`cachedRows` and `cachedTasks` are always nulled** even when `dirty.graph` and `dirty.tree` are both `false`. This is intentional: a content-only edit (new prose, updated task status) changes search results and row data even though it doesn't affect graph structure.
- **`version` always increments** — even a pure content edit must bump it so an open editor can detect that the file changed externally and optionally reconcile.
- The **search index is always invalidated** for the same reason.

---

## 5. The Async Cache (`asyncCache.ts`)

`graphCache` and `treeCache` use `createAsyncCache<T>(build)`, which provides three guarantees beyond a plain `let cached = null`:

### In-flight deduplication

Concurrent `get()` calls while the value is being built share **one** build promise. Without this, a cold `/graph` request arriving during a 3–5 s PivotMDS layout compute would spawn parallel builds.

### Invalidation safety (generation counter)

`invalidate()` increments a generation counter. When a build settles, it checks whether the generation has advanced since it started; if so, the result is discarded rather than populating a cache that is now stale.

**Example**: A file changes mid-build. The sequence is:

1. `get()` starts build, captures `gen = 0`.
2. `invalidate()` runs; `generation` becomes `1`.
3. Build resolves; checks `gen (0) !== generation (1)` → result dropped.
4. Next `get()` starts a fresh build at `gen = 1`.

### `warm()` for boot pre-warming

`warm()` fires off `get()` and swallows errors — used to kick the expensive graph build off the critical path. The first real `/graph` request then either finds a ready value or joins the in-flight build.

### Plain lazy caches for rows and tasks

`cachedRows` and `cachedTasks` are plain `Row[] | null` variables (not `AsyncCache` instances). They are rebuilt lazily on the next read after being nulled by `applyDirty`. There is no in-flight deduplication for these — concurrent readers each trigger an independent rebuild — but row builds are fast enough that this is acceptable.

---

## 6. SSE: The `/events` Stream

### Server side (`sse.ts`)

`createSseRegistry()` maintains a `Set<ReadableStreamDefaultController>`. The public API:

```ts
subscribe(ctrl)    // add a client
unsubscribe(ctrl)  // remove a client
publish(payload)   // encode + broadcast to all clients
size()             // test-only subscriber count
```

`publish` encodes the payload as:

```
data: <JSON.stringify(payload)>\n\n
```

Dead controllers (those that throw on `enqueue`) are silently removed from the set.

### The `/events` endpoint

On `GET /events` the server:

1. Creates a `ReadableStream<Uint8Array>` with `Content-Type: text/event-stream`, `Cache-Control: no-store`, `Connection: keep-alive`.
2. Subscribes the stream's controller to the SSE registry.
3. If `version > 0`, immediately enqueues a snapshot event `{ version, paths: [] }` so a reconnecting client learns the current version without waiting for the next file change.
4. Starts a keepalive heartbeat (SSE comment `: keepalive\n\n`) at `appConfig.server.sseHeartbeatMs` (default **5000 ms**, min 1000 ms, max 30 000 ms). This keeps the TCP connection alive past Bun's 10 s idle timeout.
5. On stream cancel (client disconnect), clears the heartbeat interval and unsubscribes.

### SSE event payload shape

Every real change event has this structure (TypeScript type from `serverVersion.ts`):

```ts
type ServerChange = {
  version: number;             // monotonically increasing integer
  paths:   string[];           // vault-relative paths that changed; [] = unknown
  dirty?: {
    graph: boolean;            // graph consumers should refetch /graph
    tree:  boolean;            // tree consumers should refetch /tree
  };
}
```

The `dirty` field is **absent** in two cases:
- The initial snapshot sent on (re)connect.
- Version updates delivered by the `/version` poll fallback.

Consumers that receive a `ServerChange` without `dirty` must treat it as "assume everything may have changed."

**Concrete example** — a prose-only edit to `notes/foo.md` that changes no wikilinks, tags, or icon:

```json
{ "version": 42, "paths": ["notes/foo.md"], "dirty": { "graph": false, "tree": false } }
```

A new file `notes/bar.md` added with wikilinks:

```json
{ "version": 43, "paths": ["notes/bar.md"], "dirty": { "graph": true, "tree": true } }
```

`settings.yaml` saved:

```json
{ "version": 44, "paths": ["settings.yaml"], "dirty": { "graph": true, "tree": true } }
```

---

## 7. Frontend: `serverVersion.ts`

### Architecture

`serverVersion.ts` is a **module-level singleton** — one `EventSource` per browser tab. It exports:

```ts
export const serverVersion: Accessor<number>          // just the version number (Solid signal)
export const lastChange: Accessor<ServerChange>        // full change record
export const currentConnectionState: Accessor<ConnectionState>  // connected | disconnected | reconnecting
export function onServerChange(cb): () => void         // imperative subscribe (for CodeMirror widgets)
```

### SSE message handling

On each `onmessage` event:

```ts
es.onmessage = (e) => {
  const raw = JSON.parse(e.data) as Partial<ServerChange>;
  if (typeof raw.version !== "number") return;
  lastSseVersion = raw.version;
  fireChange({ version: raw.version, paths: [...], dirty: raw.dirty });
};
```

`lastSseVersion` tracks the last version seen over SSE specifically, used to detect poll catch-ups.

### `/version` poll fallback

`startPolling()` runs a `setInterval` that calls `GET /version` and fires a change if the version advanced:

```ts
const { version: v } = await api.version();
if (v > change().version) {
  if (v > lastSseVersion) recordPollCatchup(v, lastSseVersion);  // telemetry
  fireChange({ version: v, paths: [] });
}
```

Poll intervals:
- **Normal (SSE connected)**: 5 000 ms (`NORMAL_POLL_INTERVAL`)
- **Disconnected (SSE dropped)**: 1 000 ms (`DISCONNECTED_POLL_INTERVAL`)

### Connection state machine

```
           SSE opens OK
  ┌──────────────────────────────┐
  │                              ↓
  │              ┌─────────────────────┐
  │              │     connected       │──── es.onerror / poll failure ──┐
  │              └─────────────────────┘                                 │
  │                                                                       ↓
  │              ┌─────────────────────┐                   ┌─────────────────────┐
  └──────────────│    reconnecting     │←── poll succeeds ─│    disconnected     │
                 └─────────────────────┘                   └─────────────────────┘
```

When the state enters `disconnected`:
- The broken `EventSource` is closed and nulled.
- Poll interval switches to 1 s.
- A "Connection lost. Retrying…" toast is shown (once, with a "Retry now" button).

When a poll succeeds while `disconnected` or `reconnecting`, `attemptReconnect()` creates a new `EventSource`. When the new EventSource opens:
- State returns to `connected`.
- Poll interval returns to 5 s.
- Toast is dismissed.

On `beforeunload`, the `EventSource` and poll timer are cleaned up to prevent connection leaks.

### `fireChange` — Solid + imperative

```ts
function fireChange(c: ServerChange): void {
  setChange(c);                              // Solid signal — reactive consumers update
  for (const cb of changeListeners) cb(c);  // imperative callbacks (e.g. CodeMirror)
}
```

`onServerChange(cb)` returns an unsubscribe function. This is the correct integration point for non-Solid code that needs to react to version changes.

---

## 8. `GET /version` Endpoint

The simplest endpoint in the server:

```ts
"GET /version": async (_, __) => {
  return ok({ version });
}
```

Returns `{ version: number }`. The frontend poll uses only this value; the response carries no `paths` or `dirty` flags, which is why poll-triggered `ServerChange` events always have `paths: []` and no `dirty`.

---

## 9. Caches: What Each One Covers

| Cache | Type | Invalidated by | Used by |
|-------|------|----------------|---------|
| `graphCache` | `AsyncCache<GraphData>` | `dirty.graph === true` | `GET /graph`, `GET /graph/views`, `GET /daemon/graph` |
| `treeCache` | `AsyncCache<TreeEntry[]>` | `dirty.tree === true` | `GET /tree` |
| `cachedRows` | `Row[] \| null` | Every vault change | `GET /vault-data`, `POST /rows`, `GET /base` |
| `cachedTasks` | `Row[] \| null` | Every vault change | `POST /rows` (tasks source) |
| Search index | external (invalidated via `invalidateSearchIndex`) | Every vault change | `POST /search` |

### `GET /graph` vs `GET /graph/views`

`GET /graph` returns the full graph with positions attached for the "both" brain mode. Brain-view layouts (`second` / `third`) are **only included if already cached** (a `peekLayout` check). If they are absent, `graph.views` is `undefined` and the frontend falls back to full-graph positions.

`GET /graph/views` is called lazily when the user switches to 2nd- or 3rd-brain mode. It computes and caches the subgraph layouts, then **mutates `graph.views` in place on the live cached `GraphData` object** so subsequent `GET /graph` calls include the view layouts without a vault rebuild:

```ts
const graph = await graphCache.get();         // returns the cached reference
const views = await computeViewLayouts(graph, cfg.vault);
graph.views = views;                          // mutate in place — no invalidation
return ok(views);
```

### Mutating routes and invalidation

Every write endpoint goes through `mutatingHandler(run, pathOf?)`, which:

1. Clones the request body.
2. Runs the handler.
3. Calls `invalidate(...paths)` where `paths` comes from `pathOf(body)`, or is empty if `pathOf` is not provided.

An empty `paths` call to `invalidate()` triggers a full `{ graph: true, tree: true }` dirty. If `pathOf` returns specific paths, only those paths are classified, potentially resulting in `{ graph: false, tree: false }` for a pure content edit.

---

## 10. Backend-Precomputed Layouts (`layout-cache.ts`)

### Why backend-precomputed

Running a PivotMDS + force simulation in the browser on a main-thread `requestAnimationFrame` loop would block interactions for seconds on large vaults. Bismuth computes both the 3D and flat-2D positions on the server; the browser only morphs between the already-settled positions.

### Two-tier cache

Layout results are cached at two levels:

1. **In-memory** (`memCache: Map<string, Layout>`) — survives for the lifetime of the server process.
2. **On-disk** (`~/.bismuth/layout-cache/<sig>.json`, override `BISMUTH_LAYOUT_CACHE_DIR`) — survives server restarts. It lives in a **durable** app dir, not `os.tmpdir()` (which macOS purges), so reopens stay cache hits; and **not** inside the vault or memory directories — writing inside the vault would trip the file watcher and create an infinite invalidate → rebuild → recompute → rewrite loop.

Cache keys are derived from `graphSig(graph, vaultKey)`:

```ts
export function graphSig(graph: GraphData, vaultKey: string): string {
  const ids   = graph.nodes.map(n => n.id).sort().join("\n");
  const edges = graph.edges.map(e => `${e.from}|${e.to}|${e.kind}`).sort().join("\n");
  const h = createHash("sha1")
    .update(vaultKey).update(" ")
    .update(ids).update(" ")
    .update(edges).digest("hex");
  return `${CACHE_VERSION}-${h.slice(0, 16)}`;
}
```

The signature hashes **sorted edge `from|to|kind` triples**, not just edge count. This means retargeting a wikilink from `[[A]]` to `[[B]]` (same node set, same edge count) correctly busts the cache.

`CACHE_VERSION` is currently `"v5"`. Changing it invalidates all on-disk cache entries — this is done whenever the layout algorithm changes in a way that alters output positions.

### Warm-start seeding

`lastFullLayout` stores the most recent full-graph layout per vault key. When the graph changes (a note added, a link changed), the next `layoutFor` call passes the prior `pos3d` as `initialPositions` to `computeLayoutAsync`. This skips the expensive cold PivotMDS step; unchanged nodes barely move, so 120 refinement ticks (`REFINE_TICKS`) are enough to converge. This keeps the graph layout **stable across edits** — adding a note doesn't scramble all positions.

### 3D and 2D alignment

The 2D layout is seeded from the **flattened 3D positions** (z-coordinate zeroed):

```ts
const pos3d = await computeLayoutAsync(input, { dimensions: 3, refineTicks: 120, initialPositions: seed });
const pos2d = await computeLayoutAsync(input, { dimensions: 2, refineTicks: 120, initialPositions: pos3d });
```

Because `pos2d` starts from `pos3d` with z=0, the 2D and 3D layouts are spatially aligned: toggling the 2D/3D mode **flattens in place** rather than scrambling to a different spatial arrangement.

### `attachLayout(graph, vaultKey)` — the hot path

Called by the `GET /graph` handler (via `graphCache`'s build function). It:

1. Computes or retrieves the full-graph layout (warm-starting from `lastFullLayout` if available).
2. Updates `lastFullLayout` for the next rebuild.
3. Peeks the 2nd-brain and 3rd-brain subgraph layouts — if both are already cached, attaches them as `graph.views`; otherwise leaves `views` undefined (they'll be computed on demand by `GET /graph/views`).
4. Attaches `position` (3D `[x,y,z]`) and `position2d` (2D `[x,y]`) to every node:

```ts
nodes: graph.nodes.map(n => {
  const p3 = layout.pos3d[n.id];
  const p2 = layout.pos2d[n.id];
  if (!p3 && !p2) return n;
  const updates: Partial<typeof n> = {};
  if (p3) updates.position   = p3;
  if (p2) updates.position2d = to2d(p2);   // drops z=0 trailing coordinate
  return { ...n, ...updates };
})
```

### `peekLayout` — cache probe without computing

`peekLayout(graph, vaultKey)` returns the cached layout or `null` without triggering a compute. An empty graph (zero nodes) always returns the trivial `{ pos3d: {}, pos2d: {} }` so callers treat it as "cached" rather than scheduling useless work (e.g., the 3rd-brain subgraph when there is no memory directory).

### `computeViewLayouts` — on-demand brain-view layouts

Called by `GET /graph/views`:

```ts
export async function computeViewLayouts(graph, vaultKey): Promise<{ second: ViewLayout; third: ViewLayout }> {
  const second = await layoutFor(subgraphByKinds(graph, SECOND_BRAIN_KINDS), vaultKey);
  const third  = await layoutFor(subgraphByKinds(graph, THIRD_BRAIN_KINDS),  vaultKey);
  return { second: toViewLayout(second), third: toViewLayout(third) };
}
```

`ViewLayout` differs from the internal `Layout` type: `pos2d` values are `[x, y]` two-tuples (the internal format always stores `[x, y, z]` even for 2D).

---

## 11. Mutation Path (API writes → invalidation)

All vault-mutating POST endpoints go through `mutatingHandler`. The general sequence:

```
POST /create { path, kind }
  └─ createEntry(vault, path, kind)
  └─ invalidate("notes/new-file.md")
       └─ classifyVault(["notes/new-file.md"])
            └─ fingerprint is absent (new file) → { graph: true, tree: true }
       └─ applyDirty(["notes/new-file.md"], { graph: true, tree: true })
            └─ graphCache.invalidate() + treeCache.invalidate() + version++ + sse.publish(...)
```

`PUT /file` (used by the editor and drawing/sheet saves) also calls `invalidate(path)` directly, bypassing `mutatingHandler` since it's in the read routes table.

---

## 12. Settings Changes

`settings.yaml` changes (whether via `POST /set-setting` or an external edit) are handled specially:

1. **`classifyVault`** detects `isSettingsPath(p)` and immediately marks `{ graph: true, tree: true }`, then reloads `appConfig`:

   ```ts
   void loadAppConfig(cfg.vault).then(c => {
     appConfig = c;
     setClaudeBotHomeOverride(c.daemon?.home);
   }).catch(() => {});
   ```

2. This makes debounce interval and SSE heartbeat changes take effect without restarting the server.

3. The frontend's `GET /settings` is a separate read (not cached by the server — it reads `settings.yaml` fresh on each request), so UI settings update on the next SSE event.

---

## 13. Edge Cases and Gotchas

- **Two rapid edits within the debounce window**: only the second fires; intermediate changes accumulate in `pendingVault` and are classified together.
- **OS-null filename**: when `fs.watch` fires with a null filename (can't identify the changed file), `pendingVaultUnknown` is set to `true` and the debounce fires a full-dirty with empty `paths`.
- **Mid-build invalidation**: `asyncCache`'s generation counter ensures that if the vault changes while a graph build is in flight, the build result is discarded. The next `GET /graph` starts a fresh build.
- **SSE silently dies**: proxies and OS sleep drop long-lived connections without sending a close frame. The 1 s disconnected poll catches this within 1–2 intervals.
- **Content-only edit (no structural change)**: `sse.publish` is still called with `{ dirty: { graph: false, tree: false } }`. The `version` still increments. The editor reconciles externally-edited files via `serverVersion`; graph and tree consumers can skip refetching by checking `dirty`.
- **Layout cache in `~/.bismuth/layout-cache/`**: if the dir is unavailable (write failure), only the in-memory cache is populated for that run. Disk write failures are silently swallowed.
- **`graph.views` mutation in `GET /graph/views`**: the handler mutates the live cached `GraphData` object in place. This is safe only because `graphCache.invalidate()` always replaces the reference, never patching the existing object.
- **`dirty` absent in poll**: the `/version` endpoint returns only `{ version }`. The frontend's poll-triggered `fireChange` has no `dirty` field, so consumers must treat it as a full invalidation.

---

Source: `core/src/server.ts`, `core/src/sse.ts`, `core/src/changeClassifier.ts`, `app/src/serverVersion.ts`, `core/src/layout-cache.ts`, `core/src/asyncCache.ts`, `core/src/schema/settingsSchema.ts`
