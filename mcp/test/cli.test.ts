import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { cliHelp, runCli, formatCliResult, cliToolResult } from "../src/cli";

// The MCP's bismuth_cli_help tool bridges to the CLI's own --help. This verifies the bridge works
// AND that the new app-control surface (the `app` + `page` groups) is discoverable through it — the
// whole point of routing app control through the existing bismuth_cli tool instead of adding new MCP
// tool schemas. repoRoot resolves to the workspace root (mcp/test → ../..), the CLI's dev fallback.
const repoRoot = resolve(import.meta.dir, "..", "..");

test("bismuth_cli_help surfaces the app + page groups (zero new MCP tools; app control rides the CLI)", async () => {
  const help = await cliHelp(repoRoot);
  expect(help.ok).toBe(true);
  expect(help.text).toContain("app windows");
  expect(help.text).toContain("app open");
  expect(help.text).toContain("app run");
  expect(help.text).toContain("page create");
}, 30_000);

// Regression for the inert isError check the reviewer caught: cliHelp used to return a bare
// string, and server.ts inferred failure from `text.trim().length === 0` — a check that can
// never be true, since the total-failure path itself returns a non-empty message. This asserts
// on the discriminated `ok` field, not on the message text, so it can't pass by accident.
test("cliHelp reports ok:false when the CLI cannot be run at all (repoRoot points nowhere real)", async () => {
  const result = await cliHelp("/definitely/not/a/real/bismuth-repo-root-xyz");
  expect(result.ok).toBe(false);
}, 30_000);

test("runCli/formatCliResult surface a non-zero exit code with an [exit N] marker (unchanged by this fix; cliToolResult below is what actually maps it to isError)", async () => {
  const r = await runCli(repoRoot, ["definitely-not-a-command"]);
  expect(r.code).not.toBe(0);
  expect(formatCliResult(r)).toContain("[exit");
}, 30_000);

test("cliToolResult marks a non-zero exit as isError", () => {
  expect(cliToolResult({ code: 1, stdout: "", stderr: "boom" }).isError).toBe(true);
});

test("cliToolResult leaves a clean exit unflagged", () => {
  expect(cliToolResult({ code: 0, stdout: "ok", stderr: "" }).isError).toBe(false);
});
