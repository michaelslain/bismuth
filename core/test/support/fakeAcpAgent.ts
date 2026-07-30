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
//
// CLINE AUTH-GATE MODE (added for the "close the cline coverage gap" task — see
// clineAuthFakeAgent.test.ts): opt-in via FAKE_ACP_AUTH_GATE=cline, decoupled from the model-shape
// logic above so acpFakeAgent.test.ts's existing three tests (which never set this var) are
// unaffected byte-for-byte. Reproduces cline 3.0.47's REAL ACP auth surface, read from its own
// compiled binary (`npm install cline@3.0.47`, `strings`'d the bundled Bun executable at
// bin/.cline — same technique agents.ts's own header already used for this binary):
//   - `initialize`'s authMethods, verified verbatim from the minified source's own
//     `var B=[{id:"cline",name:"Sign in with Cline"},{id:"openai-codex",name:"Sign in with ChatGPT
//     Subscription"}]` (this array is BOTH the authMethods list AND the only valid `authenticate`
//     methodId allowlist in the real binary).
//   - `session/new`'s gate, verified verbatim from: `async newSession(z){if(!this.authResult&&
//     !process.env.CLINE_API_KEY){if(this.authResult=this.tryRestoreAuth(),!this.authResult)throw
//     $.authRequired(void 0,"Call authenticate before creating a session")}...}` — an ACP SDK
//     `RequestError.authRequired(data, detail)` helper that renders as JSON-RPC code -32000, message
//     `"Authentication required: Call authenticate before creating a session"` (confirmed from the
//     SDK's own `static authRequired(X,Z){return new D(-32000,\`Authentication required${Z?
//     `: ${Z}`:""}\`,X)}`).
//   - The REAL bypass this task discovered and live-verified (a real cline 3.0.47 binary, driven
//     through Bismuth's own unmodified production driver, completed a full ACP turn against a local
//     mock LLM this way — see backendEnv.ts's `cline` case + clineMocked.test.ts's new "real E2E"
//     block): `process.env.CLINE_API_KEY`, read at newSession() time, unconditionally skips the
//     throw above. Bismuth's driver (chatProviders/acp/driver.ts) never calls the ACP `authenticate`
//     method at all (grep confirms no `call(s, "authenticate", ...)` anywhere in that file) — so the
//     only faithful way for THIS fake to model "the gate is satisfied" is the exact same shape the
//     real binary itself offers: an env var read fresh at THIS process's own spawn time,
//     FAKE_ACP_CLINE_AUTHED, standing in for CLINE_API_KEY. This is not invented — it mirrors a real,
//     cited mechanism 1:1, chosen because it is the only bypass that exists at all (see the case
//     comment above it for the full finding).
//
// SCOPE LIMIT of this mode (a code-review finding on this task, recorded explicitly so nobody
// mistakes this for broader coverage than it is): this mode reproduces cline's AUTH surface only.
// Once the gate is open, `handleSessionNew` below falls through to the SAME generic
// old/new-model-shape logic FAKE_ACP_MODEL_SHAPE already drives (this file's own hand-built
// `{id, name}`-shaped configOptions) — NOT cline's real, quirkier `provider`-then-`model`
// `configOptions` ordering (see backendEnv.ts's `cline` case, "TWO HONEST LIMITS" #2, for that
// separate, already-cited bug: a real cline session emits a "provider" selector ahead of the true
// "model" selector under the same category, which poisons both the `models` ChatFrame and
// `modelConfigId`). This mode's own gate-OPEN test therefore CANNOT catch that bug — it was found
// only by driving the REAL binary (clineMocked.test.ts's "real E2E" block), and this
// always-running, binary-independent fake structurally never will unless a future task teaches it
// cline's real configOptions shape too.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

type JsonRpcMsg = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: unknown; result?: unknown; error?: unknown };

/**
 * Optional echo file (a code-review addition — see acpFakeAgent.test.ts's setModel test): when
 * `FAKE_ACP_ECHO_FILE` is set, every inbound JSON-RPC REQUEST (never a notification we send
 * ourselves) is appended to it as one `{method, params}` JSON line, so a test can observe WHICH wire
 * method the driver actually sent — driver.ts's setModel is fire-and-forget with a swallowed
 * `.catch()`, so nothing about its own success/failure is otherwise observable from outside the
 * driver; this file is the only way a test can distinguish "the driver sent
 * session/set_config_option" from "the driver silently sent nothing at all". Best-effort: a write
 * failure (missing dir, permissions) is swallowed rather than crashing the fake agent over what is
 * purely a test-observability channel, not part of the ACP protocol itself.
 */
