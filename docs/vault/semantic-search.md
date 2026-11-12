# Semantic search

Semantic search ranks the notes, PDFs, images and past chats of a vault by meaning as well as by the words they contain, so a query like "how do I plan a launch" finds a note titled "Release checklist". `bismuth search` blends the keyword ranking and the meaning ranking into one list when the switch is on. The switch, `embeddings.enabled`, is off by default and is shared with the meaning-based channel of memory recall.
Read it to decide whether to turn the switch on, to run a blended query, or to change how the index is built.

```yaml
# In the vault's .settings
embeddings:
  enabled: true
```

```bash
bismuth search "open things" --limit 3 --vault ~/Notes
```

```text
open.md  0.912  about open things
```

Each hit is a path, a score from 0 to 1 and an excerpt of the best matching passage, at most 300 characters. The score is the fused rank of the hit, scaled so the best hit is `1`. A hit carries a kind:

| Kind | What it is | Text line starts with | JSON fields |
|---|---|---|---|
| `note` | A markdown note. | `open.md` | `path`, `score`, `excerpt`, `kind` |
| `pdf` | One page of a PDF with a text layer or a transcript. | `papers/a.pdf p.4` | the same, plus `page` |
| `image` | An image, found through its description. `path` is the image itself, never its companion note. | `photos/board.png (image)` | the same |
| `chat` | A past conversation in this vault. | `chat 2026-10-29 <session-id>` | `path` (`chat <session-id>`), `score`, `excerpt`, `kind`, `date`, `session` |

Hits of every kind share one list. A note that ranks well by words and by meaning outranks a note that ranks well by only one. When the fitted blend turns reranking on, the best twenty hits are then reordered by a reranking model if it answers within 700 milliseconds, and the scores stay in descending order. The committed blend leaves reranking off.

## What does turning it on cost?

Turning `embeddings.enabled` on starts a separate helper process the first time a query or a background pass needs the model. The helper holds a small embedding model (about 35 MB on disk, roughly 260 to 280 MB of RAM while it runs) and exits after 10 minutes without work, which returns the memory.
The first pass over a large vault takes minutes of CPU while every note is embedded. Queries are answered while it runs, from the notes embedded so far.

