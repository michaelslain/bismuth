# Memory store

The daemon's **memory** (the "3rd brain") is a flat tree of markdown notes on disk plus a handful of pure functions that read, parse, query, score, and consolidate them. There is no database, no search index, and no embeddings — "the graph" is just the `[[wikilink]]` edges between notes, and it is **recomputed on demand** every time something needs it by re-reading the whole store (`loadAllNotes`).

This page documents that store: where notes live, the note model and on-disk format, the two distinct retrieval paths (exact filtering vs. ranked lexical search), and the consolidation ("dream") cycle. Related: the dream cron in [crons-and-processes.md](crons-and-processes.md), the per-vault runtime in [overview.md](overview.md) and [lifecycle.md](lifecycle.md), the on-disk layout in [storage.md](storage.md), and the recall/collect hooks + MCP tools in [communication.md](communication.md). See also the [daemon README](../README.md).

## One brain per vault — no machine-global memory

> **There is no machine-global memory dir.** The daemon is **one machine process that multiplexes per-vault brains**, and each enabled vault's memory lives under its own **`<vault>/.daemon/memory`** (`vaultPaths(root).memoryDir` in `daemon/src/lib/config.ts`). `~/.claude-bot/memory` survives only as a one-time, copy-only legacy migration source.

The `@bismuth/memory` package (`memory/src/`) is **pure** and takes the memory dir explicitly. Every public function's `dir` parameter defaults to `getMemoryDir()`, which reads the **`BISMUTH_MEMORY_DIR`** env var and **throws** when it is unset:

```ts
export function getMemoryDir(): string {
  const dir = process.env.BISMUTH_MEMORY_DIR;
  if (!dir) throw new Error("BISMUTH_MEMORY_DIR is not set — pass an explicit memory dir");
  return dir;
}
```

So a missing dir fails loudly instead of silently reading the wrong place. Three callers supply it:

- The **daemon runtime** passes the active vault's `ctx.memoryDir` explicitly on every call — e.g. `buildQueryOptions` (`daemon/src/daemon/session.ts`) sets `BISMUTH_MEMORY_DIR: ctx.memoryDir` in the env of every daemon session it starts, cron or interactive, and `cronMemoryInstruction(ctx.memoryDir)` (`daemon/src/daemon/cron.ts`) appends the same directory, plus a warning against writing notes with Write/Edit, onto every cron's own prompt text regardless of what the cron body says.
- The **per-session MCP** memory tools and the **relay** recall/collect hooks run inside Bismuth terminals where `core/src/terminal.ts` injects `BISMUTH_MEMORY_DIR` — **only when `settings.daemon.enabled` is true for that vault**.

This is why memory is recalled/collected strictly for vault-scoped sessions, never globally via `~/.claude/settings.json`.

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

