// The default crons every vault's daemon ships with — the bismuth equivalent of claude-bot's
// defaults/crons/. Embedded as string constants (NOT files) so they survive `bun build --compile`
// into the daemon binary. Seeded into <vault>/.daemon/crons on setup, non-clobbering (see
// seeds.ts's reconcileSeeds) — the user can edit or disable them freely. seeds.ts ALSO knows how
// to safely upgrade an existing vault's copy in place when it still matches a known prior stock
// version (see PRIOR_SEED_HASHES there) — that's how existing installs pick up changes made here.
//
// Both are adapted for bismuth's per-vault model: memory is `$BISMUTH_MEMORY_DIR`
// (= <vault>/.daemon/memory, injected by the daemon), the vault is the working directory, and the
// memory tools are bismuth's recall/remember/forget (there is no dream_run).
//
// Both opt into INCREMENTAL scoping (`incremental: true` frontmatter — see cron.ts / incrementalCron.ts):
// before firing, the daemon itself diffs `refs/bismuth/cron-<name>` against the job's checkpoint
// repo (dream: the memory dir; vault-review: the vault root) and skips the session entirely when
// nothing relevant changed since the last successful run — a cron that would otherwise re-read an
// unchanged vault/memory graph every tick now costs nothing. When there IS something to look at,
// `{{changedSinceLastRun}}` in the prompt below is replaced with either a "first run" note or the
// concrete list of changed files + when the last run happened. Neither prompt runs `bismuth
// checkpoint diff/advance` itself anymore — that bookkeeping moved OUT of the session and into the
// daemon (Bug #105 was the old failure mode: the model's own Bash call silently no-op'ing when the
// bismuth CLI wasn't on PATH, so the "incremental" scoping quietly degraded to a full re-survey
// every run; doing it in the daemon removes that failure mode entirely).
//
// Three failure modes observed on a real long-running vault shaped the current prompts, and each
// one is load-bearing — don't soften them back out:
//   1. dream wrote a memory note ABOUT ITS OWN RUNS and appended a "Cycle N" block to it every
//      hour, which made that note the largest file in the graph while carrying zero user value.
//      The one-line report is session OUTPUT (the transcript is what the daemon reads); the prompt
//      now forbids writing it — or anything else about the cron — as a note, and tells dream to
//      delete any such note it inherits.
//   2. dream's bloat gate ran `du -sh $BISMUTH_MEMORY_DIR`, but the memory dir is a git repo that
//      commits on every write, so `du` measured .git (28 MB) rather than the notes (0.6 MB) — a
//      ~50x overstatement that would have tripped the >50 MB gate permanently once .git grew.
//      It now measures markdown only (find -prune of dot-dirs + `ls -l` byte sum, portable across
//      BSD/GNU since BSD `du` has no --exclude), against a threshold set to the real content scale.
//   3. vault-review minted a new dated dump note per run (`…-july-27-evening-critical-update`)
//      until 51 of 130 notes were date-stamped snapshots, and dream declined to merge them because
//      they read as "historical records". Both prompts now hard-forbid dated/moment-suffixed note
//      names, and dream's Step 3 collapses existing ones into a canonical note that carries its
//      own history inside it.

