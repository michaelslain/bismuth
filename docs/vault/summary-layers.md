# Summary layers

Summary layers are the summaries an agent reads from the top down to answer a question that spans many notes or a stretch of time: a month links to its weeks, a week to its days, a day to the notes and chats it touched, and a note's summary to the passages it rests on. `bismuth ask` walks them and answers with the passages as `path:line`, so a summary is never the end of the trail.

```bash
bismuth summary build --vault ~/Notes     # once: a summary for every note
bismuth ask "what did I get done on Nov 9 and 10?" --vault ~/Notes
```

```text
Nov 9: you planned the beta launch with the assistant and drafted the Launch Checklist, which includes writing the beta announcement. You also turned both garden beds and planted garlic in the north bed.

Nov 10: you sent beta invites to 40 testers and booked the dentist for Nov 20 at 9am.

Still open: collecting tester feedback by Nov 21 and renewing your library card.

sources
.daemon/memory/day-2026-11-09.md:13  - [[Launch Checklist]] — drafted
.daemon/memory/day-2026-11-09.md:14  - [[Garden]] — beds turned, garlic planted
.daemon/memory/day-2026-11-10.md:13  - [[Launch Checklist]] — invites sent to 40 testers
.daemon/memory/day-2026-11-10.md:14  - [[Errands]] — dentist booked for Nov 20
Errands.md:3  - [x] Book the dentist (Nov 20, 9am)
projects/Launch Checklist.md:5  - [ ] Collect feedback by Nov 21
```

The day digests named the notes, the walk followed their links down, and each source is a line of the file it names.

## What are the layers?

Each layer is a short text that links one level down. The digests are memory notes the daemon's dream writes ([Day notes and `now`](../daemon/memory.md#day-notes-and-now)); the note summaries are written by `bismuth summary build`.

| Layer | Where it lives | Links down to |
|---|---|---|
| month | memory note `month-YYYY-MM` | its weeks, under `## Weeks` |
| week | memory note `week-YYYY-Www` | its days, under `## Days` |
| day | memory note `day-YYYY-MM-DD` | the vault notes that changed (`## Notes changed`), the memory notes it wrote (`## Facts touched`) and each chat as `(session <id>)` |
| note | the note summaries store | the note's passages: each point of the summary carries a quote found in the note and the line it starts on |
| passage | the note itself | |

A day note stays after its week is written, so a week always reaches its days.

## Build the note summaries

`bismuth summary build` writes a one-sentence summary and a few points for every note whose text changed since its last summary.
It runs on the backend `chat.provider` picks, several notes to a turn and a few turns at once.

```bash
bismuth summary build --vault ~/Notes --model haiku
```

| Flag | Effect |
|---|---|
| `--model <name>` | The backend's model for the turns. Without it, the backend's own default. |
| `--fast` | The chat provider's fast tier, as the daemon's crons name it (`haiku` on Claude, low effort on Codex). |
| `--limit n` | Summarise at most `n` notes this run; the rest wait for the next. |
| `--jobs n` | Turns at once. The default comes from the free cores and memory. |
| `--if-built` | Do nothing unless the vault already has summaries. |
| `--json` | Print `{total, summarised, unchanged, failed, removed, backend}`. |

A note the reply leaves out counts as failed and is tried again on the next build. A killed build keeps every turn it finished.
A point whose quote is not in the note is dropped, so every `path:line` a summary prints opens on text that exists.

Read one note's summary with `bismuth summary show <path>`:

```text
A launch checklist where the beta announcement is written and invites have gone to 40 testers, with feedback still to collect by Nov 21.
projects/Launch Checklist.md:3  Beta announcement written
projects/Launch Checklist.md:4  Invites sent to 40 testers
projects/Launch Checklist.md:5  Feedback due by Nov 21, still open
```

It prints the summary, then one `path:line  <point>` row per point, and warns `the note changed since this summary` when the note's text differs from the text it summarised.

## Keep summaries fresh

Once a vault has summaries, the daemon refreshes them before every incremental cron run that looks at the vault (the hourly dream): it runs `bismuth summary build --if-built --fast --jobs 1`, which summarises only the notes whose text changed.
A vault that never ran `bismuth summary build` is left alone, so nothing is spent on it.

## Ask a question across notes

`bismuth ask "<question>"` gathers documents from the top layer down and answers from them in one turn on the backend `chat.provider` picks.

1. The digests covering every time the question names ("last week", "in October"), and the memory notes that match it.
2. The vault notes vault search finds for the question (`--limit`, default `10`), and the notes the digests and memory notes link to.
3. Each document goes whole while the total stays within 400,000 characters; past that, a note goes as its summary alone.

The answer prints first, then `sources` and one `path:line  <passage>` row per passage it rests on. A passage the ai invents is never printed.
`--json` prints `{answer, sources, backend, read, summariesBuilt}`, where `read` lists every document sent and whether it went whole.
Without summaries, `ask` still answers from the documents' text and writes `summaries not built: bismuth summary build` on stderr.

## What can agents not see?

A note hidden from ai on either channel ([visibility](visibility.md)) is never summarised and never sent by `ask`. An agent's `ask` also leaves out what its own channel may not read, and `summary show` treats such a note as not found.

## How it works

`core/src/noteSummaries.ts` packs notes into turns (`packTurns`), parses the reply's JSON lines (`parseSummaryReply`) and anchors each point with `locateQuote` (`anchorSummary`). The store is one JSON line per note in `~/.bismuth/cache/summaries/<sha1 of the vault path>.jsonl`, outside the vault so the file watcher never sees it; `core/src/noteSummaryStore.ts` reads it, keyed by path, with the note's sha1 so `buildSummaries` skips unchanged notes and compacts the file after each build.
`core/src/askVault.ts` holds the walk: `memoryLayer` (digests from `timeRefs` and `digestsCovering`, then `searchMemory` matches), `resolveLinkedNotes` (wikilinks to vault paths, shortest path first), `packDocs` and `locateSources`.
The daemon's refresh is `daemon/src/daemon/summaryRefresh.ts`, started from `fireJob` in `daemon/src/daemon/cron.ts` once an incremental run's gate passes.
The digest links come from `rollupPlan` in `memory/src/digests.ts`, which lists a finer digest until the coarser one links it.

Source: `core/src/noteSummaries.ts`, `core/src/noteSummaryStore.ts`, `core/src/askVault.ts`, `cli/src/commands/summary.ts`, `daemon/src/daemon/summaryRefresh.ts`, `daemon/src/daemon/cron.ts`, `memory/src/digests.ts`
