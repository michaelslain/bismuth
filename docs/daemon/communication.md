# Memory injection and device ownership

With the daemon on and `daemon.recall.enabled` set, Bismuth puts the vault's memory in front of your AI agents without being asked; with `daemon.saveSessions` set, it saves their conversations back as raw notes for the `dream` cron to consolidate. A small plugin of Claude Code hooks does this in the app's terminal tabs, and the visual chat does it in-process. Every session opens with one orientation block, the brain, holding who you are, a map of the vault and an index of the memory. Separately, when several devices share one daemon, a single owner device runs its sessions.

Memory reaches an agent inside a `<bismuth-memory>` block, labeled as read-only background from the vault's own store and kept apart from the agent's built-in memory. This is the prompt-time block for "who is going on the April climbing trip":

```
<bismuth-memory>
The notes below are recalled from THIS VAULT'S Bismuth memory (your "3rd brain" for this vault) —
a store SEPARATE from your own native memory. This is read-only background context: do NOT copy it
into your own memory. Use the recall / remember tools to read or update this Bismuth memory store.

# Memories

## alice (person) [friend, climbing]
Path: /Users/me/vault/.daemon/memory/alice.md
Climbing partner; plans trips in the spring
Alice climbs with me on weekends. See [[spring-trip]].

</bismuth-memory>
```

This is the brain a session opens with, trimmed to its shape. The [vault map](../vault/map.md) explains the map part, a shortened form of what `bismuth map` prints:

```
<bismuth-memory>
The notes below are recalled from THIS VAULT'S Bismuth memory (your "3rd brain" for this vault) —
a store SEPARATE from your own native memory. This is read-only background context: do NOT copy it
into your own memory. Use the recall / remember tools to read or update this Bismuth memory store.

# Who you are working with

Michael, builds a local-first vault app. Prefers terse answers.

# Vault map (4 notes)

## folders
- Projects/ 3, 3 recent
- Journal/ 1, 1 recent

## hubs
- Projects/Launch.md (3 in, 2 out)

# Memory index

[[spring-trip]] (project) — April climbing trip with Alice

</bismuth-memory>
```

## What gets injected

Memory is injected at these moments. Each is a request to core's `POST /memory/recall`, and core decides what to send.

| Moment | Hook | What is sent | Limits |
|---|---|---|---|
| A session starts, resumes, clears or compacts | `SessionStart` | The brain: your profile, the `now` note, the vault map, a memory index with one line per note, `[[name]] (type) — description`, and the full text of short `preference` notes | 9,500 characters in all; a line says how many index lines were left out |
| You submit a prompt | `UserPromptSubmit` | Excerpts of the notes that best match the prompt | 5 notes, 900 characters each, 6,000 in total |
| A batch of tool calls ends | `PostToolBatch` | Excerpts matching what the tools just did | 2 notes, 600 characters each, 1,800 in total, with a stricter match rule; one batch per prompt |
| A subagent starts | `SubagentStart` | Excerpts matching the task given to the subagent | 4 notes, 700 characters each, 4,000 in total |

Ranking is BM25 over each note's name, tags, description and body, with the name and tags counting most. Preference notes get a small boost and `daily` and `auto` notes a penalty. A note must clear a score floor to be injected, and in a vault of 12 or more notes a note whose only evidence is a single body word that is a small share of the prompt is dropped. An excerpt is the note's header, its file path, its description and its best-matching section, never the whole note. The prompt and subagent blocks end with up to 5 and 4 one-line pointers to related notes that did not fit. Pointers to notes one wikilink away from an injected note come first.

A prompt is matched on what you typed: the `<editor-context>` block the app puts in front of a chat prompt is removed before ranking.

Tool-batch recall injects for at most one batch between two prompts, and each subagent counts its own. A turn of many tool calls would otherwise drip the next-best unsent notes, each weaker than the last, after every batch.

A note is sent once per session. Core remembers what each session and subagent has seen and skips a note until its content changes. After a `compact` or `clear` the memory has left the agent's context, so the record resets and the session-start index is sent again.

The terminal-tab hooks need the Claude Code CLI. The visual chat runs the same recall in-process on session start, each prompt and each tool batch; opencode chats get the brain on every turn plus prompt-time recall. A recall that takes too long injects nothing: a prompt waits 1,500 ms, a tool batch 700 ms, a subagent 1,500 ms, and session start 1,500 ms in a terminal tab or 3,000 ms in the visual chat and opencode.

## The session-start brain

The brain is one `<bismuth-memory>` block of at most 9,500 characters that an agent reads before its first prompt. It has these parts, in this order:

| Part | Content | Limit |
|---|---|---|
| `# Who you are working with` | The body of the `user-profile` memory note. Omitted when the vault has none | 1,500 characters, cut at a line |
| `# Now (written <updated>)` | The body of the `now` memory note, headed with when it was written: active projects, tasks due soon, open threads and the last few days. Omitted when the vault has none | 1,500 characters, cut at a line |
| `# Vault map (N notes)` | Folders two levels deep, hub notes, clusters and surfaces such as bases, open tasks and daily notes | 2,200 characters |
| `# Memory index` | One line per memory note except day, week and month digests (`type: daily`) and the `now` note, which are reached through `# Now` and time words in a prompt. Ordered by value: hubs first, then notes with the most links in, then the most recently updated | the rest of the block |
| `# Preferences` | The full text of short `preference` notes | 4,000 characters in all, 1,200 per note |

A line's description is the note's `description`, else its first sentence with headings and labels such as `Status:` skipped. A `preference` note's index line is kept before any other line, and dropped when the note's body is shown: the body replaces the line. An index line that does not fit is skipped and the next one is tried, and a closing line counts the notes left out. With a profile and map present, preference bodies give way first so the other index lines keep room.

