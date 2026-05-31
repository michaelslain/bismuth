import { existsSync, appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { $ } from "bun";

/** Human-readable snapshot label, e.g. "vault snapshot 2026-05-27 14:30". */
export function snapshotMessage(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  return `vault snapshot ${stamp}`;
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
    await $`git -C ${dir} config user.name "Obsidian Alternative"`.quiet();
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
