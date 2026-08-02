// Task 4 of the offline-integration-testing plan: prove that a REAL `goose` binary, driven through
// Bismuth's OWN ACP driver (core/src/chatProviders/acp/driver.ts, via `goose acp` — see
// chatProviders/acp/agents.ts), completes a turn against the local mock LLM server
// (core/test/support/mockLlm.ts) with ZERO calls against any real provider account. Mirrors
// claudeMocked.test.ts's shape (Task 3): runs by default in `bun test core`, skips only when the
// `goose` binary itself is missing — a missing-BINARY skip, never a missing-account skip.
//
// At the time this task ran, this was the ONE ACP-native backend (of cline/gemini/goose/openclaw)
// that task could verify FULLY end to end: `goose acp`'s `session/new` succeeds immediately (no
// `authenticate` gate, unlike cline's ACP mode), and `session/prompt` streamed a real
// `agent_message_chunk` carrying the mock fixture's exact "Hello!" text, settling with
// `stopReason:"end_turn"` — a clean assistant-text frame through the driver, confirmed via the mock's
// own /metrics: exactly one `GET /v1/models` hit (session/new discovering the configured provider's
// models) and two `POST /v1/messages` hits (both 200, fixture-matched), never a real anthropic.com
// request. See backendEnv.ts's `goose` case comment for the full write-up (upgraded from GUESSED to
// VERIFIED this task). gemini later joined it (offline2/gemini branch — see geminiMocked.test.ts's
// header): goose just never needed extra fixtures for gemini-cli's own routing/next-speaker-check
// calls, since goose doesn't make them.
//
// LOCAL-STATE ISOLATION: goose persists config/session state under
// $XDG_CONFIG_HOME/$XDG_DATA_HOME/$XDG_STATE_HOME (confirmed live via `goose info`'s own path
// listing) — all three are redirected to throwaway temp dirs below so this test can never read or
// write a developer's real ~/.config/goose, independent of (and in addition to) backendMockEnv's own
// mapping, which only points goose's PROVIDER at the mock.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { whichBinary } from "../../src/claudeWhich";
import { CHAT_BACKENDS } from "../../src/chatProviders/backends";
import { backendMockEnv } from "../support/backendEnv";
import { makeChatFrameCollector } from "../support/chatFrameCollector";
import { startMockLlm, type MockLlmHandle } from "../support/mockLlm";

const HAS_GOOSE = whichBinary("goose") !== null;
const describeOrSkip = HAS_GOOSE ? describe : describe.skip;

if (!HAS_GOOSE) {
  // eslint-disable-next-line no-console
  console.warn("[gooseMocked.test] skipped — the `goose` CLI is not installed on this machine (nothing to drive).");
}

/**
 * Task 12 (step 2 of 2, "live tool-use, the fixture half"): does a REAL machine-wide install of
 * Bismuth's own MCP server exist? `chatProviders/acp/driver.ts`'s `buildMcpServers()` only adds the
 * "bismuth" MCP server to a session's `mcpServers` when `~/.bismuth/bin/bismuth-mcp` exists — a
 * side effect of the desktop app having installed its machine-wide tools at least once
 * (`core/src/bismuthInstall.ts`), NOT something this test file can create for itself (that binary
 * is a real compiled artifact, not a stub). Without it, `goose` would never learn about a
 * "bismuth__bismuth_docs_list" tool at all (confirmed live in this task's own research — see
 * gooseToolUse test below), so the tool-call fixture couldn't be driven meaningfully. A missing
 * install here is a missing-PRECONDITION skip, same spirit as HAS_GOOSE's missing-BINARY skip —
 * never a missing-account skip.
 */
const HAS_BISMUTH_MCP = existsSync(join(homedir(), ".bismuth", "bin", "bismuth-mcp"));
if (HAS_GOOSE && !HAS_BISMUTH_MCP) {
  // eslint-disable-next-line no-console
  console.warn(
    "[gooseMocked.test] the live tool-use test is skipped — ~/.bismuth/bin/bismuth-mcp isn't installed on this machine (no MCP server for goose to call a tool on).",
  );
}

