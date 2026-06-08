import { test, expect } from "bun:test";
import { getUpdateStatus, type GitRunner } from "../src/selfUpdate";

// A fake git runner: maps a subcommand key → canned {code, stdout}. rev-parse is keyed by
// its target ("rev-parse HEAD" / "rev-parse origin/main" / "rev-parse --is-inside-work-tree").
function fakeGit(map: Record<string, { code?: number; stdout?: string }>): GitRunner {
  return async (_repo, args) => {
    const key = args[0] === "rev-parse" ? `rev-parse ${args[1]}` : args[0];
    const r = map[key] ?? { code: 0, stdout: "" };
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: "" };
  };
}

const ORIGIN = { repoRoot: "/repo", sha: "aaaa" };

test("not-a-source-build when there's no build origin", async () => {
  const s = await getUpdateStatus({ origin: null, git: fakeGit({}) });
  expect(s.available).toBe(false);
  expect(s.reason).toBe("not-a-source-build");
});

test("not-a-git-repo when the repo isn't a work tree", async () => {
  const s = await getUpdateStatus({
    origin: ORIGIN,
    git: fakeGit({ "rev-parse --is-inside-work-tree": { code: 1 } }),
  });
  expect(s.reason).toBe("not-a-git-repo");
  expect(s.builtSha).toBe("aaaa");
});

test("no-upstream when origin/main is missing", async () => {
  const s = await getUpdateStatus({
    origin: ORIGIN,
    git: fakeGit({
      "rev-parse --is-inside-work-tree": { code: 0, stdout: "true" },
      "rev-parse origin/main": { code: 1 },
    }),
  });
  expect(s.reason).toBe("no-upstream");
});

test("available when behind > 0", async () => {
  const s = await getUpdateStatus({
    origin: ORIGIN,
    git: fakeGit({
      "rev-parse --is-inside-work-tree": { code: 0, stdout: "true" },
      "rev-parse origin/main": { code: 0, stdout: "bbbb" },
      "rev-parse HEAD": { code: 0, stdout: "aaaa" },
      "rev-list": { code: 0, stdout: "3" },
      status: { code: 0, stdout: "" },
    }),
  });
  expect(s).toMatchObject({ available: true, behind: 3, localSha: "aaaa", remoteSha: "bbbb", dirty: false });
});

test("not available when up to date; dirty flag surfaces", async () => {
  const s = await getUpdateStatus({
    origin: ORIGIN,
    git: fakeGit({
      "rev-parse --is-inside-work-tree": { code: 0, stdout: "true" },
      "rev-parse origin/main": { code: 0, stdout: "aaaa" },
      "rev-parse HEAD": { code: 0, stdout: "aaaa" },
      "rev-list": { code: 0, stdout: "0" },
      status: { code: 0, stdout: " M core/src/x.ts" },
    }),
  });
  expect(s.available).toBe(false);
  expect(s.behind).toBe(0);
  expect(s.dirty).toBe(true);
});
