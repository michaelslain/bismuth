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
| `type` | `person`, `project`, `workflow`, `fact`, `preference`, `daily`, `auto`, `profile`, `hub`; other text is accepted | Groups notes; recall ranks `preference` and `workflow` slightly higher and `daily` and `auto` lower. `profile` and `hub` have their own roles, below. Defaults to `fact` |
| `tags` | inline list `[a, b]` | Matched by `tag:` queries and ranked as a title field |
| `created`, `updated` | `YYYY-MM-DD`, local date | `updated` drives `after:` and `before:` filters. Missing values default to today |
| `description` | one line | Says when the note matters. The session-start index shows only this line for each note, clipped to 160 characters. Without one, the index uses the note's first prose sentence, which skips headings, lines ending in `:` and short `Label:` prefixes such as `Status:` |
| `visibility` | `chat-only` or `hidden` | Keeps the note away from agents; see below |

Keep frontmatter simple: the parser is not YAML. It splits each line at the first colon, reads only the inline `[a, b]` list form for `tags`, and ignores a line with no colon.

Notes sit at the top of the memory folder or one folder down (`trips/spring-trip.md`). A file two folders down is invisible to every tool. Note names have `/`, `\` and `..` replaced or stripped so a name cannot leave the folder. A `[[link]]` matches a note by its bare name in any folder, so `[[spring-trip]]` links to `trips/spring-trip`.

## Profile and hub notes

A `profile` note is the always-on summary of who you are. The note named `user-profile`, or any note of type `profile`, is shown in full at the top of every session's memory block and never as an index line. It is cut at 1,500 characters, so keep it to stable facts: who you are, what you do and how you like to work.

A `hub` note lists the members of one topic, one line each, with a `[[link]]` per member. Hub lines sort first in the session-start index, and a hub may be longer than the 2,000 characters other notes are held to. A topic with four or more notes is a candidate for a hub.

## Check the health of the graph

The memory health report lists structural problems in the graph, worst first, as a numbered agenda. `dream` reads it at the start of every run ([crons and processes](crons-and-processes.md#seeded-crons-and-files)). Each item has a kind, the notes it concerns (up to ten) and a one-line fix.

| Kind | Reported when |
|---|---|
| `no-profile` | No `profile` note exists |
| `status-lines` | A note has three or more lines with an explicit date older than 14 days, outside a `## History` section |
| `oversized` | A non-hub note body is over 2,000 characters |
| `dated-tags` | A tag is `latest`, `status` or `current`, or contains a month name or a four-digit year |
| `duplicate` | Two notes' names and descriptions share at least 60% of their words |
| `cluster` | Two or more notes share a name once dates, months and status words are removed |
| `broken-link` | A `[[link]]` resolves to no memory note and no vault note |
| `no-hub` | Four or more notes share a tag or a name stem and no hub links at least half of them |
| `dated-name` | A name carries a date, a month or a status word such as `-final` or `-update` |
| `no-source` | A note links to no vault note and carries no `(session YYYY-MM-DD)` marker; profile and hub notes are exempt |
| `orphan` | A note has no wikilink in or out |
| `no-description` | A note other than the profile has no `description` |

Transcript notes (`auto-*`) are skipped, and a restricted note never appears. `broken-link` and `no-source` need the vault's note names, so they appear only when the daemon supplies them. A `(session YYYY-MM-DD)` marker counts as a source.

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

The seeded `dream` cron works the memory health report worst first, at most 12 items per run, then folds your changed notes and the session transcripts that your terminal sessions and chats save as `auto-*` notes into a small set of canonical notes. It writes memory only through `remember` and `forget`, and files an inbox page only when something needs you. [Crons and processes](crons-and-processes.md#seeded-crons-and-files) describes the full run.

The rules it follows when it writes a note:

- It keeps one `user-profile` note of at most 1,500 characters.
- It writes atomic notes of at most 2,000 characters, and gives a topic with four or more notes one `hub` note.
- It links each fact it adds to the vault note it came from, or ends it with `(session YYYY-MM-DD)`.
- It moves a replaced fact to a dated line under `## History` instead of erasing it, and carries every fact over when it splits a note.
- It never stores what the vault answers live, such as task counts or "this week" status, and links the source note instead.
- It words facts about you neutrally, with no alarm words or psychological verdicts.
- It gives every note it touches a one-line `description`, and uses `bismuth map --around <note>` ([vault map](../vault/map.md)) to see where a vault note sits before linking it.

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
| `graph.ts` | Note create, read, delete, list; backlinks; the visibility check; `noteDescription`, the index line's description |
| `query.ts` | The filter syntax above, behind the `recall` tool |
| `rank.ts` | BM25 ranking for injection |
| `pack.ts`, `recall.ts` | Cut ranked notes into the bounded `<bismuth-memory>` block; `pack.ts` also holds `formatProfile` (the profile, cut at 1,500 characters on a line boundary) and the index order (hubs first, then in-links, recency, type) |
| `health.ts` | `brainHealth` computes the health report items and `formatBrainHealth` renders them as a numbered list capped at 3,000 characters; the daemon fills `{{brainReport}}` in a cron prompt with it (`daemon/src/daemon/brainReport.ts`) |
| `transcript.ts` | Turn a finished conversation into an `auto-*` note |
| `search.ts` | `searchMemory`, a ranked search that returns whole notes (up to 10) above the prompt-mode score floor |

Source: `memory/src/{graph,query,rank,pack,recall,search,health,noteCache,transcript}.ts`, `daemon/src/daemon/{brainReport,defaultCrons}.ts`, `mcp/src/memory.ts`, `cli/src/commands/memory.ts`, `core/src/{memoryRecall,backup}.ts`
