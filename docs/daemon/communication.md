# Memory injection and device ownership

When a vault's daemon is on, Bismuth puts the vault's memory in front of your AI agents without being asked, and saves their conversations back as raw notes for the `dream` cron to consolidate. A small plugin of Claude Code hooks does this in the app's terminal tabs, and the visual chat does it in-process. Separately, when several devices share one daemon, a single owner device runs its sessions. Read this page to learn what an agent sees from memory, to tune it, or to move the daemon to another machine.

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

## What gets injected

Memory is injected at these moments. Each is a request to core's `POST /memory/recall`, and core decides what to send.

| Moment | Hook | What is sent | Limits |
|---|---|---|---|
| A session starts, resumes, clears or compacts | `SessionStart` | A memory index: one line per note, `[[name]] (type) — description`, plus the full text of short `preference` notes | About 9,500 characters; the lowest-value types are dropped first, and a line says how many were left out |
| You submit a prompt | `UserPromptSubmit` | Excerpts of the notes that best match the prompt | 5 notes, 900 characters each, 6,000 in total |
| A batch of tool calls ends | `PostToolBatch` | Excerpts matching what the tools just did | 2 notes, 600 characters each, 1,800 in total, with a stricter match rule; one batch per prompt |
| A subagent starts | `SubagentStart` | Excerpts matching the task given to the subagent | 4 notes, 700 characters each, 4,000 in total |

Ranking is BM25 over each note's name, tags, description and body, with the name and tags counting most. Preference notes get a small boost and `daily` and `auto` notes a penalty. A note must clear a score floor to be injected, and in a vault of 12 or more notes a note whose only evidence is a single body word that is a small share of the prompt is dropped. An excerpt is the note's header, its file path, its description and its best-matching section, never the whole note. The prompt and subagent blocks end with up to 5 and 4 one-line pointers to related notes that did not fit.

A prompt is matched on what you typed: the `<editor-context>` block the app puts in front of a chat prompt is removed before ranking.

Tool-batch recall injects for at most one batch between two prompts, and each subagent counts its own. A turn of many tool calls would otherwise drip the next-best unsent notes, each weaker than the last, after every batch.

A note is sent once per session. Core remembers what each session and subagent has seen and skips a note until its content changes. After a `compact` or `clear` the memory has left the agent's context, so the record resets and the session-start index is sent again.

The terminal-tab hooks need the Claude Code CLI. The visual chat runs the same recall in-process on session start, each prompt and each tool batch; opencode chats get prompt-time recall. A recall that takes too long injects nothing: prompt and session start wait 1,500 ms, a tool batch 700 ms, a subagent 1,500 ms.

## Tune or turn off automatic recall

These `.settings` keys control injection. They apply on the next call.

| Key | Default | Effect |
|---|---|---|
| `daemon.recall.enabled` | `true` | Master switch for every automatic injection. Off, agents see only what they ask for with `recall` |
| `daemon.recall.midTurn` | `true` | Also recall after each batch of tool calls. Off, memory is recalled at the prompt only |
| `daemon.recall.semantic` | `true` | Also match by meaning, not only by words |

