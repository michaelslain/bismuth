# Memory injection and device ownership

When a vault's daemon is on, Bismuth puts the vault's memory in front of your AI agents without being asked, and saves their conversations back as raw notes for the `dream` cron to consolidate. A small plugin of Claude Code hooks does this in the app's terminal tabs, and the visual chat does it in-process. Every session opens with one orientation block, the brain, holding who you are, a map of the vault and an index of the memory. Separately, when several devices share one daemon, a single owner device runs its sessions.

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
| A session starts, resumes, clears or compacts | `SessionStart` | The brain: your profile, the vault map, a memory index with one line per note, `[[name]] (type) — description`, and the full text of short `preference` notes | 9,500 characters in all; a line says how many index lines were left out |
| You submit a prompt | `UserPromptSubmit` | Excerpts of the notes that best match the prompt | 5 notes, 900 characters each, 6,000 in total |
| A batch of tool calls ends | `PostToolBatch` | Excerpts matching what the tools just did | 2 notes, 600 characters each, 1,800 in total, with a stricter match rule; one batch per prompt |
| A subagent starts | `SubagentStart` | Excerpts matching the task given to the subagent | 4 notes, 700 characters each, 4,000 in total |

Ranking is BM25 over each note's name, tags, description and body, with the name and tags counting most. Preference notes get a small boost and `daily` and `auto` notes a penalty. A note must clear a score floor to be injected, and in a vault of 12 or more notes a note whose only evidence is a single body word that is a small share of the prompt is dropped. An excerpt is the note's header, its file path, its description and its best-matching section, never the whole note. The prompt and subagent blocks end with up to 5 and 4 one-line pointers to related notes that did not fit. Pointers to notes one wikilink away from an injected note come first.

A prompt is matched on what you typed: the `<editor-context>` block the app puts in front of a chat prompt is removed before ranking.

Tool-batch recall injects for at most one batch between two prompts, and each subagent counts its own. A turn of many tool calls would otherwise drip the next-best unsent notes, each weaker than the last, after every batch.

A note is sent once per session. Core remembers what each session and subagent has seen and skips a note until its content changes. After a `compact` or `clear` the memory has left the agent's context, so the record resets and the session-start index is sent again.

The terminal-tab hooks need the Claude Code CLI. The visual chat runs the same recall in-process on session start, each prompt and each tool batch; opencode chats get the brain on every turn plus prompt-time recall. A recall that takes too long injects nothing: a prompt waits 1,500 ms, a tool batch 700 ms, a subagent 1,500 ms, and session start 1,500 ms in a terminal tab or 3,000 ms in the visual chat and opencode.

## The session-start brain

The brain is one `<bismuth-memory>` block of at most 9,500 characters that an agent reads before its first prompt. It has up to four parts, in this order:

| Part | Content | Limit |
|---|---|---|
| `# Who you are working with` | The body of the `user-profile` memory note. Omitted when the vault has none | 1,500 characters, cut at a line |
| `# Vault map (N notes)` | Folders two levels deep, hub notes, clusters and surfaces such as bases, open tasks and daily notes | 2,200 characters |
| `# Memory index` | One line per memory note, ordered by value: hubs first, then notes with the most links in, then the most recently updated | the rest of the block |
| `# Preferences` | The full text of short `preference` notes | 4,000 characters in all, 1,200 per note |

A line's description is the note's `description`, else its first sentence with headings and labels such as `Status:` skipped. A `preference` note's index line is kept before any other line, and dropped when the note's body is shown: the body replaces the line. An index line that does not fit is skipped and the next one is tried, and a closing line counts the notes left out. With a profile and map present, preference bodies give way first so the other index lines keep room.

When the parts do not fit together, the map is dropped first, then the profile, and the index stays. A vault whose memory directory is empty, with the daemon on, still gets the vault map at session start; without a vault there is nothing to send. Restricted notes are absent from the map and the index; the daemon's view is narrower than a chat's ([visibility](../vault/visibility.md)).

The brain is composed for the channel that asks. Chat callers (terminal-tab hooks, the visual chat and opencode) get the chat view. A request that names no channel gets the daemon view, which hides more, so a caller that forgets to identify itself sees less rather than more.

The brain reaches each kind of session in its own way:

