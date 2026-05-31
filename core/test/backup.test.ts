import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/files";
import { ensureRepo, commitVault } from "../src/backup";
import { $ } from "bun";

test("ensureRepo inits a git repo; commitVault commits changes locally", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-bk-"));
  await ensureRepo(dir);
  expect(existsSync(join(dir, ".git"))).toBe(true);

  await writeNote(dir, "a.md", "# A");
  const committed = await commitVault(dir, "snapshot test");
  expect(committed).toBe(true);

  const again = await commitVault(dir, "snapshot test 2");
  expect(again).toBe(false);

  const count = (await $`git -C ${dir} rev-list --count HEAD`.text()).trim();
  expect(count).toBe("1");
  const remotes = (await $`git -C ${dir} remote`.text()).trim();
  expect(remotes).toBe("");
});

test("ensureExclude does not throw when .git/info dir is absent (existing repo / worktree)", async () => {
  // Simulate a pre-existing git repo where .git/info/ was never created.
  const dir = mkdtempSync(join(tmpdir(), "oa-bk-noinfo-"));
  await $`git -C ${dir} init -q`.quiet();
  await $`git -C ${dir} config user.email "vault@local"`.quiet();
  await $`git -C ${dir} config user.name "OA Test"`.quiet();
  // Remove the info/ subdirectory to reproduce the edge-case.
  const infoDir = join(dir, ".git", "info");
  if (existsSync(infoDir)) rmSync(infoDir, { recursive: true, force: true });

  // ensureRepo (and thereby ensureExclude) must not throw.
  await expect(ensureRepo(dir)).resolves.toBeUndefined();

  // commitVault must succeed end-to-end even without .git/info/.
  await writeNote(dir, "note.md", "# Test");
  const committed = await commitVault(dir, "snapshot without info dir");
  expect(committed).toBe(true);
});

test("commitVault never tracks settings.yaml", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-backup-"));
  await writeNote(vault, "note.md", "# Note\n");
  await writeNote(vault, "settings.yaml", "appearance:\n  theme: dark\n");

  const committed = await commitVault(vault, "snapshot");
  expect(committed).toBe(true);

  const tracked = (await $`git -C ${vault} ls-files`.text()).trim().split("\n");
  expect(tracked).toContain("note.md");
  expect(tracked).not.toContain("settings.yaml");
});
