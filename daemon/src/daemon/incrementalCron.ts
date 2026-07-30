// Pre-fire incremental-scoping for crons that opt in via `incremental: true` frontmatter (the
// two seeded crons — dream, vault-review — see defaultCrons.ts). Moves the "what changed since
// last time" scoping OUT of the session (previously the model itself ran `bismuth checkpoint
// diff/advance` as its first/last Bash step — see Bug #105 history in session.ts) and INTO the
// daemon, so a cron with nothing new to look at never spins up a session at all.
//
// Split pure/impure on purpose: `decideIncrementalRun` + `filterCronPaths` + the prompt-templating
// helpers take plain data and are fully unit-testable without touching git (see
// incrementalCron.test.ts); `resolveIncrementalRun` is the thin impure shell that wires them to
// checkpointRef.ts's git calls (see checkpointRef.test.ts for the git-touching half, against a
// real scratch repo).
import { checkpointDelta, advanceCheckpointRef, commitTimeIso, type CheckpointDelta, type ChangedFile } from "../lib/checkpointRef.ts"
import type { VaultContext } from "../lib/config.ts"

/** The ref namespace prefix for incremental crons: `refs/bismuth/cron-<name>`. Distinct from any
 *  ref name a cron's OWN prompt might have driven by hand in the past (e.g. plain "dream") so a
 *  vault upgrading to this feature always starts from a clean "first incremental run" rather than
 *  inheriting a ref an LLM-authored bash step may have advanced under uncertain conditions. */
export function incrementalRefName(cronName: string): string {
  return `cron-${cronName}`
}

/** Which repo an incremental cron's checkpoint lives against. "vault" = the vault root
 *  (ctx.root); "memory" = the vault's memory dir (ctx.memoryDir, itself its own git repo). */
export type CheckpointDirKind = "vault" | "memory"

export function checkpointDirFor(ctx: VaultContext, kind: CheckpointDirKind | undefined): string {
  return kind === "memory" ? ctx.memoryDir : ctx.root
}

/** The template placeholder a cron's prompt body can embed; replaced with either the changed-file
 *  summary or a bounded "first run" note. A prompt without this placeholder is left byte-identical
 *  (an `incremental: true` cron that forgot the placeholder just never gets the injected text). */
export const CHANGED_SINCE_PLACEHOLDER = "{{changedSinceLastRun}}"

/** Extensions an incremental cron's diff cares about — everything else (the daemon's own
 *  `.last-fired.json`/logs/session state, non-markdown assets, …) is noise for a note-consolidation
 *  pass. Kept as a small allowlist rather than a denylist so a new non-markdown daemon artifact
 *  never accidentally shows up as "content to review". */
function isMarkdownish(path: string): boolean {
  return path.endsWith(".md")
}

/** True for anything under a `.daemon/` directory at any depth — belt-and-suspenders: the vault
 *  repo's `.git/info/exclude` already keeps `.daemon` out of git entirely (see backup.ts), and the
 *  memory repo's own root IS `.daemon/memory` so it has no nested `.daemon` to worry about, but a
 *  pre-existing repo without that exclude rule (or a future layout change) shouldn't leak daemon
 *  bookkeeping into a cron's "what changed" list. */
function isDaemonInternal(path: string): boolean {
  return path === ".daemon" || path.startsWith(".daemon/") || path.includes("/.daemon/");
}

/** Narrow a raw checkpoint delta's file list to what an incremental cron actually cares about:
 *  markdown notes, outside `.daemon/`. Pure. */
export function filterCronPaths(files: ChangedFile[]): ChangedFile[] {
  return files.filter((f) => isMarkdownish(f.path) && !isDaemonInternal(f.path))
}

/** Render a changed-file list as a compact bulleted block for prompt injection. Pure. */
export function formatChangedList(files: ChangedFile[]): string {
  return files.map((f) => `- ${f.status} ${f.path}`).join("\n")
}

export type IncrementalDecision =
  | { skip: true; note: string }
  | { skip: false; injected: string }