| Session | How the brain arrives |
|---|---|
| Terminal tab | The `SessionStart` hook of the relay plugin |
| Visual chat | A `SessionStart` hook that asks the same recall service in-process. It is sent again after `compact` and `clear` |
| opencode chat | The system field of every turn. It is kept for the session only once it holds a `# Vault map` section; until then (a timeout, or a map still building) the next turn asks again |
| Daemon cron and page sessions | Appended to the daemon's persona: Claude gets it in the system prompt, Codex in its developer instructions |
| Any agent using the MCP server | The `brain` and `vault_map` tools, and an instruction telling the agent to call `brain` when its context has no `# Vault map` section |

`daemon.recall.enabled` off stops the terminal, visual chat and opencode injections. Print the same text yourself with `bismuth brain`, and one note's surroundings with `bismuth map --around <note>`; the [CLI reference](../cli/reference.md#map-and-brain) has the flags.

A vault map is built once and kept per vault and channel. It rebuilds after the vault's files change, and at least every 5 minutes. A session that starts while the first map is still building waits up to 1 second (a daemon session waits up to 30) and otherwise starts without the `# Vault map` section.

## Notes about the open note

Memory notes that link the note you are looking at are injected even when no word of your prompt matches them. When a chat prompt carries an `<editor-context>` block, core takes the Active file and Open tabs from it and finds the memory notes whose `[[links]]` point at them, by full path or by bare file name. Up to 2 are injected per prompt, and their excerpt header ends with `(about the open note)`:

```
## spring-trip (project) [climbing] (about the open note)
```

A batch of tool calls that read or edited a vault file does the same for that file, with a cap of 1 note. A note already sent in the session is skipped, and every injected note still counts against the block's character budget.

## Tune or turn off automatic recall

These `.settings` keys control injection. They apply on the next call.

| Key | Default | Effect |
|---|---|---|
| `daemon.recall.enabled` | `true` | Master switch for every automatic injection. Off, agents see only what they ask for with `recall` |
| `daemon.recall.midTurn` | `true` | Also recall after each batch of tool calls. Off, memory is recalled at the prompt only |

