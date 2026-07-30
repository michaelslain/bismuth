#!/usr/bin/env bun
// core/test/support/fakeAcpAgent.ts
// A FAKE Agent Client Protocol agent: a standalone script speaking newline-delimited JSON-RPC 2.0
// over its own stdio, exactly the wire shape core/src/chatProviders/acp/driver.ts drives every real
// ACP CLI (cline/gemini/goose/openclaw/claude-code-acp/codex-acp) through. It is spawned as a stub
// binary in core/test/chatProviders/acpFakeAgent.test.ts (writeFileSync + chmodSync 0o755, prepended
// onto PATH under one of the real agent binary names — mirrors relay/test/wrap.test.ts's own
// "write and chmod a stub binary" pattern, cited in this task's brief as the precedent to follow).
//
// WHY A FAKE AGENT AT ALL (not just another real-CLI mocked test): the driver's model-shape
// version-skew branch (./protocol.ts's detectModelShape — SDKs ~0.20+ report `configOptions` with a
// "model"-category entry; older/still-shipping adapters instead report the OLD
// `models.availableModels`/`currentModelId` shape) can only be exercised by controlling BOTH shapes
// from ONE place. No single real CLI ships both — a real agent is pinned to whichever SDK generation
// it happens to bundle (this task found gemini 0.53.0 returns the OLD shape live; nothing installed
// here returns the NEW one) — so a real-CLI test can only ever prove ONE branch. This script proves
// both, selected per-process via the FAKE_ACP_MODEL_SHAPE env var, because the driver spawns a FRESH
// child per chat session and reads process.env at spawn time (chatProviders/acp/driver.ts's
// spawnAcpProcess -> claudeSpawnEnv(process.env, "chat") — a plain spread, verified in
// claudeMocked.test.ts's own finding for the sibling Claude driver).
//
// SCOPE: covers exactly the driver verbs this task's brief calls out — initialize, session/new
// (both model shapes), session/prompt (a streamed session/update + a settling response), plus enough
// of session/set_config_option + session/set_model to prove setModel/setEffort dispatch to the RIGHT
// wire method for each shape. Deliberately NOT a general-purpose ACP simulator: no tool calls, no
// session/load|resume, no MCP — those aren't what this task needs proven, and every real-CLI test
// alongside this one already exercises the driver against a genuine binary for what IS installed.
//
// Tolerant by construction, like every other piece of this harness: a malformed/unrecognized method
// gets a generic empty result rather than crashing the process — a fake agent that dies mid-test
// would just look like a flaky test, not a useful failure signal.
import { createInterface } from "node:readline";

type JsonRpcMsg = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: unknown; result?: unknown; error?: unknown };

