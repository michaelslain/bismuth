// Exercises the ACTUAL mock LLM server (`bunx llmock`, from the @copilotkit/aimock devDependency)
// end-to-end — never a real model API, and no dependency on any agent CLI being installed (this
// harness itself doesn't spawn claude/codex/opencode/etc; core/test/support/backendEnv.ts's per-CLI
// mapping is exercised as a pure function here, not by actually running a CLI).
import { describe, expect, test } from "bun:test";
import { DEFAULT_FIXTURE_DIR, startMockLlm } from "./mockLlm";
import { backendMockEnv } from "./backendEnv";
import { BACKEND_IDS } from "../../src/agentBackends/catalog";

describe("startMockLlm", () => {
  test(
    "serves the fixture's response over an Anthropic-shaped /v1/messages call, then fully tears down on stop()",
    async () => {
      const mock = await startMockLlm(DEFAULT_FIXTURE_DIR);
      expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      const res = await fetch(`${mock.url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 100,
          messages: [{ role: "user", content: "hello" }],
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { content: { type: string; text: string }[] };
      expect(body.content[0].text).toBe("Hello!");

      await mock.stop();

      // The port must be genuinely released, not just "the process we hold a reference to says
      // it exited" — prove it by trying to reach the exact same URL and observing a connection
      // failure (nothing is listening there any more), the same check used to verify this live
      // during development.
      await expect(fetch(`${mock.url}/v1/messages`, { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
    },
    20_000,
  );

  test(
    "rejects rather than hanging when the fixture directory doesn't exist (verified live: llmock prints " +
      '"Fixtures path not found" and exits immediately without ever printing its listening banner)',
    async () => {
      await expect(startMockLlm("/nonexistent-fixture-dir-for-real")).rejects.toThrow();
    },
    20_000,
  );
});

describe("backendMockEnv", () => {
  const MOCK_URL = "http://127.0.0.1:54321";

  test("every backend id core/src/agentBackends/catalog.ts knows about either maps to real env vars or is explicitly unmapped", () => {
    // Not every BACKEND_IDS entry is expected to be covered (the ACP-adapter entries bridge a
    // CLI that already has its own native row — see catalog.ts's `hidden` doc comment), but every
    // id the task brief named must resolve to a non-empty mapping.
    for (const id of ["claude", "codex", "opencode", "gemini", "cline", "goose"] as const) {
      expect(BACKEND_IDS as readonly string[]).toContain(id);
      const env = backendMockEnv(id, MOCK_URL);
      expect(Object.keys(env).length).toBeGreaterThan(0);
      expect(Object.values(env).some((v) => v.includes(MOCK_URL))).toBe(true);
    }
  });

  test("claude maps ANTHROPIC_BASE_URL/AUTH_TOKEN/API_KEY — the one row verified live end-to-end", () => {
    expect(backendMockEnv("claude", MOCK_URL)).toEqual({
      ANTHROPIC_BASE_URL: MOCK_URL,
      ANTHROPIC_AUTH_TOKEN: "mock",
      ANTHROPIC_API_KEY: "mock",
    });
  });

  test("codex maps OPENAI_BASE_URL/OPENAI_API_KEY", () => {
    expect(backendMockEnv("codex", MOCK_URL)).toEqual({
      OPENAI_BASE_URL: MOCK_URL,
      OPENAI_API_KEY: "mock",
    });
  });

  test("opencode maps a runtime OPENCODE_CONFIG_CONTENT carrying an inline custom-provider block pointed at the mock", () => {
    const env = backendMockEnv("opencode", MOCK_URL);
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
    expect(config.provider.mock.options.baseURL).toBe(`${MOCK_URL}/v1`);
  });

  test("gemini maps GOOGLE_GEMINI_BASE_URL/GEMINI_API_KEY", () => {
    expect(backendMockEnv("gemini", MOCK_URL)).toEqual({
      GOOGLE_GEMINI_BASE_URL: MOCK_URL,
      GEMINI_API_KEY: "mock",
    });
  });

  test("goose maps ANTHROPIC_HOST + GOOSE_PROVIDER=anthropic (source-verified against goose's own env-override resolution order)", () => {
    const env = backendMockEnv("goose", MOCK_URL);
    expect(env.ANTHROPIC_HOST).toBe(MOCK_URL);
    expect(env.GOOSE_PROVIDER).toBe("anthropic");
  });

  test("an unrecognized backend id throws rather than silently returning an empty (no-op) mapping", () => {
    expect(() => backendMockEnv("not-a-real-backend", MOCK_URL)).toThrow();
  });
});