These keys need `daemon.enabled`. [The settings reference](../settings/reference.md#daemon) has the full text.

### Meaning-based matching

With `semantic` on, core also scores notes with a small embedding model (`Xenova/bge-small-en-v1.5`, quantized) and adds the closest few to the ranking as a bonus on top of the word match. The model runs in a separate helper process that core starts on the first semantic query and ends after 10 minutes without one, which returns its memory (about 35 MB of model files; the helper's own memory use is in the settings reference). The first query, and any query past 250 ms, is answered by word matching alone while the helper warms up. The model downloads on first use into `~/.bismuth/models`; offline with no cached copy, recall stays word-based.

With semantics available, prompt and subagent recall add a relevance check: a small second model reads each of the best few notes against your prompt, and a note is injected only when it answers it. A prompt the vault knows nothing about injects nothing. [How recall ranks notes](#how-recall-ranks-notes) has the thresholds.

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

Ranking is BM25 first. With `daemon.recall.semantic` on (the default), core also scores notes by meaning with **bge-small-en-v1.5, quantized (`q8`)**, run by `onnxruntime-node` through `@huggingface/transformers`, and `rankNotes` (`memory/src/rank.ts`) fuses the top cosines in additively. `semantic: false` means the model is never loaded. The iPad in-process backend never imports any of it, and the compiled `bismuth serve` is BM25-only too: the embed worker runs only in the core sidecar, recognised by `BISMUTH_CORE_SIDECAR=1` on a binary whose exec name starts with `bismuth-core`. The semantic query text is capped at 1,000 characters (`SEMANTIC_QUERY_CHARS`). A reply that used the channel carries `"semantic": true`.

**Evidence rules.** In tool mode, at 12 or more notes, evidence is strict: a semantic-only hit never injects, because a cosine is only a bonus on top of lexical evidence. bge-small cosines sit in a narrow band, so the floor is relative per query: a note is lifted only when its cosine clears both the mode's `semanticMinCosine` and this query's tenth-best cosine plus `SEMANTIC_BACKGROUND_MARGIN` (0.07). A prompt the vault knows nothing about scores ten notes within a few hundredths of each other and lifts none. With that map in hand (prompt and subagent modes, 12 or more notes), a note matched only by words in its body, with no name, tag or description hit and no semantic lift, is dropped, and the prompt-mode bar rises from `minScore` 0.08 to `semanticMinScore` 0.12 (`memory/src/pack.ts`). Without semantics (the setting off, the model still warming, the iPad) the lexical rules and 0.08 apply. `which`, `whose`, `whom`, `these`, `those` and `off` are stop words.

**Vectors, chunked.** One `vectors-chunked.json` per memory dir under `~/.bismuth/cache/recall/<sha1(memoryDir)>/`, keyed by `noteHash`; Only notes whose hash changed are re-embedded, throttled to one run per 2 s, and a restart embeds nothing already stored. A note is cut into windows of at most `CHUNK_CHARS` characters (`noteChunks`, up to `MAX_CHUNKS_PER_NOTE`), each led by the note's name, description and tags, and scores as its best chunk (max-sim), so a fact deep in a long note is not diluted by the rest. A stored entry whose dimension is 0 or does not divide its byte length is skipped as corrupt and re-embedded. Queries get bge's instruction prefix; documents do not.

**The reranker gate** (`core/src/memoryRerank.ts`, `memory/src/rerankGate.ts`). With semantics in hand, prompt and subagent modes (never tool mode) send the top `RERANK_CANDIDATES` (5) ranked notes scoring at least `semanticMinScore` (0.12), as the excerpt the agent would read, to a cross-encoder in its own idle-exiting child process, the embedder's pattern. `gateByRerank` keeps a note only when its raw logit is at least `RERANK_MIN_LOGIT` and within `RERANK_MAX_DROP` (6) of the best candidate; an empty result injects nothing. The gated list is packed with `semantic: false`, so `semanticMinScore` never vetoes a note the reranker admitted. The budget is `RERANK_TIMEOUT_MS` (700 ms): a cold load, a failure, a timeout or a bad reply falls back to the rules above for that request, and the recall never waits longer.

The reranker judges each passage against `rerankQuery`. That is the prompt itself, at most `RERANK_QUERY_CHARS` (1,000) characters, because the cross-encoder cuts the joined pair from the end at 512 tokens and a long subagent brief would otherwise leave no passage tokens. When the prompt has fewer than `RERANK_TERSE_TERMS` (4) content terms, it is the prompt followed by the first `RERANK_CONTEXT_CHARS` (400) of the context, which leads with the agent's last reply (the tool-input strings that trail it are noise). A terse follow-up such as "ok do it" or "continue" is therefore judged with that reply attached rather than on its own words, which score about -11 against anything.

**Choosing the threshold.** `RERANK_MIN_LOGIT` is -6. Measure a change with `bun bench/recallEval.ts --dir <memoryDir> --cases <file> --semantic ./core/src/memoryEmbed.ts --reranker ./core/src/memoryRerank.ts --sweep`, which scores each case in prompt mode and sweeps the logit threshold. Each row reports recall@5 and false-inject, the share of expect-nothing prompts that still inject a note. The shipped value sits just below the largest threshold that keeps recall@5 at or above 0.95 on both the synthetic suite and a real vault, which leaves margin for vaults the sweep did not see. Raising it lowers false-inject and eventually costs recall; lowering it does the reverse.

### One service behind every surface

`createRecallService` in `core/src/memoryRecall.ts` is the single implementation. The relay hooks reach it through the route, and the visual chat (`core/src/chat.ts`) and opencode call `recallServiceFor` in-process, so all of them share one already-sent record per session. A recall that was abandoned (the caller timed out) never adds to the record, because the agent never saw the notes. The service rebuilds its index only when a note file's modification time or size changed, and reads `.settings` on every request. It answers `reason: disabled`, `mid-turn-off`, `no-memory`, `no-match` or `turn-budget` (a tool batch after this turn's one injection) when it injects nothing.

### Device files

Ownership is two plain files in the machine directory, so devices see each other's entries only when they share that directory (`BISMUTH_DAEMON_DIR`). `devices.json` gets this device's entry on every scheduler tick, owner or not. `owner.json` is written by core's `setOwner`; the daemon only reads it. `isOwner()` is true when the file is absent, otherwise `ownerDeviceId` must equal this device's id. The check sits at the top of `sendMessage`, the scheduler tick, boot recovery and every trigger consumer. These files coordinate which device does the work; no message passes between devices. [Storage](storage.md) has their formats.

Source: `relay/{bin,lib,hooks}/*`, `core/src/{memoryRecall,memoryEmbed,memoryRerank,embedWorker,terminal,chat}.ts`, `core/src/routes/memory.ts`, `memory/src/{rank,pack,rerankGate,recall,transcript}.ts`, `daemon/src/lib/{owner,device}.ts`, `daemon/src/daemon/session.ts`, `cli/src/commands/daemon.ts`
