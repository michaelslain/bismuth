import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
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