describeOrSkip("the real goose CLI, driven through the ACP driver, against a mock LLM (zero account API calls)", () => {
  const ENV_KEYS = ["ANTHROPIC_HOST", "ANTHROPIC_API_KEY", "GOOSE_PROVIDER", "GOOSE_MODEL", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"] as const;
  // Snapshotted BEFORE anything that can fail/reject (startMockLlm) — a code-review finding on this
  // task: populating this AFTER an await that can throw leaves it empty, and afterAll's restore loop
  // then unconditionally `delete`s every ENV_KEY from the shared `bun test` process, including a
  // developer's real ANTHROPIC_API_KEY/XDG_* vars this test never touched.
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  // EVERY mock spawned across this file's tests, not just the latest — this file now has more than
  // one test, and each calls setup() independently (its own isolated aimock instance + its own
  // fresh XDG dirs, matching this file's existing one-mock-per-test shape rather than switching to
  // the shared-singleton pattern opencodeMocked.test.ts uses). A single `let mock` reassigned by a
  // SECOND test's setup() call would orphan the FIRST test's own mock server — afterAll's old
  // `mock?.stop()` only ever stopped whichever one was assigned LAST — reproduced live as exactly
  // that leak before this fix (see this task's report). Tracked in an array and stopped in full.
  let mock: MockLlmHandle | undefined;
  const mocks: MockLlmHandle[] = [];
  const chatIds: string[] = [];
  const tempDirs: string[] = [];

  async function newTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  async function setup(): Promise<void> {
    mock = await startMockLlm();
    mocks.push(mock);
    const mockEnv = backendMockEnv("goose", mock.url);
    for (const [k, v] of Object.entries(mockEnv)) process.env[k] = v;
    // Isolation, not mocking — see this file's header.
    process.env.XDG_CONFIG_HOME = await newTempDir("bismuth-goose-xdgcfg-");
    process.env.XDG_DATA_HOME = await newTempDir("bismuth-goose-xdgdata-");
    process.env.XDG_STATE_HOME = await newTempDir("bismuth-goose-xdgstate-");
  }

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    for (const m of mocks.splice(0)) await m.stop();
  });

  afterEach(async () => {
    for (const id of chatIds.splice(0)) CHAT_BACKENDS.goose.closeChat(id);
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test(
    "a turn sent through CHAT_BACKENDS.goose returns the fixture's exact text, then terminates with result + done",
    async () => {
      await setup();

      const cwd = await newTempDir("bismuth-goose-cwd-");
      const chatId = "goose-mocked-" + Date.now();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeChatFrameCollector();

      CHAT_BACKENDS.goose.sendMessage({ chatId, cwd, sink, computerUse: false, text: "hello" });

      const assistantText = await waitFor((f) => f.type === "assistant-text");
      expect(assistantText.type).toBe("assistant-text");
      if (assistantText.type === "assistant-text") {
        // Can only have come from the local fixture — no real model replies to "hello" with the
        // literal string "Hello!" verbatim, and ANTHROPIC_HOST is the only thing goose's configured
        // "anthropic" provider talks to for the lifetime of this test.
        expect(assistantText.text).toBe("Hello!");
      }

      const done = await waitFor((f) => f.type === "done");
      expect(done.type).toBe("done");

      const resultIdx = frames.findIndex((f) => f.type === "result");
      const doneIdx = frames.findIndex((f) => f.type === "done");
      expect(resultIdx).toBeGreaterThanOrEqual(0);
      expect(doneIdx).toBeGreaterThan(resultIdx);
      const resultFrame = frames[resultIdx];
      if (resultFrame.type === "result") expect(resultFrame.isError).toBe(false);
    },
    60_000,
  );

  /**
   * Task 12 (step 2 of 2, "live tool-use, the fixture half"): drive a REAL goose ACP tool call
   * through Bismuth's own production driver, using `core/test/fixtures/llm/tool-call.json`'s
   * `response.toolCalls` + a `match.toolCallId` follow-up (aimock's own tool-call fixture shape).
   *
   * WHY `bismuth__bismuth_docs_list` OF ALL TOOLS: `goose acp` is spawned with no `--with-builtin`
   * extension (`chatProviders/acp/agents.ts`'s goose entry is plain `["acp"]`), so it registers NO
   * tools at all UNLESS `session/new`'s `mcpServers` gives it one — and `buildMcpServers()`
   * (driver.ts) only does that when `~/.bismuth/bin/bismuth-mcp` exists (HAS_BISMUTH_MCP above).
   * `bismuth_docs_list` is read-only (lists doc pages; see mcp/src/server.ts) — the only tool this
   * test could drive that is both REAL (goose actually declares and executes it, not a name it
   * invents) and safe to actually execute for real (no writes, no shell, no network).
   *
   * REAL DIVERGENCE FOUND HERE, FIXED SINCE: a real goose ACP `tool_call` update carries `rawInput`
   * (ACP's OWN spec'd field for the tool's structured arguments — populated live here as
   * `rawInput:{}` since bismuth_docs_list takes none, and as the REAL query object for a tool that
   * takes arguments, e.g. `rawInput:{"query":"gcal"}` for bismuth_docs_search), and
   * `chatProviders/acp/protocol.ts`'s `toolCallInput()` could not see it — its parameter type
   * declared only `title`/`kind`, so callers handed it the whole update and the arguments were
   * dropped, leaving every ACP tool chip showing a JSON restatement of its own heading. It now
   * merges `rawInput`; see its doc for the precedence rule and acpProtocol.test.ts for the
   * assertions pinning it. This test's own call is the zero-argument case (`rawInput:{}`), so its
   * frames are unchanged by that fix.
   *
   * Also observed live, NOT a divergence (both are spec-legal — ACP's `kind` is optional, and this
   * one real agent simply never sends it): goose's own `tool_call` notification never carries a
   * `kind` field at all, so this tool-use frame's `kind` is `undefined` — the OTHER real, exercised
   * branch of Task 2's `kind`-optional design, distinct from the fake-agent test's populated case.
   */
  test.if(HAS_BISMUTH_MCP)(
    "a real goose ACP tool call (bismuth__bismuth_docs_list, a genuine Bismuth MCP tool) yields tool-use then tool-result with equal ids, then completes normally",
    async () => {
      await setup();

      const cwd = await newTempDir("bismuth-goose-toolcall-cwd-");
      const chatId = "goose-mocked-toolcall-" + Date.now();
      chatIds.push(chatId);
      const { sink, frames, waitFor } = makeChatFrameCollector();

      CHAT_BACKENDS.goose.sendMessage({ chatId, cwd, sink, computerUse: false, text: "please list the bismuth docs" });

      await waitFor((f) => f.type === "done");

      // Exactly one of each — never "at least one".
      const toolUseFrames = frames.filter((f) => f.type === "tool-use");
      const toolResultFrames = frames.filter((f) => f.type === "tool-result");
      expect(toolUseFrames.length).toBe(1);
      expect(toolResultFrames.length).toBe(1);

      const toolUse = toolUseFrames[0];
      const toolResult = toolResultFrames[0];
      if (toolUse.type !== "tool-use" || toolResult.type !== "tool-result") throw new Error("unreachable — filtered above");

      // Equal ids — the literal id THIS fixture chose (never derived from either wire response), so
      // this can only pass if the id genuinely round-tripped through goose's real tool_call ->
      // tool_call_update -> Bismuth's translator.
      expect(toolUse.id).toBe("toolu_task12_docslist");
      expect(toolResult.id).toBe(toolUse.id);

      // name: a real ACP ToolCall has no `name` field, so this must be goose's own human-readable
      // `title` for the call (confirmed live: "bismuth: bismuth docs list"), never a raw tool
      // identifier and never the synthesized "tool" fallback.
      expect(toolUse.name.length).toBeGreaterThan(0);
      expect(toolUse.name).not.toBe("tool");
      // kind: see this test's own header — a real, live-confirmed negative: goose's tool_call never
      // sends one.
      expect(toolUse.kind).toBeUndefined();

      expect(toolResult.isError).toBe(false);
      // The real MCP tool's real output — bismuth_docs_list against an EMPTY cwd (no docs there)
      // returns an empty JSON array, verbatim, as the tool_call_update's content text.
      expect(toolResult.content).toBe("[]");

      // Ordering: tool-result strictly after tool-use, result strictly after tool-result, done after
      // result — same three-part ordering discipline as the fake-agent half's test.
      const toolUseIdx = frames.indexOf(toolUse);
      const toolResultIdx = frames.indexOf(toolResult);
      expect(toolResultIdx).toBeGreaterThan(toolUseIdx);
      const resultIdx = frames.findIndex((f) => f.type === "result");
      expect(resultIdx).toBeGreaterThan(toolResultIdx);
      const resultFrame = frames[resultIdx];
      if (resultFrame.type === "result") expect(resultFrame.isError).toBe(false);
      const doneIdx = frames.findIndex((f) => f.type === "done");
      expect(doneIdx).toBeGreaterThan(resultIdx);

      // The turn's own prose (built from the fixture's toolCallId follow-up) still arrived.
      const assistantTexts = frames.filter((f) => f.type === "assistant-text").map((f) => (f.type === "assistant-text" ? f.text : ""));
      expect(assistantTexts.join("")).toBe("Thanks, got the docs list.");
    },
    60_000,
  );
});
