# Memory store

claude-bot's **memory** is a flat tree of markdown notes on disk plus a handful of pure functions that read, parse, query, score, and consolidate them. There is no database, no search index, and no embeddings — "the graph" is just the `[[wikilink]]` edges between notes, and it is **recomputed on demand** every time something needs it by re-reading the whole vault (`loadAllNotes`).

This page documents that store: where notes live, the note model and on-disk format, the two distinct retrieval paths (exact filtering vs. ranked lexical search), and the consolidation ("dream") cycle. Related: the dream cron in [crons-and-processes.md](crons-and-processes.md), the recall hook in [communication.md](communication.md), the memory MCP tools in [mcp.md](mcp.md), and the system [overview.md](overview.md).

## There is NO index file

> **Do not go looking for a `MEMORY.md` index in the memory store — there isn't one.** A repo-wide search finds zero references to such a file under the memory dir. The directory is a flat tree of `.md` notes; the link graph, search rankings, and consolidation batches are all derived live by scanning files. There is no persisted adjacency list, no manifest, no SQLite, and no vector store.

(Claude Code, the host harness, separately keeps its own `MEMORY.md` index for *its* file-based memory. That is an unrelated host-level feature and is **not** part of this store. Don't conflate the two.)

## Where notes live

`MEMORY_DIR` is `~/.claude-bot/memory`, derived from `BOT_DIR` in `lib/config.ts`. `getMemoryDir()` returns it, and every public function defaults its `dir` parameter to it.

- **One note = one markdown file** named `<name>.md`.
- Notes live either at the **root** of the memory dir or in **single-level folders** (e.g. `moltbook/voting.md`).
- **No deeper nesting.** `listNotes` silently drops anything more than one level deep — a file at `a/b/c.md` is invisible to the store.

```
~/.claude-bot/memory/
  alice.md              # root note,   name = "alice"
  project-x.md          # root note,   name = "project-x"
  moltbook/
    voting.md           # folder note, name = "moltbook/voting"
  people/
    alice.md            # folder note, name = "people/alice"
```

## The note model

Defined in `memory/graph.ts`:

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

> **Footnote on undeclared types.** `search.ts` `TYPE_BOOST` and the `dream.ts` consolidation prompt both reference `feedback` and `reference` note types that are **not** in the declared `NoteType` union. They are scored and handled at runtime but never declared — treat the union as descriptive, not exhaustive.

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
| Body | `<frontmatter>` then a blank line then `<content>` |

### Parsing (lenient, hand-rolled — NOT a YAML library)

`parseNoteFile` and `parseFrontmatter` are bespoke string parsers, not a YAML dependency:

- `parseNoteFile` splits the file on `/^---\s*$/m`. If the **body itself** contains a `---` line, the content is re-joined via `slice(2).join("---")`, so dashes inside the note survive.
- `parseFrontmatter` splits **each line on the FIRST colon** only. A value that starts with `[` and ends with `]` is parsed as a comma-split array; a single scalar `tags` value is coerced into a one-element array.
- **Missing/absent frontmatter defaults:** `type` → `"fact"`, `tags` → `[]`, `created`/`updated` → today.

### Backlinks (the graph edges)

`extractBacklinks` runs the regex `/\[\[([^\]]+)\]\]/g` over the content, trims each capture, **dedupes via a `Set`**, and drops empty/whitespace-only matches.

Edges are **folder-agnostic and resolved by bare name.** `findBacklinks(name)` loads all notes and matches on `n.backlinks.includes(parseNoteRef(name).name)`. So a note in `moltbook/` can `[[alice]]`-link to `people/alice` — only the bare segment `alice` is compared. There is **no on-disk adjacency**; the graph is recomputed on each `findBacklinks` call.

### Names, folders, and safety

| Function | Behavior |
| --- | --- |
| `sanitizeSegment` | Replaces `/` and `\` with `-`, strips `..`, strips leading/trailing `.`/`-`, collapses repeats. A name that fully sanitizes away (`"..."`, `"---"`, `""`) makes `notePath` throw `"Invalid note name"`. |
| `parseNoteRef(ref)` | Strips a trailing `.md`, splits on the **first** `/` into `{ folder?, name }`. |
| `sanitizeFolder` | Same sanitization rules as `sanitizeSegment`. |
| `notePath` | Builds the path, then does a final `resolve().startsWith(dir)` traversal guard. |

## Public API by module

### `memory/graph.ts` — CRUD + graph primitives

No caching and no index: `loadAllNotes` re-reads the entire vault on every call.

| Function | Returns | Notes |
| --- | --- | --- |
| `getMemoryDir()` | `string` | The `MEMORY_DIR` path |
| `sanitizeFolder(folder?)` | `string` | Sanitizes a folder segment |
| `parseNoteRef(ref)` | `{ folder?, name }` | Strips `.md`, splits on first `/` |
| `listNotes(dir?, folder?)` | `Promise<string[]>` | Glob `*.md` folder-scoped, or `**/*.md` recursive (single-level only); non-root names are folder-prefixed |
| `readNote(name, dir?, folder?)` | `Promise<MemoryNote \| null>` | `null` if absent |
| `writeNote(name, fm, content, dir?, folder?)` | `Promise<void>` | Serialize + `Bun.write`; create-or-overwrite |
| `deleteNote(name, dir?, folder?)` | `Promise<boolean>` | |
| `loadAllNotes(dir?, folder?)` | `Promise<MemoryNote[]>` | `listNotes` then `readNote` each in parallel, filters out nulls |
| `findBacklinks(name, dir?)` | `Promise<string[]>` | Bare-name match across all folders |

### `memory/query.ts` — structured filter queries (exact boolean, NOT ranked)

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

An empty query returns **all** notes.

### `memory/search.ts` — keyword scoring / ranking (the recall engine)

This is a **different retrieval path** from `query.ts`: ranked lexical relevance, not exact boolean filtering. Don't conflate them.

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

- `searchMemory(prompt, dir?, maxResults = 10)`: extract keywords → score all notes → keep `score >= MIN_SCORE` (`1.0`) → sort descending → cap by `maxResults` **and** by `MAX_CONTEXT_BYTES` (`4096`) cumulative size. It always emits at least one match if any note qualifies.

The mechanism is lexical/substring matching + stemming + weighted scoring. **No embeddings, no TF-IDF, no external index.**

**Consumer:** `bin/recall-hook.ts` (a `UserPromptSubmit` hook) calls `searchMemory(prompt)` and injects the matches as `additionalContext`, formatted as:

```
## Relevant memories
[matched note contents...]
```

(See [communication.md](communication.md) for the hook plumbing itself.)

### `memory/dream.ts` — the consolidation ("dream") cycle

**What it does.** An LLM-driven dedup / merge / improve / prune pass over the notes. The crucial detail: it runs **through the bot's own persistent session** — dispatch is `sendMessage(prompt).result` — not a separate one-off model call.

**`dream(dir?)`:**

1. `loadAllNotes`; bail if there are fewer than 2 notes.
2. `groupByFolder`. **Folders are hard semantic boundaries** — consolidation **never** crosses them. Root notes are grouped under the key `""`.
3. Per folder (skip any folder with fewer than 2 notes), batch in `BATCH_SIZE` (`20`) notes.
4. Per batch, build a JSON array of `{ name (bare), type, tags, created, updated, content, backlinks }`, append it to `CONSOLIDATION_PROMPT` along with today's date, and dispatch.

**`CONSOLIDATION_PROMPT`** instructs the session to: return JSON only; stay strictly scoped to memory (**forbidden** from touching crons / processes / daemon config); **prioritize processing `type: "auto"` notes** (extract their value → merge into or create typed notes → delete the auto note); and apply **memory decay** (old notes that are isolated in the backlink graph are deletion candidates *unless* timeless; well-connected notes survive).

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
  updatedType: string;
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
| `merge` | Delete each dup first (**abort the merge if any delete fails**), then `writeNote` the kept note with merged content/tags/type, preserving the original `created`, stamping `updated` = today |
| `improve` | Must reference an existing note in the batch; `writeNote` with new content/tags and `updated` = today |
| `delete` | `deleteNote` each |

`dream` returns counts `{ merged, improved, deleted }`.

**How it's triggered** — two paths:

1. The shipped **hourly cron** `defaults/crons/dream.md` (see [crons-and-processes.md](crons-and-processes.md)).
2. The in-process timer `startDreaming(config?)`, firing every `intervalMs`. `DEFAULT_DREAM_INTERVAL_MS` is **6h**.

   > The README prose says "hourly," but the **code default is 6h**. The code is authoritative. `stopDreaming` / `getDreamConfig` (which adds a `running` flag) / `updateDreamConfig` (restarts the loop only if it is already running) round out the timer API.

It is also exposed over MCP as `dream_run` / `dream_status` / `dream_config` (see [mcp.md](mcp.md)).

## Cross-cutting facts

- **No index, no DB, no embeddings.** The "graph" is markdown files re-scanned via `loadAllNotes` on every read / query / search / dream.
- **Two distinct retrieval paths.** `query.ts` = exact boolean filters; `search.ts` = ranked lexical relevance (the recall hook). Keep them separate in your head.
- **Folders** are single-level, sanitized, AND-scoped in queries, hard boundaries during dreaming, and transparent to backlinks (which match by bare name across all folders).
- **The frontmatter parser is hand-rolled and lenient** — first-colon splits, bracket-array tags, today-defaults for missing fields — not a YAML library.

Source: lib/config.ts, memory/graph.ts, memory/query.ts, memory/search.ts, memory/dream.ts, bin/recall-hook.ts, defaults/crons/dream.md