These keys need `daemon.enabled`. [The settings reference](../settings/reference.md#daemon) has the full text.

Matching by meaning is the separate `embeddings.enabled` setting, which is `false` by default and also governs vault-note search. [The embeddings section](../settings/reference.md#embeddings) has the cost.

### Meaning-based matching

With `embeddings.enabled` on, core also scores notes with a small embedding model (`Xenova/bge-small-en-v1.5`, quantized) and adds the closest few to the ranking as a bonus on top of the word match. The model runs in a separate helper process that core starts on the first semantic query and ends after 10 minutes without one, which returns its memory (about 35 MB of model files; the helper's own memory use is in the settings reference). The first query, and any query past 250 ms, is answered by word matching alone while the helper warms up. The model downloads on first use into `~/.bismuth/models`; offline with no cached copy, recall stays word-based.

With semantics available, prompt and subagent recall add a relevance check: a small second model reads each of the best few notes against your prompt and admits the ones that answer it. Every note that word matching alone would inject still goes in, whatever the check says, so turning embeddings on never recalls less than leaving them off. [How recall ranks notes](#how-recall-ranks-notes) has the thresholds.

The compiled `bismuth serve` command and the iPad build match by words only.

## What gets saved

When a terminal session ends (not on `compact`), and when a visual chat ends, Bismuth saves the conversation as a memory note named `auto-<YYYYMMDD-HHMMSS>-<first 8 characters of the session id>`, with `type: auto` and the tags `auto`, `raw` and `session` (or `chat`). `dream` reads these notes, extracts what matters into real notes, and deletes them.

The note is the conversation paired by turn, in `## Turn N` blocks with a `**You:**` and a `**Claude:**` line. Tool calls and results are dropped. Each message is cut at 1,500 characters, and a note is held to 12,000: the middle turns are replaced by `_(N turns omitted)_`. Two kinds of session are not saved: one started by a cron (a prompt that begins `[Cron: `) and one with under 50 characters in total. The injected `<bismuth-memory>` block is stripped first, so recalled notes never come back as new ones.

## Which device runs the daemon

When several devices use one daemon, only the owner device runs sessions: crons, approved pages and recovery. Every other device keeps heartbeating and supervising background processes but its session calls fail with `This device is not the owner`, and it deletes "run now" triggers unread.

With no `owner.json`, the daemon is unclaimed and every device counts as the owner, so a single-machine install needs no setup. To pick an owner:

```bash
bismuth daemon devices --pretty        # every device that has checked in, flagged owner and this
bismuth daemon owner <deviceId>        # claim a device as owner
bismuth daemon owner --pretty          # read the current owner
```

`daemon owner <deviceId>` accepts only a device that has heartbeated. The command **Set daemon owner device…** opens the same choice in the app. A device id is the UUID in `~/.bismuth/daemon/device-id`, and the label is the machine's hostname. An inbox page approved on a non-owner device does nothing; the page's action bar warns when that is the case.

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

**Keyword-only evidence rules.** When no semantic scores exist for a request, prompt and subagent recall rank by words alone and `rankNotes` applies four more rules (tool mode keeps its own strict rules and matches exact words). Rarity is a term's idf scaled so a word found in one note scores 1; a word is distinctive at 0.8 or more (`DISTINCT_MIN_IDF`), which is a word found in two or three notes of a vault of 50 to 150. Prompt words that share a stem count as one content term in every rule below. The size rules apply from 12 notes (`SMALL_VAULT`); a smaller vault is never silenced by them.

- **Word forms.** A prompt word also matches other forms of its stem (`stem` strips `s`, `es`, `ies`, `ed`, `ing`, `ment`, `ation` and their plurals and a final `e`, so `update`, `updates` and `updated` share a stem; it keeps at least 4 letters and leaves tokens with digits whole). A variant form counts at 0.6 of an exact match (`STEM_FORM_WEIGHT`).
- **A lone body hit.** A note whose only evidence is one body word needs that word to be at least 0.4 of the prompt's content terms (`LONE_HIT_MIN_COVERAGE`) and found in under about a tenth of the notes (`LONE_HIT_MIN_IDF`, 0.55). The note must also repeat the word, at least twice and at 0.4% of its length (`LONE_HIT_MIN_MENTIONS`, `LONE_HIT_MIN_DENSITY`), unless no other note holds it. A note that mentions the word 4 or more times (`LONE_HIT_TOPIC_MENTIONS`) is about it, and the 0.4 coverage is waived.
- **Several body hits.** A note with two or more hits and none in its name, tags or description needs two of them inside one paragraph or heading block, and one distinctive word among them. The distinctive-word requirement is waived when the note holds at least 0.75 of the prompt's content terms (`ANSWERED_ENOUGH`).
- **The unknown-prompt gate.** A prompt of 3 or more content terms (`UNKNOWN_MIN_TERMS`) with at least 0.4 of them found nowhere in the memory (`UNKNOWN_MAX_SHARE`) is about something the vault does not hold, so a note matched only on prompt words is dropped. A note survives when two of its name, tag or description terms match (`UNKNOWN_EXEMPT_HEAD_HITS`), when it matched through the context rather than the prompt, or when it holds a phrase of the prompt: two distinctive words that sit next to each other in the prompt and next to each other in one paragraph of the note. A word counts as found in the memory when it appears itself, or as an inflection that is a name, tag or description term of some note; an inflection found only in a body does not.

**Vectors, chunked.** One `vectors-chunked.json` per memory dir under `~/.bismuth/cache/recall/<sha1(memoryDir)>/`, keyed by `noteHash`; Only notes whose hash changed are re-embedded, throttled to one run per 2 s, and a restart embeds nothing already stored. A note is cut into windows of at most `CHUNK_CHARS` characters (`noteChunks`, up to `MAX_CHUNKS_PER_NOTE`), each led by the note's name, description and tags, and scores as its best chunk (max-sim), so a fact deep in a long note is not diluted by the rest. A stored entry whose dimension is 0 or does not divide its byte length is skipped as corrupt and re-embedded. Queries get bge's instruction prefix; documents do not.

**The reranker gate** (`core/src/memoryRerank.ts`, `memory/src/rerankGate.ts`). With semantics in hand, prompt and subagent modes (never tool mode) send the top `RERANK_CANDIDATES` (5) ranked notes scoring at least `semanticMinScore` (0.12), as the excerpt the agent would read, to a cross-encoder in its own idle-exiting child process, the embedder's pattern. `gateByRerank` keeps a note only when its raw logit is at least `RERANK_MIN_LOGIT` and within `RERANK_MAX_DROP` (8) of the best candidate; an empty result admits nothing, and the keyword picks below still go in. The gated list is packed with `semantic: false`, so `semanticMinScore` never vetoes a note the reranker admitted. The budget is `RERANK_TIMEOUT_MS` (700 ms): a cold load, a failure, a timeout or a bad reply falls back to the rules above for that request, and the recall never waits longer.

**Keyword picks are kept with embeddings on.** Whenever the semantic channel scored a request, in every mode, the service also ranks it keyword-only (`rankNotes` with no semantic map) and packs that list exactly as the `embeddings.enabled: false` service does. `withKeywordPicks` keeps every note that pack injects, so neither the semantic score floor nor the reranker gate drops it: a keyword pick the reranker scores -11 is still injected. The semantic or gated picks keep their order and the keyword picks they lack follow them; when the two together pass the mode's `maxNotes` or character budget, the semantic path's own picks give way from the tail, never a keyword pick. A note that neither the keyword-only pack nor the semantic or gated pack admits stays out. With `embeddings.enabled` off, none of this runs and recall is the keyword-only path alone.

The reranker judges each passage against `rerankQuery`. That is the prompt itself, at most `RERANK_QUERY_CHARS` (1,000) characters, because the cross-encoder cuts the joined pair from the end at 512 tokens and a long subagent brief would otherwise leave no passage tokens. When the prompt has fewer than `RERANK_TERSE_TERMS` (4) content terms, it is the prompt followed by the first `RERANK_CONTEXT_CHARS` (400) of the context, which leads with the agent's last reply (the tool-input strings that trail it are noise). A terse follow-up such as "ok do it" or "continue" is therefore judged with that reply attached rather than on its own words, which score about -11 against anything.

**Choosing the threshold.** `RERANK_MIN_LOGIT` is -6. Measure a change with `bun bench/recallEval.ts --dir <memoryDir> --cases <file> --semantic ./core/src/memoryEmbed.ts --reranker ./core/src/memoryRerank.ts --sweep`, which scores each case in prompt mode and sweeps the logit threshold. Each row reports recall@5 and false-inject, the share of expect-nothing prompts that still inject a note. The shipped `RERANK_MIN_LOGIT` is the lowest bar that adds no false injection on the synthetic suite: its expect-nothing prompts read -6.2 to -7.1 and the correct paraphrases it would recover read -6.6 to -6.8, so a lower bar admits as many false matches as true ones. `RERANK_MAX_DROP` (8) keeps a second real match that reads 7 to 8 below a strongly matching first one. Through the service in prompt mode, `--embeddings on` scores the synthetic suite 1.000 recall@5 and 0.188 false-inject against 1.000 and 0.167 with `--embeddings off`, and the private real vault 0.941 and 0.167 both ways. The kept keyword picks set the recall floor; the one extra synthetic false injection is a note the gate admits on its own at logit -3.7 for a prompt whose keyword-only pack is empty. Raising `RERANK_MIN_LOGIT` lowers false-inject and eventually costs recall; lowering it does the reverse.

**Measuring through the real service.** `bun bench/recallEval.ts --dir <memoryDir> --cases <file> --service [--embeddings off|on] [--vault <dir>] [--explain]` sends each case through `createRecallService`, so the numbers are what an agent receives. `--embeddings off` (the default) runs with no embedder or reranker, the keyword-only path; `on` loads the real embedder and reranker and downloads the model on first use. `--vault <dir>` gives the service a vault, so session-start composes a brain. `--explain` lists every miss and every false injection with the reason: the note's score against the mode's floor and its rank, the query words that matched and whether they sit in its name, tags or description, the keyword-only rule that admitted or dropped it, and the strongest rivals. `--sweep` also sweeps `minScore` over a grid read from the scores the candidates carry, bracketing the production floor.

### The brain block

`composeBrain` in `core/src/brain.ts` builds the block per vault and channel (`chat` or `daemon`). The channel selects the deny list that hides restricted notes from the map. The map is cached with a build generation: `invalidateBrain` (called by the server's file watcher and the daemon's) bumps it so a build that started earlier never writes a stale map back, and an entry older than `MAP_MAX_AGE_MS` (5 minutes) rebuilds. Memory notes are loaded on every call, so only the map is cached. `buildVaultMap` and `formatVaultMap` (`core/src/vaultMap.ts`) drop detail in steps until the map fits: recent notes, tags, cluster exemplars and base names go first.

`formatSessionStart` (`memory/src/pack.ts`) takes the profile and map as `lead`. It tries the lead with the map, then the profile alone, then none, and returns the first block within `BRAIN_BUDGET_CHARS`. If even the index does not fit, the lead alone is cut at a line boundary and the envelope is closed. Index lines sort hubs first, then by in-link count, `updated`, type (`INDEX_TYPE_ORDER`) and name. Preference bodies are bounded by `PREFERENCE_BODY_MAX`, `PREFERENCE_BODIES_BUDGET` and, with a lead, a `PREFERENCE_BODIES_FLOOR` of 1,500 above a reserve of 3,000 characters for the other lines. `noteDescription` (`memory/src/graph.ts`) falls back to the first prose sentence and skips headings, fences, tables and short `Label:` prefixes.

The recall service's `session-start` mode calls `composeBrain` with the request's channel (`RecallRequest.channel`, default `daemon`) and falls back to the memory index alone when there is no vault or composing fails. An empty memory dir with a vault still reaches `composeBrain`. The route (`core/src/routes/memory.ts`) asks `requestChannel`: an `x-bismuth-channel: chat` header or the owner token means `chat`, anything else `daemon`. The relay (`relay/lib/recall.ts`) sends the chat header, and `chat.ts` and opencode pass `channel: 'chat'` in-process. `buildDaemonPersona` (`daemon/src/daemon/persona.ts`) calls it with the `daemon` channel and `DAEMON_BRAIN_WAIT_MS` (30 s); a failure leaves the persona unchanged. `DAEMON_PERSONA_CHANNELS` maps each daemon backend to `systemPromptAppend` or `developerInstructions`. The visual chat's hook is in `core/src/chat.ts` and opencode's in `core/src/chatProviders/opencode/opencode.ts`. The MCP `brain` and `vault_map` tools run the CLI twins `bismuth brain` and `bismuth map`.

### Link-aware recall

`notesAbout` (`core/src/memoryLinkBoost.ts`) returns the memory notes whose backlinks resolve to the given vault paths, notes linking more of them first. The recall service prepends them to the ranked list with a score of at least 1, so they clear the score floor, after the reranker gate has run and capped at `LINK_BOOST_CAP` (2 for prompt and subagent, 1 for tool). `markBoosted` appends `(about the open note)` to their headers unless that would push the block over its budget. `toolVaultPaths` reads `file_path`, `path` and `notebook_path` from the batch's tool inputs. `neighbourNames` lists the memory notes one wikilink away from the injected ones, and `preferNeighbourPointers` puts them first among the "Also related" lines.

### One service behind every surface

`createRecallService` in `core/src/memoryRecall.ts` is the single implementation. The relay hooks reach it through the route, and the visual chat (`core/src/chat.ts`) and opencode call `recallServiceFor` in-process, so all of them share one already-sent record per session. A recall that was abandoned (the caller timed out) never adds to the record, because the agent never saw the notes. The service rebuilds its index only when a note file's modification time or size changed, and reads `.settings` on every request. It answers `reason: disabled`, `mid-turn-off`, `no-memory`, `no-match` or `turn-budget` (a tool batch after this turn's one injection) when it injects nothing.

### Device files

Ownership is two plain files in the machine directory, so devices see each other's entries only when they share that directory (`BISMUTH_DAEMON_DIR`). `devices.json` gets this device's entry on every scheduler tick, owner or not. `owner.json` is written by core's `setOwner`; the daemon only reads it. `isOwner()` is true when the file is absent, otherwise `ownerDeviceId` must equal this device's id. The check sits at the top of `sendMessage`, the scheduler tick, boot recovery and every trigger consumer. These files coordinate which device does the work; no message passes between devices. [Storage](storage.md) has their formats.

Source: `relay/{bin,lib,hooks}/*`, `core/src/{memoryRecall,memoryLinkBoost,memoryEmbed,memoryRerank,embedWorker,brain,vaultMap,terminal,chat}.ts`, `core/src/chatProviders/opencode/opencode.ts`, `core/src/routes/memory.ts`, `memory/src/{rank,pack,graph,rerankGate,recall,transcript}.ts`, `mcp/src/{instructions,server}.ts`, `daemon/src/daemon/persona.ts`, `daemon/src/lib/{owner,device}.ts`, `daemon/src/daemon/session.ts`, `cli/src/commands/daemon.ts`
