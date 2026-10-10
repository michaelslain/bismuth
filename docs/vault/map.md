# Vault map

The vault map is a short, deterministic overview of how a vault is organised: its folders, most-linked notes, clusters of related notes and the places where tasks, flashcards and bases live.
Bismuth builds it from the link graph with no model involved, and gives it to AI agents so they orient before they search.
Read it to see what an agent knows about your vault at the start of a session, or run it yourself to get the same picture.

```bash
bismuth map --vault ~/Notes
```

```text
# vault map (29 notes)

## folders
- reading/ 11, 11 recent, types: book, keys: rating type
- projects/ 10, 10 recent, types: project, keys: status type
  - projects/alpha/ 5, 5 recent, types: project, keys: status type
  - projects/beta/ 5, 5 recent, types: project, keys: status type
- daily/ 6, 6 recent, types: daily, keys: type, named YYYY-MM-DD
- (root) 1, 1 recent
- templates/ 1, 1 recent, types: template, keys: type

## hubs
- projects/alpha/Roadmap.md (16 in, 3 out)
- reading/Dune.md (11 in, 2 out)
- reading/Gamma.md (10 in, 2 out)
- projects/alpha/Launch.md (5 in, 3 out)

## clusters
- #reading (11): reading/Dune.md, reading/Gamma.md, reading/Solaris.md; in reading
- Roadmap (8): projects/alpha/Roadmap.md, Home.md, daily/2026-10-01.md; in daily, (root), projects/alpha
- Api (5): projects/beta/Spec.md, projects/beta/Api.md, projects/beta/Deploy.md; in projects/beta

## surfaces
- open tasks in 6 notes (mostly daily)
- 11 flashcard notes
- daily notes: daily/
- templates: templates/

## tags
#flashcards 11, #reading 11, #planning 5
```

The output is from a small demo vault, trimmed to the first hubs and clusters; a `## recent` list of the latest notes follows the tags.

## What does the map show?

Each section answers one orientation question. A section with nothing to report is left out.

| Section | What it lists |
|---|---|
| `folders` | Top-level folders with their second-level folders indented under them, each with its note count |
| `hubs` | The most linked notes, as `(N in, M out)` link counts |
| `clusters` | Groups of closely linked notes, with their size, the best-connected notes and the folders they sit in |
| `surfaces` | Where bases, open tasks, flashcards, daily notes and templates live |
| `tags` | The most used tags, with how many notes carry each |
| `recent` | The latest-edited notes with their date |

A folder line carries four facts after its note count:

- `N recent` counts notes edited in the last 14 days.
- `types:` lists the `type` property values that at least 30% of the folder's notes share.
- `keys:` lists the most common frontmatter keys.
- `named YYYY-MM-DD` appears when most of the folder's notes are named by date.

Notes in the vault root appear as `(root)`.

Surfaces show a base count with the folders holding most of them, the number of notes with open tasks (a task that is to do or in progress), the number of notes tagged `flashcards`, the folder most likely to be the daily-notes folder (the date-named folder edited most recently, ignoring archives) and a folder named `templates` or `template`.

## Where do agents see the map?

An agent gets the map in two places:

- **At session start.** In a vault with the daemon enabled, the memory block an agent receives when a session starts, resumes, clears or compacts carries a `# Vault map (N notes)` section, after the `# Who you are working with` profile and before the memory index. [Memory injection](../daemon/communication.md) describes the block.
- **On demand.** The `vault_map` MCP tool runs `bismuth map`, and the `brain` MCP tool runs `bismuth brain`. An agent whose context has no `# Vault map` section calls `brain` once at the start.

The MCP tools run against the session's vault and the session's visibility channel, so an agent reads the same restricted view it gets everywhere else.

## How do I print the map?

Run `bismuth map` with the vault to read.

| Flag | Effect |
|---|---|
| `--vault <dir>` | The vault to map |
| `--folder <folder>` | Limit folders, clusters and hubs to that folder and its subfolders. Note count, surfaces, tags and recent notes stay vault-wide |
| `--around <note>` | Print the neighbourhood of one note instead of the whole map |
| `--json` | Print the map as JSON |
| `--pretty` | Indent the JSON |

`--folder` matches the folders the map lists, which are two levels deep, so `--folder projects/alpha/deep` matches nothing and prints no folders.

