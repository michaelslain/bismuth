import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/files";
import { ensureRepo, commitVault, checkpointDelta, advanceCheckpoint, checkpointRef } from "../src/backup";
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
  await writeNote(vault, "settings.yaml", "appearance:\n  theme: oxide-duotone\n");

  const committed = await commitVault(vault, "snapshot");
  expect(committed).toBe(true);

  const tracked = (await $`git -C ${vault} ls-files`.text()).trim().split("\n");
  expect(tracked).toContain("note.md");
  expect(tracked).not.toContain("settings.yaml");
});

test("checkpoint: first run reports all files; advance + delta tracks only what changed since", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-ckpt-"));
  await writeNote(dir, "a.md", "# A");
  await writeNote(dir, "b.md", "# B");
  await commitVault(dir, "init");

  // No ref yet → every tracked file counts as added; base is null.
  expect(await checkpointRef(dir, "dream")).toBe(null);
  const first = await checkpointDelta(dir, "dream");
  expect(first.base).toBe(null);
  expect(first.files.map((f) => f.path).sort()).toEqual(["a.md", "b.md"]);
  expect(first.files.every((f) => f.status === "A")).toBe(true);

  // Advance the bookmark to HEAD, then nothing has changed since.
  const head = await advanceCheckpoint(dir, "dream");
  expect(head).not.toBe(null);
  expect(await checkpointRef(dir, "dream")).toBe(head);
  expect((await checkpointDelta(dir, "dream")).files).toEqual([]);

  // New commit → delta shows only the new file, measured from the bookmark.
  await writeNote(dir, "c.md", "# C");
  await commitVault(dir, "add c");
  const delta = await checkpointDelta(dir, "dream");
  expect(delta.base).toBe(head);
  expect(delta.files).toEqual([{ status: "A", path: "c.md" }]);
});

test("checkpoint: commitMessage commits pending changes before diffing; refs are independent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-ckpt2-"));
  await writeNote(dir, "a.md", "# A");
  await commitVault(dir, "init");
  await advanceCheckpoint(dir, "dream");
  await advanceCheckpoint(dir, "vault-review");

  // Uncommitted edit + a commitMessage → checkpointDelta commits first, then sees it.
  await writeNote(dir, "a.md", "# A edited");
  const delta = await checkpointDelta(dir, "dream", "checkpoint snapshot");
  expect(delta.files).toEqual([{ status: "M", path: "a.md" }]);

  // Advancing only dream leaves vault-review where it was — the bookmarks are independent.
  const beforeVR = await checkpointRef(dir, "vault-review");
  await advanceCheckpoint(dir, "dream");
  expect(await checkpointRef(dir, "vault-review")).toBe(beforeVR);
  expect(await checkpointRef(dir, "dream")).not.toBe(beforeVR);
});

test("checkpoint: rejects an unsafe ref name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-ckpt3-"));
  await writeNote(dir, "a.md", "# A");
  await commitVault(dir, "init");
  await expect(checkpointDelta(dir, "../evil")).rejects.toThrow();
});