> **Footnote on undeclared types.** `search.ts` `TYPE_BOOST` references `feedback` and `reference` note types that are **not** in the declared `NoteType` union. They are still scored at runtime but never declared — treat the union as descriptive, not exhaustive. (There is no code-level restriction on which types a consolidation pass may write any more — the `dream` cron's prompt, covered below, is plain text with no schema behind it.)

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

**Consumer:** `recallMemory(dir, prompt, budgetMs?)` (`memory/src/recall.ts`) calls `searchMemory(prompt, dir)` under an 800ms `RECALL_BUDGET_MS` race (a bloated graph degrades to "no recall" rather than stalling prompt submission) and formats matches under a `# Memories` heading (`formatRecall`). It is the ONE shared recall path behind **both** auto-injectors: the relay `UserPromptSubmit` hook (`relay/bin/recall-hook.ts`, terminal-tab CLI sessions — `recallContext` aliases `recallMemory`) **and** the visual chat (`core/src/chat.ts`, an SDK session that registers an in-process `hooks.UserPromptSubmit` calling the same function). Both inject the result as `additionalContext`. (See [communication.md](communication.md) for the hook plumbing.)

## The dream consolidation cycle (the `dream` cron)

> **This module is gone.** `daemon/src/memory/dream.ts` was deleted in commit `be3bd5f7`, whose message records that it "had zero importers and zero uses of its exports, superseded by the dream cron." `daemon/src/memory/` does not exist at all any more — `daemon/src/` now holds only `daemon/` and `lib/` — and none of the symbols this section used to document (`dream(ctx)`, `groupByFolder`, `BATCH_SIZE`, `CONSOLIDATION_PROMPT`, `parseDreamResult`, `startDreaming`/`stopDreaming`, `getDreamConfig`/`updateDreamConfig`) exist anywhere in the repo any more (verified by grep). There is no TypeScript "dream cycle" module to document — consolidation is now entirely a **cron**, and this section documents that instead.

**What runs instead: the `dream` cron.** It is a plain prompt — the `DREAM` string constant in `daemon/src/daemon/defaultCrons.ts` — seeded non-clobbering into `<vault>/.daemon/crons/dream.md` by `reconcileSeeds` (`daemon/src/daemon/seeds.ts`) on every fresh vault. Its frontmatter:

```
name: dream
schedule: 0 * * * *
timeout: 1800
catchup: true
incremental: true
checkpointDir: memory
```

- **Hourly** (`0 * * * *`), dispatched through the vault's own persistent daemon session (`sendMessage`, `daemon/src/daemon/session.ts`) — not a separate one-off model call. Cron scheduling, catchup and notify semantics are shared by every cron and are covered in full in [crons-and-processes.md](crons-and-processes.md); this page covers only what's specific to memory.
- **`incremental: true` + `checkpointDir: memory`** — before firing, the daemon diffs `refs/bismuth/cron-dream` against the memory dir (`resolveIncrementalRun`, `daemon/src/daemon/incrementalCron.ts`) and skips the session entirely when nothing has changed there since the last successful run, instead of re-surveying an unchanged graph every hour.
- **No JSON round-trip any more.** The deleted module's shape — one prompt in, a `DreamResult` (`merge`/`improve`/`delete`) JSON back out, applied by daemon-side code calling `writeNote`/`deleteNote` — went with the file. The cron session now calls the `remember`/`recall`/`forget` MCP tools **directly, live**, during its own run: every consolidation action is a tool call the model makes itself, and there is no `MergeOp`/`ImproveOp` type and no daemon-side code left that applies a merge.
- **`daemon/src/lib/config.ts` still exports `DEFAULT_DREAM_INTERVAL_MS`** (6h) — a leftover from the old in-process timer. It is unused dead code now: nothing in the current cron path reads it, as [crons-and-processes.md](crons-and-processes.md) notes explicitly. There is no `startDreaming`/`stopDreaming` per-vault timer any more — the hourly cron above is the only trigger, and it is vault-scoped simply because every cron already runs per-vault (see [crons-and-processes.md](crons-and-processes.md)).

**What the prompt actually does**, at a high level (the full text lives in `defaultCrons.ts`):

1. **Survey by size** — list every note with its byte size; measure total markdown bytes directly (`find` + `ls -l`, explicitly NOT `du` on the memory dir, since it's a git repo and `du` would be dominated by `.git`). Over 5 MB total or any single note over 100 KB means the graph is bloated and triage is the priority.
2. **Triage oversized notes** (>100 KB) — `forget` broken `auto-*` bloat outright without reading it; for anything else, peek at the first 4 KB, split salvageable content into atomic notes via `remember`, then `forget` the original.
3. **Collapse date-stamped snapshots into one canonical note** — runs over the whole graph on every fire regardless of scope, because duplicates can be spread across runs a scoped pass would never see. Any note whose name carries a date, a month, or a moment suffix (`-final`, `-checkpoint`, `-update`, `-snapshot`, `-status`, `-latest`, `-escalation`) is merged into one topic-named canonical note with an internal `## History` section — "it's a historical record" is explicitly rejected as a reason to keep the duplicates.
4. **Process small `type: auto` notes** (<100 KB) — these are the raw session transcripts `relay/bin/session-end-hook.ts` writes (see below). Extract anything useful into a properly-typed note via `remember`, attributing carefully between the transcript's `**You:**` and `**Claude:**` sides, then `forget` the auto note.
5. **Targeted `recall` dedup** — `recall("type:fact")`, `recall("type:preference")`, `recall("type:project")` etc. to find and merge duplicates, tighten unclear notes via `remember`, and split notes covering more than one idea into their own atomic notes.
6. **Delete stale isolated notes** — only on a first/full run, or when a scoped note looks abandoned: a note with no recent `updated:` frontmatter AND no inbound `[[backlinks]]` is a deletion candidate; connected notes survive regardless of age.

The prompt explicitly forbids the session from writing a note about its own runs — a self-referential "dream-cycle"/"consolidation-log" note with an appended "Cycle N" block was itself once the largest file in a real graph — and instructs it to `forget` such a note on sight if one already exists. There is no enumerated list of allowed merged-note types any more; that was a property of the deleted module's `CONSOLIDATION_PROMPT`, not of the current prompt. The run ends by **printing** one report line — `bloat-deleted=N snapshots-collapsed=N auto-processed=N merged=N improved=N stale-deleted=N notes=N size=XKB` — as session output, never as a memory note; the daemon reads this off the transcript rather than the model writing it into the graph.

> **Where do `auto` notes come from?** The relay `SessionEnd` hook (`relay/bin/session-end-hook.ts` → `collectTranscript` in `relay/lib/memory.ts`) saves a finished terminal session's **whole conversation** — both the user's prompts and Claude's responses — as a `type: auto` note (`auto-<timestamp>-<sid>`), which the dream cron's Step 4 above later consolidates. The transcript→note logic is the shared pure module `memory/src/transcript.ts`: exchanges are **paired per logical turn** (`## Turn N` with `**You:**`/`**Claude:**` sides — tool round-trips collapse into their turn, tool payloads are never included), each message is capped at `PER_MESSAGE_CHARS` (1500) chars, and the whole body is budgeted at `MAX_BODY_CHARS` (12000) chars with turn-aware middle-elision (`_(N turns omitted)_`) so no turn is ever split. All mechanical — zero LLM tokens at collect time. Cron-fired and trivial sessions are dropped (the trivial check sums BOTH roles, so a "continue" prompt that made Claude do real work still counts), and `compact` is skipped (the same logical session continues). See [communication.md](communication.md).
>
> **Refreshing an existing vault's dream prompt:** seeds never clobber a file the user has edited, so a stock `dream.md` upgrades automatically the next time the brain starts — `reconcileSeeds` (`daemon/src/daemon/seeds.ts`) hashes the on-disk file, and a match against any entry in `PRIOR_SEED_HASHES['dream']` (an append-only list of every past stock version, in `seeds.ts`) is replaced with the current `DEFAULT_CRONS` content in place. A hash that was never added to that list is misclassified as user-customized and left untouched forever — see [The `PRIOR_SEED_HASHES` git-history guard](crons-and-processes.md#the-prior_seed_hashes-git-history-guard) for the mechanism that is meant to prevent that.

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

Source: `memory/src/{index`, `graph`, `query`, `search`, `recall`, `transcript}.ts`, `daemon/src/lib/config.ts`, `daemon/src/daemon/{seeds`, `defaultCrons`, `cron`, `session`, `incrementalCron}.ts`, `mcp/src/{server`, `memory}.ts`, `relay/lib/memory.ts`, `relay/bin/{recall-hook`, `session-end-hook}.ts`, `core/src/chat.ts`
</content>
</invoke>