When the parts do not fit together, the map is dropped first, then the profile and `# Now`, and the index stays. A vault whose memory directory is empty, with the daemon on, still gets the vault map at session start; without a vault there is nothing to send. Restricted notes are absent from the map and the index; the daemon's view is narrower than a chat's ([visibility](../vault/visibility.md)).

The brain is composed for the channel that asks. Chat callers (terminal-tab hooks, the visual chat and opencode) get the chat view. A request that names no channel gets the daemon view, which hides more, so a caller that forgets to identify itself sees less rather than more.

The brain reaches each kind of session in its own way:

| Session | How the brain arrives |
|---|---|
| Terminal tab | The `SessionStart` hook of the relay plugin |
| Visual chat | A `SessionStart` hook that asks the same recall service in-process. It is sent again after `compact` and `clear` |
| opencode chat | The system field of every turn. It is kept for the session only once it holds a `# Vault map` section; until then (a timeout, or a map still building) the next turn asks again |
| Daemon cron and page sessions | Appended to the daemon's persona: Claude gets it in the system prompt, Codex in its developer instructions |
| Any agent using the MCP server or a shell | `bismuth brain` and `bismuth map` (through `bismuth_cli` over MCP), and an instruction telling the agent to run `bismuth brain` when its context has no `# Vault map` section |

`daemon.recall.enabled` off stops the terminal, visual chat and opencode injections. Print the same text yourself with `bismuth brain`, and one note's surroundings with `bismuth map --around <note>`; the [CLI reference](../cli/reference.md#map-and-brain) has the flags.

A vault map is built once and kept per vault and channel. It rebuilds after the vault's files change, and at least every 5 minutes. A session that starts while the first map is still building waits up to 1 second (a daemon session waits up to 30) and otherwise starts without the `# Vault map` section.

## Notes about the open note

Memory notes that link the note you are looking at are injected even when no word of your prompt matches them. When a chat prompt carries an `<editor-context>` block, core takes the Active file and Open tabs from it and finds the memory notes whose `[[links]]` point at them, by full path or by bare file name. Up to 2 are injected per prompt, and their excerpt header ends with `(about the open note)`:

```
## spring-trip (project) [climbing] (about the open note)
```

A batch of tool calls that read or edited a vault file does the same for that file, with a cap of 1 note. Day, week and month digest notes and the `now` note are never injected this way; they reach a prompt through `# Now` and time words. A note already sent in the session is skipped, and every injected note still counts against the block's character budget.

## Files, past chats and docs beside memory

Prompt and subagent recall also point the agent at the vault files, past chats and Bismuth documentation pages that match the prompt by meaning, each under a heading that names its source. They need `embeddings.enabled` as well as `daemon.recall.enabled`, and each source has its own switch. Memory is packed first and keeps its whole share of the block; the sources fill what character budget is left.

Every source item is a reference: one line that names the item and says how to open it, never the item's text. The agent opens one only when it helps, so an item that turns out unrelated costs one line. A learned gate decides which items appear. One lead line comes before the first source heading:

```
# Memories

## alice (person) [friend, climbing]
Path: /Users/me/vault/.daemon/memory/alice.md
Climbing partner; plans trips in the spring

Possibly related, unverified. Open one only if it helps; ignore the rest.

# Vault files

- papers/attention.pdf (pdf, page 4) — Scaled dot-product attention divides by the square root of the key dimension. (open: `/Users/me/vault/papers/attention.pdf`)

# Past chats

- 2026-10-29 — "you: why does the backup cron fire late claude: the expression was read in UTC" (open: `bismuth history show 3f2a9c1e-…`)

# Bismuth docs

- bases/authoring/calendar.md — Calendar (read: `bismuth docs read bases/authoring/calendar.md`)
```

| Source | Heading | What the line shows | Prompt cap | Subagent cap |
|---|---|---|---|---|
| Vault files: notes, PDFs by page, images through their description | `# Vault files` | path, kind (and page for a PDF), a short hook, the absolute path to open | 2 | 2 |
| Past chats started in this vault | `# Past chats` | date, a short hook from the matching turn, the `bismuth history show` command that opens it | 2 | 1 |
| Bismuth documentation | `# Bismuth docs` | page path (with `#anchor` for one section), its title, the `bismuth docs read` command | 2 | 2 |

A hook is the item's title, else the first sentence of its best match, cut at a word to at most 160 characters and ended with `…` when cut. An item is sent once per session until its content changes, like a memory note. Tool-batch recall never injects sources.

Visibility applies to every source. A hidden file is never injected, and a chat-only file is never injected into a daemon session. Past chats follow `chatVisibility`, the session asking is never in its own results, and a vault that restricts any note injects no past chats at all, the rule `bismuth history` keeps for agents.

## Time words in a prompt

A prompt that names a time ("what did we do yesterday", "last tuesday", "on nov 3", "2 days ago", "this week") gets a `# What happened <label>` section before `# Vault files`:

```
# What happened yesterday (2026-11-05)

## day-2026-11-05
## Sessions
- reworked the memory index (session 4f2a9c1e)
```

The section holds the digest notes that cover the named dates, most specific first: the day note if it exists, else the week note, else the month note. At most 3 digest notes and 2,500 characters go in. Past chats whose session date falls in the range are added under `# Past chats` when the source gate accepts them. A prompt without a time word is unaffected. Digests follow the same rules as other memory: a digest is sent once per session until it changes, restricted notes are never injected, and chats follow the same visibility rule as every other source.

## Tune or turn off automatic recall

These `.settings` keys control injection. They apply on the next call.

| Key | Default | Effect |
|---|---|---|
| `daemon.recall.enabled` | `false` | Master switch for every automatic injection. Off, agents see only what they ask for with `recall`. |
| `daemon.recall.midTurn` | `false` | Also recall after each batch of tool calls. Off, memory is recalled at the prompt only |
| `daemon.recall.files` | `true` | Also inject pointers to matching vault notes, PDFs and described images. Needs `embeddings.enabled`. |
| `daemon.recall.chats` | `true` | Also inject pointers to matching past chats. Needs `embeddings.enabled`. |
| `daemon.recall.docs` | `true` | Also inject pointers to matching Bismuth docs pages. Needs `embeddings.enabled`. |

