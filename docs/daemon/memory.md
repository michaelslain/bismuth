# Daemon memory

The memory is a vault's "3rd brain": a folder of markdown notes at `<vault>/.daemon/memory` that the daemon and your AI agents read and write. Notes link to each other with `[[wikilinks]]`, and the graph view draws them as `mem:` nodes. It exists only while `daemon.enabled` is on. Read this page to learn the note format, the three tools that edit memory, and how to find a note; [communication](communication.md) covers how notes reach agent sessions on their own.

A note, as `bismuth memory remember --name alice --type person --tags friend,climbing --description "Climbing partner; plans trips in the spring" --content "Alice climbs with me on weekends. See [[spring-trip]]." --vault ~/vault` writes it to `.daemon/memory/alice.md`:

```markdown
---
type: person
tags: [friend, climbing]
created: 2026-10-07
updated: 2026-10-07
description: Climbing partner; plans trips in the spring
---

Alice climbs with me on weekends. See [[spring-trip]].
```

## Note format

| Key | Values | Effect |
|---|---|---|
| `type` | `person`, `project`, `workflow`, `fact`, `preference`, `daily`, `auto`; other text is accepted | Groups notes; recall ranks `preference` and `workflow` slightly higher and `daily` and `auto` lower. Defaults to `fact` |
| `tags` | inline list `[a, b]` | Matched by `tag:` queries and ranked as a title field |
| `created`, `updated` | `YYYY-MM-DD`, local date | `updated` drives `after:` and `before:` filters. Missing values default to today |
| `description` | one line | Says when the note matters; shown in the session-start index, clipped to 160 characters. Falls back to the note's first sentence |
| `visibility` | `chat-only` or `hidden` | Keeps the note away from agents; see below |

Keep frontmatter simple: the parser is not YAML. It splits each line at the first colon, reads only the inline `[a, b]` list form for `tags`, and ignores a line with no colon.

