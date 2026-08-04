import { test, expect, afterEach } from "bun:test";
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { handleCallTool } from "../src/server";

// Reviewer's point: reverting just the one-line `bismuth_cli`/`bismuth_cli_help` wiring in
// server.ts (while leaving cliToolResult/cliHelp themselves intact) passed every test in
// cli.test.ts, because those only exercise the helpers directly — never the actual switch/case
// dispatch an agent's tool call goes through. These tests call the exported `handleCallTool`
// (the same function `server.setRequestHandler(CallToolRequestSchema, ...)` registers) with a
// fabricated MCP request, so a regression in the wiring itself — not just the helpers — fails.

const originalBismuthCli = process.env.BISMUTH_CLI;

afterEach(() => {
  if (originalBismuthCli === undefined) delete process.env.BISMUTH_CLI;
  else process.env.BISMUTH_CLI = originalBismuthCli;
});

function callTool(name: string, args: Record<string, unknown> = {}) {
  const request: CallToolRequest = {
    method: "tools/call",
    params: { name, arguments: args },
  };
  return handleCallTool(request);
}

test("dispatching bismuth_cli through the real handler flags a failing invocation as isError", async () => {
  const result = await callTool("bismuth_cli", { args: ["definitely-not-a-command"] });
  expect(result.isError).toBe(true);
}, 30_000);

test("dispatching bismuth_cli through the real handler leaves a clean help call unflagged", async () => {
  delete process.env.BISMUTH_CLI;
  const result = await callTool("bismuth_cli", { args: ["--help"] });
  expect(result.isError).not.toBe(true);
}, 30_000);

test("dispatching bismuth_cli_help through the real handler flags an unreachable CLI as isError", async () => {
  process.env.BISMUTH_CLI = "/definitely/not/a/real/bismuth-binary-xyz";
  const result = await callTool("bismuth_cli_help", {});
  expect(result.isError).toBe(true);
}, 30_000);

test("dispatching bismuth_cli_help through the real handler leaves a normal lookup unflagged", async () => {
  delete process.env.BISMUTH_CLI;
  const result = await callTool("bismuth_cli_help", {});
  expect(result.isError).not.toBe(true);
}, 30_000);
