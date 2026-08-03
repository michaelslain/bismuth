import { test, expect } from "bun:test";
import { affectedWorkspaces } from "./gate";

test("a single-workspace edit tests only that workspace", () => {
  expect(affectedWorkspaces(["app/src/App.tsx"])).toEqual(["app"]);
  expect(affectedWorkspaces(["core/src/server.ts", "core/test/server.test.ts"])).toEqual(["core"]);
});

test("edits across workspaces test each of them, in a stable order", () => {
  expect(affectedWorkspaces(["daemon/src/x.ts", "app/src/y.ts"])).toEqual(["app", "daemon"]);
});

test("a shared root file widens the gate to every workspace", () => {
  // These can change resolution/config for everything, so a narrow gate would be false comfort.
  for (const f of ["package.json", "bun.lock", "tsconfig.base.json", "bunfig.toml", "scripts/gate.ts"]) {
    expect(affectedWorkspaces([f])).toEqual(["core", "app", "cli", "mcp", "relay", "memory", "daemon"]);
  }
});

test("docs-only and asset-only changes touch no workspace, so the gate stays out of the way", () => {
  expect(affectedWorkspaces(["docs/README.md", "CLAUDE.md", ".gitignore", "design/x.png"])).toEqual([]);
});

test("a workspace name appearing mid-path does not count as that workspace", () => {
  // "docs/core/x.md" is docs, not core — the match is anchored to the path's first segment.
  expect(affectedWorkspaces(["docs/core/x.md"])).toEqual([]);
});

test("nothing staged yields nothing to test", () => {
  expect(affectedWorkspaces([])).toEqual([]);
});