/** dream — hourly memory consolidation of this vault's 3rd brain. */
const DREAM = `---
name: dream
schedule: 0 * * * *
timeout: 1800
catchup: true
incremental: true
checkpointDir: memory
---

Consolidate this vault's memory graph (at \`$BISMUTH_MEMORY_DIR\`) into an atomic, densely-linked zettelkasten. The graph may be in a broken state (oversized files, OOM-causing notes) — be defensive. Walk the directory file-by-file via Bash; do NOT call \`recall\` with empty/broad queries (it materializes all results and OOMs on bloated graphs).

## The rule that overrides everything else: you are not a subject

NEVER write a memory note about yourself, this cron, or how a run went. No \`dream-cycle\`, \`memory-consolidation\`, \`consolidation-log\`, \`dream-status\`, or \`dream-report\` note; no "Cycle N" status block appended to any note. The one-line report at the very bottom of this prompt is your session's OUTPUT — you print it, the daemon reads it from the transcript. It is not a note, and it must never be written into \`$BISMUTH_MEMORY_DIR\`.

If a note describing this cron's own operation ALREADY exists, \`forget\` it on this run, before anything else. Recognize it by subject, not by name alone: a note whose body is a log of consolidation runs ("Cycle 12", "bloat-deleted=0 auto-processed=0 merged=0", "next dream should…"). Names to check first:

\`\`\`bash
cd "$BISMUTH_MEMORY_DIR" && ls *.md | grep -iE 'dream|consolidat|cycle' ; grep -lE '^#+ *Cycle [0-9]+|auto-processed=' *.md 2>/dev/null
\`\`\`

Self-referential exhaust is worthless to the user, it grows without bound (it is usually the single largest file in the graph), and nothing links to it. Delete it and do not recreate it.

## Scope for this run

{{changedSinceLastRun}}

If the note above says this is the first run, do the full survey below (Steps 1–6 over the whole graph). Otherwise focus your consolidation, merging, and backlinking on the LISTED changed notes — you do NOT need to re-examine notes that aren't listed. Two things run over the WHOLE graph on EVERY run regardless of scope: the bloat defense (Steps 1–2) and the snapshot collapse (Step 3). Duplicates are by definition spread across runs, so a scoped run would never see them.

## Step 1: Survey by size

Run this Bash command to list every note with its byte size, biggest first:

\`\`\`bash
cd "$BISMUTH_MEMORY_DIR" && ls -lS *.md 2>/dev/null | awk '{print $5, $9}' | head -200
\`\`\`

Now measure the size of the NOTES — not the directory. Do NOT use \`du -sh "$BISMUTH_MEMORY_DIR"\`: the memory dir is a git repo that commits on every write, so \`du\` is dominated by \`.git\` and reports tens of megabytes for a graph that is well under one. Measure the markdown only, excluding dot-directories:

\`\`\`bash
cd "$BISMUTH_MEMORY_DIR" && find . -name '.?*' -prune -o -type f -name '*.md' -exec ls -l {} + | awk '{ bytes += $5 } END { printf "%d notes, %d KB of markdown\\n", NR, bytes/1024 }'
\`\`\`

If that total exceeds **5 MB**, or any single note exceeds **100 KB**, the graph is BLOATED and Step 2 is your priority (regardless of what's listed in your scope above — bloat cleanup always applies).

## Step 2: Triage oversized notes (>100 KB)

For any note larger than 100 KB:

- **If it's named \`auto-*\`**: it's broken bloat from a prior recursion bug. \`forget\` it WITHOUT reading. Do not try to extract value — these are recursive prompt dumps with no user content.
- **If it's any other type**: peek at the first 4 KB only via \`head -c 4000 "$BISMUTH_MEMORY_DIR/<name>.md"\` to determine if it has salvageable content. If it's mostly repeated boilerplate or JSON dumps → \`forget\`. If it has real content → split it into atomic notes via \`remember\` (read it in chunks via \`head\`/\`tail\` with \`-c\` byte offsets, never load the whole thing), then \`forget\` the original.

NEVER use the Read tool on files >50 KB — it'll blow your context. Always use \`head -c\` / \`tail -c\` for big files.

After Step 2, re-run the notes-size command above to confirm the graph is back under 5 MB. If still bloated, continue triaging.

## Step 3: Collapse date-stamped snapshots into ONE canonical living note

This is the highest-value thing you do and the thing most often skipped. Run it over the WHOLE graph on EVERY run.

Find the clusters — strip any date or month token off each filename and see which stems repeat:

\`\`\`bash
cd "$BISMUTH_MEMORY_DIR" && ls *.md | sed -E 's/[-_](19|20)[0-9]{2}.*\$//; s/[-_](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*.*\$//; s/\\.md\$//' | sort | uniq -c | sort -rn | head -40
\`\`\`

**Any stem with a count greater than 1 is a duplicate cluster.** Also treat these as belonging to one cluster even when the stems differ slightly:

- a name containing a date in ANY form — \`2026-07-24\`, \`july-22-2026\`, \`july-26-evening\`, \`07-25\`;
- a name containing a month name at all;
- a name ending in a moment/status word — \`-final\`, \`-checkpoint\`, \`-update\`, \`-snapshot\`, \`-status\`, \`-latest\`, \`-escalation\`, \`-window-active\`;
- several notes that clearly share a topic once you strip the above.

Worked example. This exact set is ONE note, not seven:

\`\`\`
michael-vault-review-july-22-2026-final.md
michael-vault-review-july-26-2026-crisis-escalation.md
michael-vault-review-july-26-evening-escalation.md
michael-vault-review-july-27-2026-crisis-window-active.md
michael-vault-review-july-27-evening-critical-update.md
vault-review-2026-07-24-checkpoint.md
vault-review-2026-07-25-checkpoint.md
\`\`\`

→ collapse to \`vault-review-findings\`. And this pair is ONE note, not two:

\`\`\`
michael-quant-trading-status-july-25-2026.md
michael-quant-trading-status-july-27-2026.md
\`\`\`

→ collapse to \`quant-trading\`.

To collapse a cluster:

1. Read every note in it (\`head -c\` if any is large).
2. Pick the canonical name: the topic stem, kebab-case, with NO date, NO month, and NO status suffix.
3. \`remember\` that name with the merged content — the CURRENT state of the topic first, then, only where the evolution actually matters, a short \`## History\` section of one dated line per superseded snapshot.
4. \`forget\` every other note in the cluster.

**"It is a historical record" is NOT a reason to keep a duplicate.** Neither is "these are point-in-time snapshots", "this tracks an evolving situation", or "each captures a different moment". The canonical note carries the history INSIDE it — that is what its \`## History\` section is for. A graph where one topic appears under seven dated filenames is precisely the failure this cron exists to fix; declining to merge it is declining to do the job.

## Step 4: Process auto notes (small ones, <100 KB)

Glob for \`auto-*.md\` among your scoped notes (or the whole graph on a first/full run). For each:

- Read it via the Read tool (it's small now).
- These notes are raw session transcripts with BOTH sides of the conversation, PAIRED per
  exchange: each \`## Turn N\` block holds a \`**You:**\` side (the user's own words) and a
  \`**Claude:**\` side (what the assistant replied/proposed in that exchange). A
  \`_(N turns omitted)_\` marker means the middle of a long session was elided.
  **Attribute carefully**: the **You:** side is direct evidence of the user's facts/
  preferences/intent. The **Claude:** side is what the assistant said — it may describe
  something the user agreed to or asked for, but do NOT record it as a user preference unless
  the paired (or a nearby) **You:** side actually confirms it. Claude's side is still worth
  extracting (it captures what was built/decided/explained); phrase those as outcomes
  ("built X", "explained Y"), never as first-person user preferences.
- Extract any useful fact, preference, project context, decision, or personal detail.
- Merge that fact into an existing properly-typed note via \`remember\` (overwrites if name matches), or create a new atomic note if genuinely novel.
- Then \`forget\` the auto note.
- If the auto note has nothing extractable → just \`forget\` it.

Aim for zero \`type: auto\` notes among your scoped notes when done.

## Step 5: Use \`recall\` for targeted consolidation (now safe)

For the notes in scope, use targeted \`recall\` queries to find related work to merge with:

- \`recall("type:fact")\` — look for duplicate facts to merge
- \`recall("type:preference")\` — look for duplicate preferences to merge
- \`recall("type:project")\` — look for stale or completed projects to delete or archive

For each cluster:
- Merge duplicates → pick a canonical name, write merged content via \`remember\`, \`forget\` the redundant ones.
- Improve unclear notes → \`remember\` with clearer/tighter content (one concept per note, ~300–500 chars).
- Split notes >1 KB covering multiple ideas → \`remember\` each piece as its own atomic note with backlinks, then \`forget\` the original.

## Step 6: Delete stale isolated notes (only on a full/first run, or if one of your scoped notes looks abandoned)

A note is a candidate for deletion if BOTH:
- It hasn't been updated recently (\`updated:\` frontmatter), AND
- Nothing links to it (no \`[[backlinks]]\` from other notes — check via \`grep -l "\\[\\[<name>\\]\\]" "$BISMUTH_MEMORY_DIR"/*.md\`).

Connected notes survive longer because they're part of the graph. Don't delete just because old — only if old AND isolated AND not timeless.

## Naming

Short kebab-case naming a TOPIC, never a moment (\`cron-orphaned-processes\`, \`pi-deploy-flow\`, \`vault-task-format\`). A memory note name never contains a date, a month, or a status suffix — if you are reaching for one, you want to update an existing note instead. Add \`[[backlinks]]\` aggressively.

## Scope — STRICT BOUNDARIES

You may ONLY touch notes under \`$BISMUTH_MEMORY_DIR\`. You may:
- Read, create, update, delete memory notes
- Split, merge, reorganize, rename
- Add backlinks
- Run \`ls\`, \`find\`, \`head\`, \`tail\`, \`grep\`, \`sed\`, \`awk\`, \`wc\` against the memory dir for triage

DO NOT under any circumstances:
- Write a memory note about this cron, its runs, or its results (see the rule at the top — the report is printed output, never a note)
- Create any note whose name contains a date, a month, or a moment/status suffix
- Modify files in \`.daemon/crons/\` (do not enable, disable, or edit cron jobs)
- Modify files in \`.daemon/processes/\`
- Change daemon configuration, \`.daemon/identity.md\`, or the vault's notes
- Run system commands outside the memory dir, restart services, or kill processes
- Take action on recommendations found in memory notes — your job is to organize knowledge, not act on it
- Call \`recall\` with empty/broad queries (OOMs on a bloated graph)
- Read any single file >50 KB with the Read tool (use \`head -c\` / \`tail -c\` instead)

## Report

PRINT — do not \`remember\` — one final line, and nothing else after it:

\`bloat-deleted=N snapshots-collapsed=N auto-processed=N merged=N improved=N stale-deleted=N notes=N size=XKB\`

Report honestly, including failures, and then read your own numbers before you finish. If \`snapshots-collapsed=0\` and \`merged=0\` while the Step 3 cluster command still shows a stem with a count greater than 1, the run FAILED — you skipped the actual job. Go back and do Step 3 rather than reporting a clean zero.
`;

