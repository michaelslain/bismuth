# Memory store

The daemon's **memory** (the "3rd brain") is a flat tree of markdown notes on disk plus a handful of pure functions that read, parse, query, score, and consolidate them. There is no database, no search index, and no embeddings — "the graph" is just the `[[wikilink]]` edges between notes, and it is **recomputed on demand** every time something needs it by re-reading the whole store (`loadAllNotes`).

This page documents that store: where notes live, the note model and on-disk format, the two distinct retrieval paths (exact filtering vs. ranked lexical search), and the consolidation ("dream") cycle. Related: the dream cron in [crons-and-processes.md](crons-and-processes.md), the per-vault runtime in [overview.md](overview.md) and [lifecycle.md](lifecycle.md), the on-disk layout in [storage.md](storage.md), and the recall/collect hooks + MCP tools in [communication.md](communication.md). See also the [daemon README](../README.md).

## One brain per vault — no machine-global memory

> **There is no machine-global memory dir anymore.** The former standalone claude-bot kept a single `~/.claude-bot/memory`; that model is gone. The daemon is **one machine process that multiplexes per-vault brains**, and each enabled vault's memory lives under its own **`<vault>/.daemon/memory`** (`vaultPaths(root).memoryDir` in `daemon/src/lib/config.ts`). `~/.claude-bot/memory` survives only as a one-time, copy-only legacy migration source.

The `@bismuth/memory` package (`memory/src/`) is **pure** and takes the memory dir explicitly. Every public function's `dir` parameter defaults to `getMemoryDir()`, which reads the **`BISMUTH_MEMORY_DIR`** env var and **throws** when it is unset:

```ts
export function getMemoryDir(): string {
  const dir = process.env.BISMUTH_MEMORY_DIR;
  if (!dir) throw new Error("BISMUTH_MEMORY_DIR is not set — pass an explicit memory dir");
  return dir;
}
```

So a missing dir fails loudly instead of silently reading the wrong place. Three callers supply it:

- The **daemon runtime** passes the active vault's `ctx.memoryDir` explicitly on every call (e.g. `dream(ctx)` uses `ctx.memoryDir`).
- The **per-session MCP** memory tools and the **relay** recall/collect hooks run inside Bismuth terminals where `core/src/terminal.ts` injects `BISMUTH_MEMORY_DIR` — **only when `settings.daemon.enabled` is true for that vault**.

This is why memory is recalled/collected strictly for vault-scoped sessions, never globally the way the old `~/.claude/settings.json` hooks did.

## There is NO index file

> **Do not go looking for a `MEMORY.md` index in the memory store — there isn't one.** The directory is a flat tree of `.md` notes; the link graph, search rankings, and consolidation batches are all derived live by scanning files (`loadAllNotes`). There is no persisted adjacency list, no manifest, no SQLite, and no vector store.