/**
 * Decide what an incremental cron should do given its (already path-filtered) delta. Pure —
 * takes plain data, no I/O — so it's directly unit-testable with fixture ChangedFile[] arrays.
 *
 *   - No checkpoint ref yet (`delta.base === null`) → never skip; a bounded "first run" note
 *     (the cron's own prompt still carries whatever full-survey instructions it wants).
 *   - Ref exists but the filtered file list is empty → skip. `note` is the exact "skipped: …"
 *     message that becomes the cron's `lastFired` entry (see cron.ts) — surfaced verbatim by
 *     `bismuth daemon graph` / the daemon graph's `lastResult` so the skip is visible, not silent.
 *   - Ref exists and something changed → run, with the changed-file block to inject.
 */
export function decideIncrementalRun(
  delta: Pick<CheckpointDelta, "base"> & { files: ChangedFile[] },
  opts: { refCommitIso: string | null },
): IncrementalDecision {
  if (delta.base === null) {
    return {
      skip: false,
      injected: "This is the first incremental run for this cron — no prior checkpoint exists yet. Do a full pass (see the instructions below).",
    }
  }
  if (delta.files.length === 0) {
    const since = opts.refCommitIso ?? "the last run";
    return { skip: true, note: `skipped: no changes since ${since}` };
  }
  const since = opts.refCommitIso ?? "the last run";
  return {
    skip: false,
    injected: `Changed since your last run (${since}):\n${formatChangedList(delta.files)}`,
  };
}

/** Substitute {{changedSinceLastRun}} in a cron's prompt body with the resolved text. A prompt
 *  that doesn't contain the placeholder is returned unchanged (no-op degrade). Pure. */
export function applyIncrementalPlaceholder(prompt: string, injected: string): string {
  return prompt.includes(CHANGED_SINCE_PLACEHOLDER) ? prompt.split(CHANGED_SINCE_PLACEHOLDER).join(injected) : prompt;
}

export interface IncrementalRunPlan {
  /** True when the job should be skipped entirely — no session, just a lastFired update. */
  skip: boolean;
  /** Present when skip=true: the human-readable reason, written verbatim into lastFired.detail
   *  and composed into the daemon graph's `lastResult` (e.g. "skipped: no changes since <ISO>"). */
  note?: string;
  /** Present when skip=false: the prompt with {{changedSinceLastRun}} resolved. */
  prompt?: string;
  /** The repo dir this plan checked (for advanceIncrementalCheckpoint after a successful run). */
  dir: string;
  /** The checkpoint ref name (refs/bismuth/<ref>) this plan checked. */
  ref: string;
}

/**
 * The impure half: resolve an incremental cron's checkpoint delta against its repo, filter it,
 * and decide skip vs. run — plus (if running) the prompt with the placeholder resolved. Called
 * from cron.ts's fireJob BEFORE any of the running-state bookkeeping, so a skip is a true no-op
 * (no session, no PTY, no running-jobs entry).
 */
export async function resolveIncrementalRun(
  ctx: VaultContext,
  job: { name: string; prompt: string; checkpointDir?: CheckpointDirKind },
): Promise<IncrementalRunPlan> {
  const dir = checkpointDirFor(ctx, job.checkpointDir);
  const ref = incrementalRefName(job.name);
  const delta = await checkpointDelta(dir, ref);
  const filtered = filterCronPaths(delta.files);
  const refCommitIso = delta.base ? await commitTimeIso(dir, delta.base) : null;
  const decision = decideIncrementalRun({ base: delta.base, files: filtered }, { refCommitIso });

  if (decision.skip) return { skip: true, note: decision.note, dir, ref };
  return { skip: false, prompt: applyIncrementalPlaceholder(job.prompt, decision.injected), dir, ref };
}

/** After a SUCCESSFUL incremental-cron session (never on failure/kill/unknown — see fireJob),
 *  advance its checkpoint ref to current HEAD. Best-effort: a failure here just means the next
 *  run re-diffs from the same base (over-inclusive, never data-losing), so it never throws. */
export async function advanceIncrementalCheckpoint(dir: string, ref: string): Promise<void> {
  try {
    await advanceCheckpointRef(dir, ref);
  } catch (err) {
    console.error(`[cron] Failed to advance checkpoint ${ref} in ${dir}:`, err);
  }
}
