import { existsSync, appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { $ } from "bun";

/** Human-readable snapshot label, e.g. "vault snapshot 2026-05-27 14:30". `kind` lets the
 *  same machinery label memory/checkpoint snapshots ("memory snapshot …"). */
export function snapshotMessage(now: Date = new Date(), kind = "vault"): string {
  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  return `${kind} snapshot ${stamp}`;
}

// Keep the daemon's surfaces out of the vault snapshot: the `.settings` config file and the whole
// `.daemon` brain. `.daemon` holds runtime junk (daemon.pid, session-id, logs, .last-fired.json,
// .triggers) that must never be committed, plus memory the daemon already version-controls on its
// own via `bismuth checkpoint` — so it has no business in the vault's git history.
const EXCLUDE_LINES = [".settings", ".daemon"];

/** Ensure .git/info/exclude ignores the daemon's config + brain dirs (idempotent — adds only the
 *  rules that are missing, so existing vaults pick up a newly-added one on their next backup). */
function ensureExclude(dir: string): void {
  const excludePath = join(dir, ".git", "info", "exclude");
  let current = "";
  try { current = readFileSync(excludePath, "utf8"); } catch { /* file may not exist yet */ }
  const have = new Set(current.split("\n"));
  const missing = EXCLUDE_LINES.filter((line) => !have.has(line));
  if (missing.length === 0) return;
  try {
    mkdirSync(dirname(excludePath), { recursive: true });
    appendFileSync(excludePath, `\n${missing.join("\n")}\n`);
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

// ── Coalesced autosave ────────────────────────────────────────────────────────
// Editor saves and memory file-watch events each fire a backup; uncoalesced that's dozens of
// commits PER MINUTE, which bloats `.git` (and, in an iCloud-synced vault, drives sync conflict
// forks). scheduleBackup() debounces per-repo: a burst of saves collapses into ONE commit after a
// quiet window, with a max-wait so a long continuous-editing session still snapshots periodically.
// Checkpoint commits (dream/vault-review, via commitVault directly) stay IMMEDIATE — they need an
// accurate diff base. Intervals are env-overridable for tests.
// Read at call time so tests (and runtime tuning) can override via env.
const debounceMs = (): number => Number(process.env.BISMUTH_BACKUP_DEBOUNCE_MS) || 30_000; // ~30s after the last save
const maxWaitMs = (): number => Number(process.env.BISMUTH_BACKUP_MAX_WAIT_MS) || 300_000; // ...but at least every 5 min

interface PendingBackup { timer: ReturnType<typeof setTimeout>; first: number; message: () => string }
const pendingBackups = new Map<string, PendingBackup>();

function fireBackup(dir: string): void {
  const p = pendingBackups.get(dir);
  if (!p) return;
  pendingBackups.delete(dir);
  void commitVault(dir, p.message()).catch(() => {});
}

/** Coalesce rapid autosave commits for `dir` into one (see above). `message` is a thunk so the
 *  snapshot timestamp reflects when it actually commits, not when it was first scheduled. */
export function scheduleBackup(dir: string, message: () => string): void {
  const now = Date.now();
  const existing = pendingBackups.get(dir);
  if (existing) clearTimeout(existing.timer);
  const first = existing?.first ?? now;
  // Deferred too long already (continuous editing) → commit now instead of pushing it out further.
  if (now - first >= maxWaitMs()) {
    pendingBackups.delete(dir);
    void commitVault(dir, message()).catch(() => {});
    return;
  }
  pendingBackups.set(dir, { first, message, timer: setTimeout(() => fireBackup(dir), debounceMs()) });
}

/** Flush any pending coalesced backup for `dir` immediately (e.g. before shutdown / in tests). */
export function flushBackup(dir: string): void {
  fireBackup(dir);
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

// Parse `git diff --name-status -z` output. `-z` is mandatory: it emits paths verbatim
// (NUL-delimited, never quoted), so non-ASCII / emoji / space paths survive intact — git's
// default output octal-escapes and quotes those (e.g. "caf\303\251.md"), yielding paths that
// don't resolve on disk. Layout per entry: <status>\0<path>\0, except renames/copies which
// carry two paths: <Rxxx>\0<oldpath>\0<newpath>\0 (we report the new path).
function parseNameStatus(out: string): ChangedFile[] {
  const tokens = out.split("\0").filter((t) => t.length > 0);
  const files: ChangedFile[] = [];
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i++][0]; // first char: A/M/D/R/C…
    if (status === "R" || status === "C") i++; // skip oldpath; the new path comes next
    const path = tokens[i++];
    if (path !== undefined) files.push({ status, path });
  }
  return files;
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
    // -z → NUL-delimited, verbatim (unquoted) paths; see parseNameStatus for why.
    const all = (await $`git -C ${dir} ls-tree -r --name-only -z HEAD`.text())
      .split("\0")
      .filter(Boolean);
    return { base: null, head, files: all.map((path) => ({ status: "A", path })) };
  }

  const base = (await $`git -C ${dir} rev-parse ${full}`.text()).trim();
  const out = await $`git -C ${dir} diff --name-status -z ${full} HEAD`.text();
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