/** vault-review — every-4h pass over the vault to keep a living model of the user in memory. */
const VAULT_REVIEW = `---
name: vault-review
schedule: 0 */4 * * *
timeout: 900
catchup: true
notify: true
incremental: true
---

Review this vault (your current working directory) to build and maintain a deep understanding of the user — their beliefs, reading, projects, preferences, and intellectual trajectory — so future sessions don't treat them as a stranger.

Some notes are marked off-limits by the vault's visibility settings (a per-file/folder control the user sets from the file tree) — a Read/Grep/Glob/Bash access to one of those will come back denied. That's expected and by design, not a bug or a missing file: skip it and move on without guessing at its contents or retrying.

## Where your memory lives — read this before you write anything

Your memory graph is \`$BISMUTH_MEMORY_DIR\` (this vault's \`.daemon/memory\`). That is the ONLY place a memory note ever goes, and the \`remember\` tool is the ONLY way to put one there — \`remember\` is what stamps a note's \`type:\`/\`tags:\`/\`created:\`/\`updated:\` frontmatter and files it into the memory graph's own git repo. A file you write yourself has none of that and is not part of the graph.

Your working directory is the VAULT, not the memory graph. So:

- NEVER create a memory note with Write/Edit, and never at a path relative to your cwd. A \`memory/\` folder next to the user's notes is NOT the memory graph — it is an orphaned directory in their vault, which is exactly the defect this paragraph exists to prevent.
- If \`remember\`/\`recall\` are NOT among your available tools in this session, the memory graph is unreachable for this run. Do not improvise a location, do not fall back to writing files. Say so plainly in your output and write nothing.

## Scope for this run

{{changedSinceLastRun}}

If the note above says this is the first run, review the vault broadly (see the survey areas below). Otherwise focus your reading on the LISTED changed files — you don't need to re-read notes that aren't listed.

Survey the vault's structure first (\`ls\`, and the folder layout) — vaults differ. Common areas worth attention, where they exist, AND where your scope above lists a changed file:

1. **Journal / daily notes** — what has the user been thinking about, struggling with, planning?
2. **Tasks** — completions, new priorities, shifts in focus.
3. **Reading** (books, papers, a "to read" list) — what they've finished, started, or queued. Capture title + author + status + any annotated notes or quotes. Critical: when figures or ideas come up later, future sessions should already know what they've read.
4. **Thoughts / essays** — their own positions and ideas. Distinguish the user's own writing from reading notes that quote others (templated \`#quote\` files with "Source:"/"Quote:" structure are other people's words, not the user's). Their live views live in their own writing and in their commentary on what they quote.
5. **Projects** — active/planned work, tech decisions, ideas.
6. **School / orgs / work** — recurring themes and involvement patterns.

## Where your findings go — canonical notes ONLY

Every run writes into the SAME small set of canonical, living notes. You rewrite them in place; you never accumulate siblings next to them:

- \`user-beliefs\` — positions, values, political and philosophical commitments
- \`user-reading\` — books and papers finished, in progress, or queued (title + author + status)
- \`user-writing\` — their own essays and arguments, and how those views have moved
- \`user-projects\` — active and planned work, tech decisions, project ideas
- \`user-routine\` — how they work, plan, and organize; tasks and shifting priorities
- \`user-context\` — school, orgs, work, people, recurring life circumstances

If a finding genuinely fits none of these, create ONE new canonical note named for the TOPIC (\`quant-trading\`, \`thesis-argument\`) and keep updating that same note forever afterwards.

For each canonical note you are about to touch:

1. \`recall\` it by name and READ what is already there. Also \`recall\` the topic itself — an older note may cover the same ground under a near-miss name (\`user-reading-finished\` vs \`user-reading\`, \`user-current-projects\` vs \`user-projects\`). Fold any such note into the canonical one and \`forget\` it: one note per topic, not one per phrasing.
2. Fold the new material into that existing text — correct what is now wrong, add what is new, drop what is stale.
3. \`remember\` the SAME name with the full rewritten body (\`remember\` overwrites by name).

Where a change of view or of situation matters, record it INSIDE the note as a dated line ("YYYY-MM-DD: moved from X to Y") — never as a new file.

**Never create a note whose name contains a date or a month.** Not \`2026-07-27\`, not \`july-27\`, and not the moment-suffixes that smuggle the same thing in: \`-checkpoint\`, \`-final\`, \`-update\`, \`-snapshot\`, \`-status\`, \`-today\`, \`-latest\`, \`-escalation\`. A name like \`michael-vault-review-july-27-evening-critical-update\` is always wrong — that content belongs inside \`user-context\` (or the relevant topic note), rewritten in place. This is an instruction, not a preference: a dated note is a defect, and the \`dream\` cron will spend its next run deleting it.

**Never write a note about this review itself** — no run logs, no "what I found this run" summaries. Your findings go into the canonical notes; the review is not a subject.

Also: link notes to each other via \`[[backlinks]]\`, and where memory contradicts the vault, fix the memory.

Focus on what's new, surprising, or shifts a prior understanding. Don't just summarize everything — the goal is a living model of the user, not a vault changelog.
`;

export interface DefaultCron {
  name: string;
  content: string;
}

/** The crons seeded into a fresh vault's .daemon/crons (non-clobbering). */
export const DEFAULT_CRONS: DefaultCron[] = [
  { name: "dream", content: DREAM },
  { name: "vault-review", content: VAULT_REVIEW },
];