With the key off, recall and search are keyword-only and the helper never starts. [The `embeddings` section of the settings reference](../settings/reference.md#embeddings) owns the key row; [how recall uses the channel](../daemon/communication.md) is on the daemon page.

## How do I run a blended search?

Run `bismuth search <query> [--limit n] [--json]`. `--limit` defaults to `10`; `--json` prints the hits as an array of the objects in the table above. `--regex`, `--case` and `--word` switch to literal matching, which stays keyword-only and prints matches with snippets. [The CLI reference](../cli/reference.md) has every flag.

`bismuth map --around <note>` adds a `similar:` line of up to five near files (notes, PDFs and images, never chats) when the switch is on and the answer arrives within two seconds. With the switch off, or when the answer is unavailable or late, the output is unchanged and the exit code stays `0`. `--json` adds a `similar` array in the same case.

```text
# open.md
…
similar: chatty.md, a/b.md
```

An agent runs `bismuth search <query>` and `bismuth map --around <note>` in its shell, or calls the `bismuth_cli` MCP tool with the same arguments.

## What happens when meaning search is unavailable?

When the meaning side cannot answer, `bismuth search` prints the keyword hits in the same shape, writes `meaning search unavailable (<reason>): keyword results only` on stderr and exits `0`. The reason is one of the answers below; `map --around` ignores an unavailable answer. A running core that answers with an error is different: the CLI prints the error and exits `1`.

| Answer | Meaning | What to do |
|---|---|---|
| `off` | `embeddings.enabled` is not `true` in the vault `.settings`. | Set the key to `true`. |
| `no-worker` | The build that answered cannot run the model. The compiled `bismuth` binary is one. | Open the vault in the Bismuth app, which runs the model, then retry. |
| `warming` | The model is still loading, nothing is embedded yet, the note has no vector yet, the running server did not answer in time, or a CLI run with no server did not finish embedding the vault within its wait. | Retry in a moment; a CLI run keeps the notes it embedded, so the next one starts where it stopped. |
| `failed` | The embedding model raised an error. The message carries it. | Read the message; retry once the cause is fixed. |

A wrong value does not raise an error: a missing, corrupt or non-boolean `embeddings.enabled` reads as `false`, so the answer is `off`.

## Which core answers a query?

A core that is running for this vault answers first. The CLI finds it through the run registry, or through `--api`, `BISMUTH_API` or `CLAUDE_RELAY_URL` when one is set. A core serving another vault is never used, and an explicit address whose port the registry lists for a different vault is ignored.
When no core answers, the CLI runs the query in its own process if the switch is on and the build can host the model. With no core to embed the vault, that run embeds every new or changed note itself before it ranks, inside the same wait, so a vault never opened in the app still gets an answer on the first call.

A running core that does not answer in time yields the keyword hits with reason `warming` and no in-process run, because it is probably still loading the same model. A running core that answers with an error prints that error and exits `1`, also with no in-process run.

## How does an image get a description?

An image is found by meaning through the description in its companion note (`photo.png` → `photo.png.md`), so an image with no description is not in the index. Turn on `embeddings.describeImages` and core has Claude Haiku describe each new or changed image, including any visible text, through your own `claude` login:

```yaml
embeddings:
  enabled: true
  describeImages: true
```

For one image on demand, run `bismuth image describe <file> [--force]`. An image whose bytes are unchanged since its last description is skipped unless `--force` is given. Images over 5 MB, formats Claude cannot read, and images hidden from the daemon are never sent. [The CLI reference](../cli/reference.md) has the output shape.

## How does `bismuth docs search` blend?

`bismuth docs search` blends a keyword ranking and a meaning ranking of Bismuth's own documentation sections when the vault's `embeddings.enabled` is on, with its own fitted blend, which leans on meaning: a question in everyday words, such as "how do I make a task repeat every week", finds the section that answers it even when the section uses other words. With the switch off it prints the keyword ranking alone. [The CLI reference](../cli/reference.md) has the flags and the output shape.

## What can agents not see?

A hidden or chat-only note, PDF or image never appears in the hits, the `similar:` line or an excerpt for an agent, from the keyword side or the meaning side. Chats follow `chatVisibility`, and an agent in a vault that restricts any note gets no chat hits at all, the same rule `bismuth history` keeps. Denied notes are dropped before the two rankings are fused and before the limit is applied, so a hidden best match does not take a slot. A hidden note used as the `--around` anchor returns nothing. [Visibility controls](visibility.md) explains the levels. You see everything from your own shell.

## What happens in the background?

- Turning the switch off stops background embedding, including a pass already running. Turning it on again rescans the vault and embeds the notes that changed.
- Core re-embeds changed notes shortly after a file change and after the vault loads at boot.
- Markdown notes, PDFs (page by page) and images (through the description and text in their companion note) are indexed. A PDF page with a transcription (see [Transcribe pages and handwritten scans](transcription.md)) is indexed by its transcript, which wins over the PDF's own text layer, so a handwritten notebook or a scan is found by what is written on it. Highlight marks and the transcript's marker comments stay out of the index. Past chats are indexed in their own store. Any file or folder whose path has a dot-prefixed segment is skipped, which keeps the `.daemon/` folder out of the index.
- Vectors persist between runs, so a restart embeds only what changed.

## How it works

`core/src/vaultEmbed.ts` holds one vector store per vault root, persisted under `~/.bismuth/cache/vault-vectors` in a folder named by a hash of the vault path, in the same append-only format as recall's vectors ([Memory injection](../daemon/communication.md)). Each note is parsed once per change through the shared note cache, and its hash is computed once per change, so an edit re-embeds and writes only that note. A note becomes chunks that each lead with its path, its title (the first heading, else the file name) and its tags, so those words count toward the meaning of every chunk. A hit's excerpt is the best chunk with that header removed.

`syncVaultEmbeddings` is the entry point for background work. The server calls it at boot and on each file change that touches the vault, and it debounces by 1.5 seconds. A pass embeds 8 notes per call so a query slips in between slices, and the store writes to disk at the end of a pass and at most every 10 seconds during one.
A query waits up to 20 seconds for the model, including a cold load, before it answers `warming`.
A query with `build: true` (what the CLI's in-process run passes) also runs the store's pending pass with `flush()` inside that wait, because the debounce timer is unref'd and a one-shot process exits before it fires; a pass that outlasts the wait answers `warming` with how many notes are embedded.

`core/src/memoryEmbed.ts` owns the shared embedder child process (loaded lazily, exits when idle) and the vector store. Memory recall and vault search share the one process. `core/src/embeddingsSetting.ts` is the single reader of the switch: it reads `.settings` on each call and returns `false` on any missing or malformed value.

`POST /search/semantic` in `core/src/routes/vault.ts` takes `{query, k}` or `{around, k}` and answers `{hits}` (files merged with `chatSemanticSearch` from `core/src/chatEmbed.ts` for a `query`, files only for `around`; a chat source that is unavailable leaves the files alone) or `{unavailable, message}` with status `200`; it returns `400` when neither `query` nor `around` is a string. It is read-only despite the method, and it applies the caller's visibility. [The HTTP reference](../api/http-reference.md#search) lists the other search routes.

`core/src/hybridSearch.ts` holds the blend. `hybridSearch` ranks notes with `rankCandidates` (the BM25 ranking of `core/src/search.ts` without its literal-snippet filter), ranks files and chats by meaning, fuses the two lists with `fuseRanks` (weighted reciprocal rank: each list's term is `weight / (k + rank)`, summed per document), scales the scores to the best hit and, when the fitted blend says so, reorders the top `RERANK_TOP` with the cross-encoder from `core/src/memoryRerank.ts`. The weights, `k` and the reranking switch come from the `fusion` block of `core/src/sourceGateModel.json`, loaded by `loadFusionModel` (`core/src/sourceGate.ts`); a missing or malformed block answers from keywords with reason `blend model missing`. `searchPools` returns the two lists before fusion. The model modules load lazily, so core boot never imports them. `POST /search/hybrid` takes `{query, limit, channel?, rerank?, agent?}` and answers `{hits, mode, reason?}` with status `200`, or `400` when `query` is missing; it is read-only despite the method and applies the caller's visibility; [the HTTP reference](../api/http-reference.md#search) has the fields.

`bench/fitSourceGate.ts` fits the blend. `bun bench/recallReplay.ts --vault <vault> --out <dir> --judge --search` records both lists for every labelled prompt, with the cross-encoder's logit for each list's head. `bun bench/fitSourceGate.ts --from <dir> --write core/src/sourceGateModel.json` then tries a grid of keyword weights (the meaning weight is 1), values of `k` and reranking on or off, picks the point with the best recall@10 of the files the agent went on to open on the training folds, and scores it on the held-out folds. Folds split by session. If no blend reaches the held-out recall@10 of ranking by meaning alone, the fit writes keyword weight `0` and `fitOn.verdict` says so. [Memory injection](../daemon/communication.md) describes the replay, the judge, the time-ordered split and the measured exchange rate behind the fit of the source gate that shares the file.

`docsHybridSearch` in `core/src/docsHybrid.ts` blends the docs: the keyword hits of `searchDocs` (`mcp/src/docs.ts`, scored on the query minus filler words) and the nearest sections of `core/src/docsEmbed.ts`, fused by `fuseRanks` with the `docsFusion` block of `core/src/sourceGateModel.json` (`loadDocsFusionModel`); with no block it fuses with equal weights. When the block turns reranking on, `rerankHead` reorders the fused head by each hit's heading and snippet.

The replay benches decide what search runs, each on the files or pages agents read after real prompts. `bun bench/searchReplay.ts pools --vault <vault> --out <dir> [--embed <name>] [--context none|headings|summaries]` builds the vault and chat indexes with one embedder from `EMBED_SPECS` (`core/src/embedModel.ts`) and records both lists of every labelled prompt; `rerank --out <dir> --reranker <name>` adds each cross-encoder's logits from `RERANK_MODELS` (`core/src/rerankWorker.ts`) and its time for a head of 20; `score --base <dir> --variant <dir>` fits the blend per session fold and prints the variant's recall@10 and MRR minus the base's, with a 95% interval over sessions (`--fixed kw,k,rerank` scores a base blend as it ships, not refit). `bench/docsSearchReplay.ts` builds the same pools for docs search from real docs searches and reads plus a question per sampled section written by Claude Haiku, and `searchReplay.ts fit --dir <dir> --key docsFusion --write core/src/sourceGateModel.json` commits its blend. The bench passes `BISMUTH_EMBED_MODEL`, `BISMUTH_CHUNK_CONTEXT` and `BISMUTH_RERANK_MODEL` to core; the store records the model and chunk text it embedded with and re-embeds when either differs. `--out` holds the prompts and an index of the vault, so keep it out of the repo.

`hybridQuery` in `cli/src/semantic.ts` picks the core, posts to that route with the limit and, when an agent runs the command, `agent` naming its channel, so the route applies that agent's deny list before fusion, applies the deny filter again on the CLI side, and falls back to `hybridSearch` in process only when no core answers. `semanticQuery` in the same file serves `map --around` the same way over `POST /search/semantic`. It drops chat hits whenever the deny list is not empty. `tryCall` (`cli/src/http.ts`) tells the cases apart: a value, no core reachable, a timeout, or an error status from a live core. One time budget covers the server attempt and the fallback together.

Source: `core/src/vaultEmbed.ts`, `core/src/memoryEmbed.ts`, `core/src/embedModel.ts`, `core/src/rerankWorker.ts`, `core/src/embeddingsSetting.ts`, `core/src/routes/vault.ts`, `core/src/hybridSearch.ts`, `core/src/docsHybrid.ts`, `core/src/sourceGate.ts`, `bench/fitSourceGate.ts`, `bench/searchReplay.ts`, `bench/docsSearchReplay.ts`, `cli/src/semantic.ts`, `cli/src/commands/search.ts`, `cli/src/commands/map.ts`
