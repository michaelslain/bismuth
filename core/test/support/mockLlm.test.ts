// Exercises the ACTUAL mock LLM server (`llmock`, from the @copilotkit/aimock devDependency)
// end-to-end — never a real model API, and no dependency on any agent CLI being installed (this
// harness itself doesn't spawn claude/codex/opencode/etc; core/test/support/backendEnv.ts's per-CLI
// mapping is exercised as a pure function here, not by actually running a CLI).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

  // Reproduces (rather than infers) the orphan-child failure mode: a caller that starts a mock
  // server and then crashes — an uncaught exception, never reaching stop() — must not leave the
  // spawned `node .../aimock/dist/cli.js` running forever, holding its port. This can't be proven
  // from INSIDE this test process (this process reaching its own "exit" would tear down the whole
  // test run), so it drives a genuinely separate `bun` child: that child starts a mock server,
  // prints its URL, then throws — simulating exactly the crash-before-stop() scenario — and this
  // test asserts the mock's port is unreachable once that child has actually exited, proving
  // mockLlm.ts's own `process.on("exit", …)` safety net fired inside the child.
  test(
    "an abnormal exit (crash before stop()) does not orphan the mock server — process.on('exit') safety net",
    async () => {
      const scriptDir = mkdtempSync(join(tmpdir(), "mockllm-crash-test-"));
      const scriptPath = join(scriptDir, "crash.ts");
      const mockLlmSpecifier = pathToFileURL(join(import.meta.dir, "mockLlm.ts")).href;
      writeFileSync(
        scriptPath,
        [
          `import { startMockLlm } from ${JSON.stringify(mockLlmSpecifier)};`,
          `const mock = await startMockLlm(${JSON.stringify(DEFAULT_FIXTURE_DIR)});`,
          `console.log("MOCK_URL:" + mock.url);`,
          `throw new Error("simulated crash — deliberately never calls stop()");`,
          "",
        ].join("\n"),
      );

      const child = Bun.spawn(["bun", "run", scriptPath], { stdout: "pipe", stderr: "pipe" });

      // Read stdout only until the URL line arrives — the child crashes right after printing it,
      // so its stdout closes on its own shortly after.
      let out = "";
      let url = "";
      const decoder = new TextDecoder();
      for await (const chunk of child.stdout as ReadableStream<Uint8Array>) {
        out += decoder.decode(chunk, { stream: true });
        const m = out.match(/MOCK_URL:(\S+)/);
        if (m) {
          url = m[1];
          break;
        }
      }
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      const code = await child.exited;
      expect(code).not.toBe(0); // confirms it really crashed rather than exiting cleanly

      // The grandchild mock server must not survive its parent's crash. Poll briefly: the exit
      // handler's kill() fires synchronously inside the child, but the OS can take a moment to
      // fully release the socket after that.
      const deadline = Date.now() + 5000;
      let stillListening = true;
      while (stillListening && Date.now() < deadline) {
        try {
          await fetch(url, { signal: AbortSignal.timeout(300) });
          await new Promise((r) => setTimeout(r, 100));
        } catch {
          stillListening = false;
        }
      }
      expect(stillListening).toBe(false);
    },
    20_000,
  );
});