function writeLine(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function respond(id: number | string, result: unknown): void {
  writeLine({ jsonrpc: "2.0", id, result });
}

function notify(method: string, params: unknown): void {
  writeLine({ jsonrpc: "2.0", method, params });
}

/** "old" (models.availableModels/currentModelId — still-shipping 0.14.1-pinned adapters + cline's
 *  own bundled dispatch, and confirmed live against a real `gemini` 0.53.0 in this task) or "new"
 *  (configOptions with a "model"-category entry — SDKs ~0.20+). Defaults to "new" so a caller that
 *  forgets to set the env var still gets a valid, well-formed session/new rather than silently
 *  falling back to neither shape. */
const modelShape = process.env.FAKE_ACP_MODEL_SHAPE === "old" ? "old" : "new";

/** Text used to prove a real turn round-tripped through THIS fake, distinguishable from any real
 *  aimock fixture text (see core/test/fixtures/llm/basic-turn.json's "Hello!") so a test asserting on
 *  it can never be fooled by a stray real mock server accidentally still running. */
const FAKE_TURN_TEXT = "Hello from the fake ACP agent";

let sessionCounter = 0;
/** Learned once per fake session, so setModel's dispatch-target assertions can check it changed. */
const currentModel = new Map<string, string>();

function handleInitialize(id: number | string): void {
  respond(id, {
    protocolVersion: 1,
    agentCapabilities: { loadSession: true, promptCapabilities: { image: false, audio: false, embeddedContext: false } },
    agentInfo: { name: "fake-acp-agent", version: "0.0.1" },
    // Empty on purpose: this fake's session/new never demands an authenticate() first (unlike real
    // cline 3.0.47 — see backendEnv.ts's cline finding) — the driver never calls it either way
    // (core/src/chatProviders/acp/driver.ts has no authenticate() call at all), so an empty array
    // here is simply honest about what this fake offers, not a workaround for anything.
    authMethods: [],
  });
}

function handleSessionNew(id: number | string): void {
  sessionCounter += 1;
  const sessionId = `fake-session-${modelShape}-${sessionCounter}`;
  if (modelShape === "old") {
    currentModel.set(sessionId, "fake-model-a");
    respond(id, {
      sessionId,
      models: {
        availableModels: [
          { modelId: "fake-model-a", name: "Fake Model A", description: "old-shape model a" },
          { modelId: "fake-model-b", name: "Fake Model B", description: "old-shape model b" },
        ],
        currentModelId: "fake-model-a",
      },
    });
  } else {
    currentModel.set(sessionId, "fake-model-x");
    respond(id, {
      sessionId,
      configOptions: [
        {
          id: "model-config",
          name: "Model",
          category: "model",
          type: "select",
          options: [
            { id: "fake-model-x", name: "Fake Model X" },
            { id: "fake-model-y", name: "Fake Model Y" },
          ],
          currentValue: "fake-model-x",
        },
        {
          id: "effort-config",
          name: "Thinking",
          category: "thought_level",
          type: "select",
          options: [
            { id: "low", name: "Low" },
            { id: "high", name: "High" },
          ],
          currentValue: "low",
        },
      ],
    });
  }
}

function handleSessionPrompt(id: number | string, params: unknown): void {
  const sessionId = (params && typeof params === "object" && "sessionId" in params && typeof (params as { sessionId: unknown }).sessionId === "string" && (params as { sessionId: string }).sessionId) || "unknown";
  notify("session/update", {
    sessionId,
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: FAKE_TURN_TEXT } },
  });
  respond(id, { stopReason: "end_turn" });
}

/** Acks BOTH setModel dispatch targets driver.ts can send (session/set_config_option for the "new"
 *  shape, session/set_model for the "old" one) — see driver.ts's setModel, which branches on
 *  s.modelShape.shape to pick exactly one of these per session. */
function handleSetConfigOption(id: number | string, params: unknown): void {
  const p = (params && typeof params === "object" ? params : {}) as { sessionId?: string; value?: string };
  if (p.sessionId && typeof p.value === "string") currentModel.set(p.sessionId, p.value);
  respond(id, {});
}

function handleSetModelOld(id: number | string, params: unknown): void {
  const p = (params && typeof params === "object" ? params : {}) as { sessionId?: string; modelId?: string };
  if (p.sessionId && typeof p.modelId === "string") currentModel.set(p.sessionId, p.modelId);
  respond(id, {});
}

function handleLine(raw: string): void {
  const trimmed = raw.trim();
  if (!trimmed) return;
  let msg: JsonRpcMsg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return; // non-JSON noise — never crash the fake over a stray line
  }
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return; // a response/notification we sent isn't looped back, but stay defensive
  const { method, params, id } = msg;

  switch (method) {
    case "initialize":
      if (id !== undefined) handleInitialize(id);
      return;
    case "session/new":
      if (id !== undefined) handleSessionNew(id);
      return;
    case "session/prompt":
      if (id !== undefined) handleSessionPrompt(id, params);
      return;
    case "session/set_config_option":
      if (id !== undefined) handleSetConfigOption(id, params);
      return;
    case "session/set_model":
      if (id !== undefined) handleSetModelOld(id, params);
      return;
    case "session/cancel":
      return; // notification — nothing to reply to; a real cancel-then-settle isn't this fake's job
    default:
      // Unknown/unimplemented verb the real driver might still call (session/load, session/resume,
      // …): reply with an empty result rather than a method-not-found error so a test exercising
      // those paths degrades gracefully instead of crashing the fake.
      if (id !== undefined) respond(id, {});
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", handleLine);
process.stdin.resume();