These keys need `daemon.enabled`. [The settings reference](../settings/reference.md#daemon) has the full text.

Matching by meaning is the separate `embeddings.enabled` setting, which is `false` by default and also governs vault-note search. [The embeddings section](../settings/reference.md#embeddings) has the cost.

### Meaning-based matching

With `embeddings.enabled` on, core also scores notes with a small embedding model (`Xenova/bge-small-en-v1.5`, quantized) and adds the closest few to the ranking as a bonus on top of the word match. The model runs in a separate helper process that core starts on the first semantic query and ends after 10 minutes without one, which returns its memory (about 35 MB of model files; the helper's own memory use is in the settings reference). The first query, and any query past 250 ms, is answered by word matching alone while the helper warms up. The model downloads on first use into `~/.bismuth/models`; offline with no cached copy, recall stays word-based.

With semantics available, prompt and subagent recall add a relevance check: a small second model reads each of the best few notes against your prompt and admits the ones that answer it. Every note that word matching alone would inject still goes in, whatever the check says, so turning embeddings on never recalls less than leaving them off. [How recall ranks notes](#how-recall-ranks-notes) has the thresholds.

The compiled `bismuth serve` command and the iPad build match by words only.

## What gets saved

When a terminal session ends (not on `compact`), and when a visual chat ends, Bismuth saves the conversation as a memory note named `auto-<YYYYMMDD-HHMMSS>-<first 8 characters of the session id>`, with `type: auto` and the tags `auto`, `raw` and `session` (or `chat`). `dream` reads these notes, extracts what matters into real notes, and deletes them.

The note is the conversation paired by turn, in `## Turn N` blocks with a `**You:**` and a `**Claude:**` line. Tool calls and results are dropped. Each message is cut at 1,500 characters, and a note is held to 12,000: the middle turns are replaced by `_(N turns omitted)_`. A session is not saved when a cron started it (a prompt that begins `[Cron: `) or when it holds under 50 characters in total. The injected `<bismuth-memory>` block is stripped first, so recalled notes never come back as new ones.

## Which device runs the daemon

When several devices use one daemon, only the owner device runs sessions: crons, approved pages and recovery. Every other device keeps heartbeating and supervising background processes but its session calls fail with `This device is not the owner`, and it deletes "run now" triggers unread.

With no `owner.json`, the daemon is unclaimed and every device counts as the owner, so a single-machine install needs no setup. To pick an owner:

```bash
bismuth daemon devices --pretty        # every device that has checked in, flagged owner and this
bismuth daemon owner <deviceId>        # claim a device as owner
bismuth daemon owner --pretty          # read the current owner
```

`daemon owner <deviceId>` accepts only a device that has heartbeated. The command **Set daemon owner device…** opens the same choice in the app. A device id is the UUID in `~/.bismuth/daemon/device-id`, and the label is the machine's hostname. An inbox page approved on a non-owner device does nothing; the page warns above its buttons when that is the case.

## How it works

### The relay plugin

The hooks live in the `relay/` workspace, a plugin with no MCP server of its own. Core starts each terminal tab's shell with a `claude` shim that runs `claude --plugin-dir <relay>`, and sets `CLAUDE_TERMINAL_ID`, `CLAUDE_RELAY_URL` and, only when the vault's daemon is on, `BISMUTH_MEMORY_DIR` (`core/src/terminal.ts`). Nothing is written to `~/.claude`. Outside a Bismuth terminal the plugin is not loaded, and each hook also exits unless `CLAUDE_TERMINAL_ID` is set.

| Script | Event | Memory job (needs `BISMUTH_MEMORY_DIR`) | Always |
|---|---|---|---|
| `session-start-hook.ts` | `SessionStart` | `mode: session-start` | register the session in the agents registry |
| `recall-hook.ts` | `UserPromptSubmit` | `mode: prompt` | register or refresh the session |
| `tool-batch-hook.ts` | `PostToolBatch` | `mode: tool`, tool responses capped at 2,000 characters | none |
| `subagent-start-hook.ts` | `SubagentStart` | `mode: subagent` | register the subagent |
| `subagent-stop-hook.ts` | `SubagentStop` | none | mark the subagent done |
| `session-end-hook.ts` | `SessionEnd` | save the transcript, except on `compact` | drop the session, except on `clear` and `compact` |

Every hook reads its JSON from stdin, swallows every error, and exits 0 within 2 seconds, so a hook can never block your session. Core owns ranking, the already-sent record and the settings; the hook forwards the payload and prints the reply as `{"hookSpecificOutput": {"hookEventName": …, "additionalContext": …}}`. If core is unreachable, answers non-2xx or times out, the hook prints nothing: there is no fallback ranker in the hook. `POST /memory/recall` refuses any request that carries an `Origin` header, because it has no token and CORS is open.

### How recall ranks notes

Ranking is BM25 first. With `embeddings.enabled` on (it is off by default), core also scores notes by meaning with **bge-small-en-v1.5, quantized (`q8`)**, run by `onnxruntime-node` through `@huggingface/transformers`, and `rankNotes` (`memory/src/rank.ts`) fuses the top cosines in additively. With `embeddings.enabled` off the model is never loaded. The iPad in-process backend never imports any of it, and the compiled `bismuth serve` is BM25-only too: the embed worker runs only in the core sidecar, recognised by `BISMUTH_CORE_SIDECAR=1` on a binary whose exec name starts with `bismuth-core`. The semantic query text is capped at 1,000 characters (`SEMANTIC_QUERY_CHARS`). A reply that used the channel carries `"semantic": true`.

**Evidence rules.** In tool mode, at 12 or more notes, evidence is strict: a semantic-only hit never injects, because a cosine is only a bonus on top of lexical evidence. bge-small cosines sit in a narrow band, so the floor is relative per query: a note is lifted only when its cosine clears both the mode's `semanticMinCosine` and this query's tenth-best cosine plus `SEMANTIC_BACKGROUND_MARGIN` (0.07). A prompt the vault knows nothing about scores ten notes within a few hundredths of each other and lifts none. With that map in hand (prompt and subagent modes, 12 or more notes), a note matched only by words in its body, with no name, tag or description hit and no semantic lift, is dropped, and the prompt-mode bar rises from `minScore` 0.08 to `semanticMinScore` 0.12 (`memory/src/pack.ts`). Without semantics (the setting off, the model still warming, the iPad) the keyword-only rules below apply on top of the 0.08 floor. `which`, `whose`, `whom`, `these`, `those` and `off` are stop words.

**Keyword-only evidence rules.** When no semantic scores exist for a request, prompt and subagent recall rank by words alone and `rankNotes` applies the rules below (tool mode keeps its own strict rules and matches exact words). Rarity is a term's idf scaled so a word found in one note scores 1; a word is distinctive at 0.8 or more (`DISTINCT_MIN_IDF`), which is a word found in two or three notes of a vault of 50 to 150. Prompt words that share a stem count as one content term in every rule below. The size rules apply from 12 notes (`SMALL_VAULT`); a smaller vault is never silenced by them.

- **Word forms.** A prompt word also matches other forms of its stem (`stem` strips `s`, `es`, `ies`, `ed`, `ing`, `ment`, `ation` and their plurals and a final `e`, so `update`, `updates` and `updated` share a stem; it keeps at least 4 letters and leaves tokens with digits whole). A variant form counts at 0.6 of an exact match (`STEM_FORM_WEIGHT`).
- **A lone body hit.** A note whose only evidence is one body word needs that word to be at least 0.4 of the prompt's content terms (`LONE_HIT_MIN_COVERAGE`) and found in under about a tenth of the notes (`LONE_HIT_MIN_IDF`, 0.55). The note must also repeat the word, at least twice and at 0.4% of its length (`LONE_HIT_MIN_MENTIONS`, `LONE_HIT_MIN_DENSITY`), unless no other note holds it. A note that mentions the word 4 or more times (`LONE_HIT_TOPIC_MENTIONS`) is about it, and the 0.4 coverage is waived.
- **Several body hits.** A note with two or more hits and none in its name, tags or description needs two of them inside one paragraph or heading block, and one distinctive word among them. The distinctive-word requirement is waived when the note holds at least 0.75 of the prompt's content terms (`ANSWERED_ENOUGH`).
- **The unknown-prompt gate.** A prompt of 3 or more content terms (`UNKNOWN_MIN_TERMS`) with at least 0.4 of them found nowhere in the memory (`UNKNOWN_MAX_SHARE`) is about something the vault does not hold, so a note matched only on prompt words is dropped. A note survives when two of its name, tag or description terms match (`UNKNOWN_EXEMPT_HEAD_HITS`), when it matched through the context rather than the prompt, or when it holds a phrase of the prompt: two distinctive words that sit next to each other in the prompt and next to each other in one paragraph of the note. A word counts as found in the memory when it appears itself, or as an inflection that is a name, tag or description term of some note; an inflection found only in a body does not.

**Vectors, chunked.** One store per memory dir under `~/.bismuth/cache/recall/<sha1(memoryDir)>/`, keyed by `noteHash`: an append-only `vectors-v2.<gen>.bin` of float32 records plus a `vectors-v2.json` index that is the commit point, so an edit appends one note's vectors instead of rewriting the store. One process writes at a time (`vectors-v2.lock`); a store another process committed to is compacted into a new generation rather than appended to. A store with only a `vectors-chunked.json` is converted once and that file is left in place. Only notes whose hash changed are re-embedded, throttled to one run per 2 s, and a restart embeds nothing already stored. A note is cut into windows of at most `CHUNK_CHARS` characters (`noteChunks`, up to `MAX_CHUNKS_PER_NOTE`), each led by the note's name, description and tags, and scores as its best chunk (max-sim), so a fact deep in a long note is not diluted by the rest. A stored entry whose dimension is 0 or does not divide its byte length is skipped as corrupt and re-embedded. Queries get bge's instruction prefix; documents do not.

**The reranker gate** (`core/src/memoryRerank.ts`, `memory/src/rerankGate.ts`). With semantics in hand, prompt and subagent modes (never tool mode) send the top `RERANK_CANDIDATES` (5) ranked notes scoring at least `semanticMinScore` (0.12), as the excerpt the agent would read, to a cross-encoder in its own idle-exiting child process, the embedder's pattern. `gateByRerank` keeps a note only when its raw logit is at least `RERANK_MIN_LOGIT` and within `RERANK_MAX_DROP` (8) of the best candidate; an empty result admits nothing, and the keyword picks below still go in. The gated list is packed with `semantic: false`, so `semanticMinScore` never vetoes a note the reranker admitted. The budget is `RERANK_TIMEOUT_MS` (700 ms): a cold load, a failure, a timeout or a bad reply falls back to the rules above for that request, and the recall never waits longer.

**Keyword picks are kept with embeddings on.** Whenever the semantic channel scored a request, in every mode, the service also ranks it keyword-only (`rankNotes` with no semantic map) and packs that list exactly as the `embeddings.enabled: false` service does. `withKeywordPicks` keeps every note that pack injects, so neither the semantic score floor nor the reranker gate drops it: a keyword pick the reranker scores -11 is still injected. The semantic or gated picks keep their order and the keyword picks they lack follow them; when the two together pass the mode's `maxNotes` or character budget, the semantic path's own picks give way from the tail, never a keyword pick. A note that neither the keyword-only pack nor the semantic or gated pack admits stays out. With `embeddings.enabled` off, none of this runs and recall is the keyword-only path alone.

The reranker judges each passage against `rerankQuery`. That is the prompt itself, at most `RERANK_QUERY_CHARS` (1,000) characters, because the cross-encoder cuts the joined pair from the end at 512 tokens and a long subagent brief would otherwise leave no passage tokens. When the prompt has fewer than `RERANK_TERSE_TERMS` (4) content terms, it is the prompt followed by the first `RERANK_CONTEXT_CHARS` (400) of the context, which leads with the agent's last reply (the tool-input strings that trail it are noise). A terse follow-up such as "ok do it" or "continue" is therefore judged with that reply attached rather than on its own words, which score about -11 against anything.

**Choosing the threshold.** `RERANK_MIN_LOGIT` is -6. Measure a change with `bun bench/recallEval.ts --dir <memoryDir> --cases <file> --semantic ./core/src/memoryEmbed.ts --reranker ./core/src/memoryRerank.ts --sweep`, which scores each case in prompt mode and sweeps the logit threshold. Each row reports recall@5 and false-inject, the share of expect-nothing prompts that still inject a note. The shipped `RERANK_MIN_LOGIT` is the lowest bar that adds no false injection on the synthetic suite: its expect-nothing prompts read -6.2 to -7.1 and the correct paraphrases it would recover read -6.6 to -6.8, so a lower bar admits as many false matches as true ones. `RERANK_MAX_DROP` (8) keeps a second real match that reads 7 to 8 below a strongly matching first one. Through the service in prompt mode, `--embeddings on` scores the synthetic suite 1.000 recall@5 and 0.188 false-inject against 1.000 and 0.167 with `--embeddings off`, and the private real vault 0.941 and 0.167 both ways. The kept keyword picks set the recall floor; the one extra synthetic false injection is a note the gate admits on its own at logit -3.7 for a prompt whose keyword-only pack is empty. Raising `RERANK_MIN_LOGIT` lowers false-inject and eventually costs recall; lowering it does the reverse.

**Measuring through the real service.** `bun bench/recallEval.ts --dir <memoryDir> --cases <file> --service [--embeddings off|on] [--vault <dir>] [--explain]` sends each case through `createRecallService`, so the numbers are what an agent receives. `--embeddings off` (the default) runs with no embedder or reranker, the keyword-only path; `on` loads the real embedder and reranker and downloads the model on first use. `--vault <dir>` gives the service a vault, so session-start composes a brain. `--explain` lists every miss and every false injection with the reason: the note's score against the mode's floor and its rank, the query words that matched and whether they sit in its name, tags or description, the keyword-only rule that admitted or dropped it, and the strongest rivals. `--sweep` also sweeps `minScore` over a grid read from the scores the candidates carry, bracketing the production floor.

**Measuring sources.** `--service --embeddings on --sources on` also hands the service the real sources (vault files, past chats, Bismuth docs) over fixtures in the cases file: `{ cases, vault, docs, chats }` (`memory/test/fixtures/recallSourceCases.json`). A case's `expect` may name source keys (`docs:<page>#<anchor>`, `chat:<id>`, `note:<path>`, `pdf:<path>`), and `sourcesExpect: []` says no source may inject. The summary adds `sourceRecall@5`, the share of expected source keys among the first five injected, and `sourceFalseInject`, the share of `sourcesExpect: []` cases that injected any source. With `--sources off` (the default) every number is the one without sources. Sources are semantic and gated by the reranker, so `--sources on` requires `--embeddings on`.

**Replaying real sessions.** `bun bench/recallReplay.ts --vault <dir> [--logs <dir>] [--out <dir>] [--negatives n] [--dry]` turns every prompt in the vault's Claude Code session logs into a case. A case's labels are the Bismuth docs pages, notes, PDFs and images the agent fetched itself before the next prompt; a prompt that mentions an earlier chat is a past-chat case; a prompt after which the agent used no tool is a quiet case. Each case runs through the real service and sources; chats that started after the prompt are left out before each source is capped at its `k`, so a source's background level is read off its true ranking. The summary reports per kind how often a label was injected (hit) and how often it was among the sources' top 10 (retrieved), plus how often a quiet case got any source. The vault and the logs are only read; indexes are built under `--out`, which also receives `cases.jsonl` with every prompt, so keep it out of the repo. `--dry` prints the case counts only.

### The brain block

`composeBrain` in `core/src/brain.ts` builds the block per vault and channel (`chat` or `daemon`). The channel selects the deny list that hides restricted notes from the map. The map is cached with a build generation: `invalidateBrain` (called by the server's file watcher and the daemon's) bumps it so a build that started earlier never writes a stale map back, and an entry older than `MAP_MAX_AGE_MS` (5 minutes) rebuilds. Memory notes are loaded on every call, so only the map is cached. `buildVaultMap` and `formatVaultMap` (`core/src/vaultMap.ts`) drop detail in steps until the map fits: recent notes, tags, cluster exemplars and base names go first.

`formatSessionStart` (`memory/src/pack.ts`) takes the profile, the `# Now` section and the map as `lead`. It tries the lead with the map, then the profile and `# Now` alone, then none, and returns the first block within `BRAIN_BUDGET_CHARS`. If even the index does not fit, the lead alone is cut at a line boundary and the envelope is closed. Index lines sort hubs first, then by in-link count, `updated`, type (`INDEX_TYPE_ORDER`) and name. Preference bodies are bounded by `PREFERENCE_BODY_MAX`, `PREFERENCE_BODIES_BUDGET` and, with a lead, a `PREFERENCE_BODIES_FLOOR` of 1,500 above a reserve of 3,000 characters for the other lines. `noteDescription` (`memory/src/graph.ts`) falls back to the first prose sentence and skips headings, fences, tables and short `Label:` prefixes.

The recall service's `session-start` mode calls `composeBrain` with the request's channel (`RecallRequest.channel`, default `daemon`) and falls back to the memory index alone when there is no vault or composing fails. An empty memory dir with a vault still reaches `composeBrain`. The route (`core/src/routes/memory.ts`) asks `requestChannel`: an `x-bismuth-channel: chat` header or the owner token means `chat`, anything else `daemon`. The relay (`relay/lib/recall.ts`) sends the chat header, and `chat.ts` and opencode pass `channel: 'chat'` in-process. `buildDaemonPersona` (`daemon/src/daemon/persona.ts`) calls it with the `daemon` channel and `DAEMON_BRAIN_WAIT_MS` (30 s); a failure leaves the persona unchanged. `DAEMON_PERSONA_CHANNELS` maps each daemon backend to `systemPromptAppend` or `developerInstructions`. The visual chat's hook is in `core/src/chat.ts` and opencode's in `core/src/chatProviders/opencode/opencode.ts`.

`composeBrain` reads the `now` note (`type: now`) from the loaded memory notes and places `# Now` right after the profile; `formatSessionStart` leaves `type: daily` and `now` notes out of the index.

### Link-aware recall

`notesAbout` (`core/src/memoryLinkBoost.ts`) returns the memory notes whose backlinks resolve to the given vault paths, notes linking more of them first. The recall service drops digest notes and the `now` note (`isDigestNote`, `isNowNote`), then prepends the rest to the ranked list with a score of at least 1, so they clear the score floor, after the reranker gate has run and capped at `LINK_BOOST_CAP` (2 for prompt and subagent, 1 for tool). `markBoosted` appends `(about the open note)` to their headers unless that would push the block over its budget. `toolVaultPaths` reads `file_path`, `path` and `notebook_path` from the batch's tool inputs. `neighbourNames` lists the memory notes one wikilink away from the injected ones, and `preferNeighbourPointers` puts them first among the "Also related" lines.

### One service behind every surface

`createRecallService` in `core/src/memoryRecall.ts` is the single implementation. The relay hooks reach it through the route, and the visual chat (`core/src/chat.ts`) and opencode call `recallServiceFor` in-process, so all of them share one already-sent record per session. A recall that was abandoned (the caller timed out) never adds to the record, because the agent never saw the notes. The service rebuilds its index only when a note file's modification time or size changed, and reads `.settings` on every request. It answers `reason: disabled`, `mid-turn-off`, `no-memory`, `no-match` or `turn-budget` (a tool batch after this turn's one injection) when it injects nothing; with no admitted source, an empty memory directory answers `no-memory` and a memory with no match answers `no-match`.

### Sources beside memory

After memory is packed, `gatherSources` in `core/src/memoryRecall.ts` embeds the query once (`QUERY_PREFIX`, waiting at most `QUERY_TIMEOUT_MS`) and asks each enabled source for `SOURCE_K` (10) hits against that vector: `vaultSourceHits` (`core/src/vaultEmbed.ts`), `chatSourceHits` (`core/src/chatEmbed.ts`) and `docsSourceHits` (`core/src/docsEmbed.ts`), sharing the shapes in `core/src/semanticSources.ts`. One deadline covers the embed, the sources and the reranker, so a slow source is dropped for that request and memory still answers inside the caller's budget.

A learned gate decides which retrieved hits are injected. The best `SOURCE_CANDIDATES` hits of each source by cosine go to the cross-encoder in one call, and `gateAccepts` (`core/src/sourceGate.ts`) scores each from its cosine, how far that stands above the source's `SOURCE_K`-th best cosine (the query's background level), its rank in the source, the cross-encoder logit, the source kind (file, chat or docs), whether its session date falls in a range the prompt names, and the prompt's length. A hit is injected when the logistic probability reaches the model's `threshold`. Every number of the model sits in `core/src/sourceGateModel.json` and is fit on measured prompts; none is typed by hand. `loadGateModel` fails closed: a model with a missing, non-finite or out-of-range number becomes `CLOSED_GATE`, which accepts nothing, so recall injects no sources and memory notes still arrive. No reranker, or no query vector or logits in time, also means no sources for that request. Hits already in the session's already-sent record are dropped after scoring, so ranks do not shift. `packSources` (`core/src/sourcePack.ts`) renders each accepted hit as one reference line within `SOURCE_LIMITS` and the remaining budget, with the lead line once before the first heading; a hook is cut at `SOURCE_HOOK_CHARS` (160). The response lists the injected `sourceKey`s (`kind:id`) in `sources`.

`timeRecall` (`core/src/timeRecall.ts`) runs after sources, only when `timeRefs` (`memory/src/timeRefs.ts`) finds a range in the prompt. `digestsCovering` (`memory/src/digests.ts`) picks the notes, and the chats come from `chatHitsFor` in `core/src/memoryRecall.ts`, the same visibility gate `sourcesFor` uses. The `DATED_CHAT_CANDIDATES` best chats inside the range go to the same gate with `inRange` set and no logit, because the time path does not rerank. The block counts against the mode's budget before the sources fill what is left, and its keys go through the session's already-sent record.

### Refit the source gate and the search blend

`core/src/sourceGateModel.json` is refit from a replay of real sessions. `bench/fitSourceGate.ts` refits the blend that `bismuth search` uses (see [Semantic search](../vault/semantic-search.md)); `bench/gateAB.ts` fits the gate, tests it and writes it; `bench/qualityReplay.ts` measures the exchange rate on real agent runs and refits at it. Run the replay with `--judge --search`, calibrate the judge, measure the exchange rate, then fit:

```bash
bun bench/recallReplay.ts --vault <vault> --out <dir> --judge --search
bun bench/judgeCalibrate.ts --from <dir> --out <dir2>
bun bench/exchangeRate.ts --vault <vault> --replay <dir> --out <dir2>/exchange-rate.json
bun bench/gateAB.ts --from <dir> --judged <dir2>/candidates-judged.jsonl --logs <claude project dir> \
    --exchange <dir2>/exchange-rate.json --out <dir2>/ab.json --write core/src/sourceGateModel.json
bun bench/fitSourceGate.ts --from <dir> --write core/src/sourceGateModel.json
bun bench/qualityReplay.ts --vault <vault> --from <dir> --judged <dir2>/candidates-judged.jsonl --logs <claude project dir> \
    --exchange <dir2>/exchange-rate.json --out <dir3> --write core/src/sourceGateModel.json
```

The replay turns every prompt in the vault's Claude Code session logs into a case and writes `candidates.jsonl`: each candidate the gate scored, its inputs, and whether a file the agent went on to fetch matches it. The output holds your prompts, so keep both directories outside the repo.

Labels. A candidate is a positive when a fetched file matches it or a Claude Haiku judge calls it relevant, and a negative when the judge calls it irrelevant. Candidates of a case where the agent used no tool are judged like any other: an agent that fetched nothing is not evidence that nothing would have helped. `bench/recallJudge.ts` holds the judge prompts by id (`v1` asks whether the item would genuinely help answer the prompt, `v2` whether it would help the assistant answer or act on it, background included). `judgeCalibrate.ts` judges the candidates a fetch proved relevant and a fixed hash-ordered sample of 200 unfetched ones with each prompt, scores each by balanced accuracy (the mean of recall on the fetched and the share of the sample marked irrelevant) and judges every candidate with the winner. The verdict cache key includes the prompt, so prompts never share verdicts. The model file records the prompt's id, never its text.

Split. `gateAB.ts` orders the sessions by the first timestamp of their log and takes the oldest 60% to train, the next 20% to validate and the newest 20% as the test set. A session sits in exactly one set. The ridge strength comes from a log grid (half a decade apart) and is the value with the lowest validation log loss; the report holds the whole curve. The test set is read only by the final scoring.

Exchange rate. The operating point, `threshold`, maximises `rate · hits − junk` on the validation sessions with the pack caps applied. A hit is a case with an injected candidate its fetched label matches (for a past-chat or time case, one the judge marks relevant); junk is an injected candidate the judge marks irrelevant. `rate` is measured, not chosen: `exchangeRate.ts` reads the session logs and divides the tokens a fetch the agent made itself costs (the tool result, the call, and the mean output tokens of the assistant turn that made it) by the tokens of one injected source entry as `packSources` renders it. The result is how many junk items one saved fetch pays for. The quality replay (below) replaces that estimate only when it measures a positive rate and its refit passes the ship rule; otherwise the shipped model and its rate stay.

A/B. `gateAB.ts` scores variants on the same test sessions, each trained without them: `wave1`, a hand-set baseline gate re-implemented over the saved features; `prev`, a fit on strict labels with session folds at a 1:1 rate; `labels`, the same procedure on the judged labels; `split`, the time-ordered split with the validation-chosen ridge at 1:1; and `rate`, the split at the measured rate. For each it reports the labelled hit rate, precision, judged junk rate, quiet-case fire rate, past-chat rate and the objective with a 95% bootstrap interval over test sessions; a change counts as an improvement only when its interval clears the previous variant's value. `--write` ships the variant with the best objective on the validation sessions at the measured rate, among the variants fit without the validation sessions (`split`, `rate`; the first two train on train plus validation, so their validation score is in-sample); the test sessions only report and decide whether a change counts as an improvement. `fitOn` records the split sizes, the ridge strength, the rate, the judge prompt id and the test numbers. `fitSourceGate.ts --write` replaces only the blend in the model file; `--gate` also replaces the gate with the fit on session folds.

Quality replay. `qualityReplay.ts` measures what recall does to an answer, which the labels cannot: a source can match a fetched file and still not change the reply, and a junk source can mislead. It takes the question and lookup prompts the replay labelled, from every session with a log (a prompt whose turn wrote a file, ran a destructive command, started a subagent or is a slash command is dropped, and the summary counts each reason). `pickRoundRobin` takes `--target` of them, one per session before any second one. Test-split sessions are marked `heldOut`, because the gate was not fit on them, and every summary reports all prompts and held-out prompts as separate rows. Each prompt runs `--samples` times per arm on a copy-on-write clone of the vault, from the conversation the prompt had, with Claude Haiku as the default agent, judge and reliance model (`--agent-model`, `--judge-model`, `--reliance-model`):

| arm | what differs |
|---|---|
| `none` | no sources block |
| `references` | the sources the shipped gate injects, rendered as references |
| `excerpts` | the same sources with their full text |
| `junk` | as many candidates the judge marked irrelevant, as references, the gate's own junk first, then the nearest misses; where the gate injects nothing, the mean count of the cases where it fires |
| `search` | no block, and one instruction in the system prompt to run `bismuth search` and `bismuth history` first |

Every arm has the same tools: Read, Grep, Glob and `bismuth` read commands, with `bismuth search` blending keyword and meaning from an index built once on the clone. A `PreToolUse` hook callback checks every call, including the read-only shell commands the permission system approves without asking, and the permission callback repeats the check: real paths (symlinks resolved) stay inside the clone, Glob and Grep patterns stay relative, and a shell command, read as the shell splits it, must be one read-only `bismuth` call with no chaining, no `--vault`, no `--api` and no outside path. `bismuth history` sees only the logs of sessions that started before the prompt's session. The clone holds today's vault, so an older prompt can see later notes, equally in every arm; the summary states this. The agent loads no settings. `--probe-guard` runs one agent, on the hook alone, told to `cat ~/.claude/…` and `ls /`; it passes when every call is refused.

Each arm's sample i is judged against `none`'s sample i, in both orders, with the arm names hidden; the judge may read the clone to check what an answer claims. A pair whose two verdicts disagree counts as a tie. The control compares `none` with itself as K pairs, `none`'s sample i against a further `none` run K+i, so its interval is the noise floor for an arm that averages K pairs, and the other comparisons are read against it. A second call lists which injected items an answer relied on; an answer that relies on an item the relevance judge marked irrelevant is `misled`. The summary reports the net (wins minus losses) with intervals from resampling prompts and from resampling sessions, order consistency, the share of given references the agent opened, and the misled rate. `--pilot n` runs the first n prompts, writes `pilot-usage.json` with summed tokens and projected totals, and exits; a later full run with the same `--out` reuses its results. `--dry` prints the eligible and planned counts without calling a model. Every run, verdict and token probe is cached under `--out`, keyed by what it was given (including which past sessions `bismuth history` could show), so a rerun resumes; a session log Claude Code has since deleted changes that set, so point `--logs` at a copy of the logs for a sweep you mean to resume. The sweep keeps the Mac awake while it runs, and a run that failed while the machine slept anyway (a closed lid) is retried rather than left missing.

`--needles <file>` adds questions about specific past sessions and about how a project changed, written by `bench/needleCases.ts`. They run the `none` and `search` arms, are scored against the stored answer, and appear in their own block of the summary. `bench/labelPairs.ts` shows a person pairs of answers blind and reports how often the judge agrees with them, which is what the verdicts are read against.

A made-up vault tests how different models use memory without sending anything of yours to a hosted model. `bench/syntheticEval.ts` has Haiku invent a vault, questions with known answers and related-but-wrong distractor notes, then runs each model on arms `none`, `references`, `junk` and `search`, and reports accuracy, abstention, references opened and answers misled, one row per model and arm. OpenCode models run through `bench/opencodeAgent.ts`: a throwaway home, a macOS read-deny sandbox around the process, loopback open only to opencode's own server, and permissions that deny edits, web access, reads outside the working directory and every shell command other than read-only `bismuth` calls. The run's working folder must sit outside your home folder, because opencode looks for a `.claude` folder in every parent folder and the sandbox denies `~/.claude`; `syntheticEval.ts` keeps its results in `--out` and puts the agents' files in `/private/tmp/bismuth-synth-<hash>` when `--out` is under home.

The harm of a junk item enters the exchange rate in tokens, each term measured by the replay:

Tokens of a run are the context at its last model call (fresh input, cache writes and cache reads together) plus its output, so one run's cache entries do not change another run's count.

- direct: the tokens one injected item adds to the first turn, from a one-word probe turn per message with and without the block;
- extra: what the junk arm spent beyond the item itself, `(sum of token deltas - items x direct) / items`;
- loss: answers made worse, as corrective turns, `(losses - wins) / items x output tokens per turn`.

The rate's numerator is what a hit saves: in the cases where the gate injected a hit, the tokens the agent saves against `none` (junk items in those cases added back, because the objective charges them on their own) plus net answers made better, as the same corrective turns. The measured rate is saved tokens per hit over the full cost of a junk item, and the report lists both with their inputs beside the log-derived rate. When no rate is measured, because the saving or the cost has no positive value (its interval reaches zero), `fitOn.qualityReplay` records that and the shipped model stays. Otherwise `bench/fitSourceGate.ts` refits at the measured rate: the weights are refit on the train sessions with `inRange` dropped (it equals `noRerank` in every replayed row, so the two cannot be told apart), the threshold is re-picked on the validation sessions, and both models are scored on the test sessions. The refit ships only when its validation objective beats the shipped model's at both rates, the log-derived one and the measured one; otherwise the shipped model stays. The measured rate comes from the test sessions' agent runs, so a rule on it alone would let a test number pick the model, and `fitOn` records `exchangeRateMeasuredOn` and `testObjectiveHeldOut: false`: the test objective is not held out with respect to the rate. Every `test*` rate in `fitOn` is recomputed for the model that is committed, and `fitOn.qualityReplay` keeps the measured rate, its inputs and the validation scores of both models. The test sessions report the interval and whether it is below.

If the data holds nothing worth injecting, the best threshold is `1` and the gate stays shut. Refit after changing the embedder, the reranker, the passage text a source hands the reranker, the pack format, or `SOURCE_CANDIDATES`.

The file deny plan for the caller's channel is cached per vault and channel for 30 seconds and dropped by `invalidateRecallDenyPlans` on every watcher change. The docs index is built at core boot only when recall can inject it (`docsIndexWantedSync`: `daemon.enabled`, `daemon.recall.enabled`, `embeddings.enabled` and `daemon.recall.docs` all on), in slices of eight sections so a query embed never waits behind the whole pass; `docsIndexReady()` resolves when it is complete.

### Device files

Ownership is two plain files in the machine directory, so devices see each other's entries only when they share that directory (`BISMUTH_DAEMON_DIR`). `devices.json` gets this device's entry on every scheduler tick, owner or not. `owner.json` is written by core's `setOwner`; the daemon only reads it. `isOwner()` is true when the file is absent, otherwise `ownerDeviceId` must equal this device's id. The check sits at the top of `sendMessage`, the scheduler tick, boot recovery and every trigger consumer. These files coordinate which device does the work; no message passes between devices. [Storage](storage.md) has their formats.

Source: `relay/{bin,lib,hooks}/*`, `core/src/{memoryRecall,memoryLinkBoost,memoryEmbed,memoryRerank,embedWorker,brain,vaultMap,terminal,chat}.ts`, `core/src/chatProviders/opencode/opencode.ts`, `core/src/routes/memory.ts`, `memory/src/{rank,pack,graph,rerankGate,recall,transcript,timeRefs,digests}.ts`, `mcp/src/{instructions,server}.ts`, `core/src/{sourcePack,agentCliNote,sourceGate,timeRecall,semanticSources,vaultEmbed,chatEmbed,docsEmbed}.ts`, `core/src/sourceGateModel.json`, `bench/{fitSourceGate,gateAB,gateEval,exchangeRate,recallJudge,judgeCalibrate,recallReplay,recallEval,qualityReplay,qualityReplayCases}.ts`, `daemon/src/daemon/persona.ts`, `daemon/src/lib/{owner,device}.ts`, `daemon/src/daemon/session.ts`, `cli/src/commands/daemon.ts`