(Claude Code, the host harness, separately keeps its own `MEMORY.md` index for *its* file-based memory. That is an unrelated host-level feature and is **not** part of this store. Don't conflate the two.)

## Where notes live

The store lives at `<vault>/.daemon/memory`.

- **One note = one markdown file** named `<name>.md`.
- Notes live either at the **root** of the memory dir or in **single-level folders** (e.g. `moltbook/voting.md`).
- **No deeper nesting.** `listNotes` silently drops anything more than one level deep — a file at `a/b/c.md` is invisible to the store (`slashCount > 1` is skipped).

```
<vault>/.daemon/memory/
  alice.md              # root note,   name = "alice"
  project-x.md          # root note,   name = "project-x"
  moltbook/
    voting.md           # folder note, name = "moltbook/voting"
  people/
    alice.md            # folder note, name = "people/alice"
```

## The note model

Defined in `memory/src/graph.ts`:

```ts
type NoteType =
  | "person" | "project" | "workflow"
  | "fact" | "preference" | "daily" | "auto";

interface NoteFrontmatter {
  type: NoteType;
  tags: string[];
  created: string; // "YYYY-MM-DD"
  updated: string; // "YYYY-MM-DD"
}

interface MemoryNote {
  name: string;             // "folder/name" for non-root, bare "name" for root
  frontmatter: NoteFrontmatter;
  content: string;          // body after the frontmatter block
  backlinks: string[];      // [[targets]] referenced in content
}
```

> **Footnote on undeclared types.** `search.ts` `TYPE_BOOST` references `feedback` and `reference` note types that are **not** in the declared `NoteType` union. They are still scored at runtime but never declared — treat the union as descriptive, not exhaustive. (The dream `CONSOLIDATION_PROMPT` restricts merged notes to the six "real" types: `fact`, `preference`, `workflow`, `project`, `person`, `daily`.)

### On-disk format

`serializeFrontmatter` + `writeNote` produce exactly:

```md
---
type: fact
tags: [productivity, tools]
created: 2026-06-08
updated: 2026-06-08
---

The body content goes here, with [[wikilinks]] to other notes.
```

Rules:

| Rule | Detail |
| --- | --- |
| Delimiters | `---` on its own line, before and after the frontmatter |
| Field order | **Fixed**: `type`, `tags`, `created`, `updated` |
| Tags | Inline bracket array `[a, b]`; empty tags serialize as `[]` |
| Body | `<frontmatter>` then a blank line then `<content>` then a trailing newline |

### Parsing (lenient, hand-rolled — NOT a YAML library)

`parseNoteFile` and `parseFrontmatter` are bespoke string parsers, not a YAML dependency:

- `parseNoteFile` splits the file on `/^---\s*$/m`. If the **body itself** contains a `---` line, the content is re-joined via `slice(2).join("---")`, so dashes inside the note survive.
- `parseFrontmatter` splits **each line on the FIRST colon** only. A value that starts with `[` and ends with `]` is parsed as a comma-split array (empty `[]` → empty array); a single scalar `tags` value is coerced into a one-element array.
- **Missing/absent frontmatter defaults:** `type` → `"fact"`, `tags` → `[]`, `created`/`updated` → today.

### Backlinks (the graph edges)

`extractBacklinks` runs the regex `/\[\[([^\]]+)\]\]/g` over the content, trims each capture, **dedupes via a `Set`**, and drops empty/whitespace-only matches.

Edges are **folder-agnostic and resolved by bare name.** `findBacklinks(name)` loads all notes and matches on `n.backlinks.includes(parseNoteRef(name).name)`. So a note in `moltbook/` can `[[alice]]`-link to `people/alice` — only the bare segment `alice` is compared. There is **no on-disk adjacency**; the graph is recomputed on each `findBacklinks` call.

### Names, folders, and safety

| Function | Behavior |
| --- | --- |
| `sanitizeSegment` (via `sanitizeName`) | Replaces `/` and `\` with `-`, strips `..`, strips leading/trailing `.`/`-`, collapses repeated `-`. A name that fully sanitizes away (`"..."`, `"---"`, `""`) makes `notePath` throw `"Invalid note name"`. |
| `parseNoteRef(ref)` | Strips a trailing `.md`, splits on the **first** `/` into `{ folder?, name }`. |
| `sanitizeFolder(folder?)` | Same sanitization rules; returns `""` for missing or fully sanitized-away input. |
| `notePath` | Builds the path, then does a final `resolve(full).startsWith(resolve(dir))` traversal guard. |

## Public API by module

### `memory/src/graph.ts` — CRUD + graph primitives

No caching and no index: `loadAllNotes` re-reads the entire store on every call.

| Function | Returns | Notes |
| --- | --- | --- |
| `getMemoryDir()` | `string` | Reads `BISMUTH_MEMORY_DIR`; **throws** if unset |
| `sanitizeFolder(folder?)` | `string` | Sanitizes a folder segment |
| `parseNoteRef(ref)` | `{ folder?, name }` | Strips `.md`, splits on first `/` |
| `listNotes(dir?, folder?)` | `Promise<string[]>` | Glob `*.md` folder-scoped, or `**/*.md` recursive (single-level only); non-root names are folder-prefixed |
| `readNote(name, dir?, folder?)` | `Promise<MemoryNote \| null>` | `null` if absent |
| `writeNote(name, fm, content, dir?, folder?)` | `Promise<void>` | Serialize + `Bun.write`; create-or-overwrite |
| `deleteNote(name, dir?, folder?)` | `Promise<boolean>` | |
| `loadAllNotes(dir?, folder?)` | `Promise<MemoryNote[]>` | `listNotes` then `readNote` each in parallel, filters out nulls |
| `findBacklinks(name, dir?)` | `Promise<string[]>` | Bare-name match across all folders |

The package entrypoint `memory/src/index.ts` re-exports `./graph`, `./query`, and `./search` as `@bismuth/memory`.

### `memory/src/query.ts` — structured filter queries (exact boolean, NOT ranked)

`parseQuery(str)` produces a `ParsedQuery`:

```ts
interface ParsedQuery {
  tags: string[];
  types: string[];
  keywords: string[];
  links: string[];
  after?: string;
  before?: string;
  keywordMode: "and" | "or";
}
```

**Token grammar** (whitespace-tokenized, all lowercased):

| Token | Effect |
| --- | --- |
| `tag:x` | Add `x` to `tags` (repeatable) |
| `type:x` | Add `x` to `types` (repeatable) |
| `link:x` | Add `x` to `links` (repeatable) |
| `after:DATE` | Set `after` |
| `before:DATE` | Set `before` |
| `keyword:x` | Add `x` to `keywords` |
| bare word | Add to `keywords` |
| unknown `prefix:val` | Kept as a single keyword |

`keywordMode` defaults to `"and"` and is only settable by callers — **no token sets it.**

**`noteMatchesQuery` filter semantics:**

| Field | Combinator | Rule |
| --- | --- | --- |
| `types` | OR | note's type is in the list |
| `tags` | AND | note has **every** requested tag |
| `links` | AND, case-insensitive | note's backlinks include **every** requested target |
| `after` | inclusive | `updated >= after` |
| `before` | exclusive | `updated < before` |
| `keywords` | AND (default) / OR | substring match over the joined+lowercased fields below |

Date comparisons are lexicographic ISO-date string compares. The keyword haystack is `[content, type, ...tags, created, updated, name]` joined and lowercased; AND requires every keyword as a substring, OR requires any (when `keywordMode === "or"`).

| Function | Returns |
| --- | --- |
| `executeQuery(q, dir?, folder?)` | `loadAllNotes` then filter |
| `query(str, dir?, folder?)` | parse + execute |

An empty query returns **all** notes. This is the path the MCP **`recall`** tool uses (see [communication.md](communication.md)).

### `memory/src/search.ts` — keyword scoring / ranking (the recall engine)

This is a **different retrieval path** from `query.ts`: ranked lexical relevance, not exact boolean filtering. Don't conflate them. This is the path the relay **recall hook** uses to inject context into a prompt.

- `extractKeywords(text)`: lowercase, split on punctuation/whitespace, drop tokens shorter than 3 chars or in `STOP_WORDS` (a ~130-word list), then dedupe.
- `scoreNote(note, keywords)`, per keyword:

| Field | Exact substring | Stemmed word-prefix (word len >= 4) |
| --- | --- | --- |
| name | +3 | +1.5 |
| tag | +3 | +1.5 |
| body | +1 | +0.5 |

  Then a **density bonus**: `score *= (1 + matchedKeywords / totalKeywords)`. Then a `TYPE_BOOST` multiplier:

| Type | Boost | Type | Boost |
| --- | --- | --- | --- |
| feedback | 1.5 | fact | 1.0 |
| preference | 1.4 | person | 1.0 |
| workflow | 1.2 | reference | 0.9 |
| project | 1.1 | daily | 0.5 |
| | | auto | 0.3 |

- `searchMemory(prompt, dir?, maxResults = 10)`: extract keywords → score all notes → keep `score >= MIN_SCORE` (`1.0`) → sort descending → cap by `maxResults` **and** by `MAX_CONTEXT_BYTES` (`4096`) cumulative size (the byte cap only kicks in after at least one note is included). Returns `[]` when the prompt yields no keywords.

The mechanism is lexical/substring matching + stemming + weighted scoring. **No embeddings, no TF-IDF, no external index.**

**Consumer:** `relay/lib/memory.ts` `recallContext(dir, prompt)` calls `searchMemory(prompt, dir)` under an 800ms `RECALL_BUDGET_MS` race (a bloated graph degrades to "no recall" rather than stalling prompt submission), formats matches under a `# Memories` heading, and the `UserPromptSubmit` hook (`relay/bin/recall-hook.ts`) injects them as `additionalContext`. (See [communication.md](communication.md) for the hook plumbing.)

## The dream consolidation cycle (`daemon/src/memory/dream.ts`)

**What it does.** An LLM-driven dedup / merge / improve / prune pass over the notes. The crucial detail: it runs **through the vault's own persistent daemon session** — dispatch is `sendMessage(prompt, ctx).result` — not a separate one-off model call.

**Vault-scoped by construction.** Every entry point takes a `VaultContext`, and per-vault timers/configs are keyed by `ctx.root`, so one machine runtime dreams independently for every enabled vault:

- `dream(ctx)` — run one cycle against `ctx.memoryDir`.
- `startDreaming(ctx, config?)` / `stopDreaming(ctx)` — per-vault timer loop.
- `getDreamConfig(ctx)` → `DreamConfig & { active: boolean }` (the `active` flag = "a timer is currently registered for this vault").
- `updateDreamConfig(ctx, config)` — mutates the config; restarts the loop **only if it was already active**.

**`dream(ctx)`:**

1. `loadAllNotes(ctx.memoryDir)`; bail if there are fewer than 2 notes.
2. `groupByFolder`. **Folders are hard semantic boundaries** — consolidation **never** crosses them. Root notes are grouped under the key `""`.
3. Per folder (skip any folder with fewer than 2 notes), batch in `BATCH_SIZE` (`20`) notes.
4. Per batch, build a JSON array of `{ name (bare), type, tags, created, updated, content, backlinks }`, append it to `CONSOLIDATION_PROMPT` along with today's date, and dispatch through the session.

**`CONSOLIDATION_PROMPT`** instructs the session to: return JSON only; stay strictly scoped to memory (**forbidden** from touching crons / processes / daemon config); **prioritize processing `type: "auto"` notes** (raw conversation snippets — extract their value → merge into or create properly-typed notes → delete the auto note); restrict merged-note types to one of `fact`, `preference`, `workflow`, `project`, `person`, `daily`; and apply **memory decay** (old notes that are isolated in the backlink graph are deletion candidates *unless* genuinely important and timeless; well-connected notes survive).

**`parseDreamResult`** → `DreamResult`:

```ts
interface DreamResult {
  merge: MergeOp[];
  improve: ImproveOp[];
  delete: string[];
}
interface MergeOp {
  delete: string[];
  keep: string;
  updatedContent: string;
  updatedTags: string[];
  updatedType: NoteType;
}
interface ImproveOp {
  name: string;
  updatedContent: string;
  updatedTags: string[];
}
```

**What it writes** (all scoped to the current folder):

| Op | Behavior |
| --- | --- |
| `merge` | Skip if `keep`/`updatedContent` missing. Delete each dup first (**abort that merge if any delete fails**), then `writeNote` the kept note with merged content/tags/type, preserving the original `created`, stamping `updated` = today |
| `improve` | Must reference an existing note in the batch; `writeNote` with new content/tags and `updated` = today |
| `delete` | `deleteNote` each |

`dream` returns counts `{ merged, improved, deleted }`.

**How it's triggered** — two paths:

1. The seeded **hourly cron** `dream` (`DREAM` in `daemon/src/daemon/defaultCrons.ts`, seeded non-clobbering by `reconcileSeeds`). See [crons-and-processes.md](crons-and-processes.md).
2. The in-process per-vault timer `startDreaming(ctx, config?)`, firing every `intervalMs`. `DEFAULT_DREAM_INTERVAL_MS` is **6h** (`daemon/src/lib/config.ts`).

> **Where do `auto` notes come from?** The relay `SessionEnd` hook (`relay/bin/session-end-hook.ts` → `collectTranscript` in `relay/lib/memory.ts`) saves a finished terminal session's user-side messages as a `type: auto` note (`auto-<timestamp>-<sid>`), which the dream cron later consolidates. Cron-fired and trivial sessions are dropped, and `compact` is skipped (the same logical session continues). See [communication.md](communication.md).

## MCP exposure — remember / recall / forget

Memory is reachable over MCP via three tools defined in `mcp/src/memory.ts` and registered in `mcp/src/server.ts`: **`remember`**, **`recall`**, **`forget`**.

> There are **no** `dream_run` / `dream_status` / `dream_config` MCP tools — those do not exist. The dream cycle is driven by the cron + the in-process timer, not by MCP.

The three tools are **conditionally registered**: `mcp/src/server.ts` only appends them to the advertised tool list when `memoryDir()` (i.e. `process.env.BISMUTH_MEMORY_DIR`) is set — which `terminal.ts` does only when the daemon is enabled for the vault. They delegate to the shared `@bismuth/memory` graph, so the MCP tools, the daemon writer, and the relay collect hook all read/write **one** note format against `<vault>/.daemon/memory`.

| Tool | Delegates to | Behavior |
| --- | --- | --- |
| `remember` | `writeNote` | Create/overwrite a note; preserves an existing note's `type`/`created` when overwriting; defaults type `fact`, stamps `updated` = today |
| `recall` | `query` (the query DSL above) | Run a query string → `{ count, notes }` |
| `forget` | `deleteNote` | Delete a (possibly folder-prefixed) note → `{ ok, name }` |

## Cross-cutting facts

- **One brain per vault; no machine-global memory.** `getMemoryDir()` throws when `BISMUTH_MEMORY_DIR` is unset; the live store is `<vault>/.daemon/memory`.
- **No index, no DB, no embeddings.** The "graph" is markdown files re-scanned via `loadAllNotes` on every read / query / search / dream.
- **Two distinct retrieval paths.** `query.ts` = exact boolean filters (MCP `recall`); `search.ts` = ranked lexical relevance (the relay recall hook). Keep them separate in your head.
- **Folders** are single-level, sanitized, AND-scoped in queries, hard boundaries during dreaming, and transparent to backlinks (which match by bare name across all folders).
- **The frontmatter parser is hand-rolled and lenient** — first-colon splits, bracket-array tags, today-defaults for missing fields — not a YAML library.

Source: memory/src/{index,graph,query,search}.ts, daemon/src/memory/dream.ts, daemon/src/lib/config.ts, daemon/src/daemon/{seeds,defaultCrons}.ts, mcp/src/{server,memory}.ts, relay/lib/memory.ts, relay/bin/{recall-hook,session-end-hook}.ts
</content>
</invoke>
