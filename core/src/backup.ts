import { existsSync, appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { $ } from "bun";

/** Human-readable snapshot label, e.g. "vault snapshot 2026-05-27 14:30". `kind` lets the
 *  same machinery label memory/checkpoint snapshots ("memory snapshot …"). */
export function snapshotMessage(now: Date = new Date(), kind = "vault"): string {
  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  return `${kind} snapshot ${stamp}`;
}

const EXCLUDE_LINE = "settings.yaml";

/** Ensure .git/info/exclude ignores the per-vault settings file (idempotent). */
function ensureExclude(dir: string): void {
  const excludePath = join(dir, ".git", "info", "exclude");
  let current = "";
  try { current = readFileSync(excludePath, "utf8"); } catch { /* file may not exist yet */ }
  if (current.split("\n").includes(EXCLUDE_LINE)) return;
  try {
    mkdirSync(dirname(excludePath), { recursive: true });
    appendFileSync(excludePath, `\n${EXCLUDE_LINE}\n`);
  } catch { /* non-standard .git layout (worktree, partial clone) — degrade gracefully */ }
}

/** git init if needed + set a local identity so commits never block. Never adds a remote. */
export async function ensureRepo(dir: string): Promise<void> {
  if (!existsSync(join(dir, ".git"))) {
    await $`git -C ${dir} init -q`.quiet();
    await $`git -C ${dir} config user.email "vault@local"`.quiet();
    await $`git -C ${dir} config user.name "Bismuth"`.quiet();
  }
  // .git/info/exclude exists after init; ensureExclude runs every time
  // (idempotent) so existing vaults pick up the rule on their next backup.
  ensureExclude(dir);
}

/** Stage everything and commit. Returns false if there was nothing to commit. Local only. */
export async function commitVault(dir: string, message: string): Promise<boolean> {
  await ensureRepo(dir);
  await $`git -C ${dir} add -A`.quiet();
  const status = (await $`git -C ${dir} status --porcelain`.text()).trim();
  if (status === "") return false;
  await $`git -C ${dir} commit -q -m ${message}`.quiet();
  return true;
}

// ── Checkpoints ──────────────────────────────────────────────────────────────
// A checkpoint is a lightweight git ref (a "bookmark") under refs/bismuth/<name>
// that marks how far a periodic consumer has processed the autosave history. It is
// NOT a branch — every consumer reads the same linear history and just remembers a
// different position, so they advance independently, side by side, invisible to
// normal git (won't show in `git branch`, never pushed). Used by background jobs
// (e.g. the dream cron on the memory repo, vault-review on the vault repo) so each
// only processes "what changed since I last ran" rather than re-scanning everything.

const CHECKPOINT_NS = "refs/bismuth";
const REF_RE = /^[a-zA-Z0-9._-]+$/;

export interface ChangedFile {
  /** git name-status code: A(dded) M(odified) D(eleted) R(enamed) C(opied) … */
  status: string;
  path: string;
}
export interface CheckpointDelta {
  /** The checkpoint ref's SHA the diff is measured from, or null on first run (no ref yet). */
  base: string | null;
  /** Current HEAD SHA, or null if the repo has no commits. */
  head: string | null;
  files: ChangedFile[];
}

function refPath(ref: string): string {
  if (!REF_RE.test(ref)) throw new Error(`invalid checkpoint ref name: ${ref}`);
  return `${CHECKPOINT_NS}/${ref}`;
}

async function headSha(dir: string): Promise<string | null> {
  const r = await $`git -C ${dir} rev-parse --verify --quiet HEAD`.nothrow().quiet();
  const sha = r.stdout.toString().trim();
  return sha || null;
}

function parseNameStatus(out: string): ChangedFile[] {
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      return { status: parts[0][0], path: parts[parts.length - 1] }; // rename → new path
    });
}

/** Current SHA of a checkpoint ref, or null if it doesn't exist yet. */
export async function checkpointRef(dir: string, ref: string): Promise<string | null> {
  await ensureRepo(dir);
  const r = await $`git -C ${dir} rev-parse --verify --quiet ${refPath(ref)}`.nothrow().quiet();
  const sha = r.stdout.toString().trim();
  return sha || null;
}

/**
 * Files changed in `dir` since the checkpoint ref `refs/bismuth/<ref>`. If the ref doesn't
 * exist yet (first run), every tracked file at HEAD counts as added. When `commitMessage`
 * is given, pending changes are committed first so the delta reflects the latest on-disk
 * state. Never throws on a missing/empty repo (returns an empty delta).
 */
export async function checkpointDelta(
  dir: string,
  ref: string,
  commitMessage?: string,
): Promise<CheckpointDelta> {
  await ensureRepo(dir);
  if (commitMessage !== undefined) await commitVault(dir, commitMessage);
  const full = refPath(ref);
  const head = await headSha(dir);
  if (!head) return { base: null, head: null, files: [] };

  const refExists =
    (await $`git -C ${dir} rev-parse --verify --quiet ${full}`.nothrow().quiet()).exitCode === 0;
  if (!refExists) {
    const all = (await $`git -C ${dir} ls-tree -r --name-only HEAD`.text())
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    return { base: null, head, files: all.map((path) => ({ status: "A", path })) };
  }

  const base = (await $`git -C ${dir} rev-parse ${full}`.text()).trim();
  const out = await $`git -C ${dir} diff --name-status ${full} HEAD`.text();
  return { base, head, files: parseNameStatus(out) };
}

/**
 * Advance the checkpoint ref to HEAD (call after successfully processing the delta). When
 * `commitMessage` is given, pending changes are committed first. Returns the new ref SHA,
 * or null if the repo has no commits.
 */
export async function advanceCheckpoint(
  dir: string,
  ref: string,
  commitMessage?: string,
): Promise<string | null> {
  await ensureRepo(dir);
  if (commitMessage !== undefined) await commitVault(dir, commitMessage);
  const full = refPath(ref);
  const head = await headSha(dir);
  if (!head) return null;
  await $`git -C ${dir} update-ref ${full} HEAD`.quiet();
  return head;
}
