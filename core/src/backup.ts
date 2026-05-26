import { existsSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

/** git init if needed + set a local identity so commits never block. Never adds a remote. */
export async function ensureRepo(dir: string): Promise<void> {
  if (!existsSync(join(dir, ".git"))) {
    await $`git -C ${dir} init -q`.quiet();
    await $`git -C ${dir} config user.email "vault@local"`.quiet();
    await $`git -C ${dir} config user.name "Obsidian Alternative"`.quiet();
  }
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
