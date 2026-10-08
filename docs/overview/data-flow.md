# Data flow

Bismuth keeps every open client in sync with the vault through one loop: a file watcher collects changes, a short debounce batches them, a classifier decides what they affect, the matching caches are dropped, a version counter increments, and a server-sent-events (SSE) stream tells each client what to refetch. This page is for engineers who change the backend, add a cache, or write a consumer of live updates; the connection messages a user sees are in [Status messages](status-messages.md).

```
file written (editor, CLI, agent, git, daemon)
  -> watcher event
  -> debounce (server.fileWatchDebounceMs, default 250 ms)
  -> classify: did links, tags, icon or visibility change?
  -> drop the graph and/or tree cache, patch the rows / tasks / search feeds
  -> version + 1
  -> GET /events pushes { version, paths, dirty: { graph, tree } }
  -> each client refetches only what its dirty flags name
```

If the stream is silently dead, `GET /version` polling catches the same version bump (see [What happens when the live stream drops](#what-happens-when-the-live-stream-drops)).

## What does a change event contain?

Every real event on `GET /events` is one JSON object per SSE frame.

| Field | Type | Meaning |
|---|---|---|
| `version` | number | Counter that only increases while the server runs |
| `paths` | string[] | Vault-relative paths that changed; empty means the extent is unknown |
| `dirty` | `{ graph: boolean, tree: boolean }` | Which structural caches changed; absent means unknown |

A prose-only edit changes neither structure, so the version still advances but both flags are false:

```json
{ "version": 42, "paths": ["notes/foo.md"], "dirty": { "graph": false, "tree": false } }
```

A new note, or a saved `.settings`, dirties both:

```json
{ "version": 43, "paths": ["notes/bar.md"], "dirty": { "graph": true, "tree": true } }
{ "version": 44, "paths": [".settings"], "dirty": { "graph": true, "tree": true } }
```

`dirty` is absent from the catch-up snapshot sent when a client connects and from a version bump discovered by polling `GET /version`. A consumer that receives an event without `dirty` treats it as "everything may have changed". Version 0 means nothing has changed yet since the server started, and the stream sends no snapshot in that case.

## Which edits count as structural?

The graph is built from wikilinks, tags and frontmatter; the file tree shows structure plus each note's icon and visibility. An edit to anything else (prose, task lines, other frontmatter values) leaves both flags false.

| Change | `graph` | `tree` |
|---|---|---|
| New note, or deleted note | true | true |
| Wikilink targets or tags changed | true | false |
| Frontmatter `icon` or `visibility` changed | false | true |
| Prose or other frontmatter only | false | false |
| A non-markdown file added, changed or removed | true | true |
| `.settings` changed | true | true |
| Other files inside `.daemon` (logs, pids, cron state, triggers) | ignored | ignored |
| A note inside `.daemon/memory` | true | per the note rules above |
| A non-note file inside `.daemon/memory` | true | true |
| Daemon identity, cron, process or inbox-page file | false | true |
| `.themes/<name>.yaml` created or deleted | false | true |

The first save of a note after the server boots is classified like every later save, because a boot-time scan records each note's baseline. Reordering links or tags does not count as a change.

## What does the app do with each event?

Each consumer decides from `dirty` whether to refetch.

| Consumer | Refetches when |
|---|---|
| Graph | `dirty.graph` is not explicitly false, and the version is above 0 |
| File tree | `dirty.tree` is not explicitly false |
| Open editor | The event lists its path, or lists no paths; it reconciles an externally edited file unless local edits are unsaved |
| Bases rows | The cached rows were fetched at an older version; the cache is keyed by version |
| Daemon inbox | Any structural event while the daemon is enabled, plus its own poll |

Content-only edits therefore cost the graph and tree nothing, while open bases and editors still see the new text.

## What happens when the live stream drops?

The client keeps one `EventSource` per browser tab and polls `GET /version` as a fallback. The poll runs every 5 seconds while connected and every second while disconnected, and a higher version than the client knows fires a change with empty `paths` and no `dirty`.

The connection has three states:

- **connected**: the stream is open, or a poll just succeeded.
- **disconnected**: the stream errored or a poll failed. The client closes the stream, polls every second, and shows the toast "Connection lost. Retrying..." once, with a **Retry now** button.
- **reconnecting**: the client is opening a new stream after you press **Retry now**.

A successful poll returns the state to connected even if the stream never reports open, then reopens the stream in the background. The toast is suppressed until the client has reached the backend once, so a cold launch does not flash it. A 5-second cooldown after a dismissal stops a stream that opens and errors repeatedly from re-showing it. Before the stream has ever opened, a failed connect retries every 250 ms.

## Which settings tune the loop?

Both keys live under `server` in `.settings` and apply without a restart.

| Key | Default | Range | Effect |
|---|---|---|---|
| `server.fileWatchDebounceMs` | 250 | 50 to 2000 | How long changes are batched before classification |
| `server.sseHeartbeatMs` | 5000 | 1000 to 30000 | Interval of the keepalive comment on `GET /events` |

A burst of writes never defers the update forever: a batch flushes at the latest 4 debounce intervals after its first event, even if writes keep arriving.

## Which caches does a change affect?

| Cache | Dropped or patched when | Serves |
|---|---|---|
| Graph | `dirty.graph` is true | `GET /graph`, `GET /graph/views` |
| Tree | `dirty.tree` is true | `GET /tree` |
| Rows | Any vault change; patched in place when the changed paths are known | `GET /vault-data`, `POST /rows`, `GET /base` |
| Tasks | Any vault change; patched in place when the paths are known | `POST /rows` with a tasks source |
| Search index | Any vault change; patched in place when the paths are known | `POST /search` |

`GET /daemon/snapshot` has no cache: each request reads the daemon's definition files and pid again. `GET /graph` filters the cached graph per request by the caller's visibility rules, so the cache holds the unfiltered graph. A change that touches only the memory directory skips the rows, tasks and search work, so a daemon memory write does not force the next base render to re-read the vault.

## What goes wrong silently?

- **Two edits inside one debounce window** produce one event, with both paths in `paths`.
- **A watcher event with no filename** forces `{ graph: true, tree: true }` with an empty `paths`, because the extent is unknown.
- **A vault change during a graph build** discards that build's result; the next `GET /graph` starts a fresh one.
- **A route that writes the vault without being marked as a self-write** produces a second event when the watcher notices the file.
- **A dead stream behind a proxy or after sleep** sends no close frame; only the poll notices.
- **An event without `dirty`** must be treated as a full invalidation; a consumer that reads `dirty.graph` as false when it is absent skips a real change.

## How it works: watcher and debounce

`createServer` in `core/src/server.ts` watches the vault (and the memory directory, when one is set) with `watchLive`, which also reports changes made while the watch is starting. Each event passes a layered filter before it is scheduled:

1. `isDaemonRuntimeNoise` drops daemon runtime churn: everything under `.daemon` except the memory directory, `identity.md`, `PAGES.md`, cron and process definitions, and inbox pages.
2. `isWatchIgnored` (in `core/src/watchSkip.ts`) drops dot-hidden paths such as `.git` and `.trash`, and the `DAEMON.md` heartbeat. System folders, `.settings` and `.themes` files bypass this check.
3. `consumeSelfWritten` drops the echo of a write the server made itself.

`scheduleVault` adds the path to a pending set (or sets an unknown-extent flag when the filename is null) and calls `arm`, which restarts a timer. The delay comes from `flushDelayMs` in `core/src/changeClassifier.ts`: the configured debounce, shortened so a batch never spans more than `MAX_COALESCE_INTERVALS` (4) debounce intervals. When the timer fires, the batch goes to `classifyVault`, then `applyDirty`. A memory-directory watcher feeds the same timer, sets `dirty.graph`, and schedules a snapshot commit of the memory repo.

## How it works: classification and invalidation

`extractFingerprint` reduces a note to its sorted, deduplicated wikilink targets, its tags, its `icon` and its `visibility`. `createChangeTracker` stores one fingerprint per path; `diffFingerprints` compares old and new. A missing old or new fingerprint means a new or deleted note and dirties both flags. Otherwise links or tags dirty the graph, and icon or visibility dirty the tree. `tracker.seed` records a baseline without classifying, and the boot-time task-syntax scan calls it for every note.

`classifyVault` in `core/src/server.ts` wraps the tracker with the path rules from the table above. A `.settings` change also reloads the runtime config asynchronously, then re-invalidates the daemon-gated caches (the `.daemon` tree folder and the 3rd-brain graph) and publishes a second event, so a `daemon.enabled` toggle shows up live.

`applyDirty(paths, dirty, vaultTouched)` is the single publishing step. It drops the graph and tree caches as flagged, and, when the vault was touched, patches the search index, the rows feed (`patchVaultRows`) and the tasks feed (`patchTaskRows`) for the known paths, or drops them for an unknown extent. The rows and tasks patches are awaited before the event is published, so a client that refetches on the event sees the patched feed. The search patch is fire-and-forget and can be one edit stale for a moment. Finally it increments `version` and calls `sse.publish`.

The graph and tree caches are `createAsyncCache` instances (`core/src/asyncCache.ts`). They share one build among concurrent callers, abort and discard any build that an invalidation made stale (a generation counter), expose `peek` and `patch`, and `warm()` starts the first build at boot.

API writes enter the same path through `mutatingHandler(run, pathOf)`: it extracts the written paths from the request body, marks them as self-written, runs the handler, then calls `invalidate(...paths)`. An empty path list classifies as `{ graph: true, tree: true }`; specific paths are classified normally, so a pure content edit can yield `{ graph: false, tree: false }`. `PUT /file` is a read-table route and runs the same mark, write, rearm, `invalidate` sequence inline.

## How it works: self-write suppression

Without suppression, each API write would trigger two event waves: one from the handler and one when the watcher notices the file. `createSelfWriteMarks` in `core/src/selfWriteMarks.ts` prevents the second.

- `mark(paths)` runs before the write, so the watcher cannot win the race. Its expiry is a backstop of one debounce interval.
- `rearm(paths)` runs when the write resolves. It extends the expiry to the larger of the debounce and `SELF_WRITE_GRACE_MS` (2 seconds) and records the path's mtime-and-size stamp. It only touches entries still present.
- `consume(path)` swallows an echo while the stamp still matches what the write left, however many echoes arrive, because one write can produce several watcher deliveries. When the stamp has changed, it deletes the mark and lets the event through, so a genuine external write (the CLI, an agent, `git checkout`, the daemon) is never swallowed.
- `unmark(paths)` runs when a handler throws or returns a status of 400 or above. Several routes reject by returning an error response, so both shapes unmark; otherwise a failed request leaves the path armed and swallows the next external edit.

Marked writes are the `mutatingRoutes` entries (only the paths their `pathOf` returns), `PUT /file`, and the boot-time `.settings` reconcile. `POST /daily-note` and the inline `.settings` reconcile in `GET /file` write without marking, so each can produce an extra event.

## How it works: SSE endpoint

`createSseRegistry` in `core/src/sse.ts` keeps a set of stream controllers. `publish` encodes `data: <json>\n\n` and sends it to all of them, dropping any controller that throws. `GET /events` (in `core/src/routes/system.ts`) creates the stream with `Content-Type: text/event-stream`, subscribes it, and enqueues `: connected` immediately, so a client connecting at version 0 receives a byte without waiting for the first heartbeat. When the version is above 0 it also sends a snapshot `{ version, paths: [] }`. A `: keepalive` comment every `sseHeartbeatMs` keeps the connection alive past Bun's idle timeout, and cancelling the stream clears the timer and unsubscribes. `GET /version` returns `{ version }` only.

## How it works: client singleton

`app/src/serverVersion.ts` is a module-level singleton started once from `app/src/index.tsx` via `start()`; it returns a disposer and is idempotent. It exports `serverVersion` (the number), `lastChange` (the full `ServerChange`), `currentConnectionState`, and `onServerChange(cb)`, which returns an unsubscribe function and is the integration point for non-Solid code such as CodeMirror widgets. `fireChange` sets the Solid signal and then calls each imperative listener.

The pure transition function `decideConnectionState` in `app/src/connectionState.ts` takes one of four observations (`sse-open`, `sse-error`, `poll-success`, `poll-failure`) and returns the next state, whether to show or dismiss the toast, and the poll cadence. The decision to refetch the graph is the pure `decideGraphRefresh` in `app/src/graphRefreshGate.ts`; the tree store re-fetches in `app/src/treeStore.ts`; `app/src/bases/changeRelevance.ts` decides whether a change can affect a base. On `beforeunload` the stream and poll timer are closed.

## How it works: layouts

The graph cache builds `buildGraph` output and passes it to `attachLayout` in `core/src/layout-cache.ts`, so every node reaches the browser with a precomputed 3D `position` and 2D `position2d`; the browser only morphs between them. Layouts are cached in memory and on disk under `~/.bismuth/layout-cache/` (override with `BISMUTH_LAYOUT_CACHE_DIR`), outside the vault so the write cannot trigger the watcher. The file name is the graph signature: a cache version prefix plus a hash of the vault key, the sorted node ids and the sorted `from|to|kind` edge triples. Retargeting a wikilink therefore changes the signature even when node and edge counts stay equal. The next rebuild after an edit warm-starts from the previous full layout, which keeps positions stable, and the 2D layout is seeded from the flattened 3D one, so toggling dimensions flattens in place.

`GET /graph` includes the 2nd-brain and 3rd-brain view layouts only if they are already cached. `GET /graph/views` computes them and attaches them to the live cached graph object in place, without invalidating it; the next invalidation replaces the object. The algorithm and cache keys are explained in [Graph](../graph/overview.md#layout-cache-and-warm-starts).

Source: `core/src/server.ts`, `core/src/routes/system.ts`, `core/src/routes/graph.ts`, `core/src/sse.ts`, `core/src/changeClassifier.ts`, `core/src/watchSkip.ts`, `core/src/selfWriteMarks.ts`, `core/src/asyncCache.ts`, `core/src/layout-cache.ts`, `core/src/schema/settingsSchema.ts`, `app/src/serverVersion.ts`, `app/src/connectionState.ts`, `app/src/graphRefreshGate.ts`, `app/src/treeStore.ts`, `app/src/bases/changeRelevance.ts`
