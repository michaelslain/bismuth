# Semantic search

Semantic search ranks the notes in a vault by meaning instead of by the words they contain, so a query like "how do I plan a launch" finds a note titled "Release checklist". It is off by default and shares one switch, `embeddings.enabled`, with the meaning-based channel of memory recall.
Read it to decide whether to turn the switch on, to run a meaning-based query, or to change how the index is built.

```yaml
# In the vault's .settings
embeddings:
  enabled: true
```

```bash
bismuth search "open things" --semantic --limit 3 --vault ~/Notes
```

```text
open.md  0.912  about open things
```

Each hit is the note path, a cosine score and an excerpt of the best matching passage, at most 300 characters.

## What does turning it on cost?

Turning `embeddings.enabled` on starts a separate helper process the first time a query or a background pass needs the model. The helper holds a small embedding model (about 35 MB on disk, roughly 260 to 280 MB of RAM while it runs) and exits after 10 minutes without work, which returns the memory.
The first pass over a large vault takes minutes of CPU while every note is embedded. Queries are answered while it runs, from the notes embedded so far.

With the key off, recall and search are keyword-only and the helper never starts. [The `embeddings` section of the settings reference](../settings/reference.md#embeddings) owns the key row; [how recall uses the channel](../daemon/communication.md) is on the daemon page.

## How do I run a semantic query?

Run `bismuth search <query> --semantic [--limit n] [--json]`. `--limit` defaults to `10`; `--json` prints the hits as an array of `{path, score, excerpt}`. [The CLI reference](../cli/reference.md) has every flag.

`bismuth map --around <note>` adds a `similar:` line of up to five near notes when the switch is on and the answer arrives within two seconds. With the switch off, or when the answer is unavailable or late, the output is unchanged and the exit code stays `0`. `--json` adds a `similar` array in the same case.

```text
# open.md
…
similar: chatty.md, a/b.md
```

An agent reaches both through the MCP `bismuth_cli` tool (`search` with `--semantic`) and through `vault_map` with `around`.

## What does an unavailable answer mean?

An unavailable answer is a reply of `{unavailable, message}` instead of hits. `bismuth search --semantic` prints the message on stderr and exits `1`; `map --around` ignores it.

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

A running core that does not answer in time yields `warming` and no in-process run, because it is probably still loading the same model. A running core that answers with an error prints that error and exits `1`, also with no in-process run.

## What can agents not see?

A hidden or chat-only note never appears in the hits, the `similar:` line or an excerpt for an agent. Denied notes are dropped before the limit is applied, so a hidden best match does not take a slot. A hidden note used as the `--around` anchor returns nothing. [Visibility controls](visibility.md) explains the levels. You see everything from your own shell.

## What happens in the background?

- Turning the switch off stops background embedding, including a pass already running. Turning it on again rescans the vault and embeds the notes that changed.
- Core re-embeds changed notes shortly after a file change and after the vault loads at boot.
- Only markdown notes are indexed. Any file or folder whose path has a dot-prefixed segment is skipped, which keeps the `.daemon/` folder out of the index.
- Vectors persist between runs, so a restart embeds only what changed.

## How it works

`core/src/vaultEmbed.ts` holds one vector store per vault root, persisted under `~/.bismuth/cache/vault-vectors` in a folder named by a hash of the vault path. A note becomes chunks that each lead with its path, its title (the first heading, else the file name) and its tags, so those words count toward the meaning of every chunk. A hit's excerpt is the best chunk with that header removed.

`syncVaultEmbeddings` is the entry point for background work. The server calls it at boot and on each file change that touches the vault, and it debounces by 1.5 seconds. A pass embeds 8 notes per call so a query slips in between slices, and the store writes to disk at the end of a pass and at most every 10 seconds during one.
A query waits up to 20 seconds for the model, including a cold load, before it answers `warming`.
A query with `build: true` (what the CLI's in-process run passes) also runs the store's pending pass with `flush()` inside that wait, because the debounce timer is unref'd and a one-shot process exits before it fires; a pass that outlasts the wait answers `warming` with how many notes are embedded.

`core/src/memoryEmbed.ts` owns the shared embedder child process (loaded lazily, exits when idle) and the vector store. Memory recall and vault search share the one process. `core/src/embeddingsSetting.ts` is the single reader of the switch: it reads `.settings` on each call and returns `false` on any missing or malformed value.

`POST /search/semantic` in `core/src/routes/vault.ts` takes `{query, k}` or `{around, k}` and answers `{hits}` or `{unavailable, message}` with status `200`; it returns `400` when neither `query` nor `around` is a string. It is read-only despite the method, and it applies the caller's visibility. [The HTTP reference](../api/http-reference.md#search) lists the other search routes.

`cli/src/semantic.ts` picks the core, posts to the route asking for `k` plus the number of deny entries, applies the deny filter again on the CLI side and keeps the first `k`, and falls back to the in-process functions in `vaultEmbed.ts` only when no core answers. `tryCall` (`cli/src/http.ts`) tells the cases apart: a value, no core reachable, a timeout, or an error status from a live core. One time budget covers the server attempt and the fallback together.

Source: `core/src/vaultEmbed.ts`, `core/src/memoryEmbed.ts`, `core/src/embeddingsSetting.ts`, `core/src/routes/vault.ts`, `cli/src/semantic.ts`, `cli/src/commands/search.ts`, `cli/src/commands/map.ts`
