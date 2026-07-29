// core/test/agentBackends/codexHooks.test.ts
// Never spawns `codex` (or anything else) — pure JSON-shape + string-content assertions, plus
// tmp-dir file-write smoke tests. No real Codex CLI is installed in this sandbox (or CI).
import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCodexHooksJson,
  codexHookScriptSource,
  upsertCodexHooksJson,
  writeCodexHooksFiles,
  CODEX_HOOK_SCRIPT_NAME,
} from "../../src/agentBackends/codexHooks";

describe("codexHookScriptSource (pure)", () => {
  test("gates on CLAUDE_TERMINAL_ID and posts to the exact four /relay/* endpoints", () => {
    const src = codexHookScriptSource();
    expect(src).toContain("CLAUDE_TERMINAL_ID");
    expect(src).toContain("/relay/session");
    expect(src).toContain("/relay/subagent/start");
    expect(src).toContain("/relay/subagent/stop");
    expect(src).toContain("/relay/session/end");
    expect(src).toContain('backend: "codex"');
  });

  test("is valid, parseable JavaScript (Bun can at least transpile/check it)", () => {
    // Not executed (never spawns anything) — just confirms it's syntactically sound source text.
    // Strip the shebang line first: `new Function` doesn't do the file-loader's shebang stripping.
    const withoutShebang = codexHookScriptSource().replace(/^#!.*\n/, "");
    expect(() => new Function(withoutShebang)).not.toThrow();
  });

  test("always exits 0 regardless of outcome", () => {
    expect(codexHookScriptSource()).toContain("process.exit(0)");
  });
});

describe("buildCodexHooksJson (pure)", () => {
  const json = buildCodexHooksJson("/vault/.codex/bismuth-relay-hook.ts");

  test("declares exactly the four events this task specifies", () => {
    expect(Object.keys(json.hooks).sort()).toEqual(["SessionEnd", "SessionStart", "SubagentStart", "SubagentStop"].sort());
  });

  test("SessionStart matches every Codex session source (startup/resume/clear/compact)", () => {
    expect(json.hooks.SessionStart[0].matcher).toBe("startup|resume|clear|compact");
  });

  test("every command invokes the given script path with the right event argv", () => {
    expect(json.hooks.SessionStart[0].hooks[0].command).toContain("session-start");
    expect(json.hooks.SubagentStart[0].hooks[0].command).toContain("subagent-start");
    expect(json.hooks.SubagentStop[0].hooks[0].command).toContain("subagent-stop");
    expect(json.hooks.SessionEnd[0].hooks[0].command).toContain("session-end");
    for (const event of Object.keys(json.hooks)) {
      expect(json.hooks[event][0].hooks[0].command).toContain("/vault/.codex/bismuth-relay-hook.ts");
    }
  });
});

describe("upsertCodexHooksJson (pure)", () => {
  test("creates a fresh hooks.json when none exists", () => {
    const { text, warning } = upsertCodexHooksJson(null, "/v/.codex/bismuth-relay-hook.ts");
    expect(warning).toBeUndefined();
    const parsed = JSON.parse(text);
    expect(parsed.hooks.SessionStart).toBeDefined();
    expect(parsed.description).toContain("Bismuth");
  });

  test("preserves an unrelated top-level key and another event's entries", () => {
    const existing = JSON.stringify({
      customTopLevelKey: 42,
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "echo not-ours" }] }],
      },
    });
    const { text } = upsertCodexHooksJson(existing, "/v/.codex/bismuth-relay-hook.ts");
    const parsed = JSON.parse(text);
    expect(parsed.customTopLevelKey).toBe(42);
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe("echo not-ours");
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toContain("session-start");
  });

  test("preserves a user's OWN entry under one of Bismuth's four event names", () => {
    const existing = JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo my-own-hook" }] }] },
    });
    const { text } = upsertCodexHooksJson(existing, "/v/.codex/bismuth-relay-hook.ts");
    const parsed = JSON.parse(text);
    const commands = parsed.hooks.SessionStart.flatMap((e: any) => e.hooks.map((h: any) => h.command));
    expect(commands).toContain("echo my-own-hook");
    expect(commands.some((c: string) => c.includes(CODEX_HOOK_SCRIPT_NAME))).toBe(true);
  });

  test("regenerating twice does not duplicate Bismuth's own entry", () => {
    const first = upsertCodexHooksJson(null, "/v/.codex/bismuth-relay-hook.ts").text;
    const second = upsertCodexHooksJson(first, "/v/.codex/bismuth-relay-hook.ts").text;
    const parsed = JSON.parse(second);
    expect(parsed.hooks.SessionStart.length).toBe(1);
  });

  test("leaves an unparseable file untouched and reports a warning", () => {
    const { text, warning } = upsertCodexHooksJson("not json {{{", "/v/.codex/bismuth-relay-hook.ts");
    expect(text).toBe("not json {{{");
    expect(warning).toBeDefined();
  });

  test("leaves a non-object JSON file (e.g. an array) untouched and reports a warning", () => {
    const { text, warning } = upsertCodexHooksJson("[1,2,3]", "/v/.codex/bismuth-relay-hook.ts");
    expect(text).toBe("[1,2,3]");
    expect(warning).toBeDefined();
  });
});

describe("writeCodexHooksFiles (effectful, tmp dir)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("writes both .codex/bismuth-relay-hook.ts and .codex/hooks.json", () => {
    dir = mkdtempSync(join(tmpdir(), "bismuth-codexhooks-"));
    const ok = writeCodexHooksFiles(dir);
    expect(ok).toBe(true);
    const scriptPath = join(dir, ".codex", CODEX_HOOK_SCRIPT_NAME);
    const hooksPath = join(dir, ".codex", "hooks.json");
    expect(existsSync(scriptPath)).toBe(true);
    expect(existsSync(hooksPath)).toBe(true);
    const hooksJson = JSON.parse(readFileSync(hooksPath, "utf8"));
    expect(hooksJson.hooks.SessionStart[0].hooks[0].command).toContain(scriptPath);
  });

  test("never throws even against an unwritable path", () => {
    expect(() => writeCodexHooksFiles("/nonexistent-\0-vault")).not.toThrow();
  });
});