The text output is capped at about 6,000 characters. A larger vault loses detail in a fixed order (see [What drops first when space is short](#what-drops-first-when-space-is-short)); `--json` is never trimmed.

`bismuth brain --vault <dir>` prints the whole session-start block: the profile, the map and the memory index, as the calling channel sees it. Run it to check exactly what an agent receives.

## How do I see where one note sits?

`--around` takes a note path, with or without `.md`, and prints that note's neighbourhood:

```bash
bismuth map --around projects/beta/Spec --vault ~/Notes
```

```text
# projects/beta/Spec.md
cluster: Api
links to: projects/alpha/Roadmap.md, projects/beta/Api.md, projects/beta/Deploy.md
linked from: Home.md, projects/beta/Api.md, projects/beta/Deploy.md, projects/beta/Docs.md, projects/beta/Tests.md
siblings: projects/beta/Api.md, projects/beta/Deploy.md, projects/beta/Docs.md, projects/beta/Tests.md
```

| Line | Meaning |
|---|---|
| `cluster` | The cluster the note belongs to |
| `links to` | Notes this note links to |
| `linked from` | Notes that link to this note (backlinks) |
| `siblings` | Other notes in the same cluster, best-connected first, at most 12 |
| `tags` | The note's tags |
| `memories` | Memory notes that link to this note by name or path |

A line with no entries is left out. `--json` prints the same data as an object.

`--around` needs the note's path from the vault root, not just its name. If the note is not in the vault, or a restricted note hides it, the command prints `note not found: <note>` and exits non-zero.

## What does a restricted note contribute?

Nothing. The map respects [visibility controls](visibility.md) for the channel that asks. A note hidden from that channel is dropped before the map is built, so it adds no count, link, tag, hub or cluster member, and it does not shift how the remaining notes group. A restricted base is not listed, and a restricted memory note never appears under `memories`.

The owner running `bismuth map` from their own shell sees the whole vault. A session on the daemon channel loses `hidden` and `chat-only` notes; a chat session loses `hidden` ones. If visibility cannot be determined, the command fails rather than printing an unfiltered map.

## Why is a section missing or short?

- **No `clusters` section.** Clustering needs at least 30 graph nodes (notes plus tag nodes). A smaller vault prints no clusters. A cluster with fewer than three notes is never listed.
- **No `hubs` section.** No note has any links, or the size limit removed the section.
- **No `recent` section.** No note was edited in the last 14 days, or the size limit removed it.
- **Folders without `types:` or `keys:`.** A folder's notes need a `type` property shared by at least 30% of them to earn a `types:` entry; notes without frontmatter add no keys.
- **A note missing from `hubs`.** Only the ten most linked notes appear, and tags never count as hubs. Repeated links to the same note count once, and a link from a note to itself is ignored.

## How it works

### What it reads

`buildVaultMap` in `core/src/vaultMap.ts` builds the map from the same vault graph the graph view uses (`buildVaultGraph`), then reads each surviving note once for its frontmatter keys, `type`, tags, open tasks and modified time.
Visibility is applied first: notes denied to the channel are removed from the graph, along with the edges that touch them, before any count, degree or cluster is computed. Tag nodes that lose all their edges drop out too.

### Clusters and hubs

A cluster is a finest-level community from `detectCommunityHierarchy` (`core/src/community.ts`), the deterministic Louvain detection that colours the graph view, run over the visible graph with notes and tags as nodes. The detection runs only at 30 or more nodes, mirroring `stampCommunities` in `core/src/engine.ts`.
Only note members count towards a cluster's size, and clusters of fewer than three notes are dropped. Clusters sort by size, then id. Each lists its three best-connected notes (by in plus out links) and the three folders holding most of its members.

A hub is a note ranked by distinct in links plus distinct out links, ties broken by path. The ten best-ranked notes with at least one link are kept.
Folders sort by note count, then path. The recent list holds up to ten notes edited in the last 14 days, and the tag list up to fifteen tags.

### What drops first when space is short

`formatVaultMap(map, budgetChars)` renders the map at the highest detail and steps down a fixed ladder until the text fits, stopping at the first fit:

1. Drop the `recent` section.
2. Drop the `tags` section.
3. Drop cluster exemplars and folders, leaving `label (size)`.
4. Drop the base names from the `bases` surface line.
5. Cap clusters at 20, hubs at 5 and second-level folders per top-level folder at 3.
6. Cap clusters at 10, hubs at 3 and second-level folders at 1.
7. Cap clusters at 5 and drop second-level folders.
8. Drop hubs.
9. Drop the per-folder detail (recent counts, types, keys, naming).
10. Drop clusters.

If the text is still too long, for example with hundreds of top-level folders, it is cut at a line boundary. Surfaces are never dropped.

`bismuth map` uses a budget of 6,000 characters. The session-start block gives the map 2,200 characters, header included, out of 9,500 for the whole block.

### Neighbourhood

`vaultNeighbourhood` reads the visible graph without file contents. Siblings are the other members of the note's cluster, sorted by link count and capped at 12. For `memories` it scans the vault's memory directory and keeps each memory note whose wikilinks name the note by base name or by path, skipping memory notes the channel may not see.

### Caching

`composeBrain` in `core/src/brain.ts` caches one built map per vault and channel. The cache drops when core's watcher sees a vault change, when the daemon's file watcher flushes a burst, and after 5 minutes. A build that starts before a drop never writes its result back.
Concurrent callers share one build. A caller waits up to a limit (1 second by default; the daemon waits longer for a cold vault), and a session that cannot get the map in time starts without the section while the build finishes for the next caller.
`bismuth map` and `bismuth brain` run in their own process and build fresh each time. `bismuth brain` waits up to ten minutes for a cold build.

### Channels and tools

`bismuth map` reads its deny list with `agentDenyEntries` (`core/src/visibilityFilter.ts`), which is empty for the owner and fails closed for an agent. `bismuth brain` picks the `daemon` channel when either environment signal says so and the `chat` channel otherwise.
The `vault_map` and `brain` tools in `mcp/src/server.ts` spawn the same CLI commands with `--vault` set to the daemon vault root, which is why the CLI and the tools never drift. A session outside a vault gets `Not in a Bismuth vault: no vault map available.`

Source: `core/src/vaultMap.ts`, `core/src/brain.ts`, `core/src/community.ts`, `core/src/visibilityFilter.ts`, `cli/src/commands/map.ts`, `cli/src/commands/brain.ts`, `mcp/src/server.ts`