Notes sit at the top of the memory folder or one folder down (`trips/spring-trip.md`). A file two folders down is invisible to every tool. Note names have `/`, `\` and `..` replaced or stripped so a name cannot leave the folder. A `[[link]]` matches a note by its bare name in any folder, so `[[spring-trip]]` links to `trips/spring-trip`.

## Write, find and remove notes

These tools edit memory. Agents get them as MCP tools named `remember`, `recall` and `forget` whenever the daemon is on for the vault ([the MCP daemon tools](../mcp/daemon-tools.md#memory-tools)). You get the same operations as `bismuth memory …` commands, which work headlessly against `--vault`.

| Tool | CLI | Effect |
|---|---|---|
| `remember` | `memory remember --name <n> --content <md> [--type] [--tags a,b] [--folder] [--description]` | Create or overwrite a note by name |
| `recall` | `memory recall <query…> [--folder]` | Return notes matching a query |
| `forget` | `memory forget <name>` | Delete a note; the name may be `folder/name` |

`remember` overwrites the whole body. When you overwrite a note and leave out `type`, `tags` or `description`, it keeps the existing values, and it always keeps the note's `created` date and any `visibility`. It sets `updated` to today. `remember` is the only supported way to write a note: it stamps the frontmatter and files the note where every reader looks. A note written with a plain file tool at another path is not part of the graph.

The tools print JSON. This is `bismuth memory recall "type:person tag:climbing" --vault ~/vault --pretty`:

```json
{
  "ok": true,
  "count": 1,
  "notes": [
    {
      "name": "alice",
      "frontmatter": {
        "type": "person",
        "tags": ["friend", "climbing"],
        "created": "2026-10-07",
        "updated": "2026-10-07",
        "description": "Climbing partner; plans trips in the spring"
      },
      "content": "Alice climbs with me on weekends. See [[spring-trip]].",
      "backlinks": ["spring-trip"]
    }
  ]
}
```

## Query syntax

A `recall` query is a list of space-separated filters, all lowercased. A note must satisfy every filter.

| Token | Matches |
|---|---|
| `tag:x` | Notes with tag `x`. Repeat for several; the note needs all of them |
| `type:x` | Notes of type `x`. Repeat for several; the note may have any one |
| `link:x` | Notes that contain `[[x]]`. Repeat to require several |
| `after:2026-04-01` | Notes updated on or after that date |
| `before:2026-04-08` | Notes updated before that date |
| `keyword:x`, or a bare word | Text anywhere in the body, type, tags, dates or name. Several keywords must all appear |

An unknown prefix such as `owner:alice` is treated as a keyword. An empty query returns every visible note, which is slow on a large graph; give it a filter. This query filters exactly. The ranked search that picks notes to inject into a prompt is a different path; see [communication](communication.md#what-gets-injected).

## Keep a note away from agents

Add `visibility: hidden` or `visibility: chat-only` to a note's frontmatter. A restricted note never appears in `recall` results, in the session-start index or in injected context. An agent that tries to overwrite or delete it is refused: a `hidden` note is off limits to every agent, and a `chat-only` note is off limits to the daemon.

The check fails closed. The strictest `visibility` line in the frontmatter wins, a value the parser cannot read counts as `hidden`, and a file that opens a `---` fence and never closes it counts as `hidden`. A restricted memory note is a per-note setting; there is no folder cascade inside the memory folder. [Visibility](../vault/visibility.md) covers the vault-wide controls.

## How `dream` maintains the graph

The seeded `dream` cron reads your changed notes and the session transcripts that your terminal sessions and chats save as `auto-*` notes, and folds them into a small set of canonical notes. It merges duplicates, collapses dated snapshots into one note, deletes transcripts it has processed, and files an inbox page only when something needs you. It writes memory only through `remember` and `forget`. See [crons and processes](crons-and-processes.md#seeded-crons-and-files).

## How it works

### Storage

`@bismuth/memory` (`memory/src/`) is a pure package: no server, no index, no database. Every read lists the markdown files and parses them (`loadAllNotes` in `graph.ts`); `noteCache.ts` keeps parsed notes between recalls and re-reads only files whose modification time or size changed. The link graph, the query results and the rankings are all derived from the files at read time.

The package never picks a directory. Each caller passes one, or reads `BISMUTH_MEMORY_DIR`, and `getMemoryDir()` throws when that is unset, so a missing directory fails loudly instead of reading the wrong place. The daemon passes `<vault>/.daemon/memory` for each vault. Bismuth's terminal tabs set `BISMUTH_MEMORY_DIR` only when the vault's daemon is on, which is why memory is never active in a vault that has not enabled it.

The memory folder is its own git repository, separate from the vault's. While the app runs, core commits it as notes change, which gives you revert and gives incremental crons a history to diff. The vault's own snapshots skip it.

### Parsing

`parseNoteFile` splits a file at `---` lines and parses the head with a hand-written parser rather than a YAML library: the first colon splits key from value, an `[a, b]` value becomes a list, and a bare `tags` value becomes a one-item list. Body text that itself contains a `---` line survives. `extractBacklinks` reads `[[…]]` with a regular expression, trims, and removes duplicates. Writing uses a fixed key order: `type`, `tags`, `created`, `updated`, then `description` (double-quoted when a plain value would misparse) and `visibility` when set.

### Retrieval modules

| Module | Role |
|---|---|
| `graph.ts` | Note create, read, delete, list; backlinks; the visibility check |
| `query.ts` | The filter syntax above, behind the `recall` tool |
| `rank.ts` | BM25 ranking for injection |
| `pack.ts`, `recall.ts` | Cut ranked notes into the bounded `<bismuth-memory>` block |
| `transcript.ts` | Turn a finished conversation into an `auto-*` note |
| `search.ts` | `searchMemory`, a ranked search that returns whole notes (up to 10) above the prompt-mode score floor |

Source: `memory/src/{graph,query,rank,pack,recall,search,noteCache,transcript}.ts`, `mcp/src/memory.ts`, `cli/src/commands/memory.ts`, `core/src/{memoryRecall,backup}.ts`