function echo(method: string, params: unknown): void {
  const path = process.env.FAKE_ACP_ECHO_FILE;
  if (!path) return;
  try {
    appendFileSync(path, JSON.stringify({ method, params }) + "\n");
  } catch {
    /* best-effort observability only */
  }
}

function writeLine(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function respond(id: number | string, result: unknown): void {
  writeLine({ jsonrpc: "2.0", id, result });
}

/** A JSON-RPC error response — the shape cline's own ACP SDK helper (`RequestError.authRequired`)
 *  produces for the auth gate, and the general shape any rejected outbound call takes on the wire
 *  (see ./protocol.ts's AcpRpcError, which driver.ts constructs from exactly these two fields). */
function respondError(id: number | string, code: number, message: string): void {
  writeLine({ jsonrpc: "2.0", id, error: { code, message } });
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

/** See this file's header "CLINE AUTH-GATE MODE" section. Unset (the default, what
 *  acpFakeAgent.test.ts's three pre-existing tests get) reproduces this fake's ORIGINAL behavior
 *  byte-for-byte: no gate, empty authMethods. "cline" reproduces cline 3.0.47's real auth surface,
 *  cited above. */
const authGate = process.env.FAKE_ACP_AUTH_GATE === "cline" ? "cline" : "none";

/** Mirrors real cline's `process.env.CLINE_API_KEY` bypass — see this file's header. Only consulted
 *  when authGate is "cline"; irrelevant (and expected unset) otherwise. */
const clineAuthed = authGate === "cline" && !!process.env.FAKE_ACP_CLINE_AUTHED;

/** Verbatim from cline 3.0.47's own `var B=[...]` — see this file's header citation. Real cline uses
 *  this SAME array as both `initialize`'s authMethods AND `authenticate`'s methodId allowlist; this
 *  fake only needs the authMethods half (the driver never calls `authenticate` — see the header). */
const CLINE_AUTH_METHODS = [
  { id: "cline", name: "Sign in with Cline" },
  { id: "openai-codex", name: "Sign in with ChatGPT Subscription" },
];

let sessionCounter = 0;

function handleInitialize(id: number | string): void {
  respond(id, {
    protocolVersion: 1,
    agentCapabilities: { loadSession: true, promptCapabilities: { image: false, audio: false, embeddedContext: false } },
    agentInfo: { name: "fake-acp-agent", version: "0.0.1" },
    // Empty by default: this fake's session/new never demands an authenticate() first UNLESS
    // FAKE_ACP_AUTH_GATE=cline is set (see this file's header) — the driver itself never calls
    // authenticate() either way (core/src/chatProviders/acp/driver.ts has no authenticate() call at
    // all), so an empty array here is simply honest about what this fake offers by default, not a
    // workaround for anything. In "cline" gate mode, this is cline's own real authMethods verbatim.
    authMethods: authGate === "cline" ? CLINE_AUTH_METHODS : [],
  });
}

function handleSessionNew(id: number | string): void {
  if (authGate === "cline" && !clineAuthed) {
    // Verbatim shape of cline 3.0.47's real refusal — see this file's header citation for both the
    // triggering source line and the SDK helper that renders it as this exact {code, message}.
    respondError(id, -32000, "Authentication required: Call authenticate before creating a session");
    return;
  }
  sessionCounter += 1;
  const sessionId = `fake-session-${modelShape}-${sessionCounter}`;
  if (modelShape === "old") {
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
 *  s.modelShape.shape to pick exactly one of these per session. Which one actually arrived (and
 *  with what params) is observable via the FAKE_ACP_ECHO_FILE mechanism above, not tracked here. */
function handleSetConfigOption(id: number | string): void {
  respond(id, {});
}

function handleSetModelOld(id: number | string): void {
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
  echo(method, params);

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
      if (id !== undefined) handleSetConfigOption(id);
      return;
    case "session/set_model":
      if (id !== undefined) handleSetModelOld(id);
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