describe("backendMockEnv", () => {
  const MOCK_URL = "http://127.0.0.1:54321";

  test("every backend id core/src/agentBackends/catalog.ts knows about either maps to real env vars or is explicitly unmapped", () => {
    // Not every BACKEND_IDS entry is expected to be covered (the ACP-adapter entries bridge a
    // CLI that already has its own native row — see catalog.ts's `hidden` doc comment). codex/
    // openclaw need a `workDir` third argument (a file-based mechanism — see backendEnv.ts's case
    // comments) so they're exercised separately below; cline is DELIBERATELY excluded from this
    // loop — Task 4 found its only real mechanism can't reach the ACP mode Bismuth drives, so it
    // throws instead of mapping (see its own dedicated test below).
    for (const id of ["claude", "opencode", "gemini", "goose"] as const) {
      expect(BACKEND_IDS as readonly string[]).toContain(id);
      const env = backendMockEnv(id, MOCK_URL);
      expect(Object.keys(env).length).toBeGreaterThan(0);
      expect(Object.values(env).some((v) => v.includes(MOCK_URL))).toBe(true);
    }
  });

  test("claude maps ANTHROPIC_BASE_URL/AUTH_TOKEN/API_KEY — verified live end-to-end", () => {
    expect(backendMockEnv("claude", MOCK_URL)).toEqual({
      ANTHROPIC_BASE_URL: MOCK_URL,
      ANTHROPIC_AUTH_TOKEN: "mock",
      ANTHROPIC_API_KEY: "mock",
    });
  });

  test("codex requires a workDir (its real mechanism is a $CODEX_HOME/config.toml file, not a bare env var — verified live this task; the old OPENAI_BASE_URL row was confirmed WRONG)", () => {
    expect(() => backendMockEnv("codex", MOCK_URL)).toThrow(/workDir/);

    const dir = mkdtempSync(join(tmpdir(), "backendenv-codex-test-"));
    const env = backendMockEnv("codex", MOCK_URL, dir);
    expect(env.CODEX_HOME).toBe(dir);
    const toml = readFileSync(join(dir, "config.toml"), "utf8");
    expect(toml).toContain(`base_url = "${MOCK_URL}/v1"`);
    expect(toml).toContain('wire_api = "responses"'); // "chat" is REJECTED by this codex version
    expect(toml).toContain('model_provider = "mock"');
  });

  test("opencode maps a runtime OPENCODE_CONFIG_CONTENT carrying an inline custom-provider block pointed at the mock", () => {
    const env = backendMockEnv("opencode", MOCK_URL);
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
    expect(config.provider.mock.options.baseURL).toBe(`${MOCK_URL}/v1`);
  });

  test("gemini maps GOOGLE_GEMINI_BASE_URL/GEMINI_API_KEY — env routing + old-shape handshake verified live; full turn completion not (see the case comment)", () => {
    expect(backendMockEnv("gemini", MOCK_URL)).toEqual({
      GOOGLE_GEMINI_BASE_URL: MOCK_URL,
      GEMINI_API_KEY: "mock",
    });
  });

  test('cline throws — its only real mock mechanism (the `auth` subcommand) cannot reach the ACP mode Bismuth actually drives, which demands real OAuth (verified live this task)', () => {
    expect(() => backendMockEnv("cline", MOCK_URL)).toThrow(/authenticate|OAuth/);
  });

  test("goose maps ANTHROPIC_HOST + GOOSE_PROVIDER=anthropic — verified live end-to-end this task (upgraded from GUESSED)", () => {
    const env = backendMockEnv("goose", MOCK_URL);
    expect(env.ANTHROPIC_HOST).toBe(MOCK_URL);
    expect(env.GOOSE_PROVIDER).toBe("anthropic");
  });

  test("openclaw requires a workDir (a config.json5 file, not a bare env var); config-path redirection verified live, full turn routing was not (see the case comment)", () => {
    expect(() => backendMockEnv("openclaw", MOCK_URL)).toThrow(/workDir/);

    const dir = mkdtempSync(join(tmpdir(), "backendenv-openclaw-test-"));
    const env = backendMockEnv("openclaw", MOCK_URL, dir);
    expect(env.OPENCLAW_CONFIG_PATH).toBe(join(dir, "openclaw.json5"));
    const config = JSON.parse(readFileSync(env.OPENCLAW_CONFIG_PATH, "utf8"));
    expect(config.models.providers.mock.baseUrl).toBe(`${MOCK_URL}/v1`);
  });

  test("an unrecognized backend id throws rather than silently returning an empty (no-op) mapping", () => {
    expect(() => backendMockEnv("not-a-real-backend", MOCK_URL)).toThrow();
  });
});
