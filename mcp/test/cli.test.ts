import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { cliHelp } from "../src/cli";

// The MCP's bismuth_cli_help tool bridges to the CLI's own --help. This verifies the bridge works
// AND that the new app-control surface (the `app` + `page` groups) is discoverable through it — the
// whole point of routing app control through the existing bismuth_cli tool instead of adding new MCP
// tool schemas. repoRoot resolves to the workspace root (mcp/test → ../..), the CLI's dev fallback.
const repoRoot = resolve(import.meta.dir, "..", "..");

test("bismuth_cli_help surfaces the app + page groups (zero new MCP tools; app control rides the CLI)", async () => {
  const help = await cliHelp(repoRoot);
  expect(help).toContain("app windows");
  expect(help).toContain("app open");
  expect(help).toContain("app run");
  expect(help).toContain("page create");
}, 30_000);
